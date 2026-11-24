import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import {
  randomToken,
  digest,
  passwordHash,
  verifyPassword,
  ownsTicket,
} from "./security";
type Identity = {
  kind: "staff" | "user";
  id: string;
  role?: string;
  name?: string;
};
type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  RATE_LIMITER: RateLimit;
  BOOTSTRAP_SECRET: string;
};
const app = new Hono<{ Bindings: Env; Variables: { identity: Identity } }>();
type AppContext = Context<{ Bindings: Env; Variables: { identity: Identity } }>;
const audit = (c: AppContext, action: string, target: string, detail = "") =>
  c.env.DB.prepare(
    "INSERT INTO audit_logs(id,actor_id,actor_name,action,target,detail) VALUES (?,?,?,?,?,?)",
  ).bind(
    crypto.randomUUID(),
    c.get("identity").id,
    c.get("identity").name || "员工",
    action,
    target,
    detail,
  );
const fail = (status: 400 | 401 | 403 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};
const str = (value: unknown, max = 10000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return fail(400, "字段为空或超出长度限制");
  return value.trim();
};
app.onError((e, c) =>
  e instanceof SyntaxError
    ? c.json({ error: "请求格式不正确" }, 400)
    : c.json(
        { error: e instanceof HTTPException ? e.message : "服务暂时不可用" },
        e instanceof HTTPException ? e.status : 500,
      ),
);
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 11 * 1024 * 1024,
    onError: (c) => c.json({ error: "上传文件不能超过 10 MB" }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (
      origin &&
      origin !== new URL(c.req.url).origin &&
      !(
        new URL(c.req.url).hostname === "localhost" &&
        origin === "http://localhost:5173"
      )
    )
      return fail(403, "不允许的请求来源");
  }
  const ip = c.req.header("CF-Connecting-IP") || "local";
  if (
    c.env.RATE_LIMITER &&
    !(await c.env.RATE_LIMITER.limit({ key: ip })).success
  )
    return c.json({ error: "请求过于频繁，请稍后重试" }, 429);
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  await next();
});
app.post("/api/setup", async (c) => {
  if (
    !c.env.BOOTSTRAP_SECRET ||
    c.req.header("Authorization") !== `Bearer ${c.env.BOOTSTRAP_SECRET}`
  )
    return fail(403, "禁止访问");
  const b = await c.req.json();
  const email = str(b.email, 200).toLowerCase(),
    name = str(b.name, 80),
    password = str(b.password, 128);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 12)
    return fail(400, "密码至少 12 位");
  const result = await c.env.DB.prepare(
    "INSERT INTO staff(id,email,name,password,role) SELECT ?,?,?,?,'admin' WHERE NOT EXISTS(SELECT 1 FROM staff WHERE role='admin')",
  )
    .bind(crypto.randomUUID(), email, name, await passwordHash(password))
    .run();
  if (!result.meta.changes) return fail(409, "已初始化");
  return c.json({ ok: true }, 201);
});
app.post("/api/auth/login", async (c) => {
  const b = await c.req.json();
  const email = str(b.email, 200).toLowerCase(),
    password = str(b.password, 128);
  const user = await c.env.DB.prepare(
    "SELECT * FROM staff WHERE email=? AND active=1",
  )
    .bind(email)
    .first<any>();
  if (!user || !(await verifyPassword(password, user.password)))
    return fail(401, "邮箱或密码错误");
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions VALUES (?,?,?)")
    .bind(await digest(token), user.id, Date.now() + 86400000)
    .run();
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 86400,
  });
  return c.json({ id: user.id, name: user.name, role: user.role });
});
app.post("/api/installations", async (c) => {
  const token = randomToken(),
    id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO installations(id,token) VALUES (?,?)")
    .bind(id, await digest(token))
    .run();
  return c.json({ id, token }, 201);
});
app.use("/api/*", async (c, next) => {
  const cookie = getCookie(c, "session");
  if (cookie) {
    const u = await c.env.DB.prepare(
      "SELECT staff.id,staff.role,staff.name FROM sessions JOIN staff ON staff.id=sessions.staff_id WHERE sessions.token=? AND sessions.expires>? AND staff.active=1",
    )
      .bind(await digest(cookie), Date.now())
      .first<any>();
    if (u) c.set("identity", { kind: "staff", ...u });
  }
  if (!c.get("identity")) {
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "");
    if (token) {
      const u = await c.env.DB.prepare(
        "SELECT id FROM installations WHERE token=?",
      )
        .bind(await digest(token))
        .first<{ id: string }>();
      if (u) c.set("identity", { kind: "user", id: u.id });
    }
  }
  if (!c.get("identity")) return fail(401, "请先登录或提供有效的安装令牌");
  await next();
});
app.get("/api/me", (c) => c.json(c.get("identity")));
app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, "session");
  if (token)
    await c.env.DB.prepare("DELETE FROM sessions WHERE token=?")
      .bind(await digest(token))
      .run();
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});
app.post("/api/auth/password", async (c) => {
  const u = c.get("identity");
  if (u.kind !== "staff") return fail(403, "需要员工身份");
  const b = await c.req.json(),
    current = str(b.currentPassword, 128),
    password = str(b.password, 128);
  if (password.length < 12) return fail(400, "密码至少 12 位");
  const account = await c.env.DB.prepare(
    "SELECT password FROM staff WHERE id=?",
  )
    .bind(u.id)
    .first<{ password: string }>();
  if (!account || !(await verifyPassword(current, account.password)))
    return fail(400, "当前密码不正确");
  if (password === current) return fail(400, "新密码不能与当前密码相同");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE staff SET password=? WHERE id=?").bind(
      await passwordHash(password),
      u.id,
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE staff_id=?").bind(u.id),
    audit(c, "password_changed", u.id),
  ]);
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});
app.get("/api/team", async (c) => {
  if (c.get("identity").kind !== "staff") return fail(403, "需要员工身份");
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,name,active FROM staff ORDER BY name",
      ).all()
    ).results,
  );
});
app.get("/api/overview", async (c) => {
  if (c.get("identity").kind !== "staff") return fail(403, "需要员工身份");
  return c.json(
    await c.env.DB.prepare(
      "SELECT COUNT(*) total,COALESCE(SUM(status='waiting_staff'),0) waiting_staff,COALESCE(SUM(status='waiting_user'),0) waiting_user,COALESCE(SUM(status='closed'),0) closed,COALESCE(SUM(assigned_to IS NULL AND status!='closed'),0) unassigned FROM tickets",
    ).first(),
  );
});
app.use("/api/staff/*", async (c, next) => {
  if (c.get("identity").role !== "admin") return fail(403, "需要管理员权限");
  await next();
});
app.get("/api/staff/audit", async (c) => {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const items = (
    await c.env.DB.prepare(
      "SELECT * FROM audit_logs ORDER BY created_at DESC,rowid DESC LIMIT 30 OFFSET ?",
    )
      .bind((page - 1) * 30)
      .all()
  ).results;
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) n FROM audit_logs",
  ).first<{ n: number }>();
  return c.json({ items, total: total?.n || 0, page });
});
app.post("/api/staff/accounts/:id/password", async (c) => {
  const id = c.req.param("id"),
    target = await c.env.DB.prepare("SELECT role FROM staff WHERE id=?")
      .bind(id)
      .first<{ role: string }>();
  if (!target) return fail(404, "账号不存在");
  if (target.role === "admin") return fail(403, "管理员请通过个人设置修改密码");
  const b = await c.req.json(),
    password = str(b.password, 128);
  if (password.length < 12) return fail(400, "密码至少 12 位");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE staff SET password=? WHERE id=?").bind(
      await passwordHash(password),
      id,
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE staff_id=?").bind(id),
    audit(c, "password_reset", id),
  ]);
  return c.json({ ok: true });
});
app.get("/api/staff/accounts", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,email,name,role,active FROM staff ORDER BY created_at",
      ).all()
    ).results,
  ),
);
app.post("/api/staff/accounts", async (c) => {
  const b = await c.req.json();
  const email = str(b.email, 200).toLowerCase(),
    name = str(b.name, 80),
    password = str(b.password, 128);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 12)
    return fail(400, "请输入有效邮箱和至少 12 位密码");
  if (
    await c.env.DB.prepare("SELECT id FROM staff WHERE email=?")
      .bind(email)
      .first()
  )
    return fail(409, "邮箱已存在");
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO staff(id,email,name,password,role) VALUES (?,?,?,?,'agent')",
    ).bind(id, email, name, await passwordHash(password)),
    audit(c, "staff_created", id, name),
  ]);
  return c.json({ id }, 201);
});
app.patch("/api/staff/accounts/:id", async (c) => {
  const target = await c.env.DB.prepare("SELECT role FROM staff WHERE id=?")
    .bind(c.req.param("id"))
    .first<any>();
  if (!target) return fail(404, "账号不存在");
  if (target.role === "admin") return fail(403, "此接口只能管理员工账号");
  const b = await c.req.json();
  if (typeof b.active !== "boolean") return fail(400, "active 必须为布尔值");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE staff SET active=? WHERE id=?").bind(
      b.active ? 1 : 0,
      c.req.param("id"),
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE staff_id=?").bind(
      c.req.param("id"),
    ),
    audit(c, b.active ? "staff_enabled" : "staff_disabled", c.req.param("id")),
  ]);
  return c.json({ ok: true });
});
app.get("/api/tickets", async (c) => {
  const u = c.get("identity"),
    page = Math.max(
      1,
      Math.min(10000, Math.floor(Number(c.req.query("page")) || 1)),
    );
  const search = (c.req.query("q") || "").slice(0, 100),
    status = c.req.query("status") || "";
  const assignee = u.kind === "staff" ? c.req.query("assignee") || "" : "";
  const where =
    "WHERE (? = 1 OR installation_id = ?) AND (? = '' OR status = ?) AND title LIKE ? AND (? = '' OR (? = 'unassigned' AND assigned_to IS NULL) OR assigned_to = ?)";
  const args = [
    u.kind === "staff" ? 1 : 0,
    u.id,
    status,
    status,
    "%" + search + "%",
    assignee,
    assignee,
    assignee,
  ];
  const items = await c.env.DB.prepare(
    `SELECT * FROM tickets ${where} ORDER BY updated_at DESC,id DESC LIMIT 30 OFFSET ?`,
  )
    .bind(...args, (page - 1) * 30)
    .all();
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tickets ${where}`,
  )
    .bind(...args)
    .first<{ n: number }>();
  return c.json({ items: items.results, total: total?.n || 0, page });
});
app.post("/api/tickets", async (c) => {
  const u = c.get("identity");
  if (u.kind !== "user") return fail(403, "请从 iOS 客户端提交工单");
  const b = await c.req.json();
  const id = crypto.randomUUID(),
    messageId = crypto.randomUUID();
  const title = str(b.title, 160),
    body = str(b.body),
    device = typeof b.device === "string" ? b.device.slice(0, 1000) : "";
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO tickets(id,installation_id,title,device) VALUES (?,?,?,?)",
    ).bind(id, u.id, title, device),
    c.env.DB.prepare(
      "INSERT INTO messages(id,ticket_id,sender,author,body) VALUES (?,?,'user','用户',?)",
    ).bind(messageId, id, body),
  ]);
  return c.json({ id, messageId }, 201);
});
app.use("/api/tickets/:id/*", async (c, next) => {
  const ticket = await c.env.DB.prepare("SELECT * FROM tickets WHERE id=?")
    .bind(c.req.param("id")!)
    .first<any>();
  if (!ticket || !ownsTicket(ticket, c.get("identity")))
    return fail(404, "工单不存在");
  await next();
});
// Exact paths are checked separately to avoid relying on wildcard matching semantics.
async function ticketFor(c: any) {
  const ticket = await c.env.DB.prepare("SELECT * FROM tickets WHERE id=?")
    .bind(c.req.param("id"))
    .first();
  if (!ticket || !ownsTicket(ticket, c.get("identity")))
    return fail(404, "工单不存在");
  return ticket;
}
app.get("/api/tickets/:id", async (c) => {
  const ticket = await ticketFor(c);
  const messages = await c.env.DB.prepare(
    "SELECT * FROM messages WHERE ticket_id=? ORDER BY created_at,rowid",
  )
    .bind(ticket.id)
    .all();
  const attachments = await c.env.DB.prepare(
    "SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.ticket_id=?",
  )
    .bind(ticket.id)
    .all();
  return c.json({
    ...ticket,
    messages: messages.results,
    attachments: attachments.results,
  });
});
app.post("/api/tickets/:id/messages", async (c) => {
  const ticket = await ticketFor(c);
  if (ticket.status === "closed") return fail(409, "工单已关闭，请先重新打开");
  const u = c.get("identity"),
    b = await c.req.json(),
    id = crypto.randomUUID(),
    body = str(b.body);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO messages(id,ticket_id,sender,author,body) VALUES (?,?,?,?,?)",
    ).bind(
      id,
      ticket.id,
      u.kind === "staff" ? "staff" : "user",
      u.name || "用户",
      body,
    ),
    c.env.DB.prepare(
      "UPDATE tickets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(u.kind === "staff" ? "waiting_user" : "waiting_staff", ticket.id),
  ]);
  return c.json({ id }, 201);
});
app.patch("/api/tickets/:id", async (c) => {
  const t = await ticketFor(c),
    b = await c.req.json(),
    u = c.get("identity"),
    hasStatus = Object.hasOwn(b, "status"),
    hasAssignee = Object.hasOwn(b, "assigned_to");
  if (!hasStatus && !hasAssignee) return fail(400, "没有可更新的字段");
  if (hasStatus && !["closed", "waiting_staff"].includes(b.status))
    return fail(400, "不支持的状态");
  if (hasAssignee) {
    if (u.kind !== "staff") return fail(403, "只有员工可以分配工单");
    if (
      b.assigned_to !== null &&
      (typeof b.assigned_to !== "string" ||
        !(await c.env.DB.prepare("SELECT id FROM staff WHERE id=? AND active=1")
          .bind(b.assigned_to)
          .first()))
    )
      return fail(400, "请选择有效的在职员工");
  }
  const statements = [
    c.env.DB.prepare(
      "UPDATE tickets SET status=?,assigned_to=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(
      hasStatus ? b.status : t.status,
      hasAssignee ? b.assigned_to : t.assigned_to,
      t.id,
    ),
  ];
  if (u.kind === "staff")
    statements.push(
      audit(
        c,
        "ticket_updated",
        t.id,
        JSON.stringify({
          ...(hasStatus ? { status: b.status } : {}),
          ...(hasAssignee ? { assigned_to: b.assigned_to } : {}),
        }),
      ),
    );
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});
app.post("/api/tickets/:id/messages/:messageId/attachments", async (c) => {
  await ticketFor(c);
  const m = await c.env.DB.prepare(
    "SELECT * FROM messages WHERE id=? AND ticket_id=?",
  )
    .bind(c.req.param("messageId"), c.req.param("id"))
    .first<any>();
  if (!m) return fail(404, "消息不存在");
  const u = c.get("identity");
  if (u.kind === "user" && m.sender !== "user")
    return fail(403, "只能向自己的消息添加附件");
  const form = await c.req.formData(),
    file = form.get("file");
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > 10 * 1024 * 1024
  )
    return fail(400, "请选择不超过 10 MB 的文件");
  if (!/\.(log|txt|zip|gz|png|jpg|jpeg)$/i.test(file.name))
    return fail(400, "不支持的附件类型");
  const id = crypto.randomUUID();
  await c.env.FILES.put(id, file.stream(), {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  try {
    await c.env.DB.prepare(
      "INSERT INTO attachments(id,message_id,name,size) VALUES (?,?,?,?)",
    )
      .bind(id, m.id, file.name.slice(0, 200), file.size)
      .run();
  } catch (e) {
    await c.env.FILES.delete(id);
    throw e;
  }
  return c.json({ id }, 201);
});
app.get("/api/attachments/:id", async (c) => {
  const a = await c.env.DB.prepare(
    "SELECT a.*,t.installation_id FROM attachments a JOIN messages m ON m.id=a.message_id JOIN tickets t ON t.id=m.ticket_id WHERE a.id=?",
  )
    .bind(c.req.param("id"))
    .first<any>();
  if (!a || !ownsTicket(a, c.get("identity"))) return fail(404, "附件不存在");
  const file = await c.env.FILES.get(a.id);
  if (!file) return fail(404, "附件已过期或不存在");
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
