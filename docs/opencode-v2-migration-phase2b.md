# OpenCode V2 迁移 · 阶段 2b 报告（事件流 + 发消息，写侧）

> 状态：**✅ 已完成**（2026-09-30）
> 范围：**写侧** —— 事件订阅层重写、`EventTypes` / `EventCallbacks` 重做、`messageStore` 的 4 个事件处理器、
> 发消息两条链路、`v1Model.ts` 收尾删除、内容搜索移除、dev proxy 修正。
> 前置：阶段 0（`docs/opencode-v2-migration-phase0.md`）、阶段 1（`docs/opencode-v2-migration-phase0.5.md`）、
> 阶段 2a（`docs/opencode-v2-migration-phase2a.md`）
> 实测环境：opencode `v2.0.19`（`/home/coder/.opencode/bin/opencode`）、`@opencode/client@2.0.19`
> 主文档：`docs/opencode-v2-migration.md`（本阶段已按实测回填 §6.1 / §6.3 / §6.4 / §8 / §9.3 / §9.5）

---

## 0. 先说三件必须交代的事

### 0.1 ⚠️ 硬性约束逐条对照

| 约束                                                 | 结果                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| 允许改：`src/api/events.ts`                          | ✅ 整体重写（1060 → 1378 行）                                            |
| 允许改：`src/api/message.ts`                         | ✅ 发消息两条链路落地                                                    |
| 允许改：`src/api/file.ts`（仅搜索相关）              | ✅ 移除 `searchText` / `searchSymbols`，实现 `searchFiles`               |
| 允许改：`EventTypes` 常量表                          | ✅ `src/types/api/event.ts` 整体重写（177 → 506 行）                     |
| 允许改：`messageStore`                               | ✅ 4 个事件处理器改成 V2 形状                                            |
| 允许改：`messageConversion.ts`（事件侧复用）         | ✅ 新增 `toUIPartFromContent` / `toStepFinishPart`，删除 V1 形状遗留函数 |
| 允许改：`v1Model.ts`（仅删 A/C 桶）                  | ✅ 189 → **104** 个顶层导出（详见 §5）                                   |
| 允许改：发消息链路                                   | ✅ 含 `createSession`（见 §4.4，任务 4 明确点名）                        |
| 允许改：`FileExplorer.tsx`（仅搜索 UI）              | ✅ 内容搜索 UI 与请求分支移除，不留置灰按钮                              |
| 允许改：`vite.config.ts`                             | ✅ 删掉会削 `/api` 前缀的 V1 rewrite                                     |
| 允许改：`docs/`                                      | ✅ 主文档回填 + 本报告                                                   |
| **禁止改**：`src-tauri/`（整个 Rust 层）             | ✅ **零改动**                                                            |
| **禁止改**：`src/api/notMigrated.ts` 既有语义        | ✅ **零改动**                                                            |
| **禁止改**：`v1Model.ts` 的 B 桶 104 个导出          | ✅ 104 个一个不少（脚本逐个核对，见 §5.4）                               |
| 禁止 git commit / push / reset / checkout / worktree | ✅ 未执行                                                                |
| 禁止删除 `docs/` 下任何文件                          | ✅ 未删除                                                                |
| 类型检查 0 报错                                      | ✅ `npx tsc -b --force` 无输出                                           |
| `npm test` 现有用例不许挂                            | ✅ 阶段 2a 基线 741 例全部仍通过                                         |
| 全程简体中文注释与报告                               | ✅                                                                       |
| 失败项如实汇报、不编造                               | ✅ 见 §7、§8                                                             |
| 只用单测 + API 冒烟证明，不做浏览器人工验证          | ✅ 未做浏览器验证                                                        |

**超出授权范围但不得不改的文件**（各 1~3 行，全部是「不改就编译不过」，逐条说明）：

| 文件                                                                                                        | 为什么必须动                                                                              | 改动量            |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| `src/hooks/useGlobalEvents.ts`                                                                              | 它是 `EventCallbacks` 的**唯一生产消费者**。事件载荷从 V1 变 V2，这里的适配代码不可能不动 | ~137 行（含注释） |
| `src/contexts/SessionContext.tsx`                                                                           | 同上（订阅 `onSessionCreated/Updated/Deleted`，且要删掉 `onTodoUpdated`）                 | ~52 行            |
| `src/hooks/useSessions.ts`                                                                                  | 同上                                                                                      | ~48 行            |
| `src/components/WorktreePanel.tsx`、`src/hooks/useGitWorkspaceCatalog.ts`                                   | `worktree.ready/failed` → `worktree.updated/resolved`                                     | 各 4~10 行        |
| `src/api/session.ts`                                                                                        | 任务 4 点名「创建会话必须写进 body 的 `location`」                                        | ~30 行            |
| `src/api/v2Convert.ts`                                                                                      | 新增 `toInternalPermissionRequest()`（V2 权限载荷 → 内部模型）                            | +45 行            |
| `src/types/api/{common,file,index,message}.ts`、`src/types/index.ts`、`src/types/ui.ts`、`src/api/types.ts` | A/C 桶删除后的转发清理（不清理就 `tsc` 报错）                                             | 各 2~110 行       |
| `src/types/api/todo.ts`                                                                                     | **新增**：`TodoItem` 原来挂在 `event.ts` 上，V2 没有 `todo.updated` 事件，类型得搬家      | 新文件 28 行      |

### 0.2 本阶段**没有**做的事

- ❌ **Tauri 真机验证**：容器内无 Tauri 运行时，`plugin-http` 的流式表现**未实测**（见 §8#1）
- ❌ **浏览器人工验证**：按用户决定，只用单测 + API 冒烟（见 §6）
- ❌ **Form 表单渲染器**：V2 的 `form.created/replied/cancelled` 事件已接线，但渲染器属阶段 3（见 §7#11）
- ❌ **权限回复 API**：`src/api/permission.ts` 仍是 `notMigratedYet`（阶段 3）
- ❌ **「换模型 → 切会话模型」的 UI 联动**：V2 的模型是**会话级**的，`prompt` 不接受 model 参数（见 §7#7）
- ❌ **撤销/重做**：依赖 V2 三段式 revert（阶段 3），行为与阶段 1/2a 一致（仍抛错）

---

## 1. 事件映射表（V1 → V2，实际实现的）

> 口径：阶段 2a 报告 §1.4 记录的「`events.ts` 实际引用的 21 个 `EventTypes` 常量」逐个对照。

### 1.1 消息族（本阶段核心）

