# OpenCode V2 迁移 · 阶段 2a 报告（消息模型 + 历史加载，读侧）

> 状态：**✅ 已完成**（2026-09-30）
> 范围：**只做读侧** —— 历史消息加载、转换、渲染、游标分页。
> 发消息、事件流、流式回复**本次未动**（归阶段 2b）。
> 前置：阶段 0（`docs/opencode-v2-migration-phase0.md`）、阶段 1（`docs/opencode-v2-migration-phase0.5.md`）已完成。
> **后续**：阶段 2b（事件流 + 发消息）**已完成**，报告见 `docs/opencode-v2-migration-phase2b.md`。
> 实测环境：opencode `v2.0.19`（`/home/coder/.opencode/bin/opencode`）、`@opencode/client@2.0.19`
> 主文档：`docs/opencode-v2-migration.md`（本阶段已按实测回填 §5.1 / §5.2 / §5.4 / §5.5 / §8）

---

## 0. 先说三件必须交代的事

### 0.1 ⚠️ 工作目录：阶段 2a 的改动在**主仓库**，不在 worktree 里

本次会话启动时的「工作目录」是一个**新建的 git worktree**
（`/home/coder/.local/share/opencode/worktree/77e28b/crisp-lagoon`），
但它**不包含前两个阶段的任何成果** —— 没有 `docs/`、没有 `src/api/notMigrated.ts`、
没有 `src/api/v2Convert.ts`、`package.json` 里也没有 `@opencode/client`。

原因：阶段 0/1 的全部产出都是**未提交的工作区改动**，而 git worktree 只签出已提交的
HEAD（`8a6d4eae`），不会带过来。另外该 worktree 里 717 个文件被显示为「已修改」，
是容器文件系统给新写入文件加执行位导致的权限位噪音，不是真实改动。

→ **本阶段把会话切到真正的仓库目录 `/home/coder/project/OpenCodeUI` 上工作**，
与阶段 0/1 的成果放在一起。全部改动都在这个目录里。

### 0.2 ✅ 硬性约束逐条对照

| 约束                                                   | 结果                                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| 允许改：`src/types/api/message.ts`                     | ✅ 重写                                                |
| 允许改：`src/types/api/v1Model.ts`（仅消息/Part 部分） | ⚠️ **未删任何导出**，原因见 §1.4（被冻结的事件层钉住） |
| 允许改：`src/utils/messageConversion.ts`               | ✅ 重写                                                |
| 允许改：`src/api/message.ts`                           | ✅ 游标分页                                            |
| 允许改：`messageStore`                                 | ✅ 数据结构 + 合并 + 游标                              |
| 允许改：对应渲染组件                                   | ✅ `MessageRenderer` + 新增 `SessionMarkerPartView`    |
| 允许改：`docs/`                                        | ✅ 主文档已回填 + 本报告                               |
| **禁止改**：`src/api/events.ts`                        | ✅ **零改动**（`git diff` 无此文件）                   |
| **禁止改**：发消息链路                                 | ✅ `sendMessage` / `sendMessageAsync` 仍是显式报错占位 |
| **禁止改**：`src-tauri/`                               | ✅ 零改动                                              |
| **禁止改**：`src/api/notMigrated.ts` 报错语义          | ✅ 零改动（且新增 3 条用例把语义钉死）                 |
| 禁止删除 `v1Model.ts` 非消息/Part 导出                 | ✅ 一个都没删                                          |
| 禁止 git commit/push/reset/checkout                    | ✅ 未执行                                              |
| 禁止删除 `docs/` 下文件                                | ✅ 未删除                                              |
| 类型检查 0 报错                                        | ✅ `npx tsc -b` 无输出                                 |
| `npm test` 现有用例不许挂                              | ✅ 基线 683 例全部仍通过，**0 失败**                   |

### 0.3 只做读侧 —— 本阶段**没有**做的事

- ❌ `src/api/events.ts`（事件订阅/解析/重连）—— 一行没动
- ❌ `coalesceEvents` delta 合并 —— 一行没动
- ❌ `EventTypes` 常量表 —— 一行没动
- ❌ 发消息链路（`POST /api/session/{id}/prompt`）—— 仍是 `notMigratedYet` 占位
- ❌ `v1Model.ts` 的删除 —— 见 §1.4

---

## 1. 前置决策：`v1Model.ts` 分类结果

`src/types/api/v1Model.ts`：**3502 行 / 189 个顶层 `export`**。
按「本阶段要换掉 / 阶段 3 再动 / 跨组」分三桶：

| 桶                            |    数量 | 含义                                                                                                                         |
| ----------------------------- | ------: | ---------------------------------------------------------------------------------------------------------------------------- |
| **A：消息 / Part / 消息事件** |  **66** | 被 V2 消息模型推翻，属阶段 2                                                                                                 |
| **B：阶段 3**                 | **104** | permission / session / config / agent / mcp / pty / file / vcs / worktree / lsp / todo / provider / model / project / auth … |
| **C：跨组 / 不明确**          |  **19** | 同时被多组引用，单独删会连带打断别的组                                                                                       |
| 合计                          | **189** | ✅ 与 `grep -c "^export "` 一致                                                                                              |

### 1.1 A 桶（66 个）—— 消息 / Part / 消息事件

| 分组                              | 类型                                                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消息主体（4）                     | `UserMessage`、`AssistantMessage`、`Message`、`Prompt`                                                                                                                                                                     |
| Part 联合成员（12+）              | `TextPart`、`ReasoningPart`、`ToolPart`、`FilePart`、`AgentPart`、`StepStartPart`、`StepFinishPart`、`SnapshotPart`、`PatchPart`、`SubtaskPart`、`RetryPart`、`CompactionPart`、`Part`                                     |
| 工具状态机（5）                   | `ToolStatePending`、`ToolStateRunning`、`ToolStateCompleted`、`ToolStateError`、`ToolState`                                                                                                                                |
| Part 来源（5）                    | `FilePartSourceText`、`FileSource`、`SymbolSource`、`ResourceSource`、`FilePartSource`                                                                                                                                     |
| 用户消息的格式/摘要（4）          | `OutputFormatText`、`JsonSchema`、`OutputFormatJsonSchema`、`OutputFormat`                                                                                                                                                 |
| 消息错误联合（6）                 | `ProviderAuthError`、`UnknownError`、`MessageOutputLengthError`、`MessageAbortedError`、`StructuredOutputError`、`ContextOverflowError`、`ApiError`                                                                        |
| Part 输入（4）                    | `TextPartInput`、`FilePartInput`、`AgentPartInput`、`SubtaskPartInput`                                                                                                                                                     |
| `message.*` 同步事件（4）         | `SyncEventMessageUpdated`、`SyncEventMessageRemoved`、`SyncEventMessagePartUpdated`、`SyncEventMessagePartRemoved`                                                                                                         |
| `session.next.*` 消息流事件（18） | `...Synthetic`、`...StepStarted/Ended/Failed`、`...TextStarted/Ended`、`...ReasoningStarted/Ended`、`...ToolInputStarted/Ended`、`...ToolCalled/Progress/Success/Failed`、`...Retried`、`...CompactionStarted/Delta/Ended` |
| 事件载荷（2）                     | `EventMessagePartRemoved`、`EventMessagePartDelta`                                                                                                                                                                         |

### 1.2 C 桶（19 个）—— 跨组，建议随 `GlobalEvent` 一起处理

