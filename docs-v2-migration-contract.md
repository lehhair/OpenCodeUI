# OpenCode v2 迁移契约（UI 适配必读）

本文件是 UI 层适配 **OpenCode v2** 时的唯一权威约定。API 层与类型层已全部重写完成并
通过 typecheck（`src/api/**`、`src/types/api/**`）。当前剩余错误全部是 UI 消费点。

## 铁律

1. **不要再引入任何 v1 形状**。`@opencode-ai/sdk` 已弃用，唯一允许的包是
   `@opencode/client`（只在 `src/api/**`、`src/types/api/**` 里直接 import）。
   UI 层不要直接 import `@opencode/*`。
2. **不要为了让编译通过而回退语义**。v2 删掉的能力就该删掉对应的 UI，
   不要造假的兼容层。
3. **保持现有设计语言**：CSS class、间距、动画、组件结构、i18n key 风格都沿用，
   只改数据接线。
4. **UI 视图模型保持不动**：`src/types/message.ts` 的 `{ info, parts }` 与
   `info.role` 继续作为渲染层契约；v2 的 `type`/`content` 只在**投影层**
   （`src/utils/v2Projection.ts`）出现。
5. 改完必须跑 `npm run typecheck`，确认你负责的文件错误数下降且**没有新增**到别的文件。

## 核心映射表

### 会话 Session（`src/types/api/session.ts`）

| v1 | v2 |
|---|---|
| `session.directory` | `session.location?.directory`（可用 `sessionDirectory(s)` 辅助函数） |
| `session.share` | **已删除**（导出改 `session.export()`，没有分享 URL） |
| `session.summary` | **已删除**（diff 改从 `session.diff()` / `getLastTurnDiff()` 拉） |
| `session.version` / `session.path` | **已删除**（本来 UI 未使用） |
| `session.revert.messageID` | 保留（新增 `files`） |
| — | 新增 `cost` / `tokens` / `outcome` / `subpath` / `metadata` / `permissions` |

`LocationPublicInfo`（`getPath()` / `getLocationInfo()` 返回）：
```ts
{ directory: string; project: { id: string; directory: string; canonical: string } }
```
**没有 `home` 字段**（v1 的 `path.get()` 有）。

### 会话列出参数

```ts
getSessions({ directory?, parentID?, search?, limit?, order?, cursor?, project?, subpath? })
```
v1 的 `roots` / `start` **不存在**。子会话：`getSessionChildren(sessionId)` 或
`getSessions({ parentID })`。

### 会话动作改名

| v1 | v2 |
|---|---|
| `abortSession` | `abortSession`（内部走 `interrupt`，返回 boolean） |
| `deleteSession` | `deleteSession`（内部 `remove`） |
| `summarizeSession` | `summarizeSession`（内部 `compact`，参数已忽略） |
| `revertMessage` | `revertMessage` → 返回 `SessionRevert`；另有 `unrevertSession` / `commitRevert` |
| `getSessionStatus` | 返回 `SessionStatusMap`（v2 只对 running 确定）；新增 `getActiveSessions()` |
| `getLastTurnDiff` | 保留（内部退化为 `getSessionDiff`） |

### 消息 Message

v2 消息**自带内容**，字段是 `type`（不是 `role`）与 `content`（不是 `parts`）：

```ts
type SessionMessage =
  | { type: 'user'; id; time; text; files?; agents?; skills? }
  | { type: 'assistant'; id; time; agent; model; content: AssistantContent[]; cost?; tokens?; error?; finish? }
  | { type: 'system' | 'synthetic' | 'skill' | 'shell' | ... }
```

助手内容三态：
```ts
{ type: 'text'; text }                       // 文本
{ type: 'reasoning'; text; time? }           // 推理
{ type: 'tool'; id; name; state; time }      // 工具
```

工具状态（按 `state.status` 判别）：`streaming`(input 是**字符串**) /
`running` / `completed`(content 为 `[{type:'text'|'file'}]` 非空元组) / `error`。

**投影入口**（UI 渲染层一律用这三个）：
```ts
import { toUIMessage, toMessageInfo, contentToParts, toUIToolState } from '../utils/v2Projection'
toUIMessage(v2Message, sessionID): Message   // { info, parts }
```
**v2 消息不带 `sessionID`** —— 必须由调用方传入所在会话。

UI 侧 `AssistantMessageInfo` 用 `modelID` / `providerID` 两个平铺字段；
v2 的 `ModelRef` 是 `{ id, providerID, variant? }`（注意是 `id` 不是 `modelID`）。

