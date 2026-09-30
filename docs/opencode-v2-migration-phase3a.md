# OpenCodeUI 迁移 V2 —— 阶段 3a 报告（功能补齐）

> 状态：**阶段 3a 已完成**（2026-09-30）
> 目标环境：opencode `v2.0.19`（`/home/coder/.opencode/bin/opencode`）、`@opencode/client@2.0.19`
> 验收：`tsc` **0 报错**；全量测试 **967 passed / 38 skipped / 0 failed**（服务未启动时）；
> 真实服务冒烟 **6/6**（中断、回退三段式、权限回复、表单、PTY、MCP 各至少一次）
> 前置报告：`docs/opencode-v2-migration-phase0.5.md`、`-phase2a.md`、`-phase2b.md`
> **计数口径**：任务书写「51 处 `notMigratedYet`」，逐文件核对后确认为 **51 处**（见 §1.1 逐条表）。

---

## 0. 三件必须先交代的事

### 0.1 硬性约束逐条对照

| 约束                                                                                    | 实际执行                                                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **允许改** `src/api/**`、`src/features/**`、`src/store/**`、`src/utils/`、测试、`docs/` | ✅ 改动集中在这几处（另有少量 `src/components/**`、`src/hooks/**` 的**必要**适配，见 §5.2）                                 |
| **禁止改 `src-tauri/`**                                                                 | ✅ 一行未动（`git diff --stat src-tauri/` 里的 2 个文件是**阶段 0** 的改动，非本阶段）                                      |
| **禁止改 `v1Model.ts` 的 B 桶 104 个导出**                                              | ✅ 一个导出都没删；本阶段新类型一律「就地重定义」在各自模块里（`mcp.ts` / `pty.ts` / `vcs.ts` / `worktree.ts` / `form.ts`） |
| **禁止删除 UI**                                                                         | ✅ 未删除任何组件。V2 删掉的能力一律用 `removedInV2()` 标记，UI 清理归 3b                                                   |
| **禁止 git commit / push / reset / checkout / worktree**                                | ✅ 只用了 `git status` / `git diff` / `git ls-files`（只读）                                                                |
| **禁止删除 `docs/` 下任何文件**                                                         | ✅ 只新增 + 追加修订                                                                                                        |
| 测试服务用完必须关闭                                                                    | ✅ 4097 上的临时服务已 `kill` 并确认端口无响应；**用户自己的 4096 服务未触碰**                                              |
| 不得在用户数据目录留下测试会话                                                          | ✅ 冒烟自建会话在 `afterAll` 全删；实测 `/home/coder/project/OpenCodeUI` 下**零** `[phase3a-smoke]` 残留                    |
| 全程简体中文注释与报告                                                                  | ✅                                                                                                                          |

### 0.2 本阶段**没有**做的事

1. **没有删除任何 UI 入口**（LSP/格式化器状态、share、归档、todo、worktree reset、git init、配置保存…）
   —— 按硬性约束只做 `removedInV2()` 标记，清单见 §7。
2. **没有接入** V2 新增的 `persistent-pty`、`plugin RPC`、`/api/shell`、`/api/websearch`、`/api/rpc`、
   `session.inbox`、`session.instructions`、`/api/vcs/base`、`/api/vcs/branch`、`fs/write`（YAGNI，与 §9.2 一致）。
3. **Tauri / WSL / Docker 未跑**（容器内无 Tauri 运行时、无 WSL）—— 与阶段 1/2a/2b 一致。
   ⚠️ 这直接影响 `ptyBridge.ts`（先取 ticket 再 `bridge_connect`）—— **真机未验证**，如实记录。
4. **没有改配置编辑器**（`src/features/settings/**`）：V2 的写入口只有 `shell`，属于 3b 的「改只读 + 引导编辑文件」。
5. **没有做全仓库 prettier 格式化**（避免无关 diff）；只格式化本阶段改动过的文件。

### 0.3 结论摘要

- **`notMigratedYet` 调用点在 `src/api/` 已清零**（仅剩定义本身）：`grep -rn "notMigratedYet(" src/api/` → 0 命中。
- 新增第二个标记函数 `removedInV2()`，把「V2 已删能力」和「还没迁移」区分开
  → `grep -rn "removedInV2(" src/api/` 就是 3b 的移除清单（**13 处**）。
- 新增 **Form 表单渲染器**（六种字段类型 + `when` 联动 + `external` 确认位），替代 V1 的 question。
- 回退改造为 **`stage` → `commit` → `clear`** 三段式；**运行时不再抛错**（阶段 2a 只做了类型适配）。
- 全量测试 **967 passed / 0 failed**（服务未启动）；服务启动时 **980 passed**。
  新增单测约 **164 个**（`file`/`vcs`/`worktree`/`config`/`global`/`client`/`tool`/`lsp`/`command`/`mcp`/`pty`/`form`/`permission`/`session`）。

---

## 1. 51 处 `notMigratedYet` 逐个处置表

### 1.1 总表

图例：**迁移** = 改成真实 V2 调用；**3b** = `removedInV2()` 标记（V2 已删能力，UI 清理归 3b）。