| V1 事件                | V2 实际实现                                                                                                                                                                                                 | 说明                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `message.part.updated` | **`session.text.started/ended`**、**`session.reasoning.started/ended`**、**`session.tool.input.started/ended`**、**`session.tool.called/progress/success/failed`**、**`session.step.started/ended/failed`** | 拆成 13 个事件；统一走 `onPartUpdated` 的判别联合（`kind: 'content' \| 'step' \| 'step-start'`）                      |
| `message.part.delta`   | **`session.text.delta`**、**`session.reasoning.delta`**、**`session.tool.input.delta`**                                                                                                                     | 统一走 `onPartDelta`（`kind: 'text' \| 'reasoning' \| 'input'`）                                                      |
| `message.part.removed` | ❌ **无对应事件** → 改为「**重拉消息**」                                                                                                                                                                    | 触发源是 `session.revert.staged/committed/cleared` 与 `session.execution.interrupted`，回调名 `onMessagesInvalidated` |
| `message.updated`      | **`session.message.content.updated`**                                                                                                                                                                       | ⚠️ 已接线，但**实测从不下发**（见 §7#2）→ 实际是「有分支、无生产者」                                                  |
| `session.error`        | **`session.execution.failed`**                                                                                                                                                                              | 载荷从 V1 的 `{name, data}` 换成 V2 的 `{type, message, status?}`                                                     |
| `session.updated`      | **`session.renamed`**、**`session.metadata.updated`**、**`session.agent.selected`**、**`session.model.selected`**、**`session.moved`**                                                                      | 统一合成 `SessionInfoPatch`（部分字段补丁）                                                                           |
| `question.asked`       | **`form.created`**                                                                                                                                                                                          | 载荷结构完全不同（`FormInfo` vs `QuestionRequest`）→ 本阶段只做 pending 登记 + 通知                                   |
| `question.replied`     | **`form.replied`**                                                                                                                                                                                          | 同上                                                                                                                  |
| `question.rejected`    | **`form.cancelled`**                                                                                                                                                                                        | 同上                                                                                                                  |
| `worktree.ready`       | **`worktree.updated`**                                                                                                                                                                                      | 载荷从 `{}` 变成 `{projectID}`                                                                                        |
| `worktree.failed`      | **`worktree.resolved`**                                                                                                                                                                                     | ⚠️ **语义变了**：不是「失败」而是「目录被解析/采用」（见 §7#10）                                                      |
| `session.created`      | ✅ `session.created`                                                                                                                                                                                        | 载荷字段与 REST 的 `Session.Info` **不一致**（见 §7#5）                                                               |
| `session.deleted`      | ✅ `session.deleted`                                                                                                                                                                                        | 载荷从裸 `sessionID` 变成 `{sessionID}`                                                                               |
| `session.idle`         | ⚠️ **保留分支，但实测从不下发**                                                                                                                                                                             | schema 里已标 `// deprecated` → 实际改用 `session.execution.succeeded`（见 §7#1）                                     |
| `session.status`       | ⚠️ **保留分支，但实测从不下发**                                                                                                                                                                             | 实际改用 `session.execution.started/succeeded/failed/interrupted`（见 §7#1）                                          |
| `project.updated`      | ✅ `project.updated`                                                                                                                                                                                        | 原样可用                                                                                                              |
| `permission.asked`     | ✅ `permission.asked`                                                                                                                                                                                       | 载荷字段名变了：`permission/patterns/always` → `action/resources/save`（见 §7#6）                                     |
| `permission.replied`   | ✅ `permission.replied`                                                                                                                                                                                     | 载荷 `{sessionID, requestID, reply}`                                                                                  |
| `vcs.branch.updated`   | ✅ `vcs.branch.updated`                                                                                                                                                                                     | 原样可用                                                                                                              |
| `server.connected`     | ✅ `server.connected`                                                                                                                                                                                       | ⚠️ V2 的 `data` 是**空对象**，V1 的 `properties.timestamp` 没有了（见 §7#3）                                          |
| `todo.updated`         | ❌ **已移除**                                                                                                                                                                                               | 源码中不存在该事件 → 常量、回调、`todoStore` 写入分支全部删除                                                         |
| `lsp.updated`          | ❌ **已移除**                                                                                                                                                                                               | 不在 `ServerDefinitions`（V2 不跑 LSP）；原本 `events.ts` 也没有处理分支，只删常量                                    |

### 1.2 本阶段**新增接线**的 V2 事件（V1 没有对应物）

| V2 事件                                   | 回调                                                                         | 用途                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `session.execution.started`               | `onSessionStatus({type:'busy'})`                                             | **替代 `session.status`**：一轮开始                      |
| `session.execution.succeeded`             | `onSessionStatus({type:'idle'})` + `onSessionIdle`                           | **替代 `session.idle`**：一轮成功结束                    |
| `session.execution.failed`                | `onSessionStatus({type:'idle'})` + `onSessionError`                          | 一轮失败                                                 |
| `session.execution.interrupted`           | `onSessionStatus({type:'idle'})` + `onSessionIdle` + `onMessagesInvalidated` | 用户中断（转录被截断 + 必须让 `isStreaming` 落回 false） |
| `session.usage.updated`                   | `onSessionUsage`                                                             | 会话级累计成本/用量（一轮内会下发 2 次：步中 + 步末）    |
| `session.retry.scheduled`                 | `onSessionRetry`                                                             | V1 是 `retry` part，V2 是 assistant 的字段               |
| `session.revert.staged/committed/cleared` | `onMessagesInvalidated`                                                      | 回退三段式 → 重拉                                        |
| `session.step.started`                    | `onPartUpdated({kind:'step-start'})`                                         | **新建 assistant 消息的权威信号**，带 `agent` / `model`  |

### 1.3 真实服务实际下发的事件（三次抓包汇总，去重 42 种）

```
server.connected
session.created
session.renamed
session.execution.started / succeeded / interrupted
session.instructions.updated
session.inbox.enqueued / delivered
session.step.started / streamed / ended / failed
session.text.started / delta / ended
session.reasoning.started / delta / ended
session.tool.input.started / delta / ended
session.tool.called / progress / success / failed
session.usage.updated
project.updated  vcs.branch.updated
provider.updated  model.updated  agent.updated  command.updated  skill.updated
integration.updated  reference.updated  plugin.updated  websearch.updated
shell.created  shell.exited
```

**不在这份名单里的**：`session.idle`、`session.status`、`session.message.content.updated`
（前两个 deprecated/无生产者，第三个不在 `V2Event` 联合里）—— 详见 §7。

---

## 2. 连接管理方案：**用了官方 `client.event.subscribe()`**

### 2.1 为什么

官方实现（`@opencode/client` 的 `SharedEvents.make`，源码逐行读过）已经做好了本项目 V1 手写 1060 行里的绝大部分事情：

| 能力                                              | 官方是否已做 | 说明                                                                      |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| 共享一条懒连接                                    | ✅           | 多订阅者复用同一流，最后一个退出才 `controller.abort()`                   |
| 每订阅者独立队列                                  | ✅           | 容量 **4096**，溢出报 `Event subscriber exceeded its 4096-event capacity` |
| SSE 文本解析                                      | ✅           | 多行 `data:` 合并、`\r\n`/`\r` 归一、增量 UTF-8 解码、单事件字节上限      |
| 心跳信号                                          | ✅           | `onActivity` 回调：**含心跳在内的任何传输活动**都触发                     |
| 自动重连                                          | ❌           | 由本项目负责（`RECONNECT_DELAYS` 退避）                                   |
| 连接状态机 / 代次防串扰 / 后台保活 / 生命周期监听 | ❌           | 由本项目负责（**从 V1 原样保留**）                                        |

### 2.2 传输层被刻意隔离成一个函数

```ts
function createEventTransport(serverId, signal, onActivity): AsyncIterable<V2EventUnion> {
  return getSDKClient(serverId).event.subscribe({ signal, onActivity })
}
```

**取舍理由**：Tauri 下 `plugin-http` 的流式表现本容器**无法验证**（见 §8#1）。
把它隔离成一个函数，真机若发现问题，只需把这一行换成手写
`fetch('/api/event') + ReadableStream`，**其余（分发 / 合并 / 重连 / 状态机）一行都不用改**。

### 2.3 从 V1 原样保留的部分