`SnapshotFileDiff`（消息 summary ↔ file 组）、`Range`（Part 来源 ↔ Symbol）、
**`GlobalEvent`（巨型联合，横跨全部组）**、`PromptSource` / `PromptFileAttachment` /
`PromptAgentAttachment` / `PromptReferenceAttachment`（message ↔ file/agent/reference）、
`SessionErrorUnknown`、`ToolTextContent` / `ToolFileContent`（V2 属消息模型，V1 仅用于工具事件）、
`SessionNextRetryError`、`SyncEventSessionNextAgentSwitched` / `ModelSwitched` / `Moved` /
`Prompted` / `PromptAdmitted` / `PromptPromoted` / `ShellStarted` / `ShellEnded`。

### 1.3 B 桶（104 个）—— 阶段 3 再动，本阶段一律保留

permission（`PermissionAction/Rule/Ruleset/Request`、`Question*`、`PermissionV2*`、`QuestionV2*`）、
session（`Session`、`SessionStatus`、`SessionListData/CreateData/UpdateData/ForkData`、
`SyncEventSessionCreated/Updated/Deleted`、`EventSessionDiff/Status/Idle`）、
config（`Config`、`AgentConfig`、`ProviderConfig`、`PermissionConfig`、`LogLevel`、`ServerConfig`、
`ReferenceConfig*`、`LayoutConfig`、`PolicyEffect`、`ConfigV2ExperimentalPolicy`…）、
file（`File`、`FileNode`、`FileContent`、`Symbol`、`FindText*`）、
mcp（`McpStatus*`、`McpResource`、`McpLocalConfig`…）、vcs / worktree / pty / tool / lsp /
todo（`Todo`、`EventTodoUpdated`）/ project / agent / model（`Model`、`Provider`、
`ProviderAuthMethod/Authorization`、`ModelV2Info`、`LocationRef`）/ auth（`Auth*`）/
server（`EventServerInstanceDisposed`、`GlobalHealth*`）。

### 1.4 🔴 本阶段**没有删除** `v1Model.ts` 的任何导出 —— 以及为什么

任务要求「本阶段只删除/替换『消息与 Part』那一组」。实测后**无法在本阶段安全删除**，原因是
**冻结的事件层把整条依赖链钉死了**：

```
src/api/events.ts  （本阶段禁止改动）
  └─ import type { GlobalEvent } from './types'
       └─ GlobalEvent（v1Model.ts:595，巨型联合）
            └─ SyncEventMessageUpdated   → properties.info: Message
            └─ SyncEventMessagePartUpdated → properties.part: Part
            └─ EventMessagePartDelta / Removed → Part
            └─ SyncEventSessionNext*     → 大量引用 Message / Part / ToolState
```

`GlobalEvent` 里嵌着 `Message` / `Part` / `ToolState`，而 `events.ts` 又必须导入 `GlobalEvent`
（用于 `coalesceEvents` / `parseGlobalEvent` / `isGlobalEvent` / `handleEventForSubscriber`）。
**只要事件层不动，A 桶的这 66 个类型就一个都删不掉。**

本阶段的实际处理：

1. **`src/types/api/message.ts` 重写为 V2 模型**，V1 别名集中在文件末尾的
   「五、⚠️ 遗留 V1 别名（阶段 2b 删除）」一节，逐个标 `@deprecated` + 理由。
2. **在 `message.ts` 的注释里给出「下游零引用、可在 2b 一并清理」的清单**：
   `UserMessage`、`AssistantMessage`（仅 `types/index.ts` 的类型守卫在用）、
   `ReasoningPart`、`ToolPart`、`ToolState`、`StepStartPart`、`StepFinishPart`、
   `SnapshotPart`、`PatchPart`、`RetryPart`、`CompactionPart`、`SubtaskPart`、
   `TextPartInput`、`FilePartInput`、`AgentPartInput`、`SubtaskPartInput`
   —— 保留它们只是为了让 `src/api/types.ts` / `src/types/api/index.ts` 这两个
   **本阶段授权范围之外**的转发文件保持原样。
3. **A 桶的 66 个定义原样留在 `v1Model.ts`**，留给 2b 随事件层一起删。

> 📌 **对阶段 3 工作量判断的影响**：B 桶 104 个是阶段 3 的真实工作量；
> A 桶 66 个 + C 桶 19 个（共 85 个）会**在 2b 一次性消失**，
> 但**必须等 `events.ts` 重写完之后**。也就是说 2b 的收尾动作之一是
> 「删 `events.ts` 对 `GlobalEvent` 的依赖 → 删 `GlobalEvent` → 删 A/C 两桶」。

---

## 2. 消息模型映射表：V1 字段 → V2 字段（逐字段）

### 2.1 结构层

|          | V1                             | V2                                                                 |
| -------- | ------------------------------ | ------------------------------------------------------------------ |
| 端点     | `GET /session/{id}/message`    | **`GET /api/session/{id}/message`**                                |
| 响应     | `MessageWithParts[]`（裸数组） | **`{ data: Session.Message.Info[], cursor: { previous, next } }`** |
| 结构     | **两层**：`{ info, parts }`    | **扁平联合**：消息自带 `content`                                   |
| 判别字段 | `role: 'user' \| 'assistant'`  | **`type`**（11 种）                                                |
| 分页     | 无（一次全量）                 | **游标**（`limit` / `order` / `cursor` / `type`）                  |
| SDK 入口 | `sdk.session.messages()`       | **顶层** `sdk.message.list()`（不是 `session.message.list`）       |

### 2.2 11 种消息类型（`type` 判别）

| TS 类型名          | 线上 `type` 值            | V1 对应物                                           |
| ------------------ | ------------------------- | --------------------------------------------------- |
| `User`             | `"user"`                  | `UserMessage`                                       |
| `Assistant`        | `"assistant"`             | `AssistantMessage`                                  |
| `System`           | `"system"`                | ❌ 无（新增）                                       |
| `Skill`            | `"skill"`                 | ❌ 无（新增）                                       |
| `Shell`            | `"shell"`                 | ❌ 无（新增）                                       |
| `Synthetic`        | `"synthetic"`             | ❌ 无（新增，V1 只有 synthetic **part**）           |
| `Compaction`       | `"compaction"`            | `compaction` **part**                               |
| `Idle`             | `"idle"`                  | `step-start` / `step-finish` part（语义：一轮结束） |
| `AgentSelected`    | **`"agent-switched"`**    | `session.updated` 事件                              |
| `ModelSelected`    | **`"model-switched"`**    | `session.updated` 事件                              |
| `LocationSwitched` | **`"location-switched"`** | ❌ 无（新增）                                       |

> ⚠️ 后三个**类型名与线上取值不一致**（源码 `Schema.tag("agent-switched")`）。

### 2.3 `User` 消息逐字段

| 概念            | V1                                | V2                                         | 处理                   |
| --------------- | --------------------------------- | ------------------------------------------ | ---------------------- |
| `id`            | ✅                                | ✅ `id`                                    | 直接映射               |
| `sessionID`     | ✅                                | ❌ **已删除**                              | 转换层由调用方补       |
| `role`          | `'user'`                          | → `type: 'user'`                           | 改名                   |
| 文本            | `parts[].type === 'text'`         | **`text`（直接字段）**                     | 摊平成 1 个 text part  |
| 附件            | `parts[].type === 'file'`         | **`files: PromptFileAttachment[]`**        | 见 2.4                 |
| agent           | `parts[].type === 'agent'`        | **`agents: PromptAgentAttachment[]`**      | 见 2.4                 |
| 技能            | ❌                                | **`skills: PromptSkillAttachment[]`**      | 新增 UI `skill` part   |
| `agent`（顶层） | ✅ `agent: string`                | ❌ 已删除（实测在 `metadata.agent`）       | 从 metadata 兜底       |
| `model`（顶层） | ✅ `model: {providerID, modelID}` | ❌ 已删除（实测在 `metadata.model`）       | 从 metadata 兜底       |
| `summary`       | ✅ `{title?, body?, diffs?}`      | ❌ **已删除**                              | 留空，下游回退正文首行 |
| `time`          | `{created, completed?}`           | `{created}`（**无 completed**）            | 丢掉 completed         |
| `metadata`      | ❌                                | ✅ `Record<string, unknown>`（**非契约**） | 仅用于取 agent/model   |

