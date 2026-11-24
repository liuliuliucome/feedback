import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MantineProvider,
  AppShell,
  Group,
  Stack,
  Text,
  Title,
  Button,
  TextInput,
  PasswordInput,
  Paper,
  Badge,
  Table,
  Select,
  Textarea,
  Modal,
  Alert,
  Avatar,
  Pagination,
  Loader,
  Divider,
  ActionIcon,
  SimpleGrid,
  Burger,
} from "@mantine/core";
import {
  IconInbox,
  IconUsers,
  IconLogout,
  IconSearch,
  IconArrowLeft,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconBolt,
  IconShieldLock,
  IconHistory,
} from "@tabler/icons-react";
import "@mantine/core/styles.css";
import "./style.css";
type User = { id: string; name: string; role: string };
type Staff = User & { email: string; active: number };
type Ticket = {
  id: string;
  title: string;
  status: string;
  device: string;
  created_at: string;
  updated_at: string;
  installation_id: string;
  assigned_to: string | null;
  messages?: Message[];
  attachments?: Attachment[];
};
type Message = {
  id: string;
  sender: string;
  author: string;
  body: string;
  created_at: string;
};
type Attachment = {
  id: string;
  message_id: string;
  name: string;
  size: number;
};
type Audit = {
  id: string;
  actor_name: string;
  action: string;
  target: string;
  detail: string;
  created_at: string;
};
const labels: Record<string, string> = {
  waiting_staff: "待客服回复",
  waiting_user: "待用户回复",
  closed: "已关闭",
};
const colors: Record<string, string> = {
  waiting_staff: "orange",
  waiting_user: "blue",
  closed: "gray",
};
const actions: Record<string, string> = {
  staff_created: "创建员工",
  staff_enabled: "启用员工",
  staff_disabled: "停用员工",
  password_reset: "重置员工密码",
  password_changed: "修改个人密码",
  ticket_updated: "更新工单",
};
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await r.json();
  if (!r.ok) {
    if (r.status === 401 && path !== "/auth/login" && path !== "/me")
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(data.error || "请求失败", r.status);
  }
  return data;
}
const time = (s: string) =>
  new Date(s.replace(" ", "T") + "Z").toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