- 每服务器独立连接 + 订阅者集合 + 连接状态广播（`useSyncExternalStore` 友好）
- **代次（generation）防串扰**：重连后旧连接的事件自动失效（实测用例覆盖）
- `RECONNECT_DELAYS = [1s,2s,3s,5s,10s,30s]` 指数退避；后台另有一套更激进的 `[0.5s…10s]`
- 心跳超时判定（前台 60s / 后台 120s）+ 后台 keepalive 轮询（30s）
- 可见性变化 / `online` / `offline` 生命周期监听
- `onReconnected` 广播（带 2s cooldown，防止快速重连密集触发数据拉取）
- **`coalesceEvents()` 批量合并**（4096 队列溢出是真实风险，必须保留）

### 2.4 批量合并（V2 字段路径重写）

```
同一批内相同 (sessionID, messageID, partID, kind) 的 delta  → 字符串拼接成一个
某个 part 的整块更新（started/ended/called/success/failed）到达 → 丢弃该 part 在途的 delta
```

关键点：合并键里的 `partID` 是**已经算好的 UI part id**，与 store 的定位规则完全一致：

- text / reasoning → `` `${messageID}:content:${ordinal}` ``
- tool → 工具自身的 `id`

**实测证明**：一次带工具调用的完整回合里，`session.tool.progress` 连续两帧、
`session.reasoning.delta` / `session.text.delta` 紧随各自的 `*.started` —— 合并逻辑有真实用武之地。

---

## 3. 恢复策略：**重订阅 + 重拉**

### 3.1 触发条件（三个入口）

| 触发                                           | 位置                            | 动作                                                   |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| **流正常结束**（服务端关闭 / 网络断开）        | `runEventStream` 的 `done` 分支 | `state='disconnected'` → `scheduleReconnect`           |
| **流出错**（fetch 失败 / 队列溢出 / 解析失败） | `catch` 分支                    | `state='error'` + `onError(err)` → `scheduleReconnect` |
| **心跳超时**（60s 无任何传输活动）             | `resetHeartbeat` 的定时器       | `state='disconnected'` → `scheduleReconnect`           |

另有两个**立即重连**入口（不走退避）：页面从后台恢复前台、网络 `online`；以及显式的
`reconnectServerSSE(serverId)`（切换服务器 / WSL sidecar 换端口）。

### 3.2 「重拉」怎么落地

V2 的流是**易失的**（官方契约原文：_"Volatile by contract: a slow consumer overflows and
fails the stream, and events during disconnection are missed."_）——**不回放**。
所以只重订阅会丢消息，必须补一次全量拉取。实现分两层：

1. **`events.ts`**：连接成功（含首次连接）→ `broadcastReconnected(conn, reason)`，
   `reason` 为 `'network'` 或 `'server-switch'`（带 2s cooldown）。
2. **`useGlobalEvents.onReconnected`**（每个服务器一份）：
   - `refreshServerHealth(serverId)`
   - `fetchAndInitialize(serverId)` —— 重拉 session 状态 + pending 权限/表单
   - **`messageStore.markAllSessionsStale()`** —— 把所有已缓存会话标记为 stale，
     下次读取时 `useSessionManager` 的 `canUseCached` 失效 → **强制重拉**
   - 逐个通知会话消费者（`consumer.callbacks.onReconnected?.(reason)`）
3. **`useChatSession.onReconnected`**（每个 pane 一份）：`markAllSessionsStale()` +
   `loadSession(routeSessionId, { force: true })` → 当前打开的会话**立刻重拉**
   （`force` 模式下跳过「SSE 推送比 API 多就不覆盖」的短路，无条件用服务端数据覆盖）。

> `SessionContext` / `useSessions` / `useAutoRefresh` / `useGitWorkspaceCatalog` 也各自订阅
> `onReconnected`，但它们在 `reason === 'server-switch'` 时**跳过**（避免切换服务器时
> 新旧数据打架）—— 与 V1 行为一致。

### 3.3 代次（generation）防串扰

每次 `teardownConnectionTransport` / `forceReconnectNow` / `disconnectServerConnection`
都会 `conn.generation++`。`runEventStream` 捕获建立时的 `myGeneration`，
在**每次 `await iterator.next()` 前后**都比对；不一致就立即 `break` 并丢弃整批。
实测用例「代次防串扰：reconnect 之后旧流的事件被丢弃」覆盖。

---

## 4. 发消息链路

### 4.1 两条链路的实现

```ts
// 只投递，不等这轮跑完（UI 常规发送路径）
sendMessageAsync(params) → sdk.session.prompt(buildPromptParams(...))

// 投递 + 等这轮跑完
sendMessage(params) → sdk.session.prompt(...)  →  sdk.session.wait({ sessionID })
```

依据（照 `v2.0.19` 源码核实，不是推测）：

- `packages/protocol/dist/groups/session.js:278` ——
  `POST /api/session/:sessionID/prompt`，payload `{id?, ...PromptInput.Prompt.fields, metadata?, delivery?, resume?}`，
  description 原文 _"Durably admit one session input and schedule agent-loop execution unless resume is false."_
  → **prompt 本身就是非阻塞的**，返回 `Session.Inbox.User`。
- `POST /api/experimental/session/{id}/wait`（SDK `session.wait`）—— _"Wait for a session agent loop to become idle"_。
- ⚠️ `POST /api/session/{id}/background` **不是** `prompt_async` 的替代品
  （它是 _"Move active foreground backgroundable tools into background observation"_）—— 已在代码注释里写明。

### 4.2 `buildPromptParams()`（唯一构造入口，纯函数，已导出供单测）

`PromptInput.Prompt` 只有 4 个字段：`{text, files?, agents?, skills?}`。映射规则：

| UI 输入                           | V2 参数                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `params.text`                     | `text`                                                                                                                               |
| 附件 `type: 'file' \| 'folder'`   | `files: [{ uri, name?, mention? }]`（`uri` 取 `attachment.url`，缺失回落到 `file://${relativePath}`；`mention` 由 `textRange` 展开） |
| 附件 `type: 'agent'`              | `agents: [{ name: agentName, mention? }]`                                                                                            |
| 附件 `type: 'text' \| 'command'`  | **跳过**（command 走 `session.command` 端点）                                                                                        |
| `params.agent`                    | `metadata.agent`                                                                                                                     |
| `params.model` + `params.variant` | `metadata.model = {providerID, modelID, variant}`                                                                                    |

空的 `files` / `agents` / `metadata` 键**整体省略**（不传 `[]`）。

### 4.3 ⚠️ 模型：V2 的 `prompt` **不接受 model 参数**

`PromptInput.Prompt` 的 4 个字段里没有 model —— V2 的模型是**会话级**的
（`POST /api/session/{id}/model` + `session.model.selected` 事件）。
本阶段的处理：

- 把调用方给的模型写进 `metadata.model`（**与官方 TUI 完全一致**：阶段 2a 实测 TUI 写的就是
  `metadata.model`，且用的是 V1 命名 `modelID`）→ **历史渲染能显示正确的模型**
- **没有**额外发 `switchModel`：那会往转录里插一条 `model-switched` 记录，每次发送都插一次显然不对
- 「用户换模型 → 切会话模型」的联动属**阶段 3**（需要 `session.switchModel` + 记住当前会话模型）

### 4.4 `createSession()`（任务 4 点名）

```ts
const created = await sdk.session.create({
  title,
  agent,
  model,
  ...(directory ? { location: { directory } } : {}), // 🔴 只认 body 里的 location
})
```