### 2.4 用户附件：`FilePart` → `PromptFileAttachment`

| 概念       | V1 `FilePart`                                 | V2 `PromptFileAttachment`                                   | 处理                                                 |
| ---------- | --------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `id`       | ✅                                            | ❌                                                          | 按 `消息id:file:下标` 合成                           |
| `filename` | ✅ `filename?`                                | → `name?`                                                   | 改名                                                 |
| `mime`     | ✅                                            | ✅                                                          | 直接映射                                             |
| `url`      | ✅ **可直接渲染**                             | ❌ 无；内容在 `data`（**base64**）                          | `uri` 源直接用；`inline` 源拼 `data:<mime>;base64,…` |
| `source`   | `FilePartSource`（file/symbol/resource 三态） | `{type:'inline'} \| {type:'uri',uri}`（两态，**语义不同**） | 只保留 uri → `path`                                  |
| 文本位置   | `source.text: {value,start,end}`              | `mention?: {start,end,text}`                                | 映射成 V1 的 `source.text`                           |

> 实测：本机 1637 条 user 消息里 **22 条带附件，全部是 inline base64 图片**。
> V1 的 `url` 是直接塞给 `<img src>` 的 → 不拼 data URL 就会显示裂图。

### 2.5 `Assistant` 消息逐字段

| 概念                  | V1                                                 | V2                                                      | 处理                                                   |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `id`                  | ✅                                                 | ✅                                                      | 直接映射                                               |
| `sessionID`           | ✅                                                 | ❌ **已删除**                                           | 调用方补                                               |
| `parentID`            | ✅（指向 user 消息）                               | ❌ **已删除**                                           | 填 `''`（实测 UI 只用 `Session.parentID`，不用消息的） |
| `role`                | `'assistant'`                                      | → `type: 'assistant'`                                   | 改名                                                   |
| 内容                  | `parts: Part[]`（**独立数组**，靠 messageID 关联） | **`content: (Text\|Reasoning\|Tool)[]`（内嵌）**        | 摊平成 UI parts                                        |
| 模型                  | `modelID` + `providerID` 两个散字段                | **`model: ModelRef`（字段名是 `id`）**                  | 改名拆回                                               |
| `mode`                | ✅                                                 | ❌ **已删除**                                           | 填 `''`                                                |
| `path`（cwd/root）    | ✅                                                 | ❌ **已删除**                                           | 填 `{cwd:'',root:''}`                                  |
| `summary`（是否摘要） | ✅ `summary?: boolean`                             | ❌ **已删除**                                           | 填 `false`                                             |
| 成本                  | `step-finish` part 的 `cost`                       | **`cost?: MoneyUSD`（顶层，可选）**                     | 上移 + 合成 step-finish part                           |
| 用量                  | `step-finish` part 的 `tokens`                     | **`tokens?: TokenUsageInfo`（顶层，可选）**             | 同上；缺省补 0                                         |
| 结束原因              | `step-finish` part 的 `reason: string`             | **`finish?: 6 字面量联合`**                             | 收窄                                                   |
| `rawFinish`           | ❌                                                 | ✅ 新增                                                 | 丢弃（渲染层零消费）                                   |
| 错误                  | `error: MessageError`（`{name,data}` 5 元联合）    | **`error: {type, message, status?}`（扁平开放字符串）** | 按关键字映射回 5 元                                    |
| 重试                  | `retry` **part**                                   | **`retry` 字段**（内嵌 `{attempt, at, error}`）         | 反向合成 `retry` part                                  |
| 快照                  | `snapshot` / `patch` **part**                      | `snapshot` 字段（`{start,end,files?}`）                 | 丢弃（渲染层零消费）                                   |
| 步骤分隔              | `step-start` / `step-finish` **part**              | ❌ **已删除**（改用 `Idle` 消息）                       | 合成 1 个尾部 step-finish                              |
| `time`                | `{created, completed?}`                            | `{created, streamed?, completed?}`                      | 新增 `streamed`，丢弃                                  |

### 2.6 Assistant `content` 逐字段

| 概念                           | V1                                   | V2                                                      | 处理                                                               |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------ |
| text `id`                      | ✅ `TextPart.id`                     | ❌ **没有**                                             | 按 `消息id:content:下标` 合成                                      |
| text `sessionID` / `messageID` | ✅                                   | ❌                                                      | 调用方补                                                           |
| text `synthetic`               | ✅ `synthetic?: boolean`             | ❌ **已删除**（改用独立 `system`/`synthetic` 消息类型） | 一律 `false`                                                       |
| reasoning `time`               | ✅ 必填 `{start, end?}`              | `{created, completed?}` **可选**                        | 缺省用消息 `created` 兜底                                          |
| reasoning `state`              | ❌                                   | ✅ `providerState`                                      | 丢弃                                                               |
| tool `id`                      | `callID`                             | **`id`**                                                | 改名                                                               |
| tool 名                        | `tool`                               | **`name`**                                              | 改名                                                               |
| tool `executed`                | ❌                                   | ✅ 新增                                                 | 丢弃                                                               |
| tool `time`                    | `state.time: {start,end}`            | **`time: {created,ran?,completed?}`（工具层）**         | 下移到 `state.time`                                                |
| tool 状态                      | `pending\|running\|completed\|error` | **`streaming\|running\|completed\|error`**              | `streaming` → `pending`（`input` 是**字符串** → 放进 `state.raw`） |
| tool 产出                      | `state.output: string`               | **`state.content: ToolContent[]`**                      | 只取 `text` 项用 `\n` join                                         |
| tool 标题                      | `state.title: string`                | ❌ **已删除**                                           | 从 `metadata.title` 兜底，否则空串                                 |
| tool 附件                      | `state.attachments?: FilePart[]`     | ❌ 删除（改用 `content` 里的 `file` 项）                | **不映射**（渲染层零消费，见 §7.2）                                |
| tool 错误                      | `state.error: string`                | `state.error: {type,message,status?}`                   | 取 `message`                                                       |

### 2.7 其余 9 种消息 → UI 模型

| V2 类型                                                   | UI 归宿                                 | 说明                                                                       |
| --------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `system`                                                  | `role:'system'` + `session-marker` part | 实测是「指令/上下文更新」通知，`description` 是给人看的摘要                |
| `synthetic`                                               | 同上                                    | 实测官方用它把 shell 作业产出插进转录                                      |
| `skill`                                                   | 同上                                    | 技能激活记录                                                               |
| `shell`                                                   | 同上                                    | 会话级 shell 命令消息（与工具里的 `shell` **不是一回事**）                 |
| `idle`                                                    | 同上（**不渲染**）                      | 一轮结束边界；可见耗时已由 assistant 的 step-finish/footer 展示            |
| `agent-switched` / `model-switched` / `location-switched` | 同上                                    | 一行提示                                                                   |
| `compaction`                                              | **复用已有的 `compaction` part**        | 渲染层本来就有 `CompactionPartView`；增补 `status`/`reason`/`summary` 字段 |

---

## 3. 分页参数与行为说明