### 事件（`src/api/events.ts`）

v2 事件是**扁平对象** `{ id, created, type, location?, data, durable? }` ——
没有 v1 的 `payload.type` / `payload.properties`。

`EventCallbacks` 变化：

- **删除**：`onPartUpdated`、`onPartDelta`、`onPartRemoved`、`onQuestion*`、
  `onTodoUpdated`、`onSessionError`、`onSessionDiff`
- **新增**：`onTextStarted/onTextDelta/onTextEnded`、
  `onReasoningStarted/onReasoningDelta/onReasoningEnded`、
  `onToolInputStarted/onToolInputDelta/onToolInputEnded/onToolCalled/onToolProgress/onToolSuccess/onToolFailed`、
  `onStep*`、`onExecution*`、`onFormCreated/onFormReplied/onFormCancelled`、
  `onRevertStaged/onRevertCleared/onRevertCommitted`、
  `onInboxEnqueued/onInboxDelivered/onInboxCancelled`、`onMcpStatusChanged`、`onFilesystemChanged`
- `onMessageContentUpdated` 的负载来自 **durable** 联合（`session.message.content.updated`
  不在实时 `V2Event` 里）。实时文本/工具更新请用对应的 delta/生命周期回调。
- `ServerConnectedPayload` **没有 `timestamp`**（就是一个事件对象）。

会话状态事件负载：`{ sessionID, status: { type: 'idle' | 'busy' | 'retry', ... } }`。

### 权限 Permission

```ts
PermissionRequest = {
  id, sessionID, action, resources: string[], save?: string[], metadata?, source?, message?
}
```
**没有** `permission` / `patterns` / `always` / `tool` 字段。
展示用 `action`（动作名）+ `resources`（受影响资源）。

```ts
getPendingPermissions(sessionId?, directory?, serverId?): Promise<PermissionRequest[]>
replyPermission(requestId, decision: 'once'|'always'|'reject', message?, directory?, sessionId?, serverId?)
```
**`sessionId` 现在是必填的**（v2 回复权限必须带 sessionID）。
「总是允许」的持久规则改走 `getSavedPermissions()` / `removeSavedPermission(id)`。

### 表单 Form（取代 v1 的 Question）

```ts
FormInfo   = { id, sessionID, title, metadata?, fields: FormField[] }   // fields 非空元组
FormDetail = FormInfo & { state: {status:'pending'} | {status:'answered', answer} | {status:'cancelled', message?} }
FormField  = string | number | integer | boolean | multiselect | external 变体
  // 每个变体有 key/title?/description?/required?/hidden?/when?；
  // string 变体有 options?/custom?/format?/minLength?/maxLength?/pattern?/placeholder?/default?
  // multiselect 变体有 options/minItems?/maxItems?/custom?/default?
  // external 变体只有 key/type/url/title?/description?（没有 required/hidden/when）
FormValue  = string | number | boolean | string[]（含 "Infinity"|"-Infinity"|"NaN" 字面量）
FormAnswer = { [fieldKey]: FormValue }
```
**没有** `questions` / `options`（顶层）/ `header` / `multiple` / `custom`（顶层）。
答案从 v1 的**位置数组**变成**键值对象** `{ [field.key]: value }`。

```ts
getPendingForms(sessionId?, directory?, serverId?): Promise<FormInfo[]>
getFormDetail(sessionId, formId, serverId?)
replyForm(sessionId, formId, answer: FormAnswer, serverId?)
cancelForm(sessionId, formId, message?, serverId?)
```
用 `isChoiceField(field)` 判断字段是否是有选项可点的类型。

### Todo —— v2 彻底移除

`@opencode/client` 里连字符串 `todo` 都不存在，`V2Event` 里没有任何 `todo.*` 成员。

- `src/store/todoStore.ts` **删除**
- `src/features/message/tools/renderers/TodoRenderer.tsx`、`todoUtils.ts` **删除**
- `getSessionTodos()` / `todo.updated` 事件**不存在**
- `src/api/todo.ts` 现在只导出 `TodoItem` 类型与 `normalizeTodoItems()`（无网络）
- 唯一来源是消息流里 `todowrite` 工具的调用（`AssistantTool`，`name === 'todowrite'`）
- 保留 `Icons.tsx` 的 `ListTodo` 图标与 `configEditorMeta` 里 `todowrite` 的**标签文案**
  （那是权限配置项的 key，不是功能）

### 文件 File

v2 `file.list` 返回**扁平条目**：
```ts
{ location, data: FileSystemEntry[] }   // FileSystemEntry = { path: string; type: 'file'|'directory' }
```
**没有 `name`、没有 `children`** —— 树形结构由 UI 自己按 `path` 构建。

