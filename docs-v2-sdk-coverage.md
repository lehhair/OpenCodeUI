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

### P0 — 认证域（2026-10 已完成 ✅）

| SDK | 官方用途 | 实现 |
|---|---|---|
| `integration.*` | provider/MCP 的 OAuth 登录、API key 连接 | api/integration.ts 封装（list/get/connect.key/oauth.connect/status/complete/cancel/wellknown.add + CONSOLE_INTEGRATION 特例）；`useProviderConnectionController` 官方 controller.ts 同款状态机；`ProviderConnectDialog`（Picker→方法选择→表单→API key/OAuth 浏览器授权）；Models 设置页入口；usage-exceeded 引导连接 |
| `credential.*` | 凭据管理 | api/credential.ts 封装（list/create/update/activate/remove）；Picker 行内「断开」（遍历 credential connections 逐个 remove，官方设置页同款） |
| MCP `needs_auth` 授权 | 远程 MCP 拉起浏览器授权 | McpPanel handleAuth 走官方 useMcpToggle 同款 integration OAuth 流 |
| usage-exceeded | 用量超限对话框 | usageExceededStore（24h 窗口 + 不再提示，官方 GO_UPSELL_* 同款）+ UsageExceededDialog（free_tier_limit/account_rate_limit）；session.status 事件接入 |

### P1

- [x] **服务端 inbox 队列**（`session.inbox.list/cancel/update`）✅
  - 官方：排队消息在服务端管理，可取消/重排（packages/app/src/session/composer/queue.ts）
  - 实现：busy 发送带 `delivery=queue/steer`（sendMessageNow）；`inboxStore` 镜像官方 pending（inbox.list 快照 + 四事件增量）；气泡式队列 UI（`QueueBubbles`，PiUI 形态）融在消息流尾部，操作行含复制 / 插入当前回合 / 撤回编辑 / 删除；输入栏 busy 投递 chip 切换 插队↔排队
  - 转写回声投影 `projectQueueEchoes`（官方 controller-projection.ts 的 `visibleTimelineMessages` 同款）：queue 回声隐藏（气泡是唯一展示位）、steer 回声挪到转写末尾
  - 发送时同步 `admitLocalInboxItem`（官方 admitLocal）：消除「先乐观实心气泡、再跳回队列」的闪烁
  - 未做：~~官方 queue.edit 的 stash + 重发替换~~ → **已做（2026-10 收口轮）**：stash 草稿 + editedPromptInput 保留原提及 + admit→cancel→rewrite 原位替换；**拖拽重排也已做**（rewriteQueueOrder 后缀重写 + 把手拖拽，官方 queue-panel 同款）

### 收口轮已完成项（2026-10，对齐官方照抄）