### 3.1 参数口径（照 openapi + v2.0.19 源码核实）

| 参数        | 类型  | 约束                                          | 说明                                   |
| ----------- | ----- | --------------------------------------------- | -------------------------------------- |
| `sessionID` | path  | `^ses`                                        |                                        |
| `limit`     | query | **`NumberFromString`，1..200**，省略时 **50** | 超过 200 → 400                         |
| `order`     | query | `asc` \| `desc`，默认 `desc`                  | **只对首页有效**                       |
| `cursor`    | query | 不透明字符串                                  | **与 `order` 互斥**                    |
| `type`      | query | **10 个字面量（无 `idle`）**                  | 在分页**之前**过滤；翻页时必须原样带上 |

### 3.2 🔴 游标方向（本阶段最重要的实测结论）

游标是 base64url 的 `{id, order, direction}`。实测解出：
`{"id":"msg_0ee2…","order":"desc","direction":"previous"}`。

**`previous` / `next` 是相对于「本次排序」的，不是绝对时间方向。**
服务端默认 `order=desc`（新→旧）时：

| 请求                     | 实测结果                                  |
| ------------------------ | ----------------------------------------- |
| `?limit=3`（不传 order） | 返回**最新 3 条**（新→旧）                |
| 跟 **`cursor.next`**     | ✅ 拿到**更旧**的一页（50 条）            |
| 跟 `cursor.previous`     | ❌ **空数组**（最新那条之后没有更新的了） |

源码依据：

- `packages/server/src/handlers/message.ts` —— `previous` 锚定 `messages[0]`、`next` 锚定 `messages.at(-1)`；
  两者都把 `order` 编码进游标；且 `cursor` + `order` 同时传 → 400 `InvalidCursorError`。
- `packages/core/src/session/store.ts` `messages()` ——
  `order = direction === 'previous' ? 反转(requestedOrder) : requestedOrder`。

→ **「滚动到顶部加载更早历史」必须用 `cursor.next`。**
（迁移文档 §5.5 原文写的是 `cursor.previous`，**已在主文档修正**。）

### 3.3 🔴 游标**不表示**「还有没有更多」

只要本页非空，`previous` / `next` **都会返回一个值**，哪怕那个方向已经没有数据
（跟过去只会拿到空数组）。因此：

**「还有更多」用 `limit + 1` 溢出法判断**：多要一条，多出来就说明还有。

⚠️ **多要的那条必须保留，不能丢弃** —— 因为 `cursor.next` 锚定在本页**最后一条**上，
丢掉它就等于让下一页跳过它，会**永久丢消息**。

实现细节（`src/api/message.ts`）：

- `limit` 先钳制到 1..200，再请求 `limit + 1`；
- 返回的 `messages` **全部保留**（可能比调用方要的多 1 条，这是刻意的）；
- `hasMore = data.length > limit`；
- `limit === 200` 时无法再 +1 → 退化为 `data.length >= 200`（已在注释里写明）。

### 3.4 本项目的用法

```
首页：getSessionMessages(sid, { limit: 50 })
      → 服务端给最新的 51 条（desc）→ API 层重排成「旧→新」交给 store
      → store 记下 cursor.next 作为 historyCursor，hasMoreHistory = page.hasMore

更旧：getSessionMessages(sid, { limit: 50, cursor: historyCursor })
      → 同样重排成「旧→新」→ store.prependMessages() 前置
      → 更新 historyCursor / hasMoreHistory
```

- 向前翻页游标存在 **`messageStore` 的 `SessionState.historyCursor`** —— 随 session 一起被
  LRU 淘汰，不会像原来的 `cursorRef`（`useSessionManager` 里的 `Map`）那样跨 session 泄漏。
- `useSessionManager` 里加了**并发保护**（`loadingMoreRef`），避免滚动事件高频触发重复加载。
- `historyCursor` 为 `null` 但 `hasMoreHistory` 为真时，视为状态不一致 → 纠正为「已到最早」，
  避免死循环。

### 3.5 滚动位置保持

**本阶段未改动滚动逻辑**，确认它仍然成立：

- `ChatArea.tsx` 的 prepend 锚点（`prependAnchor` / `capturePrepend` / `restorePrepend`，
  L614-673）按 `data-timeline-key`（= 消息 id）记录锚点元素的视口偏移，
  prepend 后按差值补偿 `scrollTop`；
- 触发条件：`onScroll` 里 `userScrolled && scrollTop < 200 && !loadingMore && hasMoreHistory`
  → `loadMore()` → `capturePrepend()` → `onLoadMore()`（= `loadMoreHistory`）→ `restorePrepend(true)`；
- 本阶段只改了 `loadMoreHistory` **内部怎么拿数据**（游标 vs limit 递增），
  以及 `hasMoreHistory` **怎么算**（`limit+1` 溢出 vs `length >= limit` 近似）；
- 锚点 key 是消息 id，而 `prependMessages` 只前置、不改已有消息的 id → 锚点仍能命中。

> ✅ 顺带修好一个老问题：V1 的 `hasMoreHistory = apiMessages.length >= limit` 是**近似**，
> 到底了还会多发一次注定为空的请求；现在用溢出法**精确**判断，到底即停。

---

## 4. 测试清单与覆盖率

### 4.1 总体结果

| 场景                   | 文件                  |                        用例 | 结果          |
| ---------------------- | --------------------- | --------------------------: | ------------- |
| **默认（无真实服务）** | 98 passed / 2 skipped | **741 passed + 20 skipped** | ✅ **0 失败** |
| **起真实 V2 服务后**   | 99 passed / 1 skipped |  **753 passed + 8 skipped** | ✅ **0 失败** |

跳过的 20 例 = 阶段 1 冒烟 12 例 + 阶段 2a 冒烟 8 例（两者都在服务不可达时**自跳过**，不是失败）。

- **基线 683 例全部仍通过**（其中含阶段 1 的 12 例冒烟，它们在本阶段起了真实服务后也跑通）
- **本阶段新增 70 例**：`messageConversion.test.ts` 35 + `api/message.test.ts` 23 +
  `messageStore.test.ts` 净增 12

### 4.2 新增测试文件

| 文件                                          | 用例 | 覆盖的关键逻辑                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/messageConversion.test.ts`         |   35 | user 文本/附件/agent/skill 映射；metadata 兜底（含 V2 命名 `id`）；inline base64 → data URL；uri 源 + mention；assistant 内容摊平与**下标 id**；model/provider 改名；step-finish 合成（含「流式中不合成」）；retry 反向合成；工具 4 态映射（`streaming→pending`、content→output、time 下移、error 取 message、metadata.title 兜底）；**错误类型映射 5 例参数化**；system/compaction/idle marker；**「11 种类型一条都不能丢」**；批量转换与 role 守卫互斥 |
| `src/api/message.test.ts`                     |   23 | **重排成旧→新**；不传 cursor 时**不发 order**；带 cursor 时**也不发 order**（互斥）；`limit+1` 溢出探测；短页 `hasMore=false`；**长页 `hasMore=true` 且保留溢出项**；游标归一化为 `string\|null`；空页；默认页大小；limit 钳制（9999 / 0 / 负数）；200 上限的退化；`type` 透传与省略；`extractUserMessageContent` 6 例（含 synthetic 过滤、folder、textRange、agent）；**`sendMessage`/`sendMessageAsync` 报错语义 3 例**                                |
| `src/test/fixtures/v2Messages.ts`             |    — | V2 消息夹具（刻意只填必填字段，V2 加必填项时会立刻报错）                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/features/message/phase2a.smoke.test.tsx` |    8 | 见 §5（默认 skip，`VITE_OPENCODE_SMOKE=1` 开启）                                                                                                                                                                                                                                                                                                                                                                                                         |