🔴 依据 `packages/server/src/handlers/session.ts:136`：
`location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) }`
—— 它**既不看中间件也不看请求头**，不传就静默落到服务进程的 cwd（阶段 0/1 已实测）。
另：V2 的 `SessionCreateInput` **没有 `parentID`**，形参保留但**不发送**（已注释说明）。

### 4.5 `sendMessage` 的返回值是**入队记录**，不是 AI 回复

V2 没有「一次请求拿回复」的接口（回复只出现在转录里）。
`SendMessageResponse` 的 `info` 是入队记录、`parts` 恒为 `[]` —— **刻意的**，
已在 `src/api/types.ts` 与 `src/api/message.ts` 双处注明。全仓库只有 `sendMessageAsync` 有生产调用方。

---

## 5. `v1Model.ts` 删除清单

### 5.1 总数

|               | 阶段 2a 末 | 阶段 2b 末 |
| ------------- | ---------: | ---------: |
| 顶层 `export` |    **189** |    **104** |
| 行数          |       3502 |       1492 |

### 5.2 A 桶 66 个（消息 / Part / 消息事件）—— 全部删除

| 分组                        | 数量 | 类型                                                                                                                                                                                               |
| --------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消息主体                    |    4 | `UserMessage`、`AssistantMessage`、`Message`、`Prompt`                                                                                                                                             |
| Part 联合成员               |   13 | `TextPart`、`ReasoningPart`、`ToolPart`、`FilePart`、`AgentPart`、`StepStartPart`、`StepFinishPart`、`SnapshotPart`、`PatchPart`、`SubtaskPart`、`RetryPart`、`CompactionPart`、`Part`             |
| 工具状态机                  |    5 | `ToolStatePending`、`ToolStateRunning`、`ToolStateCompleted`、`ToolStateError`、`ToolState`                                                                                                        |
| Part 来源                   |    5 | `FilePartSourceText`、`FileSource`、`SymbolSource`、`ResourceSource`、`FilePartSource`                                                                                                             |
| 输出格式                    |    4 | `OutputFormatText`、`JsonSchema`、`OutputFormatJsonSchema`、`OutputFormat`                                                                                                                         |
| 消息错误联合                |    7 | `ProviderAuthError`、`UnknownError`、`MessageOutputLengthError`、`MessageAbortedError`、`StructuredOutputError`、`ContextOverflowError`、`ApiError`                                                |
| Part 输入                   |    4 | `TextPartInput`、`FilePartInput`、`AgentPartInput`、`SubtaskPartInput`                                                                                                                             |
| `message.*` 同步事件        |    4 | `SyncEventMessageUpdated`、`SyncEventMessageRemoved`、`SyncEventMessagePartUpdated`、`SyncEventMessagePartRemoved`                                                                                 |
| `session.next.*` 消息流事件 |   18 | `Synthetic`、`StepStarted/Ended/Failed`、`TextStarted/Ended`、`ReasoningStarted/Ended`、`ToolInputStarted/Ended`、`ToolCalled/Progress/Success/Failed`、`Retried`、`CompactionStarted/Delta/Ended` |
| 事件载荷                    |    2 | `EventMessagePartRemoved`、`EventMessagePartDelta`                                                                                                                                                 |

### 5.3 C 桶 19 个（跨组）—— 17 删 + 2 降级

**删除（17）**：`GlobalEvent`、`PromptSource`、`PromptFileAttachment`、`PromptAgentAttachment`、
`PromptReferenceAttachment`、`SessionErrorUnknown`、`ToolTextContent`、`ToolFileContent`、
`SessionNextRetryError`、`SyncEventSessionNextAgentSwitched`、`ModelSwitched`、`Moved`、`Prompted`、
`PromptAdmitted`、`PromptPromoted`、`ShellStarted`、`ShellEnded`

**降级为非导出（2）**：`SnapshotFileDiff`、`Range`
—— 它们被 **B 桶**的 `Session.summary.diffs` / `EventSessionDiff.diff` / `Symbol.location.range`
结构性地引用，删定义会让 B 桶编译不过。处理方式是**只去掉 `export` 关键字，结构一字未改**，
这样「顶层导出」计数照样从 189 降到 104，而 B 桶一个都没动。

> ⚠️ `Range` 必须显式定义：不定义的话它会**静默解析到 DOM 的 `Range`**（`lib.dom.d.ts`），
> `tsc` 照样零报错，但 `Symbol.location.range` 的类型就完全错了 —— 已在文件里加注释警示。
> `src/types/api/file.ts` 的 `FileDiff` 原先是 `Omit<SnapshotFileDiff, 'file'>`，
> 已就地定义等价形状（`file`/`patch`/`status` 仍是可选，**结构零变化**）。

### 5.4 🔴 如实交代：批量删除脚本误删了 3 个 B 桶类型（已补回）

删除用的是一个「从 `export type X = {` 扫到首个大括号配平行」的脚本。
`Pty` / `Todo` / `QuestionOption` 这三个 B 桶类型的内层字段带 `/** … */` 文档注释，
脚本在「向前吞注释」时吃掉了外层注释的起始行、又把结束行算错，于是**把定义删掉了、留下残片**。

**发现方式**：用「原始 189 个名字」与「删后剩余名字」做集合差（不是靠 `tsc` —— 因为残片仍能编译）。
**补回方式**：按仓库内**实际读取的字段**逐一核对后重写，并加注释说明：