`file.read` 返回 `Uint8Array`；`getFileContent()` 已解码为：
```ts
{ path: string; content: string; isBinary: boolean; size: number }
```
**没有** `mimeType` / `encoding` / `patch` / `hunks`。

- `searchFiles(query, opts)` 返回 `string[]`（已从 v2 条目投影）
- `searchSymbols()` / `searchText()` **已删除**（v2 无符号搜索与全文检索）→ 相关 UI 必须移除
- `getFileStatus()` → 内部走 `vcs.status`，元素字段是 `file`（不是 `path`）

### VCS

```ts
getVcsInfo() -> { provider?: string; branch: { current?: string; default?: string } } | null
```
**当前分支是 `branch.current`**（v1 是字符串，v2 是对象）。
`VcsFileStatus = { file, additions, deletions, status }`（**没有 `path`**、没有 `patch`）。

### MCP

```ts
getMcpStatus() -> { location, data: McpServer[] }
McpServer = { name: string; status: McpStatus; integrationID?: string }
McpStatus = {status:'connected'} | {status:'pending'} | {status:'disabled'}
          | {status:'failed', error} | {status:'needs_auth', error}
```
服务器标识字段是 **`server`**（v1 用 `name`）。已改为 map 的调用点要适配。

**已删除**：`startMcpAuth` / `removeMcpAuth` / `completeMcpAuth` / `authenticateMcp`
（MCP 的 OAuth 在 v2 由 `integration.*` / `credential.*` 承担）。
新增可用：`removeMcpServer` / `listMcpServers` / `getMcpServerStatus`。

`getMcpResources()` 现在按 server 名归组，形状是
`Record<string, { resources: [...], templates: [...] }>`。

### Worktree

```ts
listWorktrees(projectID, serverId?) -> string[]          // 参数从 directory 变成 projectID
listWorktreeEntries(projectID, serverId?) -> { directory, strategy? }[]
createWorktree(params, serverId?) -> { directory }
removeWorktree(params, serverId?)
refreshWorktrees(projectID, serverId?)                    // 新增，取代 reset
```
**`resetWorktree` 已删除**。
`Project` 上**没有 `worktree` 字段**了 —— worktree 列表要按 `projectID` 单独拉。

### 配置 Config

```ts
getConfig(directory?, serverId?) -> ConfigInfo        // 已把各 document 深合并
getConfigSources(directory?, serverId?) -> ConfigEntry[]  // ConfigEntry = {type:'document',path?,info} | {type:'directory',path}
getGlobalConfig(serverId?) -> ConfigInfo
updateShell(shell: string | null, serverId?)          // config.update 唯一支持的字段
getAvailableShells(serverId?) -> ConfigShellsOutput
```
**已删除**：`updateConfig` / `updateGlobalConfig` / `getProviderConfigs`（整份配置写回在
v2 不存在）。配置编辑器因此应为**只读浏览**，仅 `shell` 可写。

### 其他

- `getServerInfo(serverId?) -> { version, pid, urls, paths:{tmp} }`（取代 `global.health`）
- `getHealth()` 投影成 `{ healthy, version }`
- **已删除**：`disposeGlobal` / `disposeInstance` → 用 `reloadLocation()`
- `getLspStatus()` / `getFormatterStatus()` / `getToolIds()` / `getTools()` 恒返回空/未运行
  （v2 无这些端点）→ 相关 UI 若是纯状态展示应移除
- `getActiveModels(directory?, serverId?) -> ModelInfo[]`（UI 形状不变）
- `getDefaultModels()` 返回 `Record<providerID, modelID>`（由单个默认模型投影）
- `getCurrentProject(directory?, serverId?) -> Project | undefined`（**可能 undefined**）
- `getProjects(_directory?, serverId?) -> Project[]`
- `updateProject(projectId, { name?, icon?, commands? }, directory?, serverId?)`
- `sendMessage(params, serverId?) -> Promise<void>`（v2 的 prompt 是入队语义；
  `sendMessageAsync` 是它的别名）

## 各文件归属（避免并行冲突）

- **A 组** 会话列表 / 侧栏 / 会话 hook
- **B 组** 权限 / 表单对话 / 全局事件
- **C 组** 文件 / 面板 / 项目对话框 / 下载
- **D 组** 设置配置编辑器 / todo 清理 / 工具渲染
- **E 组** 测试文件（最后做）

只改自己组里的文件；需要动别人的文件时在报告里说明，不要直接改。