### 4.3 改写的测试文件

| 文件                                   | 改动                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/store/messageStore.test.ts`       | 17 → **29** 例。夹具从 V1 `{info,parts}` 换成 V2 扁平消息；**明确区分两条通路**（V2 读侧用 `v2*` 夹具 / V1 事件侧仍用 V1 夹具）；新增游标（存/取/不被元数据刷新清掉）、prepend 去重与「不按时间重排」、`upsertMessages`（不清空历史 / 就地更新）、`keepLocalOnly`（保留 / 不保留）等用例 |
| `src/store/messageStoreHooks.test.tsx` | 6 例，夹具换 V2；`handlePartUpdated` 的 part id 换成转换层合成规则                                                                                                                                                                                                                       |
| `src/hooks/useSessionStats.test.tsx`   | 2 例，夹具换 V2；压缩场景改用**独立的 compaction 消息**（V2 语义）                                                                                                                                                                                                                       |

### 4.4 覆盖率

> ⚠️ **测量方式与善后（如实交代）**：仓库未安装覆盖率工具。为拿到数字，本次用
> `npm install --no-save --no-package-lock @vitest/coverage-v8@4` 临时装了一个副本
> （`--no-save --no-package-lock` 保证 **`package.json` / `package-lock.json` 零改动**，已 diff 核对）。
> 但这个命令**顺带把 node_modules 里的 vitest 4.1.2→4.1.11、shiki 4.0.2→4.4.3 升上去了**
> （npm 会重算依赖树），并因此让 `src/workers/shikiWorker.ts` 冒出一个**与本次改动无关**的
> `tsc` 类型报错。**已用 `npm ci` 把 node_modules 恢复到 package-lock 的精确版本**
> （vitest 4.1.2 / shiki 4.0.2，覆盖率包已移除），恢复后 `tsc -b` 重新为 **0 报错**、
> 测试重新全绿。仓库文件自始至终零改动。

| 文件                              |      Stmts |     Branch |      Funcs |      Lines | 未覆盖部分说明                                                                                                                                                          |
| --------------------------------- | ---------: | ---------: | ---------: | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/messageConversion.ts`  | **92.38%** | **85.22%** | **91.66%** | **92.92%** | 仅剩 8 处分支（`toFilePartSource` 的空 mention 分支、`toAgentPart` 的无 mention 分支、compaction failed 的 model 分支等）                                               |
| `src/api/message.ts`              |   **100%** | **88.63%** |   **100%** |   **100%** | 未覆盖分支：`clampLimit` 的非有限数、`hasMore` 的 200 上限退化等                                                                                                        |
| `src/store/messageStore.ts`       |     64.95% |     52.32% |     68.18% |     71.25% | 未覆盖部分**全部是既有代码**：通知/rAF 管线、session LRU 淘汰与保护、`revertState` 撤销重做（**属阶段 3**）、V1 事件处理器（**属阶段 2b**）、`extractUserText` 私有辅助 |
| `src/types/message.ts`            |     83.33% |     90.47% |      92.3% |     83.33% | 未覆盖：`getMessageText` 尾部、部分守卫分支                                                                                                                             |
| `src/test/fixtures/v2Messages.ts` |     88.88% |       100% |      87.5% |     88.88% | `v2Tool` 的默认参数分支                                                                                                                                                 |

**核心结论**：本阶段**新写的逻辑**（转换层、分页层）覆盖率 92% / 100%；
`messageStore` 的缺口集中在**本阶段明确不碰**的三块（事件层、撤销重做、通知管线）。

---

## 5. 冒烟结果

### 5.1 环境

```
OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097
```

- 真实服务 `v2.0.19`，`GET /api/info` → `{"version":"2.0.19","pid":…,"urls":["http://127.0.0.1:4097"]}`
- 数据：**本机真实数据目录**（588 个会话 / **17,288 条真实 V2 消息**），
  目标目录 `/home/coder/project/OpenCodeUI`（25 个会话）
- 入口：`VITE_OPENCODE_SMOKE=1 npx vitest run src/features/message/phase2a.smoke.test.tsx`

### 5.2 结果：8/8 通过（跑过两次，数字不同是因为目标会话本身还在增长）

| 用例                                        | 实测输出（第 1 次 / 第 2 次）                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页拉到历史、重排成旧→新、给出游标         | 6 条 = limit 5 + 溢出 1；`hasMore=true`；`cursor.next` 有值（两次一致）                                                                                                       |
| 跟 `cursor.next` 拉到更早一页、与首页无重叠 | 第 2 页 6 条，全部早于首页最早那条，**零重叠**（两次一致）                                                                                                                    |
| 连续翻页直到尽头                            | 第 1 次：**9 页 / 181 条去重**；第 2 次：**11+ 页 / 231+ 条去重**（目标会话在这两次之间又写入了新消息）。两次都：页大小 21(=20+1)，`hasMore=false` 后**正常终止**，**零重复** |
| 转换后渲染层依赖的不变量                    | 角色分布 `{assistant:21}`；part 分布 `{reasoning:9, tool:21, step-finish:20, text:11}`；每条消息 `sessionID`/`id`/`time.created` 齐备；**每个 part 有 id 且消息内唯一**       |
| 真实工具调用映射                            | 样例 `{"tool":"write","status":"completed"}`，状态落在 UI 认识的 4 态内                                                                                                       |
| 真实渲染（用户 / 助手）                     | 用户消息渲染 **2502** 字符；助手消息渲染 **118** 字符（均非空 DOM）                                                                                                           |
| 系统类消息渲染                              | 找到真实 `system` 消息，渲染 **38** 字符，不抛错                                                                                                                              |
| 整页渲染不抛错                              | **51 条消息渲染 49721 字符**，含工具卡片、推理、系统提示                                                                                                                      |

### 5.3 原始分页语义（curl 直打，独立于本项目代码）

| 检查                    | 结果                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| 首页 `?limit=3`         | 最新 3 条（desc）✅                                                   |
| 跟 `cursor.next`        | 50 条更旧 ✅                                                          |
| 跟 `cursor.previous`    | **空数组** ✅（证明 `previous` = 更新方向）                           |
| 游标解码                | `{"id":"msg_0ee2…","order":"desc","direction":"previous"}` ✅         |
| `?type=idle`            | **400**（过滤枚举只有 10 个，无 idle）✅                              |
| `?type=user`            | 200 ✅                                                                |
| `?limit=201`            | **400** `Expected a value less than or equal to 200` ✅               |
| `?cursor=abc&order=asc` | **400** `InvalidCursorError: Cursor cannot be combined with order` ✅ |

### 5.4 ❌ 没做到的：浏览器级滚动验证

**没有做**浏览器里的真实滚动加载验证，原因如实说明：

- 本会话**没有连接桌面浏览器**（`browser.tabs.open` 返回
  _"No desktop browser is connected to this session"_），浏览器工具不可用；
- 备选路径（vite dev server + `VITE_API_BASE_URL=http://127.0.0.1:4097` + `--cors`）能起来，
  但**没有浏览器可以打开它**；顺带发现 `vite.config.ts` 的 dev proxy 是 V1 遗留
  （`rewrite: path => path.replace(/^\/api/, '')` 会把 V2 必需的 `/api` 前缀削掉），
  该文件不在本阶段授权范围内，未改动。

**替代验证**（已做）：

