# OpenCode v2 SDK 覆盖对照与接入计划

> 盘点日期：2026-06（SDK `@opencode/client@2.0.21`）
> 三方对照：SDK 全接口面（dist/promise/client.d.ts，130+ 方法） × 官方 app/client 实际调用 × 本仓库 src/api 调用。
> 状态图例：✅ 已接入 ｜ 🚧 计划接入（本文档跟踪） ｜ ⚪ 官方也不用 / 不适用，不接

## 已全面接入 ✅

| 区域 | 覆盖 |
|---|---|
| session 主干 | list/get/create/remove/update/fork/import/export/active/prompt/command/compact/wait/interrupt/diff/switchAgent/switchModel |
| revert | stage/clear/commit（busy 先 interrupt 重试） |
| message | list（order:desc + reverse，官方模式） |
| 发送链路 | 乐观上屏 + inbox 事件对账 |
| model/provider | model.list/default + provider.list |
| permission | list/reply/request.list/saved.list/remove |
| form（question） | session.form list/get/reply/cancel + 全局 form.list |
| mcp | 全方法（list/add/remove/connect/disconnect/resource.catalog） |
| pty | 全方法（list/create/get/update/remove/connect.token） |
| worktree | 全方法（list/create/remove/refresh） |
| vcs | get/status/diff |
| file | read/list/find/write |
| config | get/shells/update（Config.latest 语义） |
| command/skill/agent/project/location/server.info/event.subscribe | 全 |
| SSE 事件 | 全部已分发（含"故意不消费"文档化） |

## 接入计划 🚧

> 每项完成后把 🚧 改成 ✅ 并注明实现位置。原则：对照官方实现照抄，不自造层。

### P0 — 明确不做（本次范围外）

| SDK | 官方用途 | 备注 |
|---|---|---|
| `integration.*` + `credential.*` | provider/MCP 的 OAuth 登录、API key 连接、凭据管理 | 最大缺口，单独排期 |

### P1

- [ ] **服务端 inbox 队列**（`session.inbox.list/cancel/update`）
  - 官方：排队消息在服务端管理，可取消/重排（packages/app/src/session/composer/queue.ts）
  - 我们：本地 `followupQueueStore`，刷新/换端后队列丢失
  - 计划：排队改走服务端 inbox（prompt 在 busy 时自然入队），队列 UI 改读 `inbox.list`，取消走 `inbox.cancel`；重排走 `inbox.update`
  - 注意：我们发送侧已接 `session.inbox.enqueued/cancelled` 事件做乐观对账，数据链路是通的
- [ ] **`!` shell 命令 + 后台 shell 输出**（`session.shell`、`shell.list/output`）
  - 官方：输入框 `!` 前缀直接跑 shell（composer-adapter.ts:147）；`shell.list` 列后台 shell（solid/data.ts:1325）；`shell.output` 拉输出（session-ui-provider.tsx:65）
  - 事件侧 `session.shell.started/ended` 已接入 messageStore

### P2

- [ ] **`reference.list`** — `@` 提及的引用目录（官方 model.ts:148）
- [ ] **`vcs.branch.list`** — 分支选择器（官方 controller.ts:154，支持 search/limit）
- [ ] **`session.move`** — 会话移动到其他目录/worktree（官方 session-workspace-menu.tsx:77；事件 `session.moved` 已接）
- [ ] **`session.background`** — 挂起会话转后台（官方 requests/model.ts:90）
- [ ] **`websearch.providers`** — 第三方搜索 provider 选择 dock（官方 session-websearch-dock.tsx；表单 `metadata.kind === 'websearch.provider'`）
- [ ] **`plugin.list/check/update`** — 扩展管理面板（官方 extensions.tsx / server-panel.tsx）

### P3

- [ ] **`experimental.persistentPty.*`** — 终端跨重连持久化 / 桌面 handoff（官方 solid/pty.ts、pty-handoff.ts；实验性）
- [ ] **`server.pair/connect`** — 设备配对（官方 desktop.tsx 命令）

## 官方也不用的边缘 API ⚪（不接）

`session.stats/context/generate/log/environment/view`、`session.instructions.entry.*`、`vcs.base`、`debug.location`、`migration.v1.status`、`permission.create/get`、`agent.get`、`provider.get`、`form.create`、`websearch.query`、`generate.text`、`session.skill/synthetic`（官方 app 无调用点，技能走 prompt 的 `skills` 字段）、`rpc.call`（低层逃生舱）