| 类型             | 字段依据                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QuestionOption` | `{label, description}`；依据 V2 自带 V1 schema `@opencode/schema/dist/v1/question.d.ts` 的 `Option`                                                                |
| `Pty`            | `{id, title, command, args, cwd, status: 'running'\|'exited', pid}`；依据 `BottomPanel.tsx:87-89`、`RightPanel.tsx:83`、`App.tsx:585` 实际读的字段 + V2 `Pty` 同构 |
| `Todo`           | `{content, status, priority}`；依据 `src/api/todo.ts` 的 `normalizeTodoItems()`，且 `TodoItem = Todo & {id}` 说明服务端无 id                                       |

**最终核对结果**（脚本 + `tsc --force` + 未定义标识符扫描三重验证）：

```
orig 189  B 104  remaining 106（= 104 导出 + 2 降级）
MISSING (B 桶里被误删的): []
EXTRA   (本应删掉却还在): [ 'Range', 'SnapshotFileDiff' ]   ← 预期的 2 个降级项
未在本文件定义、也未列白名单的标识符: （空）
顶层 export 计数: 104
```

---

## 6. 测试与冒烟结果

### 6.1 总体

| 场景                           | 文件                  | 用例                        | 结果                                     |
| ------------------------------ | --------------------- | --------------------------- | ---------------------------------------- |
| **默认（无真实服务开关）**     | 99 passed / 2 skipped | **803 passed + 19 skipped** | ✅ **0 失败**                            |
| **开 `VITE_OPENCODE_SMOKE=1`** | 101 passed            | **822 passed + 0 skipped**  | ✅ **0 失败**（连续 3 轮复跑均 822/822） |

- 阶段 2a 基线 **741 例全部仍通过**（0 回归）
- 跳过的 19 例 = 阶段 2a 冒烟 8 + 阶段 2b 冒烟 11（两者都在开关关闭时**自跳过**，不是失败）
- `npx tsc -b --force`：**0 报错**
- `npx eslint <所有改动文件>`：**0 告警**
- `npx prettier --check <所有改动文件>`：**全部通过**（顺带把改动文件里既有的格式漂移一并修正）

### 6.2 新增 / 改写的测试

| 文件                                          |               用例数 | 覆盖的关键逻辑                                                                                                                                                     |
| --------------------------------------------- | -------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/api/events.test.ts`                      | **43**（原 5，重写） | 真实帧解析（A 组）、`coalesceEvents` 合并/作废（B 组）、事件分发（C 组）、连接管理（D 组）                                                                         |
| `src/api/message.test.ts`                     |          29（原 23） | `buildPromptParams` 7 例（附件/agent/跳过/省略空键/metadata）+ 发送链路 2 例（prompt 顺序、wait 参数）+ 原有分页 20 例                                             |
| `src/store/messageStore.test.ts`              |          35（原 29） | V2 载荷下的 part upsert、text/reasoning/input 三种 delta、step-finish 只在 finish 存在时合成、`handleSessionInvalidated` 置 stale、`handleMessageUpdated` 全量替换 |
| `src/store/messageStoreHooks.test.tsx`        |                    6 | 夹具换 V2 载荷                                                                                                                                                     |
| `src/hooks/useGlobalEvents.test.tsx`          |                   25 | 回调载荷换 V2；`handlePartRemoved` → `handleSessionInvalidated`；`onTodoUpdated` 用例删除；question → form                                                         |
| `src/contexts/SessionContext.test.tsx`        |            7（原 5） | 新增 2 例锁住「部分补丁必须合并、不得覆盖成 undefined」与「本地没有该会话时交给服务端重查」                                                                        |
| `src/api/phase1Smoke.test.ts`                 |          13（原 12） | 删掉 `searchText` 报错断言；新增「文件名搜索在真实服务上能命中」                                                                                                   |
| `src/components/FileExplorer.test.tsx`        |            4（原 3） | 新增「只剩文件名搜索」：调用 `searchFiles`、渲染在 Files 分组、Content 分组不存在                                                                                  |
| `src/features/message/phase2b.smoke.test.tsx` |       **11**（新增） | 真实服务冒烟，见 §6.4                                                                                                                                              |

### 6.3 真实事件帧夹具（任务 8 的硬性要求）

**新增 `src/test/fixtures/v2EventFrames.ts`**：把三次真实抓包得到的 **30 个原始帧**（含心跳注释行）
逐字节存成夹具，来源与抓包命令写在文件头。用途：

1. `A. 真实事件帧解析` 组用它验证 **wire 格式**：
   - 只有 `data:` 行，**没有** `event:` / `id:` 行
   - `data` 后面是**一层** JSON，事件是**扁平**结构（`type` 与 `data` 同级，不是 V1 的 `{directory, payload:{type, properties}}`）
   - 心跳是**注释行**（解析不出事件）
   - 首帧是 `server.connected`，`data` 为空对象且**没有 `created`**
2. `C. 事件分发` 组用它验证 **字段路径**：把真实帧喂进 `subscribeToEvents`，断言
   - `session.text.*` 的 `assistantMessageID` / `ordinal` / `delta` / `text`
   - **合成 part id = `消息id:content:下标`**（不是 V2 的任何字段）
   - `session.tool.*` 用**工具自身的 `id`** 作 part id；`input.ended` **不带 `name`**
   - `session.step.started` 带 `agent`/`model`；`session.step.ended` 带 `finish`/`cost`/`tokens`
   - `session.created` 的 `sessionID`/`slug`/`version`/`location.directory`，且**没有 `time`**
   - `session.renamed` / `session.moved` → `SessionInfoPatch` 部分补丁

> 真实帧一旦被 V2 改字段，这组测试会立刻红掉 —— 这就是它存在的意义。

### 6.4 API 冒烟（真实 V2 服务，11/11 通过）

环境：`OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097`
入口：`VITE_OPENCODE_SMOKE=1 npx vitest run src/features/message/phase2b.smoke.test.tsx`

| 用例                                                 | 实测结果                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 订阅 `/api/event` 能收到 `server.connected` **首帧** | ✅ 首帧 `data: {"id":"evt_…","type":"server.connected","data":{}}`（**无 `created`**）                                                |
| **心跳**正常                                         | ✅ 连接后 **≈0.01s 立刻一次**，之后严格 **15.00s / 30.00s / 45.00s**；全是注释行                                                      |
| 发 `prompt` 后事件流真的有数据                       | ✅ `session.execution.started` → `step.started` → `text.started` → `text.delta` → `text.ended` → `step.ended` → `execution.succeeded` |
| 🔴 `session.idle` / `session.status` 从未下发        | ✅ 22~100 秒窗口、三次抓包、含一次带工具调用的完整回合与一次 interrupt，**一帧都没有**                                                |
| 🔴 `session.message.content.updated` 也不下发        | ✅ 同上                                                                                                                               |
| `execution.*` → busy/idle 映射生效                   | ✅ 事件层回调实测收到 `['busy','idle']` + `onSessionIdle`                                                                             |
| delta 的 part id 合成正确                            | ✅ `partID === `${assistantMessageID}:content:${ordinal}``                                                                            |
| `step.started` / `step.ended` 载荷正确               | ✅ `messageID` 与真实 `assistantMessageID` 一致                                                                                       |
| `sendMessageAsync` 走 `prompt` 且非阻塞              | ✅ 返回 < 15s；随后转录里出现 `user` 消息                                                                                             |
| `sendMessage` 走 `prompt` + `wait`                   | ✅ `wait` 返回后转录里已有 assistant 消息且有 parts                                                                                   |
| 附件 / agent 参数形状                                | ✅ `buildPromptParams` 纯函数断言（`files[].uri` + `mention`、`metadata.agent`、`metadata.model`）                                    |

**顺带修好两个老问题**（都属测试自身质量，**不是被测代码回归**）：

1. **阶段 2a 冒烟选会话的启发式太脆**。原来是「最新 12 个会话里第一个非空的」——
   本阶段的冒烟在仓库目录里新建会话，于是它选中了一个只有 1~2 条消息的小会话，
   导致「hasMore 必须为真」「必须能找到工具调用」等 6 条断言失败。
   已改成「按新→旧逐个体检、**取消息数最多的那个**，探针页填满即提前收工」，
   并把 `GET /api/session` 的 `limit` 显式提到 200（**服务端默认只给最新 50 个**，
   不显式要就会被截断 —— 这是踩到的第二个坑）。
2. **冒烟测试会往数据目录里堆会话**。每次全量冒烟都会新建 2~3 个会话；
   跑几轮后仓库目录攒到 97 个会话，把老的长会话挤到列表很后面（正是问题 1 的诱因）。
   已给 `phase2b.smoke.test.tsx` 加 `afterAll` **自清理**：只删本次运行自己建的 id，
   不碰任何既有会话。实测连续 3 次全量冒烟后会话总数稳定不变（97 → 97）。

> ⚠️ **遗留**：本阶段早期（未加自清理之前）的冒烟运行已在
> `/home/coder/project/OpenCodeUI` 目录留下约 40 个 1~4 条消息的测试会话。
> **未做删除**（对用户数据的破坏性操作需明确授权）。清理命令见 §8#10。

---

## 7. 🔴 与文档预测不符之处

> 本节是本次报告最重要的部分。前三轮都是这么做的。

### 7.1 🔴🔴 文档 §6.4 把 `session.idle` / `session.status` 判为「✅ 原样可用」——**实测二者从不下发**