1. 游标分页的**真实数据**端到端（9 页 181 条、无重复、正确终止）；
2. 真实数据的**真实 React 渲染**（51 条消息 / 49721 字符，含工具卡片）；
3. 滚动保持逻辑所在的 `ChatArea.tsx` **本阶段零改动**，
   且其触发条件（`hasMoreHistory`）与依赖（消息 id 稳定）都由单测覆盖。

→ 结论：**数据链路已充分验证；「滚动触发 + 锚点补偿」这段 UI 行为未在浏览器里实跑**，
建议在能开浏览器的环境里补一次人工回归（步骤见 §9）。

---

## 6. 🔴 与文档预测不符之处

> 本节是本次报告最重要的部分。前两轮都是这么做的。

### 6.1 🔴🔴 文档 §5.5 写错了：加载更早历史要用 `cursor.next`，不是 `cursor.previous`

|              | 内容                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **文档原文** | 「滚动到顶部时用 **`cursor.previous`** 向前加载」                                                                                                                                     |
| **实测**     | 服务端默认 `order=desc`（新→旧）。跟 `cursor.previous` 拿到的是**更新**的一页（在最新那条之后 → **空数组**）；跟 **`cursor.next`** 才拿到**更旧**的一页（实测 50 条）                 |
| **为什么**   | 游标把 `order` 和 `direction` 一起编码；`previous`/`next` 是**相对于本次排序**的。源码 `store.messages()`：`order = direction === 'previous' ? 反转(requestedOrder) : requestedOrder` |
| **影响**     | 若照文档实现，**滚动到顶部永远加载不出历史**，而且**不报错**（只是空数组）—— 属于最难查的一类 bug                                                                                     |
| **处理**     | ✅ **已在主文档 §5.5 修正并标注「阶段 2a 实测修正」**                                                                                                                                 |

### 6.2 🔴 文档 §5.1 的类型名 ≠ 线上 `type` 取值

文档列的是 `AgentSelected | ModelSelected | LocationSwitched`（TS 类型名），
**线上 `type` 实际是 `"agent-switched"` / `"model-switched"` / `"location-switched"`**。
按类型名去比较会永远匹配不上。→ ✅ 已回填 §5.1（新增对照表）。

### 6.3 🔴 文档 §5.2 遗漏：**所有 V2 消息都没有 `sessionID`**

V1 每条消息都带 `sessionID`，V2 **一律没有**（会话上下文由请求路径给出）。
文档只写了「`sessionID` 在 Assistant 上被删除」，实际是**11 种消息全都没有**。
→ 转换层必须由调用方补，否则 store 里所有按 session 分组的逻辑失效。
✅ 已回填 §5.2 ①。

### 6.4 🔴 文档 §5.2 遗漏：`User` 的 `agent` / `model` 是「移到 metadata」而不是「删除」

文档写 `User.agent` / `User.model` 被删除。实测**官方 TUI 会把它们写进 `metadata`**：

```json
"metadata": { "displayText": "…", "agent": "build",
              "model": { "modelID": "deepseek-v4.1-flash", "providerID": "aether2", "variant": "max" } }
```

⚠️ 两个坑：① `metadata` 在 schema 里是 `Record<string, unknown>`，**不是契约字段**，
第三方写入方可以不写；② `metadata.model` 用的是 **V1 命名 `modelID`**（不是 V2 的 `id`）。
→ 处理：**只做「有就取」的兜底**，取不到留空，绝不假设存在（转换层同时兼容 `modelID` 和 `id`）。
✅ 已回填 §5.2 ②。

### 6.5 🔴 文档 §5.2 遗漏：`text` / `reasoning` **没有 `id`**

文档只说「步骤分隔被删除」。实测 `assistant.content[]` 里**只有 tool 有 `id`**，
`text` / `reasoning` 完全没有 id；而 UI 用 id 做 React key 与折叠状态。
→ 转换层按 `消息id:content:下标` 合成。
⚠️ 下标必须按 **content 数组下标**算，不能按同类型计数（否则插入新块会让已有 id 漂移）。
✅ 已回填 §5.2 ④。

### 6.6 🔴 文档 §5.2 遗漏：工具状态多了 `streaming`、少了 `pending`，且 `title`/`attachments` 被删

| 文档说法                                                         | 实际                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「工具调用：`parts[].type === 'tool'`（内嵌 `state`）」→ V2 同构 | ❌ 状态机**变了**：`pending` → **`streaming`**（且此时 `input` 是**未解析的字符串**）；`callID` → **`id`**；`tool` → **`name`**；`state.time` → **工具层 `time`**；`state.output: string` → **`state.content: ToolContent[]`**；`state.title` 与 `state.attachments` **被删除** |

→ UI 只认 `pending|running|completed|error`，转换层必须把 `streaming` 翻译回 `pending`。
✅ 已回填 §5.2 ⑤。

### 6.7 🔴 文档 §5.2 表述不准：错误不是「`Assistant.error` + `Session.StructuredError`」这么简单

V1 的 `Message.error` 是 `{name, data}` 的 **5 元判别联合**；V2 是 `{type, message, status?}`，
`type` 是**开放字符串**。实测出现过的取值：`aborted`、`unknown`、`provider.error`、
`provider.invalid-output`、`tool.execution` —— **一个都不叫 `ProviderAuthError` / `APIError`**。
→ 只能按关键字启发式映射。最关键的一条：**`aborted` → `MessageAbortedError`**，
UI 靠它显示「已中止」（本机库里有 **57 条** assistant 是这个类型）。
✅ 已回填 §5.2 ⑥。

### 6.8 🔴 文档 §5.5 未提：**游标不代表「还有没有更多」**

只要本页非空，`previous`/`next` 都会返回值，哪怕该方向已经没数据。
→ 必须用 `limit + 1` 溢出法；且**溢出的那条不能丢**（游标锚定本页最后一条，
丢了就永久丢消息）。这是照文档实现一定会踩的坑。✅ 已回填 §5.5。

### 6.9 🔴 文档 §5.5 未提：`limit` 是 `NumberFromString` 且限定 1..200

`?limit=201` → 400 `Expected a value less than or equal to 200`。
V1 时代前端习惯用 `limit` 递增（`Math.max(INITIAL_MESSAGE_LIMIT, 200)`），
迁移时必须加钳制。✅ 已回填 §5.5。

### 6.10 🔴 V2 自身的不一致：`idle` **能返回但不能过滤**

`SessionMessagesQuery.type` 的枚举只有 **10 个值（没有 `idle`）**，
但响应联合 `PublicSessionMessage` **包含** `SessionMessage.Idle`。
实测 `?type=idle` → **400**，而 `idle` 消息在不过滤时会正常返回。
→ 不是本项目的 bug，是 V2 的枚举不一致；实现里用 `SessionMessageFilterType = Exclude<SessionMessageType,'idle'>`
把它编码进类型。✅ 已回填 §5.5。

### 6.11 🟡 文档 §5.1 的端点写法容易误读

文档写 `GET /api/session/{id}/message`（对的），但 SDK 入口是**顶层**
`client.message.list()`，**不是** `client.session.message.list()`
（`session.message` 只有 `get` 单条）。任务描述里的「`GET /api/message`」经 openapi 核实
**不存在** —— 正确路径就是 `/api/session/{sessionID}/message`。

### 6.12 🟡 文档 §5.4 的文件清单与实际改动有出入

- 文档列了 `src/api/types.ts`（兼容别名）要改 —— 实际**没改**（该文件不在本阶段授权范围内，
  且 V1 别名保留在 `src/types/api/message.ts` 里就够用）。