|   # | 文件:函数                                                         | 处置                                                | V2 端点 / SDK                                                                                                                   |
| --: | ----------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `session.ts::getLastTurnDiff`                                     | 迁移                                                | `GET /api/session/{id}/diff`（**不传 `from` 时服务端默认就是「最新一条 user 消息所在轮次」**）→ `sdk.session.diff({sessionID})` |
|   2 | `session.ts::updateSession`                                       | 迁移                                                | `PATCH /api/session/{id}` → `sdk.session.update` + **回读一次**（V2 返回 void）                                                 |
|   3 | `session.ts::deleteSession`                                       | 迁移                                                | `DELETE /api/session/{id}` → `sdk.session.remove`（方法名从 `delete` 改名）                                                     |
|   4 | `session.ts::abortSession`                                        | 迁移                                                | `POST /api/session/{id}/interrupt` → `sdk.session.interrupt`，返回 `interrupted`                                                |
|   5 | `session.ts::revertMessage`                                       | 迁移（**改名** `stageRevert`）                      | `POST /api/session/{id}/revert/stage`                                                                                           |
|   6 | `session.ts::unrevertSession`                                     | 迁移（**改名** `clearRevert`）                      | `DELETE /api/session/{id}/revert`                                                                                               |
|   7 | `session.ts::shareSession`                                        | **3b**                                              | V2 删除了分享端点（仅配置层 `share:"auto"`，无 API）                                                                            |
|   8 | `session.ts::unshareSession`                                      | **3b**                                              | 同上                                                                                                                            |
|   9 | `session.ts::forkSession`                                         | 迁移                                                | `POST /api/session/{id}/fork`，body **`{before}`**（不是 `messageID`）                                                          |
|  10 | `session.ts::summarizeSession`                                    | 迁移                                                | `POST /api/session/{id}/compact` → `sdk.session.compact`（**不接受模型参数**）                                                  |
|  11 | `session.ts::getSessionChildren`                                  | 迁移                                                | `GET /api/session?parentID=` → `sdk.session.list({parentID})`                                                                   |
|  12 | `session.ts::getSessionTodos`                                     | **3b**                                              | V2 删除了 todo 端点，事件侧亦无 `todo.updated`                                                                                  |
|  13 | `permission.ts::getPendingPermissions`                            | 迁移                                                | `GET /api/permission/request`（location 作用域）                                                                                |
|  14 | `permission.ts::replyPermission`                                  | 迁移                                                | `POST /api/session/{id}/permission/{rid}/reply`，body `{decision, message?}`                                                    |
|  15 | `permission.ts::getPendingQuestions`                              | 迁移（**改名** `listPendingForms`，搬到 `form.ts`） | `GET /api/form`（位置级）/ `GET /api/session/{id}/form`（会话级）                                                               |
|  16 | `permission.ts::replyQuestion`                                    | 迁移（**改名** `replyForm`）                        | `POST /api/session/{id}/form/{formID}/reply`                                                                                    |
|  17 | `permission.ts::rejectQuestion`                                   | 迁移（**改名** `cancelForm`）                       | `DELETE /api/session/{id}/form/{formID}`                                                                                        |
|  18 | `pty.ts::listPtySessions`                                         | 迁移                                                | `GET /api/pty`（location 作用域，解包 `{location,data}`）                                                                       |
|  19 | `pty.ts::createPtySession`                                        | 迁移                                                | `POST /api/pty`                                                                                                                 |
|  20 | `pty.ts::getPtySession`                                           | 迁移                                                | `GET /api/pty/{ptyID}`                                                                                                          |
|  21 | `pty.ts::updatePtySession`                                        | 迁移                                                | **`PUT`** `/api/pty/{ptyID}`（方法从 PATCH 改 PUT）                                                                             |
|  22 | `pty.ts::removePtySession`                                        | 迁移                                                | `DELETE /api/pty/{ptyID}`                                                                                                       |
|  23 | `pty.ts::getPtyConnectUrl`（非 `notMigratedYet`，但同属连接协议） | 迁移（**改签名**）                                  | 新增 `createPtyConnectTicket()` → `POST /api/pty/{ptyID}/connect-token`；URL 改为「带 ticket」                                  |
|  24 | `mcp.ts::getMcpStatus`                                            | 迁移                                                | `GET /api/mcp`（**数组**，不再是 `Record<name,status>`）                                                                        |
|  25 | `mcp.ts::getMcpResources`                                         | 迁移                                                | `GET /api/mcp/resource`（新增 `templates`）                                                                                     |
|  26 | `mcp.ts::addMcpServer`                                            | 迁移                                                | `PUT /api/experimental/mcp/{server}`，body `{config}`                                                                           |
|  27 | `mcp.ts::connectMcpServer`                                        | 迁移                                                | `POST /api/experimental/mcp/{server}/connect`                                                                                   |
|  28 | `mcp.ts::disconnectMcpServer`                                     | 迁移                                                | `POST /api/experimental/mcp/{server}/disconnect`                                                                                |
|  29 | `mcp.ts::startMcpAuth`                                            | 迁移                                                | `/api/integration/*`：`GET /api/integration/{id}` 找 oauth method → `POST .../connect/oauth`                                    |
|  30 | `mcp.ts::removeMcpAuth`                                           | 迁移                                                | `GET /api/integration/{id}` 找 credential connection → `DELETE /api/credential/{credentialID}`                                  |
|  31 | `mcp.ts::completeMcpAuth`                                         | 迁移                                                | `POST /api/integration/{id}/connect/oauth/{attemptID}/complete`                                                                 |
|  32 | `mcp.ts::authenticateMcp`                                         | 迁移                                                | 发起 + **轮询** `GET .../connect/oauth/{attemptID}`（仅 `mode:'auto'`）                                                         |
|  33 | `file.ts::listDirectory`                                          | 迁移                                                | `GET /api/fs/list` → `sdk.file.list`                                                                                            |
|  34 | `file.ts::getFileContent`                                         | 迁移                                                | `GET /api/fs/read/*` → `sdk.file.read`（**裸 `Uint8Array`**）                                                                   |
|  35 | `file.ts::getFileStatus`                                          | 迁移                                                | `GET /api/vcs/status`（V1 的 `/file/status` 已删）                                                                              |
|  36 | `vcs.ts::getVcsInfo`                                              | 迁移                                                | `GET /api/vcs`                                                                                                                  |
|  37 | `vcs.ts::getVcsDiff`                                              | 迁移                                                | `GET /api/vcs/diff`（`mode` 枚举**变了**，见 §6.6）                                                                             |
|  38 | `worktree.ts::listWorktrees`                                      | 迁移                                                | `GET /api/worktree?projectID=`（**作用域从 directory 改为 projectID**）                                                         |
|  39 | `worktree.ts::createWorktree`                                     | 迁移                                                | `POST /api/worktree`                                                                                                            |
|  40 | `worktree.ts::removeWorktree`                                     | 迁移                                                | `DELETE /api/worktree`（`{projectID, directory, force}` 三字段必填）                                                            |
|  41 | `worktree.ts::resetWorktree`                                      | **3b**                                              | V2 删除了 `POST /experimental/worktree/reset`，无替代                                                                           |
|  42 | `tool.ts::getToolIds`                                             | **3b**                                              | V2 删除 `/experimental/tool/ids`；本仓库**零调用点**                                                                            |
|  43 | `tool.ts::getTools`                                               | **3b**                                              | V2 删除 `/experimental/tool`；本仓库**零调用点**                                                                                |
|  44 | `lsp.ts::getLspStatus`                                            | **3b**                                              | V2 不再运行语言服务器，端点已删；零调用点                                                                                       |
|  45 | `lsp.ts::getFormatterStatus`                                      | **3b**                                              | 同上；零调用点                                                                                                                  |
|  46 | `global.ts::disposeGlobal`                                        | **3b**                                              | V2 删除 `POST /global/dispose`，**无等价物**；零调用点                                                                          |
|  47 | `global.ts::disposeInstance`                                      | 迁移                                                | `DELETE /api/debug/location` → `sdk.debug.location.evict`                                                                       |
|  48 | `config.ts::updateConfig`                                         | **3b**                                              | V2 的 `/api/config` **只有 GET**，无 location 级写入口                                                                          |
|  49 | `config.ts::updateGlobalConfig`（「含其它字段」分支）             | **3b**                                              | `PATCH /api/experimental/config` 的 payload **只有 `shell`**                                                                    |
|  50 | `client.ts::initGitProject`                                       | **3b**                                              | V2 删除 `POST /project/git/init`（改为 location 首次使用时自动初始化）                                                          |
|  51 | `client.ts::updateProject`                                        | 迁移                                                | `PATCH /api/project/{projectID}` → `sdk.project.update`                                                                         |
|  52 | `command.ts::executeCommand`                                      | 迁移                                                | `POST /api/session/{id}/command`，body `{name, text}`（V1 是 `{command, arguments}`）                                           |

