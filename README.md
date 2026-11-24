# Topfast 工单工作台

React + Mantine 管理后台，Hono / Cloudflare Workers API，D1 数据库，私有 R2 附件。本仓库根目录就是工单应用，旧静态模板已移除。

## 功能

- 管理员创建、停用、重新启用员工账号；员工共享工单收件箱，没有账号管理权限。
- 工单搜索、状态/负责人筛选、分页、对话、关闭/重新打开，支持分配给在职员工。
- 全局状态统计、个人修改密码、管理员重置员工密码；改密立即撤销该账号所有会话。
- 管理员查看账号启停、密码变更及工单更新操作记录；不记录密码。
- iOS 无需登录，以随机安装令牌访问自己的工单；所有附件下载都校验归属。
- 日志/图片上传（每个文件最多 10 MB，log/txt/zip/gz/png/jpg/jpeg）。
- 会话 Cookie 为 HttpOnly/SameSite=Strict，HTTPS 下 Secure；员工密码 PBKDF2-SHA256；客户端和员工令牌只保存 SHA-256 摘要。

## 本地启动

Node.js 22 或更高版本。在此目录执行：

```sh
npm ci
npm run build
npx wrangler d1 migrations apply topfast-helpdesk --local
# 在 .dev.vars 中设置 BOOTSTRAP_SECRET 为随机长字符串；该文件已 gitignore。
npm run worker
# 可选：另一终端运行 npm run dev 获得 React 热更新，访问 localhost:5173。
```

向 `POST /api/setup` 发送 `Authorization: Bearer <BOOTSTRAP_SECRET>`，JSON 为 `{"email":"admin@example.com","name":"管理员","password":"至少12位的随机密码"}`，仅数据库还没有管理员时有效。随后在工作台登录、添加员工。初始化完成后删除此 secret 即可禁用初始化入口。不要在源码中写真实密码。

`npm run worker` 本身已提供构建后的前端，默认 localhost:8787。

## Cloudflare 部署

```sh
npx wrangler login
npx wrangler d1 create topfast-helpdesk
npx wrangler r2 bucket create topfast-helpdesk-files
```

先用 `npx wrangler whoami` 确认 Topfast 所属 Cloudflare 账号，在环境变量 `CLOUDFLARE_ACCOUNT_ID` 或配置的 `account_id` 中明确选择账号。当前资源名是独立工单服务的建议名，实际部署前应检查现有 Topfast 项目，避免覆盖已有应用。将返回的 D1 ID 写入 `wrangler.jsonc`，确认 R2 bucket 名称；不启用 R2 公开访问。

```sh
npx wrangler d1 migrations apply topfast-helpdesk --remote
npx wrangler secret put BOOTSTRAP_SECRET
npm run deploy
```

在生产域名初始化管理员后执行 `npx wrangler secret delete BOOTSTRAP_SECRET`。Workers 的 Rate Limit binding 每来源 IP 每分钟最多 30 次请求（共享该服务所有 API；大团队/NAT 环境需调优）。使用 R2 需在账户中启用相应产品，实际费用按使用量计。

## iOS 匿名身份