- 文档**没列**实际必须新增的文件：`SessionMarkerPartView.tsx`（V2 新增消息类型的渲染）、
  `src/test/fixtures/v2Messages.ts`（V2 夹具）、两个新测试文件。
- ✅ 已回填 §5.4 的「阶段 2a 实际改动的文件」表。

### 6.13 🟡 文档 §5.4 说 `src/types/message.ts` 要「UI 侧模型调整」——实际是**新增**而非推翻

按「保留现有函数签名与导出名、调用方最小改动」的要求，本阶段**没有推翻 UI 模型**，
而是把它当**转换目标**（渲染层 5,900 行因此几乎零改动），只**新增**了：
`SystemMessageInfo`（`role:'system'`）、`SessionMarkerPart`、`SkillPart`，
并给 `CompactionPart` 增补 V2 字段。这是本阶段最关键的架构决策，见 §7.1。

### 6.14 🟡 阶段 0/1 报告与实际的偏差（本次核对发现）

- 阶段 1 报告称「683 单测全绿」—— 实测该数字**包含**阶段 1 冒烟的 12 例
  （当时服务在跑）；服务不在时它们会**自跳过**。本阶段报告统一按「有无服务」两种口径给出。
- 容器里 `npx eslint .` 有 **42 个 warning / 0 error**（全是既有的 React refs 与
  react-refresh 告警）；`npx prettier --check .` 有 **167 个文件不达标**（版本漂移，
  与本次改动无关，本阶段未做全仓库格式化以免产生无关 diff）。
  本阶段**新增/改动的文件 eslint 零告警**，格式化风格与所在文件保持一致。

---

## 7. 设计决策与取舍

### 7.1 ✅ 核心决策：**不推翻 UI 模型，而是把它当转换目标**

任务要求「保留现有函数签名与导出名（调用方最小改动）」。据此选择：

```
V2 扁平消息（Session.Message.Info）
        │  ← 新增的全部复杂度都在这一层
        ▼
src/utils/messageConversion.ts
        │
        ▼
UI 模型 src/types/message.ts（{info, parts, isStreaming} 基本不变）
        │
        ▼
渲染层 src/features/message/**（≈5,900 行，几乎零改动）
```

**收益**：`MessageRenderer.tsx` 只加了 37 行（一个 `role==='system'` 分支 + 一个轻量视图），
其余 5,900 行渲染代码一行没动。
**代价**：转换层要「造」三样 V2 没有的东西（见 7.2），并且这是**有损**的
（V2 独有的字段如 `providerState` / `rawFinish` / `providerResultState` 被丢弃）。

**为什么值得**：这些被丢的字段经全仓库核对**渲染层零消费**；
而如果反过来让渲染层直接用 V2 模型，等于重写 5,900 行 + 全部相关测试。

### 7.2 转换层「造」出来的三样东西（都是为了喂饱既有渲染层）

| 造的东西                    | 为什么必须造                                                                                                                                                          | 风险与对策                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **`sessionID`**             | V2 消息里没有，但 store 按 session 分组、revert 按 id 定位都要它                                                                                                      | 入参**强制要求**（`toUIMessage(msg, sessionID)`），不给默认值，避免静默传空串                  |
| **part `id`**               | V2 的 text/reasoning 没有 id，UI 要它做 React key 与折叠状态                                                                                                          | 规则固定为 `消息id:content:下标`（**下标而非同类型计数**），保证「插入新块不导致已有 id 漂移」 |
| **尾部 `step-finish` part** | V2 把 cost/tokens/finish 上移到 assistant 顶层，但渲染层的「过程/最终内容拆分」（`splitProcessRenderItems`）与工具组配对（`groupPartsForRender`）**依赖 step-finish** | **只在 `finish` 已存在时**合成（流式中不合成），否则工具组会提前挂上未完成的用量               |

### 7.3 V2 新增的 9 种消息：统一用一个 `session-marker` part 承载

**没有**给 9 种消息各造一个 UI part 类型，而是：

```ts
interface SessionMarkerPart extends PartBase {
  type: 'session-marker'
  marker: SessionMarkerMessage // 保留 V2 原始消息（强类型判别联合）
}
```

**理由**：① 渲染上它们都是「一行提示」，共用一个视图即可；
② 保留原始消息的完整类型，渲染层按 `marker.type` 拿到强类型字段，**转换层不做有损摊平**；
③ 将来 V2 加新消息类型时只需扩联合，渲染层 switch 会提示补分支。
`compaction` 例外 —— 渲染层本来就有 `CompactionPartView`，直接复用。

**`idle` 故意不渲染**：它只是「一轮结束」边界，可见耗时已由 assistant 的 step-finish 与 footer
展示，再画一条分隔线只会让信息流变吵（本机有 81 条 idle）。

### 7.4 分页：**不暴露 `order` 参数**

`getSessionMessages()` 刻意**不提供 `order` 选项**，一律用服务端默认 `desc` 起手，
再把结果重排成「旧→新」交给上层。理由：
① `cursor` 与 `order` 互斥，暴露 `order` 会引入「传了 cursor 又传 order → 400」的脚枪；
② 固定 desc 意味着**所有游标都是 desc 语义**，不会有方向歧义；
③ 上层（store）本来就按升序存。

### 7.5 `hasMoreHistory` 从「近似」改成「精确」

V1：`apiMessages.length >= limit` —— 到底了还会多发一次注定为空的请求。
V2：`limit + 1` 溢出法 —— 到底即停。
（顺带：`historyCursor` 为 `null` 但 `hasMoreHistory` 为真时会被纠正，避免死循环。）

### 7.6 没有做的事（YAGNI）

- ❌ 没有为「用户技能附件」写专门的渲染分支（实测 1637 条 user 消息里 **0 条**带 skills）
  —— 但**类型与转换都做了**（`SkillPart`），只是渲染走 `session-marker` 之外的路径时
  会被 `UserMessageView` 的 filter 忽略。**如实记录：用户消息上的 skill 附件当前不显示。**
- ❌ 没有把 V2 `state.content` 里的 **file 类型产出**映射成附件（V1 的 `state.attachments`
  在渲染层**零消费**，映射了也不会显示）。
- ❌ 没有处理 `Assistant.snapshot`（渲染层零消费）。
- ❌ 没有改 `MAX_CACHED_SESSIONS = 10` 的 LRU 策略（游标已并入 `SessionState`，无需额外缓存层）。

---

## 8. 未做 / 已知缺口（如实）

| #   | 项                                     | 说明                                                                                                                                           |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **浏览器级滚动验证未做**               | 本会话无桌面浏览器连接，见 §5.4。数据链路已验证；UI 滚动行为建议人工补测                                                                       |
| 2   | ~~**`v1Model.ts` 一个导出都没删**~~    | ✅ **阶段 2b 已完成**：189 → 104 个顶层导出（A 桶 66 删 + C 桶 17 删 + 2 降级）                                                                |
| 3   | ~~**事件层零改动**~~                   | ✅ **阶段 2b 已重写** `events.ts` / `EventTypes` / `EventCallbacks`                                                                            |
| 4   | ~~**流式回复未适配**~~                 | ✅ **阶段 2b 已适配**（真实 V2 服务冒烟 11/11）                                                                                                |
| 5   | ~~**发消息仍不可用**~~                 | ✅ **阶段 2b 已实现**（`prompt` / `prompt` + `wait`）                                                                                          |
| 6   | **撤销/重做（undo/redo）仍不可用**     | 依赖 V2 已删的 `revert` / `unrevert` 端点（V2 改成三段式），属**阶段 3**。`useRevertState` 只做了类型适配，运行时仍会抛错（与阶段 1 行为一致） |
| 7   | **用户消息上的 skill 附件不显示**      | 见 §7.6（实测 0 条，未做渲染分支）                                                                                                             |
| 8   | **`limit === 200` 时 `hasMore` 退化**  | 无法再 +1 探测，退化为「满页即视为还有」；已在代码注释与报告中写明。本项目实际只用 50                                                          |
| 9   | **Rust / Tauri / WSL 未跑**            | 与阶段 1 一致（本阶段完全没碰 `src-tauri/`）                                                                                                   |
| 10  | **prettier 全仓库不达标**              | 167 个文件（既有版本漂移），本阶段未做全仓库格式化以免产生无关 diff                                                                            |
| 11  | ~~**阶段 1 的 dev proxy 是 V1 遗留**~~ | ✅ **阶段 2b 已修正**（删掉会削掉 V2 必需 `/api` 前缀的 `rewrite`）                                                                            |