|                  | 内容                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **文档原文**     | `session.idle` ✅（`session-status-event.ts`）、`session.status` ✅                                                                                                                                                                                                                                                                   |
| **实测**         | v2.0.19 **一帧都没有**。22~100 秒窗口、三次抓包、含带工具调用的完整回合 + 一次 interrupt，逐帧核对                                                                                                                                                                                                                                    |
| **源码依据**     | 两者**确实在** `ServerDefinitions` 里（`event-manifest.js` 的 `...SessionStatusEvent.Definitions`），所以类型与常量都在；但 `SessionStatusEvent.Idle` 上明确标了 **`// deprecated`** → **没有生产者**                                                                                                                                 |
| **后果（严重）** | `useGlobalEvents.onSessionIdle` 负责 `messageStore.handleSessionIdle()`（把 `isStreaming` 落回 false、给流式消息补 `completed`）与 `childSessionStore.markIdle`；`onSessionStatus` 负责 `activeSessionStore.updateStatus`（"Working" 列表 + busy→idle 通知）。**这两个回调永不触发 → 界面会一直停在「生成中」，侧栏永远有「工作中」** |
| **处理**         | ✅ 改用**确实会下发**的 `session.execution.*` 做映射：`started`→busy、`succeeded`→idle+`onSessionIdle`、`failed`→idle+`onSessionError`、`interrupted`→idle+`onSessionIdle`+`onMessagesInvalidated`。`session.idle`/`session.status` 的常量与分支**保留**（将来恢复了也能用），但代码注释明确写了「不要依赖它」                        |
| **回填**         | ✅ 主文档 §6.4 已加「阶段 2b 实测修正」标注                                                                                                                                                                                                                                                                                           |

> ⚠️ `execution.interrupted` 的映射里**必须**带 `onSessionIdle`：
> 实测用户中断后不会有 `execution.succeeded`，只 reset 状态码是不够的，
> `isStreaming` 会一直停在 true。这一条是本阶段自查时发现的（已补测试）。

### 7.2 🔴 `session.message.content.updated` 有 schema 类型、但**不在 `V2Event` 联合里**，且实测不下发

|                      | 内容                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **文档原文**         | `message.updated` → `session.message.content.updated`（§6.4）                                                                                                                                                                                                                                                 |
| **实测 1（类型层）** | `@opencode/client` 里**有** `SessionMessageContentUpdated` 类型（`types.d.ts:3257`），也出现在事件日志联合 `SessionEventDurable` 里，但 **`V2Event`（`types.d.ts:3310`）的联合里没有它** → `client.event.subscribe()` 的静态类型不包含该事件，直接 `satisfies Record<string, V2Event['type']>` 会**编译失败** |
| **实测 2（运行时）** | 三次抓包**一帧都没有**                                                                                                                                                                                                                                                                                        |
| **处理**             | ① `V2EventUnion = V2Event \| SessionMessageContentUpdated`，把 SDK 漏掉的这一支手工并回来并加注释；② `satisfies` 放宽到 `V2Event['type'] \| SessionMessageContentUpdated['type']`；③ **保留** `handleMessageUpdated` 分支（API 完整），但在注释与报告里都注明「有分支、无生产者」                             |
| **性质**             | V2 自身的**枚举/联合不一致**（与阶段 2a 发现的「`idle` 能返回但不能过滤」同一类），不是本项目的问题                                                                                                                                                                                                           |

### 7.3 🔴 心跳：**连接后立刻有一次**，之后才是 15 秒间隔

|              | 内容                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **文档原文** | §6.1「心跳：每 **15 秒**一行注释 `: heartbeat`」                                                                                               |
| **实测**     | `0.00s server.connected` / **`0.01s HEARTBEAT`** / `15.00s` / `30.00s` / `45.00s` —— 首帧心跳**几乎立刻**到达                                  |
| **影响**     | 若照文档实现「15 秒才该有心跳」的判定，会误判；反过来，若用「收到心跳」当连接成功信号，会**过早**认为连接就绪                                  |
| **处理**     | ✅ 本项目用的是 `onActivity`（任何传输活动都刷新心跳超时），两种行为都能正确覆盖；冒烟测试的断言已按实测改为「首帧心跳 < 5s，之后间隔 12~20s」 |
| **回填**     | ✅ 主文档 §6.1 已加标注                                                                                                                        |

### 7.4 🟡 `server.connected` 的 `data` 是空对象，V1 的 `properties.timestamp` 没有了

|                    | 内容                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **文档原文**       | §6.1「首帧：连接即刻收到 `{id, type:"server.connected", data:{}}`」（文档这里是对的）                                                                                                                                         |
| **本项目受影响点** | `useGlobalEvents.onServerConnected` → `serverStore.applyServerConnectedTimestamp(serverId, data.timestamp)` 做**时钟校准**                                                                                                    |
| **实测**           | `server.connected` 既没有 `data.timestamp`，也**没有 `created`**                                                                                                                                                              |
| **处理**           | ✅ 事件层尽力而为：传事件的 `created`（有就给、没有就是 `undefined`）；`applyServerConnectedTimestamp` 对非数字直接 `return false`，**静默跳过校准**。即：V2 下**服务器时钟校准能力丢失**，如实记录（未见 UI 依赖它的硬需求） |

### 7.5 🟡 `session.created` **事件**的字段与 REST 的 `Session.Info` 不一致

| 概念           | 事件 `session.created.data` | REST `Session.Info`                             |
| -------------- | --------------------------- | ----------------------------------------------- |
| id             | **`sessionID`**             | `id`                                            |
| 目录           | `location.directory`        | `location.directory`                            |
| slug / version | **有**                      | ❌ 没有（`toInternalSession` 用 id / 空串兜底） |
| **时间**       | ❌ **完全没有 `time`**      | `time.created/updated`                          |
| 成本 / 用量    | ❌ 没有                     | `cost` / `tokens`                               |

→ 事件层新增 `sessionFromCreatedEvent()` 逐字段映射，**时间用事件自身的 `created` 兜底**（语义正确）。
文档 §5.2 只讲了 REST 侧，没提事件侧字段不同。

### 7.6 🔴 权限载荷：不是「多了 `patterns`」，而是 `permission→action` + `patterns→resources`

|                                | 内容                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **阶段 1 注释原文**            | 「V2 的 `PermissionRequest` 结构变了（**少了 permission 字段、多了 patterns**）」                                                                                                                                                            |
| **实测（生成类型逐字段核对）** | V2 是 `{id, sessionID, action, resources, save?, source?, message?}` —— **`patterns` 是 V1 的名字**，V2 叫 `resources`；`permission` 改叫 `action`；`always` 改叫 `save`；`tool:{messageID,callID}` 改叫 `source:{type:'tool',messageID,id}` |
| **处理**                       | ✅ 新增 `v2Convert.toInternalPermissionRequest()` 做映射，权限 UI 与 `SessionEventCallbacks` 本阶段零改动；阶段 3 换权限链路时一并清理                                                                                                       |

### 7.7 🔴 V2 的 `prompt` **不接受 model 参数**（文档 §4.2 的请求体列表里没有它，但没点明后果）

`PromptInput.Prompt`（`@opencode/schema/dist/prompt-input.js`）只有 `{text, files?, agents?, skills?}`。
V2 的模型是**会话级**的。文档 §4.2 写的是「请求体 `{text, files, agents, skills, metadata, delivery, resume}`」
—— 列的是对的，但没说明「**V1 的逐条消息指定模型在 V2 不存在了**」，这是个容易踩的坑。
→ 处理见 §4.3（写 `metadata.model` 与官方 TUI 一致；切模型属阶段 3）。