> **说明**：表里 52 行是因为把「同属连接协议但不是 `notMigratedYet`」的 `getPtyConnectUrl` 也列进来了。
> 真正的 `notMigratedYet` 调用点 = **51 处**（第 23 行不计入）。

### 1.2 处置结果统计

| 处置                           |   数量 | 明细                                                                                                                                      |
| ------------------------------ | -----: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **迁移到 V2 端点**             | **38** | 见上表                                                                                                                                    |
| **标记 `removedInV2()` 给 3b** | **13** | share / unshare / todos / 归档 / worktree reset / tool ×2 / lsp ×2 / disposeGlobal / updateConfig / updateGlobalConfig 其它字段 / initGit |
| 合计                           | **51** | ✅ 全部有明确去向                                                                                                                         |

### 1.3 「改名」的函数（避免后来者找不到）

| V1 名字               | V2 新名字                               | 为什么改名                                                   |
| --------------------- | --------------------------------------- | ------------------------------------------------------------ |
| `revertMessage`       | `stageRevert`                           | 三段式的第一段，旧名会误导「一次调用完成回退」               |
| `unrevertSession`     | `clearRevert`                           | V2 官方术语是 clear（清暂存），且新增了 `commitRevert`       |
| `getPendingQuestions` | `listPendingForms` / `listSessionForms` | Form ≠ question，且新增了会话级/位置级两个入口               |
| `replyQuestion`       | `replyForm`                             | 载荷从 `answers: QuestionAnswer[]` 变成 `answer: FormAnswer` |
| `rejectQuestion`      | `cancelForm`                            | V2 官方术语是 cancel                                         |

---

## 2. 三段式回退：实现说明与端点口径

### 2.1 V1 vs V2 语义对照（源码核实，tag `v2.0.19`）

| 阶段       | 端点                                   | 源码行为（`packages/core/src/session/revert.ts`）                                                                                                                                            |
| ---------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **stage**  | `POST /api/session/{id}/revert/stage`  | 只写 `session.revert = {messageID, snapshot, files}` 并把**文件快照**恢复到该边界（`files:false` 可只挪边界）。**不删任何消息**。返回 `Session.Revert`。                                     |
| **commit** | `POST /api/session/{id}/revert/commit` | 只发 `RevertEvent.Committed`；由 projector（`projector.ts:739`）**真正 `DELETE FROM session_message WHERE seq >= boundary.seq`** + 清空 revert 标记 + `InstructionState.reset`。**不可逆**。 |
| **clear**  | `DELETE /api/session/{id}/revert`      | 把 stage 时改动的文件快照恢复回去 + 清空 revert 标记。消息从未被删，所以清掉标记后它们**重新可见**（= V1 的 `unrevert`）。                                                                   |

### 2.2 🔴 两条必须知道的行为（否则 UI 会错）

1. **stage 之后消息仍然留在服务端**，`GET /api/session/{id}/message` 依然会返回它们。
   → 「回退后消息消失」**必须由前端按 `session.revert.messageID` 过滤** ——
   这正是 `messageStore` 的 `revertState` 在做的事（阶段 2a 已实现），本阶段沿用。
2. **发新消息（`prompt`）会自动 commit**：
   源码 `packages/core/src/session/session.ts:165` 的注释原文
   _"Commit a staged revert only after preparation succeeds, before admitting new work."_
   → 所以「回退 → 改一下 → 重新发送」这条自然流**不需要前端显式 commit**。
   `session.compact` 同样会先 commit（`session.ts:252`）。

### 2.3 UI 映射（`useSessionManager` / `useRevertState`）

| UI 动作              | 调用                                                                                          | 说明                                          |
| -------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 撤销（undo）         | `stageRevert(sessionId, userMessageId)`                                                       | 边界 = 被点击的用户消息                       |
| 重做（redo）         | 还有更早的撤销历史 → `stageRevert`（边界往前挪一条 = 恢复一条）<br>没有历史了 → `clearRevert` | 与 V1 的 redo 语义等价                        |
| 全部重做（redo all） | `clearRevert`                                                                                 | 等价 V1 的 `unrevert`                         |
| ——                   | **不主动调用 `commitRevert`**                                                                 | 交给服务端在 `prompt`/`compact` 时自动 commit |

> `commitRevert()` 仍然**导出**（API 完整 + 冒烟测试用它验证「真删」语义），但 UI 不调用。
> 理由：`commit` 不可逆，而 UI 的「撤销/重做」是可逆交互，主动 commit 会毁掉 redo 能力。

### 2.4 阶段 2a 遗留的「运行时会抛错」已修复

阶段 2a 只做了**类型适配**，`revertMessage` / `unrevertSession` 仍是 `notMigratedYet` 占位。
本阶段：

- `src/hooks/useSessionManager.ts`：`handleUndo` / `handleRedo` / `handleRedoAll` 改走 `stageRevert` / `clearRevertApi`
  （导入时**别名**成 `clearRevertApi`，因为本文件有一个同名的本地回调 `clearRevert`，不别名会遮蔽）。
- `src/hooks/useRevertState.ts`：整体改写到三段式。
  ⚠️ **如实说明**：该 hook 全仓库**零消费点**（真正在跑的是 `useSessionManager`），
  它只是 `src/hooks/index.ts` 的公共导出。本阶段按任务要求把它迁移到可用状态，**是否删除归 3b 判断**。

---

## 3. Form 表单：字段类型清单与渲染方案

### 3.1 六种字段类型（照 openapi `Form.*` + 服务端 `packages/core/src/form.ts` 核实）

| type          | 专有字段                                                                                                                       | 渲染控件（本项目 `FormDialog.tsx`）                                                                                                            | 提交值                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `string`      | `format?`(email/uri/date/date-time)、`minLength?`、`maxLength?`、`pattern?`、`placeholder?`、`default?`、`options?`、`custom?` | 有 `options` → **选项按钮组**（`custom:true` 时另给自由输入框）；无 → 单行 `<input>`，按 `format` 用原生 `email`/`url`/`date`/`datetime-local` | `string`（选项用 **option.value**，不是 label） |
| `number`      | `minimum?`、`maximum?`、`default?`（可能是 `'Infinity'`/`'-Infinity'`/`'NaN'`）                                                | `<input type="number" step="any">`                                                                                                             | `number`                                        |
| `integer`     | 同 number                                                                                                                      | `<input type="number" step="1">`                                                                                                               | `number`（整数）                                |
| `boolean`     | `default?`                                                                                                                     | 勾选按钮                                                                                                                                       | `boolean`（**`false` 也要提交**）               |
| `multiselect` | `options[]`（必填）、`minItems?`、`maxItems?`、`custom?`、`default?: string[]`                                                 | 多选按钮组（`custom:true` 时另给「回车追加」输入框）                                                                                           | `string[]`                                      |
| `external`    | `url`（必填）                                                                                                                  | **链接 + 「我已打开并完成」确认按钮**                                                                                                          | **`true`**（见 §3.3）                           |

所有非 external 字段还都可带：`title?` `description?` `required?` `hidden?` `when?: FormWhen[]`。