| 项 | 实现 |
|---|---|
| skill 提及入口 | @ 菜单接入 skill.list（官方 composer/model.ts:193-205 同款），@skill.id 文本 + skill 附件，prompt.skills 端到端验证（服务端解析技能内容） |
| compaction 进行中/失败/用量 | CompactionPartView 对齐官方 SessionCompactionMessage：started 分隔线 + 摘要流式 + running 指示 + 结果/用量/失败详情 |
| 队列编辑原位替换 | 官方 queue.edit 同款 stash + 替换提交 + rewriteQueueOrder 保序；编辑中条目高亮、铅笔变取消 |
| 队列拖拽重排 | QueueBubbles 把手拖拽（4px 阈值 + 中线槽位），rewriteQueueOrder 后缀重写 |
| 客户端斜杠命令族 | /undo /redo /fork /export /btw 本端处理不走后端路由；纯文本 /cmd args 兜底路由 |
| revert.committed 消费 | messageStore.applyRevertCommitted + inboxStore.dropFromBoundary（官方 data.ts:1076-1092 同款，多客户端同步） |
| 全局输入历史 | promptHistoryStore（官方 composer/history 同款：全局持久化、normal/shell 分轨、上限 100、失败移除） |
| 草稿持久化 | usePersistedDraft（官方 composer persistence 同款：按会话/工作区作用域、防抖写盘、发送清空） |
| List/Skill 渲染器 | 官方 session-ui 同款：list 只展 output+目录 subtitle；skill 紧凑「Loaded skill」行 |
| session.message.get 回读 | model.selected 合成行后 durable 回读原位替换（官方 data.ts:677-683 同款） |
| 命令面板混合搜索 | 命令 + 文件（file.find 防抖）+ 会话（标题过滤），各 5 条（官方 palette.ts ENTRY_LIMIT 同款） |
| 健康检查轮询 + 通知跨标签去重 | 订阅中服务器 10s 例行体检；notificationCoordinator 官方 coordinator 同款（locks + localStorage 认领清单） |
| 设置 Provider 页 | 官方 settings/providers 同款：已连接列表 + 来源标签（env/api/account/config/custom）+ 断开 + 常用区 |
| /btw 侧问 | session.generate 封装 + BtwDialog（官方 session/btw 同款：一次性作答、不落转写） |
| 官方主题 JSON 导入 | opencodeTheme.ts 映射器（扁平 palette → HSL 层级）+ 自定义主题注册/持久化 + 外观页导入/移除 |
- [x] **`!` shell 命令 + 后台 shell 输出**（`session.shell`、`shell.list/output`）✅
  - 官方：composer 输入 `!` 进入 shell mode（composer/suggestions/machine.ts:203），提交走 `session.shell`（submit.ts:147）；shell 消息独立成行、用 shell 工具渲染器（session-ui/tool-renderer.tsx:1837）
  - 实现：`!` 进 shell mode（mono + Shell 徽标，Enter 执行、esc/空退格退出）→ `executeSessionShell`；`ShellMessageView` 投影成 shell 工具调用走 bash 管线；可见性 + 过程时间线补 shell 类型；全局 Escape 快捷键在 shell mode 内让路（data-shell-mode）
  - `shell.list` ✅（api/shell.ts）：并入「移到后台」候选（官方 requests/background.ts:100-109 同款去重），busy 期间 3s 轮询
  - `shell.get/output` ✅（api/shell.ts）：运行中 shell 实时输出跟随（followShellOutput 逐行移植官方 session-ui/shell-output.ts：游标记忆、64KB 尾窗、missing 态短路、存活期 1s 轮询）
  - 未做：官方那个独立「后台任务面板」依赖 session-ui 包，无对应消费场景（功能已由上述两处覆盖）

### P2

- [x] **`reference.list`** — `@` 提及的引用目录（官方 model.ts:148）✅
  - 实现：`getReferences`（api/reference.ts）；MentionMenu 根目录与搜索态列出非 hidden 引用（label `@name`），选中按 folder 附件插入（mime `application/x-directory`，官方 model.ts:162）
  - 验证：REST 实测 `data:[]`（测试项目无引用），空态不报错；渲染路径有单测
- [x] **`vcs.branch.list`** — 分支选择器（官方 controller.ts:154，支持 search/limit）✅
  - 实现：`getBranchList(directory, search, limit=50)`（api/vcs.ts）；WorktreePanel 新建 Worktree 表单加「基于分支（可选）」：focus 列出、输入即搜索，选中作为 `worktree.create` 的 `from` 传入
  - 验证：live 下拉列出 dev/main，`search=ma` 收敛为 main 且可选中填入
- [x] **`session.move`** — 会话移动到其他目录/worktree（官方 session-workspace-menu.tsx:77）✅
  - 实现：`moveSession`（api/session.ts）+ Header 标题旁 SessionMoveMenu：项目根（在根时隐藏）+ 现有 worktree + 内联新建 worktree 并移入；运行中禁止；`session.moved` 由 useSessions 消费（回读后按目录匹配增删）
  - 验证：live 菜单列出 worktree，点击后服务端 location 实变并移回
- [x] **`session.background`** — 阻塞回合的 shell/task 转后台（官方 requests/model.ts:90）✅
  - 实现：`backgroundSession`（api/session.ts）+ `findBlockingBackgroundTasks`（官方 requests/background.ts 的 blocking 逻辑：最新未完成 assistant 里 running 的 shell/task）；InputBox 上方「移到后台（N 个任务）」按钮
  - 验证：live 按钮在模型跑 60s sleep shell 时正确出现；⚠️ 测试服务器（opencode 1.18.15）对 background 返回 204 但不实际解除阻塞（jobs.block/backgroundAll 疑似未接线），端点/路径与官方一致，待新 server 复验