首次请求 `POST /api/installations`，保存响应 token 到 **Keychain**（建议 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`），后续请求设置 `Authorization: Bearer <token>`。注册时不要在每次启动都创建新身份。凭证代表工单访问权限，不使用 IDFV 或可猜测设备标识作为密钥。不要写入日志、分析事件或 URL。

没有注册/登录意味着没有跨设备恢复。Keychain 凭证丢失时旧工单无法找回；不要承诺卸载重装一定保留。重试创建工单可能产生重复记录，客户端应禁用重复提交；当前没有幂等键支持。

## API

所有 API 前缀 `/api`，错误 JSON 为 `{"error":"说明"}`。无权限读取工单或附件统一返回 404。列表每页 30 条。日期为 UTC SQLite 时间字符串。

| 方法 | 路径 | 内容/响应 |
|---|---|---|
| POST | `/installations` | 无参数；201 `{id,token}`，token 仅在创建时返回 |
| GET | `/me` | 当前安装身份/员工身份 |
| POST | `/tickets` | `{title,body,device?}`；201 `{id,messageId}`，仅用户 |
| GET | `/tickets?page=1&status=waiting_staff&q=标题` | `{items,total,page}`；员工支持 `assignee=员工ID` / `unassigned`；用户只看到自己的工单 |
| GET | `/tickets/:id` | 工单、`messages`、`attachments` |
| POST | `/tickets/:id/messages` | `{body}`；201 `{id}`，已关闭工单返回 409 |
| PATCH | `/tickets/:id` | `{status:"closed"}` 或 `{status:"waiting_staff"}`；员工还可传 `{assigned_to:"员工ID"}`，null 取消分配 |
| POST | `/tickets/:id/messages/:messageId/attachments` | multipart/form-data 字段 `file`；201 `{id}` |
| GET | `/attachments/:id` | 授权后的二进制下载 |
| POST | `/auth/login` | `{email,password}`；设置员工 Cookie |
| POST | `/auth/logout` | 删除当前会话 |
| GET/POST | `/staff/accounts` | 管理员列出/创建员工；创建 `{email,name,password}` |
| POST | `/auth/password` | 员工 `{currentPassword,password}`，成功后全部设备重新登录 |
| POST | `/staff/accounts/:id/password` | 管理员重置普通员工密码 `{password}`，撤销会话 |
| GET | `/staff/audit?page=1` | 管理员操作记录，每页 30 条 |
| GET | `/team` | 员工可见的负责人选项（含停用标识） |
| GET | `/overview` | 员工可见的全局工单状态统计 |
| PATCH | `/staff/accounts/:id` | 管理员 `{active:false}`，即时撤销该员工所有会话 |

状态：用户新建/回复 → `waiting_staff`；客服回复 → `waiting_user`；任一方关闭 → `closed`。关闭后需重新打开才能回复。

创建工单后，使用 `messageId` 上传日志；回复后使用响应 `id` 上传追加附件。附件失败不回滚已经保存的文本，应让客户端显示失败并允许单独重试。当前通过 Worker 流式上传，适合限制在 10 MB 内的日志，无需额外 R2 凭证或 CORS 配置。

Swift 请求示意（token 从 Keychain 读取）：

```swift
var request = URLRequest(url: baseURL.appendingPathComponent("api/tickets"))
request.httpMethod = "POST"
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: [
    "title": "同步失败", "body": "切换网络后无法同步", "device": "iPhone / iOS / App build"
])
let (data, response) = try await URLSession.shared.data(for: request)
// 检查 HTTP 状态；成功后解码 id/messageId，独立上传压缩日志。
```

## 当前边界

此版本不含 APNs、WebSocket、未读游标、附件自动过期、邮件找回密码或恶意文件扫描。对话通过手动刷新更新。匿名注册建议上线前根据流量配置 Cloudflare WAF，必要时接入 App Attest。R2 生命周期可在控制台配置（例如 30 天），文件过期后接口返回 404，当前附件元数据仍保留。

代码尚未部署到真实 Cloudflare 账号；部署需要账户绑定和资源 ID。不要用假数据充当线上工单。

## 验证

```sh
npm run build
npm test
npm run test:integration
```

集成测试启动独立本地 Worker，使用临时 D1/R2 数据和单独的较高测试限流配置，结束后清理进程及测试数据；不接触生产资源。覆盖匿名工单隔离、附件存取、员工权限、分配与筛选、密码重置/修改后的会话撤销、操作记录权限及密码不进入日志。生产配置仍为每 IP 每分钟 30 次 API 请求。

2026-11-24：构建、3 项单元测试和扩展集成流程通过；登录页面已检查。尚未完成 Cloudflare 正式部署或线上管理员初始化。当前环境的 Cloudflare 网络访问不在已发布允许范围内，且未配置账号凭据。