### 3.2 渲染方案的三个关键决策

1. **`when` 求值放在前端，且逐字对齐服务端 `isActive`/`matches`**
   （`src/api/form.ts` 的 `resolveVisibility()`）：
   - 服务端在**创建期**就强制「`when` 只能引用**前面**的字段」
     （`Form field condition must reference an earlier field`）→ 前端按 fields 顺序自上而下求值即可，无循环依赖。
   - **条件引用的字段「未作答」时，`eq` 与 `neq` 都判 false**（不是「neq 取反」）。源码注释原文：
     _"An unanswered referenced field makes the condition false for both ops."_
   - 多选字段参与比较时是「**任一项命中**」（`value.some(item => item === when.value)`）。
   - 比对用的是**转换后的值**（number 字段的条件值是数字、boolean 是布尔），所以 `resolveVisibility` 边遍历边转换。
2. **`external` 字段是「永远必填的确认位」**：服务端 `validateAnswer` 里
   `if (field.type === 'external') { if (value !== true) return 'External form field must be acknowledged' }`
   —— 字段里**没有** `required` 也一样。渲染器因此必须给一个显式的确认动作（不能只渲染链接）。
3. **answer 只提交「可见」字段，且空值不提交**（`buildFormAnswer()`）：
   服务端会拒「未知 key」（`Unknown form field`）与「条件不成立却带了值」（`Form field is not active`）。
   留空的非必填字段直接**不发该 key**（服务端把「缺 key」当「未作答」，合法）；
   而 `''` / `[]` 会触发字段级约束（如 `minLength`、`minItems`），所以必须丢掉。
   例外：`boolean` 的 `false` 是合法值，必须保留。

### 3.3 校验（`validateForm()`）—— 与服务端 `validateAnswer`/`validateField` 对齐

覆盖：`external` 确认位、`required`、string 的 min/maxLength、`pattern`、`format`（email/uri/date/date-time）、
**闭集选项**（有 `options` 且 `custom!==true` 时值必须是某个 option 的 value）、
number/integer 的 `Number.isFinite` + 整数性 + min/max、multiselect 的 min/maxItems + 闭集。

刻意与服务的两处差异（都在注释里写明）：

- `pattern` 是**非法正则**时本地不阻塞（本地判不了，交给服务端报 `invalid pattern`）。
- 非必填字段留空时**不跑** minLength/minItems（因为我们会把空值丢掉，服务端看到的是 `undefined`，
  它的字段级约束不会执行）。这**不是疏漏**，是服务端语义。
- 额外加了一条**服务端没有**的保护：数字字段填了内容但转不出有效值（`abc` / `Infinity`）时报
  「请输入数字」，而不是静默丢掉用户的输入。

### 3.4 接线（事件 → 状态 → 渲染）

| 环节 | 文件                                           | 说明                                                                                                                                                                  |
| ---- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 事件 | `src/hooks/useGlobalEvents.ts`                 | `form.created` 载荷是 **`{form: FormInfo}`（包了一层）**，`form.replied`/`form.cancelled` 是**扁平**的 `{id, sessionID, …}` —— 这个不一致是 V2 自身的，别「顺手统一」 |
| 分发 | 同上                                           | **阶段 3a 起真正向会话消费者分发** `onFormCreated/Replied/Cancelled`（2b 只做 pending 登记，因为当时没有渲染器）                                                      |
| 状态 | `src/hooks/usePermissionHandler.ts`            | `pendingQuestionRequests: ApiQuestionRequest[]` → **`pendingForms: FormInfo[]`**；新增 `handleFormReply` / `handleFormCancel`                                         |
| 渲染 | `src/features/chat/FormDialog.tsx`（**新增**） | 六种字段类型 + `when` 联动 + external 确认位；Escape 取消 / send 键提交                                                                                               |
| 挂载 | `src/features/chat/ChatPane.tsx`               | 底部 `QuestionDialog` → **`FormDialog`**（与 PermissionDialog 同一套视觉与弹入动画）                                                                                  |

> ⚠️ **内联通道（`InlineQuestion`）保持原样但恒空**：V2 的 `Form.Info` 只有
> `{id, sessionID, title, fields}`，**没有 tool 关联字段**，无法按 `callID` 内嵌到工具卡片里。
> 所以 `InlineToolRequestContext.pendingQuestions` 恒为 `[]`，`InlineQuestion` 的渲染路径保留不删，归 3b。

---

## 4. PTY 两步连接说明

### 4.1 协议

```
① POST /api/pty/{ptyID}/connect-token   → {location, data:{ticket, expires_in:60}}
   ⚠️ 必须带请求头 `x-opencode-ticket: "1"`（见 §6.4）
② GET  /api/pty/{ptyID}/connect?ticket=…&cursor=…&location[directory]=…
   → 101 Switching Protocols
```

### 4.2 实现

| 位置                          | 改动                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/pty.ts`              | 新增 `createPtyConnectTicket(ptyId, directory?, serverId?)`；`getPtyConnectUrl` 改为 `(ptyId, ticket, directory?, options?, serverId?)`   |
| `src/api/ptyBridge.ts`        | 拼 URL 前先 `await createPtyConnectTicket()`；ticket 走 **query**（Rust `bridge_connect` 不支持自定义 header，注释已写明不要挪到 header） |
| `src/components/Terminal.tsx` | 浏览器分支改为异步 IIFE：先取 ticket 再拼 URL；**重连天然重新申请**（指数退避逻辑未动）                                                   |

**ticket 是一次性的**：同一 ticket 第二次连接 → **403**（真机实测）。所以 URL **不能缓存复用**。

---

## 5. 改动清单

### 5.1 新增文件（15 个）

| 文件                                                                                                        | 行数级别 | 说明                                         |
| ----------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| `src/api/form.ts`                                                                                           | 大       | Form API + 纯函数（可见性/校验/answer 组装） |
| `src/types/api/form.ts`                                                                                     | 小       | Form 类型（复用 SDK 生成类型）               |
| `src/features/chat/FormDialog.tsx`                                                                          | 大       | **表单渲染器**（新增 UI 能力）               |
| `src/api/phase3a.smoke.test.ts`                                                                             | 中       | 真实服务冒烟（6 例，默认 skip）              |
| `src/features/chat/FormDialog.test.tsx`                                                                     | 中       | 渲染器单测（6 例）                           |
| `src/api/{session,permission,form,file,vcs,worktree,config,global,client,tool,lsp,command,mcp,pty}.test.ts` | ——       | 本阶段新增/扩展的单测（共 14 个测试文件）    |

### 5.2 修改文件（关键项）

| 文件                                          | 改动                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/api/notMigrated.ts`                      | 新增 `removedInV2()` + `V2_REMOVED_PENDING_CLEANUP` 前缀；文件头写清两种去向        |
| `src/api/session.ts`                          | 51 处中的 12 处；三段式；`getSessionDiff` 修全量语义（见 §6.1）                     |
| `src/api/permission.ts`                       | 权限 2 处 + 新增 saved 规则管理（`listSavedPermissions` / `removeSavedPermission`） |
| `src/api/v2Convert.ts`                        | 新增 `toInternalRevert()`（V2 的 `files` 字段映射）                                 |
| `src/types/api/session.ts`                    | `SessionRevert` 用**交叉类型**追加 V2 的 `files`（不动 v1Model）                    |
| `src/hooks/useGlobalEvents.ts`                | `pendingQuestions` → `pendingForms`；form 事件**开始向消费者分发**                  |
| `src/hooks/usePermissionHandler.ts`           | 表单链路（`pendingForms` / `handleFormReply` / `handleFormCancel`）                 |
| `src/hooks/useSessionManager.ts`              | undo/redo 改三段式（导入别名避免遮蔽）                                              |
| `src/hooks/useRevertState.ts`                 | 整体改写到三段式（该 hook 零消费点，如实记录）                                      |
| `src/hooks/useChatSession.ts`                 | form 事件回调、session family 拉取改 `listPendingForms`                             |
| `src/features/chat/ChatPane.tsx`              | `QuestionDialog` → `FormDialog`；内联通道 `pendingQuestions: []`                    |
| `src/components/SessionChangesPanel.test.tsx` | 补 `toVcsDiffMode` 替身（3 行，见 §6.6）                                            |