- [x] **`websearch.providers`** — 第三方搜索 provider 选择 dock（官方 session-websearch-dock.tsx；表单 `metadata.kind === 'websearch.provider'`）✅
  - 实现：`getWebsearchProviders`（api/websearch.ts）；表单按 kind 分流（websearch 不再落通用 QuestionDialog）；WebsearchDock：非 specific 加「任意」+ providers 列表，disable/allow/choose 三答案与官方一致；choose 两段式跨挂载用 sessionID 暂存自动回 {provider}
  - 验证：⚠️ 测试服务器 1.18.15 无此端点（404），dock 有失败/重试/空态；逻辑与官方逐行对齐
- [x] **`plugin.list/check/update`** — 扩展管理面板（官方 extensions.tsx / server-panel.tsx:285）✅
  - 实现：api/plugin.ts（list/check/update + 官方同款 pluginLabel）；新 plugins 面板 tab；非 builtin 过滤、failed 红标+错误、package outdated → 「更新」（plugin.update targets）；`plugin.updated` 事件接入并驱动刷新（check/update 官方 web 不用，仅 CLI，已封装备用）
  - 验证：live 渲染本机 failed 态本地插件（红标+错误信息）

### P3

- [x] **`experimental.persistentPty.*`** — ✅ 结论：官方 **web 应用不消费**（packages/app 无任何引用），只有 TUI（terminal-pane/session-terminals）与 CLI（pty-handoff、server-connection）用；且需要独立的 persistent-pty 端点。归入「官方不用的边缘 API」清单，不实现
- [x] **`server.pair/connect`** — ✅ 结论：官方 web 应用不调用这两个 SDK 端点——其「连接服务器」流程是扫码/解析配对 URL 后填入普通 URL+密码表单（servers/connect/pairing.ts）；`server.pair`/`connect` 只有 CLI（`opencode pair`）与桌面平台原生通道用。归入「官方不用的边缘 API」清单，不实现

## 官方也不用的边缘 API ⚪（不接）

`session.stats/context/log/environment/view`、`session.instructions.entry.*`、`vcs.base`、`debug.location`、`permission.create/get`、`agent.get`、`provider.get`、`form.create`、`websearch.query`、`generate.text`、`session.skill/synthetic`（官方 app 无调用点，技能走 prompt 的 `skills` 字段）、`rpc.call`（低层逃生舱）、`experimental.persistentPty.*`（仅 TUI/CLI 用，需独立 persistent-pty 端点）、`server.pair/connect`（仅 CLI/桌面原生配对通道用，web 端扫码只是解析配对 URL 填表单）、`shell.create/remove`（官方 app 不用；list/get/output 已接，见 P1）

## 勘误与补充（2026-10 审计）

- **`session.generate`**：从 ⚪ 移出——官方 app 的「/btw 侧问」在用它（app/src/session/btw/model.ts:66-73，一次性生成、不调工具，hidden、desktop-only；TUI 同款）。原声明「官方 app 无调用点」失实。当前结论：**暂不接**（产品决策，功能与主对话重叠度高）；若要功能对齐需实现 /btw。
- **`migration.v1.status`**：官方 web app 确实不消费，但 **desktop 壳**轮询它显示 v1→v2 迁移进度 toast（desktop/src/renderer/migration-status.tsx:57），TUI 也用。SDK 2.0.21 已带 `client.migration.v1.status`；迁移期间会话列表短暂为空且无提示，如需可低成本补提示（低优先）。
- **`session.message.get`**：官方数据层在用（model.selected 后回读校正 data.ts:677、composer admitted 去重、fork 取消息），OCUI 未接、文档原未声明。属低危补充项（list 已覆盖主要场景），需要时补单条 get 封装。
- **本轮审计修复已落地**（不再属于缺口）：发送链路串行化 + outbox 回滚守卫（官方 sendAdmission）；queue 不立即 switchModel/switchAgent（仅 steer 切换）；prompt 载荷补 mention/skills/metadata；inbox 快照对账（pendingUpdates + inflight）；权限 always 默认交服务端持久化；历史分页改游标 + leadingTurn 补齐；revert 清空队列；compaction 去重 + started 移除 pending；回复 404 短路 + form 失败保留；工具名精确匹配（subagent/skill/list/todowrite）；标题 displayLabel 兜底；时钟校准改用真实事件时间戳。
- **已知偏差（保留记录）**：`session.revert.committed` 事件已分发但暂无消费者（多客户端下转写不同步，官方 data.ts:1076-1092 就地 splice）；queue 拖拽重排与原位编辑未做；P0 integration/credential 仍属最大功能缺口（另立项）。