### 7.8 🟡 `session.step.started` 是「新建 assistant 消息」的权威信号，文档没提

文档 §6.4 的流式事件族表里列了 `session.step.started/streamed/ended/failed` 对应
「`step-start` / `step-finish`」，但没说它**带 `agent` 与 `model`**。
V2 的 `session.text.started` 只给 `assistantMessageID` + `ordinal`，**拿不到 agent/model**；
而 UI 的助手页脚要显示模型名 → 本阶段据此新增了 `PartUpdatedPayload` 的 `kind: 'step-start'` 分支，
流式期间就能把 `modelID`/`providerID`/`agent`/`time.created` 填对。

### 7.9 🟡 工具事件的三个「载荷不全」之处（文档未提）

| 事件                       | 实测现象                                        | 处理                                                      |
| -------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `session.tool.input.ended` | **不带 `name`**（只有 `input.started` 带）      | store 合并时**保留已有的 name**，否则工具卡片会变空白标题 |
| `session.tool.called`      | 实测帧里**没有 `state`** 字段（类型上是可选的） | 按可选处理（`providerState: undefined`）                  |
| `session.tool.success`     | 实测帧里**没有 `resultState`**                  | 同上                                                      |

### 7.10 🟡 `worktree.resolved` 不是「失败」

文档 §6.4 写 `worktree.failed` → `worktree.resolved`（名字对应关系是对的），
但 `worktree.resolved` 的语义是「目录被解析/采用」（`{projectID, directory, previous, adopted?}`），
**不是失败**。原代码在 `onWorktreeFailed` 里把 `data.message` 塞进错误提示 —— V2 没有 `message` 字段。
→ 处理：`WorktreePanel` 改成「只刷新列表 + 清 loading」，不再弹错误（并加注释说明语义变化）。

### 7.11 🟡 Form 体系：**不是 question 的等价替换**

文档 §4.3 已经点明「Form 是全新 UI 能力」，本阶段实测补充：`form.created` 的载荷是
`{form: {id, sessionID, title, fields, metadata?}}`，与 V1 `QuestionRequest` 的
`{questions: [{question, header, options, multiple}]}` **结构完全不兼容**。
→ 处理：事件层按 V2 真实事件名接线（`form.created/replied/cancelled`），
`useGlobalEvents` 只做 **pending 登记 + 通知**（沿用原来的通知/提示音路径），
**不**向会话消费者分发；Form 渲染器属阶段 3。

### 7.12 🟡 `session.step.failed` 会带 `aborted` 错误（用户中断时）

实测一次 interrupt 的帧序列：`session.execution.interrupted`（`reason:"user"`）+ `session.step.failed`
（`error: {type:"aborted", message:"Step interrupted"}`，**无 `finish` / `cost` / `tokens`**）。
→ 阶段 2a 的 `toMessageError()` 会把 `aborted` 映射成 `MessageAbortedError`，
UI 的 `isAbortedMessage()` 因此能正确显示中止态；`finish` 缺失时**不合成** step-finish part，
与读侧规则一致。

### 7.13 🟡 阶段 0/1 报告的一处小偏差

阶段 0 报告说 `--log-level` 只影响 WSL 路径 —— 本阶段复核：**桌面路径 `opencode.rs:88` 不带任何参数**，
确实不受影响（结论不变）。此条仅作记录，无新增差异。

### 7.14 🟡 V2 对 location 的**惰性初始化**（本阶段再次复现）

首次访问某个 location 时，第一批请求可能返回**不完整**列表（模型 / skill / 文件索引都复现过），
紧接着的第二次请求就正常。阶段 0.5 报告 §5⑩ 已记录；本阶段在
`phase1Smoke` 的 `getSkills(DIR_B)` 与 `searchFiles` 上**再次复现**，已在测试里用「预热一次」绕过。
**UI 侧任何新增的 per-location 调用都应有重试或「等 location 就绪」的处理。**

---

## 8. 未做 / 已知缺口（如实）

| #   | 项                                                              | 说明                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Tauri 下 `plugin-http` 的流式未实测**                         | 容器内无 Tauri 运行时。传输层已隔离成 `createEventTransport()` 一个函数，真机若异常只需换掉它，其余一行不动                                                                                                                                                                                                                                                                                                              |
| 2   | **浏览器人工验证未做**                                          | 按用户决定只用单测 + API 冒烟（阶段 2a 的同类缺口沿用）                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | **`handleMessageUpdated` 有分支、无生产者**                     | 依赖 `session.message.content.updated`，实测不下发（见 §7.2）。保留是为了 API 完整                                                                                                                                                                                                                                                                                                                                       |
| 4   | **Form 渲染器缺失**                                             | 事件已接线，但 UI 还是 V1 的 question 组件（且 `getPendingQuestions` 仍抛 `notMigratedYet`）→ 表单实际不可用（阶段 3）                                                                                                                                                                                                                                                                                                   |
| 5   | **权限回复不可用**                                              | `replyPermission` 仍抛 `notMigratedYet`（阶段 3）                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | **换模型不生效**                                                | `prompt` 不接受 model；只写进 `metadata.model` 供历史显示（见 §4.3 / §7.7）                                                                                                                                                                                                                                                                                                                                              |
| 7   | **`sendMessage`（阻塞版）无生产调用方**                         | 返回值是拼出来的入队记录，`parts` 恒空；若将来有人渲染它会显示空 AI 消息（已在两处注释警示）                                                                                                                                                                                                                                                                                                                             |
| 8   | **`useGlobalEvents` 的 `pendingQuestions` 队列成了死代码**      | V1 由 `onQuestionAsked` 写入；V2 的 `onFormCreated` 只做 pending 登记，不再写入该队列，但 `onSessionCreated` 仍 `drainPending`、`onFormReplied/Cancelled` 仍 `removePendingByRequestId` —— 永远空转。建议阶段 3 做表单分发时一并清理或补齐                                                                                                                                                                               |
| 9   | **`sendMessageAsync` 的 1.5s 兜底拉取仍在**                     | `useChatSession` 里那段「SSE 没推就主动拉一次」的逻辑未动，作为断流兜底保留                                                                                                                                                                                                                                                                                                                                              |
| 10  | **本机数据目录残留约 40 个测试会话**                            | 阶段 2b **早期**的冒烟运行（自清理机制加入之前）在 `/home/coder/project/OpenCodeUI` 目录建了约 40 个 1~4 条消息的会话。**未做删除**（属对用户数据的破坏性操作，需明确授权）。已加自清理，后续运行不再增长（实测 3 轮 97 → 97）。清理命令：<br>`curl -u opencode:t1 "http://127.0.0.1:4097/api/session?directory=<目录>&limit=200"` 找到测试会话后 `curl -u opencode:t1 -X DELETE http://127.0.0.1:4097/api/session/<id>` |
| 11  | **`session.usage.updated` 未接入 UI**                           | 事件已分发到 `onSessionUsage`，但 `useGlobalEvents` 没有消费者（用量已由 assistant 的 step-finish 展示）。属 YAGNI，留作阶段 3 可选                                                                                                                                                                                                                                                                                      |
| 12  | **`session.shell.*` / `shell.created` / `shell.exited` 未接线** | V2 新增的会话级 shell 消息与 shell 作业事件；本阶段范围外（`shell` 消息类型阶段 2a 已能渲染）                                                                                                                                                                                                                                                                                                                            |
| 13  | **Rust / Tauri / WSL 未跑**                                     | 与阶段 1/2a 一致（本阶段完全没碰 `src-tauri/`）                                                                                                                                                                                                                                                                                                                                                                          |
| 14  | **prettier 全仓库仍有漂移**                                     | 本阶段把**所有改动过的文件**格式化到合规，未做全仓库格式化（避免无关 diff）                                                                                                                                                                                                                                                                                                                                              |