> ⚠️ **越界说明（如实）**：硬性约束写的是「允许改 `src/api/**`、`src/features/**`、`src/store/**`、`src/utils/`、测试、`docs/`」，
> 但为了让迁移**真的可用**，本阶段还动了 `src/hooks/**`（表单/回退链路所在）与
> `src/components/{McpPanel,Terminal,WorktreePanel,SessionChangesPanel}.tsx`（消费方适配）。
> 这些都是「调用方必须跟着改」的最小改动，没有删任何 UI。

---

## 6. 🔴 与文档预测不符之处（本节最重要）

> 共 **16 条**。前 8 条是本阶段新发现，后 8 条是 4 个并行子任务的实测补充。
> 已回填主文档的部分在 §6.17 列出。

### 6.1 🔴🔴 `GET /api/session/{id}/diff` **是「按轮次」的，不是全量** —— 阶段 1 的迁移悄悄退化了它

|                  | 内容                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **文档原文**     | §4.2：`diff \| GET /session/{id}/diff \| GET /api/session/{id}/diff \|`（暗示等价）                                                                                                                                                  |
| **openapi 原文** | _"Structured per-file diffs of the files **a turn** changed… `from`: User message whose turn to diff. **Defaults to the turn of the newest user message.**"_                                                                         |
| **后果**         | 阶段 1 把 V1 的 `getSessionDiff`（全量）直接映成不传参数的 `session.diff()` → **它只显示最后一轮**。UI 的「会话变更」模式与 V1 行为不一致，而且**不报错**。                                                                          |
| **处理**         | ✅ 本阶段修掉：先查**最早/最新一条 user 消息**（`limit=1&type=user&order=asc\|desc`，两个轻请求），把它们当 `from`/`to` 传进去覆盖整段历史；拿不到边界时退化为 V2 默认。`getLastTurnDiff` 则**不需要**任何参数（默认就是最新一轮）。 |

### 6.2 🔴 `fork` 的请求体字段是 **`before`**，不是 `messageID`；`Session.ForkBoundary` 是只读字段

|              | 内容                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **文档原文** | §4.2：`POST /api/session/{id}/fork \| 新增 ForkBoundary`                                                                                                                        |
| **实测**     | openapi 的请求体是 `{before?: msg_id}`；`Session.ForkBoundary = {type:'before'\|'through', messageID}` 是 `Session.Info.fork.boundary` 这个**只读字段**的形状，**不是请求体**。 |
| **处理**     | ✅ `forkSession(sessionId, messageId)` → `sdk.session.fork({sessionID, before: messageId})`。语义与 V1 一致（都不含该消息）。                                                   |

### 6.3 🔴 **V2 删除了「归档会话」能力**（文档未提）

|          | 内容                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **实测** | `SessionUpdateInput` 只有 `{title?, metadata?, permissions?}`；v2.0.19 的 server handler / protocol / core 里 `grep archiv` **零命中**。 |
| **后果** | UI 的「归档」（`useChatSession.handleArchiveSession`）在 V2 **没有实现手段**。                                                           |
| **处理** | ✅ `updateSession(..., {time:{archived}})` 显式抛 `removedInV2()`（不静默忽略）→ 归 3b 决定移除或改「删除」。                            |

### 6.4 🔴 PTY 连接协议的四条实测细节（openapi 看不出来）

| #   | 发现                                                                                                                                                                                          | 证据                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| ①   | **`connect-token` 必须带请求头 `x-opencode-ticket: "1"`**（值是**固定字面量 `"1"`**，不是票据本身）。openapi 标它 optional，实际不带 → **403** `Invalid PTY connect token request`            | 真机握手                               |
| ②   | **`pty.connect.token` 的返回值没有被 SDK 解包** —— 返回的是完整信封 `{location, data:{ticket, expires_in}}`（只有 `experimental.persistentPty.*` 等少数端点被 SDK `.then(v => v.data)` 处理） | 生成代码 + 真机                        |
| ③   | **WS connect 的目录参数名是 `location[directory]`**：`?ticket=X` → 404、`?ticket=X&directory=/tmp` → **404（裸参数被静默忽略）**、`?ticket=X&location[directory]=/tmp` → 101                  | 真机（pty 在 /tmp、服务端 cwd 在别处） |
| ④   | **手拼 URL 必须带 `/api` 前缀**。`getApiBaseUrl()` 返回**裸**地址（SDK 内部自己拼 `/api`）。漏了会打到 SPA 兜底路由拿到 **200 + text/html**（不是 404，极具迷惑性），WS 握手失败              | 真机                                   |

> 另外实测：ticket **一次性**（同 ticket 第二次连接 → 403）、**错目录 → 404**、
> **带 ticket 时服务端跳过 Basic 认证**（所以浏览器形态可以不带 `auth_token`/userinfo）。

### 6.5 🔴 `fs/list` 的目录条目 **path 带尾斜杠**（文档未提）

实测 `GET /api/fs/list` 返回 `src/`、`.git/`、`src/components/`；`fs/find` 同样。
必须剥掉，否则：① `name` 变空串（UI 目录名消失）；② `node.path` 与 `/api/vcs/status` 的裸文件路径对不上 →
`computeDirectoryStatus` 生成的父目录键是 `src` 而不是 `src/` → **目录改动颜色整片失效**。

另外三条 fs 细节：

- **`path=''` / `path='.'` / 不传 `path` 三者等价**（都返回 location 根），文档担心的「空串会报错」不成立。
- **`fs/read` 返回裸 `Uint8Array`**（丢掉 content-type），且**不接受绝对路径**（传了返回 **500**，不在 SDK 声明的状态码里）。
  → mimeType 必须**前端按扩展名推断**（正好也避开了服务端把 `a.ts` 认成 `video/mp2t` 的错判）。