function App() {
  const [user, setUser] = useState<User | null>(null),
    [initial, setInitial] = useState(true),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [mobile, setMobile] = useState(false);
  const [view, setView] = useState("tickets"),
    [tickets, setTickets] = useState<Ticket[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [status, setStatus] = useState(""),
    [q, setQ] = useState(""),
    [assignee, setAssignee] = useState(""),
    [selected, setSelected] = useState<Ticket | null>(null),
    [reply, setReply] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]),
    [team, setTeam] = useState<Staff[]>([]),
    [overview, setOverview] = useState<Record<string, number>>({});
  const [audit, setAudit] = useState<Audit[]>([]),
    [auditTotal, setAuditTotal] = useState(0),
    [auditPage, setAuditPage] = useState(1);
  const [modal, setModal] = useState<"create" | "reset" | "disable" | null>(
      null,
    ),
    [target, setTarget] = useState<Staff | null>(null);
  const [newName, setNewName] = useState(""),
    [newEmail, setNewEmail] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const resetSession = () => {
    setUser(null);
    setSelected(null);
    setTickets([]);
    setStaff([]);
    setAudit([]);
    setReply("");
    setNewPassword("");
    setCurrentPassword("");
    setConfirmPassword("");
    setModal(null);
    setView("tickets");
  };
  useEffect(() => {
    api("/me")
      .then((u) => {
        if (u.kind === "staff") setUser(u);
      })
      .catch((e) => {
        if (e.status !== 401) setError("无法连接服务，请刷新后重试");
      })
      .finally(() => setInitial(false));
  }, []);
  useEffect(() => {
    const expire = () => {
      resetSession();
      setError("登录已过期，请重新登录");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  async function run(fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const query = `/tickets?${new URLSearchParams({ page: String(page), status, q, assignee })}`;
  async function refresh() {
    const [d, stats, members] = await Promise.all([
      api(query),
      api("/overview"),
      api("/team"),
    ]);
    setTickets(d.items);
    setTotal(d.total);
    setOverview(stats);
    setTeam(members);
  }
  useEffect(() => {
    if (!user || view !== "tickets" || selected) return;
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.all([api(query), api("/overview"), api("/team")])
        .then(([d, stats, members]) => {
          if (live) {
            setTickets(d.items);
            setTotal(d.total);
            setOverview(stats);
            setTeam(members);
          }
        })
        .catch((e) => live && setError(e.message))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [user, query, view, selected]);
  useEffect(() => {
    if (user?.role !== "admin" || !["staff", "audit"].includes(view)) return;
    let live = true;
    setLoading(true);
    api(view === "staff" ? "/staff/accounts" : `/staff/audit?page=${auditPage}`)
      .then((d) => {
        if (live) {
          if (view === "staff") setStaff(d);
          else {
            setAudit(d.items);
            setAuditTotal(d.total);
          }
        }
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [user, view, auditPage]);
  const open = (id: string) =>
    run(async () => {
      setSelected(await api("/tickets/" + id));
      setReply("");
    });
  const navigate = (next: string) => {
    setView(next);
    setSelected(null);
    setError("");
    setNotice("");
    setMobile(false);
    setNewPassword("");
    setCurrentPassword("");
    setConfirmPassword("");
  };
  const closeModal = () => {
    if (!busy) {
      setModal(null);
      setNewPassword("");
      setNewName("");
      setNewEmail("");
    }
  };
  async function updateTicket(body: unknown) {
    await api("/tickets/" + selected!.id, "PATCH", body);
    setSelected(await api("/tickets/" + selected!.id));
  }
  const person = (id: string | null) =>
    team.find((t) => t.id === id)?.name || (id ? "已停用员工" : "未分配");
  if (initial)
    return (
      <div className="center">
        <Loader aria-label="加载工作台" />
      </div>
    );
  const alerts = (
    <>
      {error && (
        <Alert color="red" mb="lg" withCloseButton onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert color="teal" mb="lg">
          {notice}
        </Alert>
      )}
    </>
  );
  if (!user)
    return (
      <div className="login">
        <Paper p={36} radius="lg" withBorder w={440} maw="100%">
          <Group mb={28}>
            <div className="brand-icon">
              <IconBolt />
            </div>
            <Title order={2}>Topfast</Title>
          </Group>
          <Title order={3}>登录工单工作台</Title>
          <Text c="dimmed" mt={8} mb={24}>
            集中处理反馈，持续跟进每一个问题。
          </Text>
          {alerts}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                setUser(await api("/auth/login", "POST", { email, password }));
                setPassword("");
              });
            }}
          >
            <Stack>
              <TextInput
                label="工作邮箱"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <PasswordInput
                label="密码"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" loading={busy}>
                登录工作台
              </Button>
            </Stack>
          </form>
          <Text size="sm" c="dimmed" mt={24}>
            请联系管理员开通账号或重置密码。
          </Text>
        </Paper>
      </div>
    );
  const viewName = {
    tickets: "工单收件箱",
    staff: "员工管理",
    audit: "操作记录",
    security: "账号安全",
  }[view];
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 236, breakpoint: "sm", collapsed: { mobile: !mobile } }}
      padding="xl"
    >
      <AppShell.Header>
        <Group h="100%" px="lg">
          <Burger
            opened={mobile}
            onClick={() => setMobile(!mobile)}
            hiddenFrom="sm"
            size="sm"
            aria-label="展开导航"
          />
          <div className="brand-icon">
            <IconBolt size={22} />
          </div>
          <Text fw={700}>
            Topfast{" "}
            <Text span fw={400} c="dimmed">
              / 工单工作台
            </Text>
          </Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="lg">
        <Text size="sm" fw={600} c="dimmed" mb="md">
          工作空间
        </Text>
        {[
          ["tickets", "工单收件箱", IconInbox],
          ...(user.role === "admin"
            ? [
                ["staff", "员工管理", IconUsers],
                ["audit", "操作记录", IconHistory],
              ]
            : []),
          ["security", "账号安全", IconShieldLock],
        ].map(([key, title, Icon]) => {
          const NavIcon = Icon as typeof IconInbox;
          return (
            <button
              key={key as string}
              className={"nav " + (view === key ? "active" : "")}
              onClick={() => navigate(key as string)}
            >
              <NavIcon size={20} />
              {title as string}
            </button>
          );
        })}
        <div className="sidebar-bottom">
          <Divider my="lg" />
          <Group justify="space-between">
            <Group gap={8}>
              <Avatar color="teal" radius="xl">
                {user.name.slice(0, 1)}
              </Avatar>
              <div>
                <Text size="sm" fw={600}>
                  {user.name}
                </Text>
                <Text size="sm" c="dimmed">
                  {user.role === "admin" ? "管理员" : "客服员工"}
                </Text>
              </div>
            </Group>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="退出登录"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/auth/logout", "POST");
                  resetSession();
                })
              }
            >
              <IconLogout size={18} />
            </ActionIcon>
          </Group>
        </div>
      </AppShell.Navbar>
      <AppShell.Main>
        <div className="workspace">
          <Text size="sm" c="dimmed" mb={24}>
            工作空间 / {viewName}
          </Text>
          {alerts}
          {view === "security" ? (
            <>
              <Title order={2} mb="md">
                账号安全
              </Title>
              <Paper withBorder p="xl" maw={560}>
                <Title order={3}>修改登录密码</Title>
                <Text c="dimmed" my="md">
                  修改后所有设备都会退出登录，请使用新密码重新登录。
                </Text>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      if (newPassword !== confirmPassword)
                        throw new Error("两次输入的新密码不一致");
                      await api("/auth/password", "POST", {
                        currentPassword,
                        password: newPassword,
                      });
                      resetSession();
                      setNotice("密码已更新，请使用新密码登录。");
                    });
                  }}
                >
                  <Stack>
                    <PasswordInput
                      label="当前密码"
                      autoComplete="current-password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                    <PasswordInput
                      label="新密码"
                      description="至少 12 位"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <PasswordInput
                      label="确认新密码"
                      autoComplete="new-password"
                      minLength={12}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <Button type="submit" loading={busy}>
                      更新密码
                    </Button>
                  </Stack>
                </form>
              </Paper>
            </>
          ) : view === "staff" ? (
            <>
              <Group justify="space-between" mb="xl">
                <div>
                  <Title order={2}>员工管理</Title>
                  <Text c="dimmed" mt={8}>
                    独立账号、统一协作。停用或重置密码会立即结束该员工的会话。
                  </Text>
                </div>
                <Button
                  leftSection={<IconPlus size={17} />}
                  onClick={() => {
                    setError("");
                    setNewPassword("");
                    setModal("create");
                  }}
                >
                  添加员工
                </Button>
              </Group>
              {loading ? (
                <Loader />
              ) : (
                <Paper withBorder style={{ overflow: "auto" }}>
                  <Table miw={650} verticalSpacing="lg" horizontalSpacing="lg">
                    <Table.Thead>
                      <Table.Tr>
                        {["员工", "邮箱", "角色", "状态", "操作"].map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {staff.map((s) => (
                        <Table.Tr key={s.id}>
                          <Table.Td fw={600}>{s.name}</Table.Td>
                          <Table.Td>{s.email}</Table.Td>
                          <Table.Td>
                            {s.role === "admin" ? "管理员" : "客服员工"}
                          </Table.Td>
                          <Table.Td>
                            <Badge color={s.active ? "teal" : "gray"}>
                              {s.active ? "已启用" : "已停用"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            {s.role !== "admin" && (
                              <Group gap={4}>
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  disabled={busy}
                                  onClick={() => {
                                    setTarget(s);
                                    setNewPassword("");
                                    setError("");
                                    setModal("reset");
                                  }}
                                >
                                  重置密码
                                </Button>
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  color={s.active ? "red" : "teal"}
                                  disabled={busy}
                                  onClick={() => {
                                    if (s.active) {
                                      setTarget(s);
                                      setModal("disable");
                                    } else
                                      run(async () => {
                                        await api(
                                          "/staff/accounts/" + s.id,
                                          "PATCH",
                                          { active: true },
                                        );
                                        setStaff(await api("/staff/accounts"));
                                      });
                                  }}
                                >
                                  {s.active ? "停用" : "启用"}
                                </Button>
                              </Group>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>
              )}
            </>
          ) : view === "audit" ? (
            <>
              <Title order={2}>操作记录</Title>
              <Text c="dimmed" mt={8} mb="xl">
                查看账号管理、密码变更和工单分配操作。记录中不保存密码。
              </Text>
              {loading ? (
                <Loader />
              ) : (
                <Paper withBorder style={{ overflow: "auto" }}>
                  <Table miw={640} verticalSpacing="md">
                    <Table.Thead>
                      <Table.Tr>
                        {["时间", "操作人", "操作", "对象", "详情"].map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {audit.map((a) => (
                        <Table.Tr key={a.id}>
                          <Table.Td>{time(a.created_at)}</Table.Td>
                          <Table.Td>{a.actor_name}</Table.Td>
                          <Table.Td>{actions[a.action] || a.action}</Table.Td>
                          <Table.Td>
                            <Text size="sm" title={a.target}>
                              {a.target.slice(0, 8)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text
                              size="sm"
                              style={{ overflowWrap: "anywhere" }}
                            >
                              {auditDetail(a.detail, person)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {audit.length === 0 && (
                    <div className="empty">暂无操作记录</div>
                  )}
                </Paper>
              )}
              <Pagination
                mt="lg"
                total={Math.max(1, Math.ceil(auditTotal / 30))}
                value={auditPage}
                onChange={setAuditPage}
              />
            </>
          ) : selected ? (
            <>
              <Button
                variant="subtle"
                color="gray"
                leftSection={<IconArrowLeft size={16} />}
                mb="md"
                onClick={() => setSelected(null)}
              >
                返回收件箱
              </Button>
              <Group justify="space-between" align="start" mb="lg">
                <div>
                  <Group mb={10}>
                    <Badge color={colors[selected.status]}>
                      {labels[selected.status]}
                    </Badge>
                    <Text size="sm" c="dimmed">
                      #{selected.id.slice(0, 8)}
                    </Text>
                  </Group>
                  <Title order={2}>{selected.title}</Title>
                </div>
                <Group>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label="刷新对话"
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        setSelected(await api("/tickets/" + selected.id)),
                      )
                    }
                  >
                    <IconRefresh size={18} />
                  </ActionIcon>
                  <Button
                    variant="default"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        updateTicket({
                          status:
                            selected.status === "closed"
                              ? "waiting_staff"
                              : "closed",
                        }),
                      )
                    }
                  >
                    {selected.status === "closed" ? "重新打开" : "关闭工单"}
                  </Button>
                </Group>
              </Group>
              <Paper withBorder p="lg" mb="lg">
                <Group justify="space-between" align="end">
                  <div>
                    <Text size="sm" c="dimmed">
                      安装身份 · {selected.installation_id.slice(0, 8)}
                    </Text>
                    <Text size="sm" mt={6}>
                      设备信息 · {selected.device || "未提供"}
                    </Text>
                  </div>
                  <Select
                    label="负责人"
                    value={selected.assigned_to || ""}
                    disabled={busy}
                    allowDeselect={false}
                    data={[
                      { value: "", label: "未分配" },
                      ...team
                        .filter(
                          (s) => s.active || s.id === selected.assigned_to,
                        )
                        .map((s) => ({
                          value: s.id,
                          label: s.name + (s.active ? "" : "（已停用）"),
                          disabled: !s.active,
                        })),
                    ]}
                    onChange={(value) =>
                      run(() => updateTicket({ assigned_to: value || null }))
                    }
                  />
                </Group>
              </Paper>
              <Stack gap="lg">
                {selected.messages?.map((m) => (
                  <Paper
                    key={m.id}
                    withBorder
                    p="lg"
                    bg={m.sender === "staff" ? "teal.0" : "white"}
                  >
                    <Group justify="space-between" mb="md">
                      <Text fw={600}>
                        {m.author}{" "}
                        {m.sender === "staff" && (
                          <Badge variant="outline">客服</Badge>
                        )}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {time(m.created_at)}
                      </Text>
                    </Group>
                    <Text
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {m.body}
                    </Text>
                    {selected.attachments
                      ?.filter((a) => a.message_id === m.id)
                      .map((a) => (
                        <Button
                          key={a.id}
                          component="a"
                          href={"/api/attachments/" + a.id}
                          variant="default"
                          leftSection={<IconPaperclip size={16} />}
                          mt="md"
                          mr="sm"
                        >
                          {a.name} · {(a.size / 1024).toFixed(0)} KB
                        </Button>
                      ))}
                  </Paper>
                ))}
              </Stack>
              {selected.status !== "closed" ? (
                <Paper mt="xl" withBorder p="lg">
                  <Textarea
                    label="回复用户"
                    placeholder="输入回复内容…"
                    minRows={4}
                    autosize
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    maxLength={10000}
                  />
                  <Group justify="space-between" mt="md">
                    <Text size="sm" c="dimmed">
                      回复后状态将变为「待用户回复」
                    </Text>
                    <Button
                      loading={busy}
                      disabled={!reply.trim()}
                      onClick={() =>
                        run(async () => {
                          await api(
                            "/tickets/" + selected.id + "/messages",
                            "POST",
                            { body: reply },
                          );
                          setReply("");
                          setSelected(await api("/tickets/" + selected.id));
                        })
                      }
                    >
                      发送回复
                    </Button>
                  </Group>
                </Paper>
              ) : (
                <Alert mt="xl" color="gray">
                  此工单已关闭，重新打开后可以继续回复。
                </Alert>
              )}
            </>
          ) : (
            <>
              <Group justify="space-between" mb="xl">
                <div>
                  <Title order={2}>工单收件箱</Title>
                  <Text c="dimmed" mt={8}>
                    处理反馈、分配负责人、跟进用户回复。
                  </Text>
                </div>
                <Button
                  variant="default"
                  leftSection={<IconRefresh size={16} />}
                  loading={busy}
                  onClick={() => run(refresh)}
                >
                  刷新
                </Button>
              </Group>
              <SimpleGrid cols={{ base: 2, md: 4 }} mb="xl">
                {[
                  ["waiting_staff", "待客服回复"],
                  ["waiting_user", "待用户回复"],
                  ["unassigned", "未分配（未关闭）"],
                  ["closed", "已关闭"],
                ].map(([key, title]) => (
                  <Paper key={key} withBorder p="lg">
                    <Text c="dimmed" size="sm">
                      {title}
                    </Text>
                    <Title order={2} mt={6}>
                      {overview[key] ?? "—"}
                    </Title>
                  </Paper>
                ))}
              </SimpleGrid>
              <Group mb="lg" align="end">
                <TextInput
                  style={{ flex: 1, minWidth: 200 }}
                  label="搜索工单"
                  placeholder="输入工单标题"
                  leftSection={<IconSearch size={17} />}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
                <Select
                  label="状态"
                  value={status}
                  onChange={(v) => {
                    setStatus(v || "");
                    setPage(1);
                  }}
                  data={[
                    { value: "", label: "全部状态" },
                    ...Object.entries(labels).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                  allowDeselect={false}
                />
                <Select
                  label="负责人"
                  value={assignee}
                  onChange={(v) => {
                    setAssignee(v || "");
                    setPage(1);
                  }}
                  data={[
                    { value: "", label: "全部负责人" },
                    { value: "unassigned", label: "未分配" },
                    ...team.map((s) => ({
                      value: s.id,
                      label:
                        s.name +
                        (s.id === user.id ? "（我）" : "") +
                        (s.active ? "" : "（已停用）"),
                    })),
                  ]}
                  allowDeselect={false}
                />
              </Group>
              <Paper withBorder style={{ overflow: "auto" }}>
                {loading ? (
                  <div className="empty">
                    <Loader aria-label="加载工单" />
                  </div>
                ) : (
                  <>
                    <Table
                      highlightOnHover
                      verticalSpacing="lg"
                      horizontalSpacing="lg"
                      miw={650}
                    >
                      <Table.Thead>
                        <Table.Tr>
                          {[
                            "工单 / 问题描述",
                            "状态",
                            "负责人",
                            "最近更新",
                          ].map((h) => (
                            <Table.Th key={h}>{h}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {tickets.map((t) => (
                          <Table.Tr key={t.id}>
                            <Table.Td>
                              <button
                                className="ticket-link"
                                disabled={busy}
                                onClick={() => open(t.id)}
                              >
                                {t.title}
                              </button>
                              <Text size="sm" c="dimmed" mt={4}>
                                #{t.id.slice(0, 8)}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Badge color={colors[t.status]}>
                                {labels[t.status]}
                              </Badge>
                            </Table.Td>
                            <Table.Td>{person(t.assigned_to)}</Table.Td>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {time(t.updated_at)}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                    {tickets.length === 0 && (
                      <div className="empty">
                        <IconInbox size={38} />
                        <Title order={4} mt="md">
                          {q || status || assignee
                            ? "没有匹配的工单"
                            : "收件箱已准备就绪"}
                        </Title>
                        <Text c="dimmed" mt={8}>
                          {q || status || assignee
                            ? "试试其他搜索词或筛选条件。"
                            : "用户提交反馈后，工单会显示在这里。"}
                        </Text>
                      </div>
                    )}
                  </>
                )}
              </Paper>
              <Group justify="space-between" mt="lg">
                <Text size="sm" c="dimmed">
                  共 {total} 条 · 每页 30 条
                </Text>
                <Pagination
                  total={Math.max(1, Math.ceil(total / 30))}
                  value={page}
                  onChange={setPage}
                  size="sm"
                />
              </Group>
            </>
          )}
        </div>
      </AppShell.Main>
      <Modal
        opened={modal !== null}
        onClose={closeModal}
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        title={
          modal === "create"
            ? "添加员工账号"
            : modal === "reset"
              ? `重置 ${target?.name} 的密码`
              : "停用员工账号"
        }
        centered
      >
        {error && (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        )}
        {modal === "disable" ? (
          <Stack>
            <Text>
              停用 {target?.name}{" "}
              后，该员工会立即退出登录。已分配工单会保留负责人，便于重新分配。
            </Text>
            <Button
              color="red"
              loading={busy}
              onClick={() =>
                run(async () => {
                  await api("/staff/accounts/" + target!.id, "PATCH", {
                    active: false,
                  });
                  setStaff(await api("/staff/accounts"));
                  setModal(null);
                })
              }
            >
              确认停用
            </Button>
          </Stack>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (modal === "create")
                  await api("/staff/accounts", "POST", {
                    name: newName,
                    email: newEmail,
                    password: newPassword,
                  });
                else
                  await api(
                    "/staff/accounts/" + target!.id + "/password",
                    "POST",
                    { password: newPassword },
                  );
                setStaff(await api("/staff/accounts"));
                setModal(null);
                setNewName("");
                setNewEmail("");
                setNewPassword("");
                setNotice("操作成功，请通过安全渠道将初始密码交给员工。");
              });
            }}
          >
            <Stack>
              {modal === "create" && (
                <>
                  <TextInput
                    label="姓名"
                    required
                    maxLength={80}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <TextInput
                    label="工作邮箱"
                    type="email"
                    required
                    maxLength={200}
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </>
              )}
              <PasswordInput
                label="新密码"
                description="至少 12 位，通过安全渠道交给员工"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Alert color="teal">
                {modal === "create"
                  ? "员工可以查看、分配和回复所有工单，但不能管理账号。"
                  : "重置后该员工的所有设备都会退出登录。"}
              </Alert>
              <Button type="submit" loading={busy}>
                {modal === "create" ? "创建账号" : "重置密码"}
              </Button>
            </Stack>
          </form>
        )}
      </Modal>
    </AppShell>
  );
}
function auditDetail(detail: string, person: (id: string | null) => string) {
  try {
    const d = JSON.parse(detail);
    return [
      d.status ? `状态：${labels[d.status] || d.status}` : "",
      Object.hasOwn(d, "assigned_to") ? `负责人：${person(d.assigned_to)}` : "",
    ]
      .filter(Boolean)
      .join("；");
  } catch {
    return detail || "—";
  }
}
createRoot(document.getElementById("root")!).render(
  <MantineProvider
    theme={{
      primaryColor: "teal",
      defaultRadius: "md",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      headings: { fontWeight: "650" },
    }}
  >
    <App />
  </MantineProvider>,
);