> **修订（2026-09-30）**：上表 #6「**换模型不生效**」已在真实使用暴露并修复 ——
> 发送前调用 `session.switchModel`（幂等）+ 建会话时带上所选模型，见主文档 §10.6。

---

## 9. 建议的后续动作

### 9.1 立刻可做（人工回归，约 10 分钟）

```bash
# 1) 起真实 V2 服务
OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097

# 2) 起前端（dev proxy 已在阶段 2b 修好，浏览器可直连）
npm run dev

# 3) 界面里：
#    - 新建会话 → 发一条消息 → 确认「流式逐字输出」+ 推理折叠 + 工具卡片
#    - 确认一轮结束后「生成中」指示消失（依赖 execution.succeeded 的映射，见 §7.1）
#    - 中途按停止 → 确认立即回到可输入状态（依赖 execution.interrupted 的映射）
#    - 打开历史长会话 → 滚到顶部继续加载（阶段 2a 的能力）
#    - 文件浏览器搜索框：只应搜到文件名，**没有**内容匹配分组
```

### 9.2 阶段 3 待办交接

1. **Form 表单渲染器**（替代 question）：`GET /api/session/{id}/form` + `POST .../form/{formID}/reply` +
   `DELETE .../form/{formID}`；六种字段类型 + `when` 条件；事件侧已接线（`form.created/replied/cancelled`）
2. **权限链路**：`GET /api/permission/request` + `POST .../permission/{rid}/reply`（`{decision}`）+
   `GET/DELETE /api/permission/saved`；载荷映射已在 `v2Convert.toInternalPermissionRequest()`
3. **换模型联动**：`POST /api/session/{id}/model`（`session.switchModel`）+ 记住当前会话模型，
   避免每次发送都写 `metadata.model`
4. **回退三段式**：`revert/stage` → `revert/commit` → `DELETE revert`；事件侧已接
   `session.revert.staged/committed/cleared` → `onMessagesInvalidated`
5. **中止**：`abort` → `POST /api/session/{id}/interrupt`（事件侧已接 `execution.interrupted`）
6. **`v1Model.ts` 的 B 桶 104 个**（清单见阶段 2a 报告 §1.3）：permission / session / config / file /
   mcp / vcs / worktree / pty / tool / lsp / todo / provider / model / project / auth
7. **`pendingQuestions` 死代码清理**（见 §8#8）
8. **B 桶收尾时的连带项**：`src/types/api/{common,file}.ts` 里为「A/C 桶删除」做的就地定义
   （`SnapshotFileDiffShape`、`v1Model` 的非导出 `SnapshotFileDiff`/`Range`）可以一起收敛
9. **Tauri 真机验证** `plugin-http` 的流式（见 §8#1）
10. **`session.usage.updated` / `session.shell.*` / `session.skill.activated` / `session.synthetic` /
    `session.instructions.updated` 的可选接入**（事件层已能分发，只差 UI 消费）

---

## 10. 附：本阶段改动清单

### 10.1 重写 / 大改

| 文件                             |         阶段 2a 末 |             阶段 2b 末 | 说明                                                                                                                                                            |
| -------------------------------- | -----------------: | ---------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/events.ts`              |            1060 行 |            **1384 行** | 传输层换官方 `subscribe()`；V2 事件分发；`coalesceEvents` 字段路径重写；删掉 Tauri bridge / 手写 SSE 解析 / `normalizeSessionError` / `normalizeTodoItems` 依赖 |
| `src/types/api/event.ts`         |             177 行 |             **506 行** | V2 `EventTypes`（45 个常量）+ V2 `EventCallbacks`（24 个回调）+ 全部载荷类型                                                                                    |
| `src/types/api/v1Model.ts`       | 3502 行 / 189 导出 | **1492 行 / 104 导出** | A 桶 66 删 + C 桶 17 删 + 2 降级                                                                                                                                |
| `src/store/messageStore.ts`      |             968 行 |            **1156 行** | 4 个事件处理器改 V2 形状；新增 `applyStepStarted` / `applyStepEnded` / `upsertPart` / `buildContentParts` / `createStreamingAssistantInfo`                      |
| `src/utils/messageConversion.ts` |             704 行 |                 720 行 | 新增 `toUIPartFromContent` / `toStepFinishPart` / `isTextLikePart`；导出 `toTokenUsage` / `toMessageError`；删除 4 个 V1 形状遗留函数                           |
| `src/api/message.ts`             |             259 行 |             **381 行** | `sendMessage` / `sendMessageAsync` / `buildPromptParams` 实现                                                                                                   |
| `src/api/file.ts`                |             118 行 |                 128 行 | 实现 `searchFiles`（`GET /api/fs/find`）；删除 `searchText` / `searchSymbols`                                                                                   |

### 10.2 新增

| 文件                                          | 行数 | 说明                                                          |
| --------------------------------------------- | ---: | ------------------------------------------------------------- |
| `src/api/events.test.ts`                      |  908 | 事件层单测（**43 例**），重写自原 359 行的 V1 版本（原 5 例） |
| `src/test/fixtures/v2EventFrames.ts`          |   59 | **真实抓包**的 30 个事件帧夹具                                |
| `src/features/message/phase2b.smoke.test.tsx` |  416 | 真实服务冒烟（**11 例**，默认 skip）                          |
| `src/types/api/todo.ts`                       |   28 | `TodoItem` 从 `event.ts` 搬家（V2 无 `todo.updated`）         |

### 10.3 小改（适配性）

`src/hooks/useGlobalEvents.ts`、`src/hooks/useSessions.ts`、`src/contexts/SessionContext.tsx`、
`src/components/WorktreePanel.tsx`、`src/hooks/useGitWorkspaceCatalog.ts`、`src/components/FileExplorer.tsx`、
`src/api/session.ts`、`src/api/v2Convert.ts`、`src/api/types.ts`、`src/types/index.ts`、`src/types/ui.ts`、
`src/types/api/{index,message,common,file}.ts`、`src/locales/{zh-CN,en}/components.json`、`vite.config.ts`

### 10.4 测试改动

`src/store/messageStore.test.ts`、`src/store/messageStoreHooks.test.tsx`、`src/hooks/useGlobalEvents.test.tsx`、
`src/contexts/SessionContext.test.tsx`、`src/api/message.test.ts`、`src/api/phase1Smoke.test.ts`、
`src/components/FileExplorer.test.tsx`、`src/features/message/phase2a.smoke.test.tsx`

### 10.5 文档

| 文件                                    | 改动                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `docs/opencode-v2-migration.md`         | §6.1 心跳修正；§6.3 传输层取舍；§6.4 事件存活判定 4 条实测修正；§8 阶段 2 标注 2b 完成；§9.3 删除已完成项；§9.5 两个决策落地 |
| `docs/opencode-v2-migration-phase2b.md` | 本报告（新增）                                                                                                               |