> ⬆️ 上表第 2/3/4/5/11 项已由 **阶段 2b** 完成，详见 `docs/opencode-v2-migration-phase2b.md`。
> 阶段 2b 还额外发现：本文件的冒烟测试选会话的启发式（「最新 12 个里第一个非空的」）过于脆弱，
> 已被阶段 2b 改成「按新→旧体检、取消息数最多的那个」。

---

## 9. 建议的后续动作

### 9.1 立刻可做（人工回归，约 5 分钟）

```bash
# 1) 起真实 V2 服务
OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097

# 2) 起前端（浏览器能直连 4097；若走 dev proxy 需先修 vite.config.ts 的 /api 重写）
npm run dev

# 3) 在界面里：
#    - 打开一个历史很长的会话（如阶段 1 的会话 ses_f11f3943…，181+ 条）
#    - 确认历史消息正确渲染（工具卡片、推理、系统提示、耗时/用量）
#    - 滚到顶部，确认能持续加载更早历史，且**滚动位置不跳**
#    - 一直滚到最早，确认加载停止（不再发空请求）
```

### 9.2 阶段 2b 的开工清单

> ✅ **阶段 2b 已全部完成**（2026-09-30），报告：`docs/opencode-v2-migration-phase2b.md`。
> 下面保留原始清单以便对照；每条的落地情况见 2b 报告。

1. 重写 `src/api/events.ts`（改用 `client.event.subscribe()` 或手写改造）→ ✅ 用了官方 subscribe
2. 重写 `EventTypes` 常量表 + `handleEventForSubscriber`（21 个事件里只有 4 个属消息族）→ ✅ 45 个 V2 常量
3. 实现「断线后重订阅 + 重拉全量」（V2 事件流是**易失**的，见 §6.2）→ ✅ `markAllSessionsStale()` + 强制重载
4. 重写 `messageStore` 的 4 个事件处理器为 V2 形状（`session.text.*` / `session.tool.*` / `session.message.content.updated`）→ ✅
5. 发消息链路：`POST /api/session/{id}/prompt` → ✅ 含 `prompt` + `wait` 两条链路
6. **收尾删除**：先摘掉 `events.ts` 对 `GlobalEvent` 的依赖 → 删 `GlobalEvent` →
   删 A 桶 66 个 + C 桶 19 个 → ✅ 实际是 66 + 17 删、2 个降级（原因见 2b 报告 §5.3）
7. 拍板两个决策（§9.5）：内容搜索怎么办、等待语义怎么走 → ✅ 内容搜索移除、等待用 `wait`

> ⚠️ 清单第 2 条的「21 个事件里只有 4 个属消息族」**口径需修正**：
> 21 个是 `EventTypes` 常量，其中消息族是 4 个（`message.part.updated/delta/removed` + `message.updated`），
> 但**替换它们的 V2 事件有 17 个**（13 个 part 类 + 3 个 delta + 1 个 content.updated），
> 加上本阶段新增接线的 `session.execution.*` 等，最终 `EventTypes` 表是 **45 个常量**。

### 9.3 阶段 3 会用到的东西

- B 桶 104 个类型（清单见 §1.3）
- `useRevertState` / `revertMessage` / `unrevertSession`：V2 三段式 `revert/stage → commit → delete`
- `TaskRenderer` 的子会话加载（V2 已删 `GET /session/{id}/children`，改用 `GET /api/session?parentID=`）

---

## 10. 附：本阶段改动清单

### 10.1 修改（17 个文件，+2070 / −553 行）

| 文件                                                    | 改动                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/types/api/message.ts`                              | 456 行 —— V2 消息模型（11 种）+ 分页类型；V1 别名集中标注 `@deprecated`                               |
| `src/utils/messageConversion.ts`                        | 684 行 —— V2 扁平 → UI 模型的完整转换                                                                 |
| `src/api/message.ts`                                    | 341 行 —— 游标分页 `getSessionMessages()`；`extractUserMessageContent` 改吃 UI 模型                   |
| `src/store/messageStore.ts`                             | 133 行 —— `setMessages`/`prependMessages` 改吃 V2；`historyCursor`；`upsertMessages`；`keepLocalOnly` |
| `src/store/messageStoreTypes.ts`                        | 9 行 —— `SessionState.historyCursor`                                                                  |
| `src/types/message.ts`                                  | 145 行 —— `SystemMessageInfo` / `SessionMarkerPart` / `SkillPart` / `CompactionPart` 增补             |
| `src/hooks/useSessionManager.ts`                        | 180 行 —— 历史加载改游标 + 并发保护                                                                   |
| `src/hooks/useRevertState.ts`                           | 45 行 —— 类型适配                                                                                     |
| `src/hooks/useChatSession.ts`                           | 19 行 —— 发消息兜底改用 `upsertMessages`                                                              |
| `src/features/message/MessageRenderer.tsx`              | 37 行 —— `role:'system'` 分支 + `SystemMessageView`                                                   |
| `src/features/message/parts/index.ts`                   | 1 行 —— 导出新视图                                                                                    |
| `src/features/message/tools/renderers/TaskRenderer.tsx` | 11 行 —— 子会话加载适配                                                                               |
| `src/locales/{zh-CN,en}/message.json`                   | 各 9 行 —— `system.marker.*` 文案                                                                     |
| `src/store/messageStore.test.ts`                        | 372 行 —— 17 → 29 例                                                                                  |
| `src/store/messageStoreHooks.test.tsx`                  | 69 行 —— 夹具换 V2                                                                                    |
| `src/hooks/useSessionStats.test.tsx`                    | 103 行 —— 夹具换 V2                                                                                   |

### 10.2 新增（5 个文件，1309 行）

| 文件                                                   | 行数 | 说明                                |
| ------------------------------------------------------ | ---: | ----------------------------------- |
| `src/utils/messageConversion.test.ts`                  |  439 | 转换层单测（35 例）                 |
| `src/api/message.test.ts`                              |  303 | 分页 + 提取 + 报错语义单测（23 例） |
| `src/features/message/phase2a.smoke.test.tsx`          |  293 | 真实服务冒烟（8 例，默认 skip）     |
| `src/features/message/parts/SessionMarkerPartView.tsx` |  155 | V2 新增消息类型的渲染               |
| `src/test/fixtures/v2Messages.ts`                      |  119 | V2 消息测试夹具                     |

### 10.3 文档

| 文件                                    | 改动                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docs/opencode-v2-migration.md`         | §5.1 类型名对照表；§5.2 八条实测补充；§5.4 阶段 2a 文件表；**§5.5 游标方向修正**；§8 阶段 2 拆成 2a/2b |
| `docs/opencode-v2-migration-phase2a.md` | 本报告（新增）                                                                                         |