- **`fs/list` 会列出 `.git/` 与 gitignore 命中的条目**，且**没有任何 ignored 标记**
  → 内部 `ignored` 只能恒 `false`，V1 的「gitignore 文件半透明」能力**丢失**（3b 需决定是否前端过滤）。

### 6.6 🔴 `Vcs.Mode` 枚举与 UI **不兼容**（文档 §4.7 只写了「路径加 `/api`」）

UI 的变更范围是 `git | branch | session | turn`，而 V2 只认 **`working | branch | committed`**。
实测传 `mode=git` → **400 `Expected Vcs.Mode`**。
→ 新增 `toVcsDiffMode()` 做 `git → working` 翻译（`session`/`turn` 不走 VCS 端点，不受影响）。
**这是本阶段最容易被漏掉的破坏性变更。**

附带：**非 git 目录的 `/api/vcs` 是 `200 + {"branch":{}}`**，不是 4xx/5xx。
只靠 try/catch 会把「没有 VCS」当成「有 VCS 但分支为空」放过去 → 必须再判 `branch.current`。

### 6.7 🔴 worktree 的**作用域参数从 `directory` 改成 `projectID`**（文档 §4.7 只写「转正」）

解析错项目时 HTTP 全 200 → 静默失效。实现里先用 `GET /api/location` 拿 `location.project.id`。
附带行为变化（3b 需知道）：V2 的 create 用 `git worktree add --detach`（**游离 HEAD，不建分支**），
remove **只做 `git worktree remove [--force]`**（不再删 `opencode/<name>` 分支、不再 `rm -rf`）。

### 6.8 🔴 `disposeGlobal` 在 V2 **没有等价物**（文档 §4.1 说「可用 `DELETE /api/debug/location` 替代」）

`debug/location` 一次只能驱逐**一个** location；`global/dispose`（释放整个进程资源）**没有替代品**。
→ 分开处理：`disposeInstance` 迁移，`disposeGlobal` 标记 3b。

### 6.9 🟡 MCP 的四条 schema 变化（文档未提）

1. `Mcp.Status` **新增 `pending`**（服务器正在启动/握手）；`NeedsAuth.error` 在 V2 是**必填**。
2. `GET /api/mcp/resource` 比 V1 多出 **`templates`**（V1 只有 resources）；资源来源字段是 `server`（V1 叫 `client`）。
3. OAuth attempt 有 **`mode: 'auto' | 'code'`** 两种，直接决定 `authenticateMcp` 能否「一步到位」：
   `code` 模式下永远轮询不到 complete，必须走 `completeMcpAuth`（实现里对 code 直接抛错并带出链接）。
4. **OAuth method 可能带必填 `form`**（如 `github-copilot` 的 `deploymentType`）→ 不带 `answer` 会被服务端拒。
   当前实现按「MCP 自动生成的 integration 通常不需要」处理，属**潜在风险点**（已在报告与注释里标注）。

### 6.10 🟡 全新 location 的**第一次 `GET /api/mcp` 返回空数组**（惰性初始化的又一处）

配置里明明有 MCP 服务器，但首次调用拿到 `data: []`，第二次（或等几秒）才有。
MCP 服务器是随 location **异步**连接的。→ UI 首次打开 MCP 面板可能显示「尚未配置」，需要刷新。
（与阶段 0.5 §5⑩、阶段 2b §7.14 是同一类问题。）

### 6.11 🟡 `GET /api/session/active` 的**线缆信封是 `{data:{…}}`**

SDK 的 `session.active()` 会**自动解包**（声明类型是裸 Record），所以 `getSessionStatus()` **是对的**。
但**裸 fetch 必须自己取 `.data`** —— 本阶段冒烟一开始直接读顶层，于是 `waitForBusy()` 永远看不到活跃会话。
这条值得记一笔：V2 的「是否解包」是**逐端点**由 codegen 决定的，不能凭直觉。

### 6.12 🟡 `revert/stage` 对 **busy 会话返回 `SessionBusyError`**

所以「回退」必须在执行结束**之后**才允许（`stage` 不是无脑幂等的）。冒烟里因此要先等会话真正空闲。
另：`prompt` 是**非阻塞入队**，刚发完时 `/api/session/active` 可能还是空的 →
「先等它忙起来再等它闲下来」是必须的两步（否则 `waitForIdle` 会立刻返回 true，然后撞上 `SessionBusyError`）。

### 6.13 🟡 Form 的三条硬性语义（文档只写了「六种字段类型 + when 条件」）

| #   | 语义                                                             | 源码位置                                                                                  |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| ①   | **`external` 字段必须被确认为 `true`**（哪怕没有 `required`）    | `validateAnswer`：`if (value !== true) return 'External form field must be acknowledged'` |
| ②   | **`when` 只能引用「前面」的字段**（创建期强制）                  | `validateFields`：`Form field condition must reference an earlier field`                  |
| ③   | **引用字段未作答时 `eq`/`neq` 都判 false**；多选是「任一项命中」 | `matches`：`if (value === undefined) return false`                                        |

另：`GET /api/form`（位置级）与 `GET /api/session/{id}/form`（会话级）**只列 `state.status === 'pending'`** 的表单。

### 6.14 🟡 权限：`decision` 枚举**没变**，变的是「必须带 sessionID」

任务提醒「`decision` 的枚举值必须以 openapi 为准，别照 V1 惯性」——
核实结果：openapi 的 `Permission.Reply` = **`"once" | "always" | "reject"`**，**与 V1 完全一致**。
真正会踩的是：V2 的 `sessionID` 是**路径参数**（`POST /api/session/{sessionID}/permission/{requestID}/reply`），
V1 有「无 sessionID」的分支 → V2 下缺 sessionID 会**必然失败**。
→ 实现里缺 sessionID 时**显式抛中文错误**，不发必错请求。

另：`GET /api/permission/request` **没有 sessionId 过滤参数**（拉全量后前端过滤）；
`POST /api/session/{id}/permission`（主动创建请求）在**审批不需要时直接返回 `{effect:'allow'}` 而不产生 pending 请求**
—— 冒烟要造 pending 必须先建一个带 `permissions:[{action:'bash',resource:'*',effect:'ask'}]` 的会话。

### 6.15 🟡 各模块的「零调用点」核查（3b 可直接删）

| 函数                                  | 调用点                           | 3b 动作                                                              |
| ------------------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `getToolIds` / `getTools`             | **0**                            | 可删 `src/api/tool.ts` + `src/types/api/tool.ts`                     |
| `getLspStatus` / `getFormatterStatus` | **0**                            | 可删 `src/api/lsp.ts`                                                |
| `disposeGlobal`                       | **0**                            | 可删函数                                                             |
| `updateConfig`（API）                 | **0**                            | 可删函数（注意 `ConfigSettings.tsx` 里有个**同名局部函数**，别误删） |
| `updateProject`                       | 0                                | 保留（已按 V2 契约实现 + 测试）                                      |
| `getPtySession`                       | 0                                | 保留（已迁移）                                                       |
| `removeMcpAuth` / `completeMcpAuth`   | 0（由 `authenticateMcp` 间接走） | 保留                                                                 |

### 6.16 🟡 任务书的两处计数/描述偏差

1. **本组实际是 15 处而不是 12 处**：worktree 4 + tool 2 + lsp 2 + global 2 + config 2 + client 2 + command 1 = **15**。
   （任务书 §9 写「`api/tool.ts` / `api/lsp.ts` / `api/global.ts` / `api/config.ts` / `api/client.ts` / `api/command.ts` 的 12 处」，
   漏算了 worktree 的 4 处。）51 处的总数不受影响（worktree 4 已在别处计入）。
2. **任务书说「lsp.ts 2 处 → 标记给 3b，不删 UI」，但 UI 侧本来就没有 LSP 状态展示**：
   全仓库 `getLspStatus|getFormatterStatus|LSPStatus|FormatterStatus` 只有定义处，**零调用点、零 UI**。
   设置面板里的 `lsp`/`formatters` 区块是**配置字段编辑器**，而且 **V2 的 config schema 里这两个字段仍在**
   （`packages/schema/src/config.ts` 有 `ConfigLSP` / `ConfigFormatter`）→ 它们属于「配置编辑器」那条线，不是「LSP 状态展示」。
3. **`docs/opencode-v2-migration.md` §9.3 的 `src/api/pty.ts:27 normalizePty()` 已过期** —— 该函数早已不存在。

### 6.17 ✅ 已回填主文档

| 位置  | 内容                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §3.3  | 新增「**「SDK 是否解包 `{data}` 信封」是逐端点决定的**」实测表                                                                                                                                                     |
| §4.1  | `global/dispose` **无替代**的修正                                                                                                                                                                                  |
| §4.2  | `update`（**V2 删除归档会话** + 返回 void）、`abort`（空闲返回 false 不是错误）、`fork`（字段是 `before`）、**`diff` 是按轮次的**（阶段 1 的退化已修）、**回退三条实测语义**                                       |
| §4.3  | 权限（枚举没变、**sessionID 变路径参数**、列表无 sessionId 过滤）+ **Form 三条硬性语义**（external 确认位 / when 只能引用前面的字段 / 未作答两 op 皆 false）                                                       |
| §4.4  | 配置写入只能改 `shell` 的复核结论                                                                                                                                                                                  |
| §4.5  | `fs/list`（**尾斜杠**、`.git/` 与 gitignore 无标记）、`fs/read`（**裸字节**、**不收绝对路径**）、`file/status → vcs/status`                                                                                        |
| §4.6  | PTY **四条连接细节**（`x-opencode-ticket:"1"`、不解包、`location[directory]`、`/api` 前缀）+ ticket 一次性                                                                                                         |
| §4.7  | MCP（**数组**、新增 `pending`、`NeedsAuth.error` 必填、`templates`、`mode:auto\|code`、惰性初始化）、VCS（**`Vcs.Mode` 枚举变了**、非 git 返回 200）、worktree（**作用域改 `projectID`**、reset 已标记、行为变化） |
| §5.6  | **新增章节**：回退三段式的实现口径（含三条必须知道的语义 + UI 映射表）                                                                                                                                             |
| §8    | 阶段 3 **拆成 3a（已完成）/ 3b（未开始）**，逐条勾选 + 产出说明                                                                                                                                                    |
| §9.3  | 标注 `normalizePty()` 那条**已过期**；`SessionChangesPanel` 的 patch 回退分支**已成死代码**；新增阶段 3a 引入的兼容物（`SessionRevert` 交叉类型）                                                                  |
| §9.4  | **逐项复核原「要移除的功能」表**：`子会话列表`/`手动摘要`/`unrevert` **其实是可迁移项**（已迁移）；**漏列了「归档会话」**                                                                                          |
| §10.3 | 新增 14 条阶段 3a 实测结论表                                                                                                                                                                                       |

合计：**13 处「实测修正/补充」标注 + 16 处「已迁移/已实现/已标记」标注 + 1 个新章节（§5.6）+ §8 的阶段拆分**。

---

## 7. 阶段 3b 待办交接（移除清单最终版）

### 7.1 `removedInV2()` 标记的 13 处（API 层）

```
src/api/session.ts    shareSession / unshareSession / getSessionTodos
                      + updateSession 的 time.archived 分支（归档会话）
src/api/worktree.ts   resetWorktree
src/api/tool.ts       getToolIds / getTools
src/api/lsp.ts        getLspStatus / getFormatterStatus
src/api/global.ts     disposeGlobal
src/api/config.ts     updateConfig / updateGlobalConfig 的「含其它字段」分支
src/api/client.ts     initGitProject
```

### 7.2 对应的 UI 入口（本阶段**只标记未删**）

| UI 入口                              | 文件                                                                                                                                         | 归属             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 分享按钮 / ShareDialog               | `src/features/chat/{Header,ShareDialog}.tsx`                                                                                                 | share            |
| 归档按钮                             | `useChatSession.handleArchiveSession`（侧栏）                                                                                                | 归档             |
| 待办展示                             | `src/features/chat/input/InputFooter.tsx`                                                                                                    | todo             |
| worktree「重置」                     | `src/components/WorktreePanel.tsx`（`handleReset`/`resetConfirm`/确认弹窗/按钮）                                                             | worktree reset   |
| 「初始化 git」按钮                   | `src/components/SessionChangesPanel.tsx`                                                                                                     | project/git/init |
| 配置保存链路                         | `src/features/settings/components/ConfigSettings.tsx` → 改「只读 + 引导编辑 `opencode.json`」                                                | config 写        |
| `InlineQuestion` 渲染路径            | `src/features/message/parts/ToolPartView.tsx` / `MessageRenderer.tsx` / `InlineQuestion.tsx` / `QuestionRenderer.tsx` / `QuestionDialog.tsx` | question 体系    |
| MCP `needs_client_registration` 分支 | `src/components/McpPanel.tsx`                                                                                                                | V2 不再产生      |
| `gitignore` 灰显（`ignored`）        | `src/components/FileExplorer.tsx`                                                                                                            | V2 无此信息      |

### 7.3 其它待办（非「移除」类）

1. **Tauri 真机验证**：`ptyBridge.ts` 的「先取 ticket 再 `bridge_connect`」只做了编译级 + 逻辑级验证，
   Rust 侧是否原样转发 query **未实测**（容器内无 Tauri 运行时）。
2. **`@opencode/client` 的 `subscribe()` 在 `plugin-http` 下的流式** 仍未验证（阶段 2b 遗留）。
3. **Form 的可选增强**：`metadata` 未做特殊渲染；`getFormDetail` 已可用但打开历史会话时**尚未回填已回答的表单**（只显示 pending）。
4. **MCP 的可选增强**：`templates` 已取回但 UI 未展示；`needs_auth.error` 未展示；`mcp.remove` 未封装（本项目 V1 也没有）。
5. **`src/hooks/useRevertState.ts` 是零消费点的公共导出** —— 建议 3b 直接删除。
6. **`useFileExplorer` 的根目录 10s TTL 缓存**（V1 原有）会让 `softRefresh()` 在 10s 内滞后，3b 可评估。
7. **prettier 全仓库仍有漂移**（本阶段只格式化改动过的文件，避免无关 diff）。
8. **`v1Model.ts` 的 B 桶 104 个导出** 仍在（本阶段一个未删，按要求留给 3b 收尾）。
9. **`docs/opencode-v2-migration.md` §4.7 建议补一行**：worktree 的作用域参数从 `directory` 改成 `projectID`（已回填）。
10. **Rust / WSL / Docker 三形态回归**（阶段 4）。

---

## 8. 测试与冒烟结果

### 8.1 类型检查

```
npx tsc -b --force   → 0 报错（全仓库）
```

### 8.2 全量单测

```
# 服务未启动（4097 关闭）—— 默认状态
npx vitest run --reporter=dot
→ Test Files  112 passed | 4 skipped (116)
  Tests      967 passed | 38 skipped (1005)
  Duration   20.02s

# 服务启动时（phase1Smoke 也会跑）
→ Test Files  113 passed | 3 skipped (116)
  Tests      980 passed | 25 skipped (1005)
```

**基线对比**：阶段 2b 结束时是 **803 passed + 19 skipped**。
本阶段新增约 **164 个通过用例**（14 个测试文件），**零失败、零回归**。
4 个 skip 的文件是 4 个「需真实服务」的冒烟文件（默认跳过）。

### 8.3 真实服务冒烟（`src/api/phase3a.smoke.test.ts`）

```
OPENCODE_SERVER_PASSWORD=t1 opencode --log-level warn serve --hostname 127.0.0.1 --port 4097
VITE_OPENCODE_SMOKE=1 VITE_OPENCODE_SMOKE_DIRECTORY=/tmp/opencode/p3a/ws \
  npx vitest run src/api/phase3a.smoke.test.ts
→ Test Files  1 passed (1) | Tests 6 passed (6)
```

| #   | 用例       | 结果 | 关键断言                                                                                                                                                              |
| --- | ---------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | 中止       | ✅   | 空闲会话 `interrupted=false`（不报错）；**观察到 busy 后 `interrupted=true`**，且随后回到 idle                                                                        |
| ②   | 回退三段式 | ✅   | stage 后**消息仍在**且 `session.revert.messageID` 正确；clear 后标记消失且消息仍在；commit 后**边界消息真被删除**                                                     |
| ③   | 权限回复   | ✅   | `POST .../permission` 造 pending → 列表能查到（`action→permission`/`resources→patterns` 映射正确）→ `reply('reject')` → 从 pending 消失；`/api/permission/saved` 可读 |
| ④   | 表单       | ✅   | 六种字段 create → 会话级 + 位置级列表都能查到 → reply（含 `external: true`）→ `state=answered`；再建一张 → cancel → `state=cancelled`                                 |
| ⑤   | PTY        | ✅   | create（`status` 形状）→ list → **connect-token 拿到 ticket** → remove                                                                                                |
| ⑥   | MCP        | ✅   | list（数组形状）→ resource catalog（`{resources,templates}`）→ runtime add → connect → remove                                                                         |

**数据卫生**：冒烟在专用 scratch 目录 `/tmp/opencode/p3a/ws` 建会话，`afterAll` 全部 `DELETE`。
实测跑完后该目录会话数 = **0**；`/home/coder/project/OpenCodeUI` 下 **零** `[phase3a-smoke]` 残留。
**测试服务已 `kill`**（端口 4097 无响应），**用户自己的 4096 服务未被触碰**（仍返回 401 = 存活）。

### 8.4 额外的真机验证（子任务做的，比要求更进一步）

| 模块   | 内容                                                                                                                                   | 结果               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| PTY    | 真实 WS 握手（Tauri 形态 + 浏览器形态）、ticket 一次性（403）、错目录（404）                                                           | ✅ 101 / 403 / 404 |
| MCP    | 起了假 MCP stdio 服务器，验证 `PUT /api/experimental/mcp/{server}` 的 `{config}` 包一层 + V2 字段名 + `connected/failed/disabled` 三态 | ✅ 204 + 状态正确  |
| fs/vcs | 尾斜杠、`absolute` 拼接、`.ts` mime、200KB base64、status 字段、非 git→null、三种 diff mode                                            | ✅ 8/8             |

---

## 9. 未做 / 已知缺口（如实）

| #   | 项                                            | 说明                                                                                        |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | **Tauri 真机未验证**                          | 容器内无 Tauri 运行时。受影响最大的是 `ptyBridge.ts`（先取 ticket 再 `bridge_connect`）     |
| 2   | **WSL / Docker 未跑**                         | 与阶段 1/2a/2b 一致                                                                         |
| 3   | **浏览器人工回归未做**                        | 按前几轮的既定做法，只用单测 + API 冒烟（**表单渲染器**额外补了组件级单测覆盖六种字段类型） |
| 4   | **配置编辑器未改**                            | V2 的写入口只有 `shell` → 3b 改「只读 + 引导编辑文件」                                      |
| 5   | **打开历史会话时不回填已回答的表单**          | 只显示 pending 表单（`getFormDetail` 已实现，未接线到历史渲染）                             |
| 6   | **Form 的 `metadata` 未特殊渲染**             | 目前只渲染 `title` + `fields`                                                               |
| 7   | **`fs/list` 的 gitignore 灰显能力丢失**       | V2 不返回 ignored 标记；未加前端过滤（3b 决策）                                             |
| 8   | **base64 是全量内存操作**                     | V2 的 `fs/read` 必须整包读文件，超大文件（>50MB）可能卡顿；未加大小上限                     |
| 9   | **`authenticateMcp` 的 `mode='code'` 只抛错** | 不自动轮询（轮询也拿不到 complete）；错误信息里带出授权链接供用户改走 `completeMcpAuth`     |
| 10  | **OAuth method 的必填 `form` 未处理**         | 需要 `answer` 的 integration 会被服务端拒（潜在风险，已在注释标注）                         |
| 11  | **MCP 面板未绑定 serverId**                   | 签名仍是 `(name, directory?)`；attempt 缓存 Map 的 key 已预留 serverId 前缀                 |
| 12  | **prettier 全仓库仍有漂移**                   | 本阶段只格式化改动过的文件                                                                  |
| 13  | **`getSessionDiff` 多两次轻请求**             | 为了拿 from/to 边界（`limit=1`）；服务端是内存查询，当前可接受                              |

---

## 10. 附：本阶段改动规模

```
git diff --stat（含未提交的 0/1/2a/2b/3a 全部改动）
 65 files changed, 6671 insertions(+), 2650 deletions(-)   ← 仅 src/api + src/types/api + src/hooks + src/features + src/components

本阶段新增测试文件（14）
  src/api/{session,permission,form,file,vcs,worktree,config,global,client,tool,lsp,command,mcp,pty}.test.ts
  src/features/chat/FormDialog.test.tsx
  src/api/phase3a.smoke.test.ts
```
