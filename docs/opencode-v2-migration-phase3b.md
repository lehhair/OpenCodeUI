# OpenCodeUI 迁移 V2 —— 阶段 3b 报告（功能裁撤 + 配置编辑器 + Rust）

> 状态：**阶段 3b 已完成**（2026-09-30）
> 目标环境：opencode `v2.0.19`（`/home/coder/.opencode/bin/opencode`）、`@opencode/client@2.0.19`
> 验收：`tsc` **0 报错**；`prettier --check` **全仓库通过**；`eslint` **0 error**；
> 全量测试 **958 passed / 44 skipped / 0 failed**（服务未启动时）；
> 真实服务冒烟 **6/6**（配置读、shell 写、静默丢弃实证、客户端防线、API 下架、数据卫生）
> 前置报告：`docs/opencode-v2-migration-phase{0,0.5,2a,2b,3a}.md`
> **计数口径**：任务书说「13 处 `removedInV2()`」→ 复核为 **13 处**（见 §2.1）。
> `v1Model.ts` B 桶：**104 个导出 → 42 个**（见 §4）。

---

## 0. 三件必须先交代的事

### 0.1 硬性约束逐条对照

| 约束                                                          | 实际执行                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **允许改** `src/**`（含删 UI）、`src-tauri/**`、测试、`docs/` | ✅ 改动集中在这几处                                                                                                    |
| **禁止 git commit / push / reset / checkout / worktree**      | ✅ 只用了 `git status` / `git diff` / `git ls-files` / `git show` / `git grep`（只读）                                 |
| **禁止删除 `docs/` 下任何文件**                               | ✅ 只新增 + 追加修订（`docs/*.md` 的 6 个文件被 prettier 重排了表格对齐，**内容一字未改**，见 §6.9）                   |
| 测试服务用完必须关闭                                          | ✅ 4097 的临时服务已 `kill` 并**确认无残留进程**；**用户自己的 4096 服务未触碰**（仍 401 = 存活）                      |
| 不得留下测试会话                                              | ✅ 冒烟自建会话全部删除；sqlite 实测 `session_v2` 里 **`phase3b` 特征 = 0**、`directory like '/tmp/opencode/p3b%'` = 0 |
| 测试必须设 120–180s 超时                                      | ✅ 全量 `timeout 180 npx vitest run`                                                                                   |
| 全程简体中文注释与报告                                        | ✅                                                                                                                     |
| **🔴 误改用户全局配置（已按用户许可恢复）**                   | ⚠️ **发生过**，见 §0.3 —— 如实交代                                                                                     |

### 0.2 本阶段**没有**做的事

1. **没有提交任何 git 事务**（整个迁移自阶段 0 起就未提交，本次沿用）。
2. **没有删** `openapi_doc.json` / `openapi_formatted.json` 两个孤儿文件 —— 见 §8.2 的交待（属主文档 §8 3b 清单项，但**不在本轮任务书 A–G 范围内**，且它们是仓库根目录的 git 跟踪文件，按「删除文件需确认」的规则留待阶段 4）。
3. **没有接入** V2 新增的 `persistent-pty` / `plugin RPC` / `/api/shell` / `/api/websearch` / `/api/rpc` / `session.inbox` / `session.instructions` / `/api/vcs/base` / `/api/vcs/branch` / `fs/write`（YAGNI，与 3a §9.2 一致）。
4. **没有做浏览器人工回归**（沿用前几轮做法：单测 + API 冒烟 + **本轮新增的「裁撤守卫」静态断言**，见 §6.3）。
5. **Rust 未编译验证**（容器缺 GTK 系统库，如实标注，见 §5.6）—— 但改动**几乎全是注释 + 一行字符串**。

### 0.3 🔴 必须交代的事故：冒烟测试写进了用户的全局配置文件

| 项             | 内容                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **发生时机**   | 第一次跑 `phase3b.smoke.test.ts` 的 ②③ 两项（都要真实写 `PATCH /api/experimental/config`）                                                                                                                                                                                                                       |
| **发生了什么** | `PATCH /api/experimental/config` 写的是「**最高优先级的全局配置文档**」，默认落在 `$XDG_CONFIG_HOME/opencode/opencode.jsonc` → 即 **`/home/coder/.config/opencode/opencode.jsonc`**（宿主机映射目录）。服务端把 `"shell": "/bin/sh"` 写进了这个文件。         |
| **怎么发现的** | 我的测试里「回读」断言一直失败（读到 `undefined`），排查时看到 `GET /api/config` 的 `Entry[].path` 指向真实用户目录，才意识到没隔离                                                                                                                                                                              |
| **影响**       | 用户的 `shell` 从「未设置 = 自动探测 `/usr/bin/bash`」变成「固定 `/bin/sh`」（不支持 bash 语法）                                                                                                                                                                                                                 |
| **证据**       | opencode 日志里 **235 条** `shell tool using shell` 记录**全部**是 `/usr/bin/bash`、**零** `/bin/sh`，最后一条在 2026-09-24 → 说明该键**原本不存在**                                                                                                                                                             |
| **处理**       | ① 立即停止测试服务；② 把当时文件备份到 `/tmp/opencode/p3b/opencode.jsonc.after-smoke`；③ **向用户说明并取得明确许可**；④ 按用户选择**删除 `shell` 键**，恢复原状（仅该行差异，已 `diff` 复核）；⑤ **整改测试**：把 `XDG_CONFIG_HOME` 指向 scratch 目录写成**运行前置条件**（红字），启动命令与文件头注释同步更新 |
| **教训**       | 「PATCH 全局配置」这类写操作，**必须先隔离 `XDG_CONFIG_HOME`**；`afterAll` 恢复「值」兜不住「文件被写过」                                                                                                                                                                                                        |

> 相关发现（有价值）：写完 `PATCH` 后**立刻** `GET /api/config` 拿到的 `info` 是 `{}`（旧值），
> 约 1 秒后才是 `{shell: …}`；`POST /api/location/reload` 也**不能**立刻修好。
> → 这条已写进冒烟测试（轮询）与配置编辑器（保存后重试回读），见 §3.4。

---

## 1. 任务 A：13 处 `removedInV2()` 对应的 UI 清理

### 1.1 UI 移除对照表（对着 3a 报告 §7.2 的 9 类）

|   # | 3a §7.2 的 UI 入口                   | 本轮实际动作                                                                                                                                                                                                                          | 涉及文件                                                                                                                                                                                                                                                     | 状态                                                        |
| --: | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
|   1 | 分享按钮 / ShareDialog               | 删除组件 + Header 的分享按钮 + SidebarFooter 的「分享对话」菜单项 + store 的 `shareUrl` 全链路 + 3 组 locale 键                                                                                                                       | delete `src/features/chat/ShareDialog.tsx`；`Header.tsx`、`sidebar/SidebarFooter.tsx`、`store/messageStore*.ts`、`store/index.ts`、`hooks/useSessionManager.ts`、`locales/{zh-CN,en}/chat.json`                                                              | ✅ 全清                                                     |
|   2 | 归档按钮（侧栏）                     | 删除 `handleArchiveSession` + **命令面板项** + **快捷键 `Alt+Backspace`** + 控制器动作 `archiveSession` + 2 个 locale 键                                                                                                              | `hooks/useChatSession.ts`、`features/chat/ChatPane.tsx`、`App.tsx`、`store/paneControllerStore.ts`、`store/keybindingStore.ts`、`features/settings/KeybindingsSection.tsx`、`features/settings/settingsSearchCatalog.ts`、`locales/{zh-CN,en}/commands.json` | ✅ 全清（**入口比任务书列的多 4 处**，见 §6.2）             |
|   3 | 待办展示（InputFooter）              | 删除会话级待办面板（进度环 + 任务列表 + `TodoSwapPanel`）+ `todoStore` + `api/todo.ts` + `types/api/todo.ts` + `sessionLifecycle` 的清理调用                                                                                          | `features/chat/input/InputFooter.tsx`（重写）、delete `store/todoStore.ts`、`api/todo.ts`、`types/api/todo.ts`；`store/index.ts`、`types/api/index.ts`、`utils/sessionLifecycle.ts`                                                                          | ✅ 全清（**`TodoRenderer` 特意保留**，见 §1.2）             |
|   4 | worktree「重置」                     | 删除 `handleReset` + `resetConfirm` 确认弹窗 + 列表项按钮 + `WorktreeItem.onReset` + `resetWorktree()` + `WorktreeResetInput` + 3 组 locale 键                                                                                        | `components/WorktreePanel.tsx`、`api/worktree.ts`、`types/api/worktree.ts`、`types/api/index.ts`、`locales/{zh-CN,en}/components.json`                                                                                                                       | ✅ 全清                                                     |
|   5 | 「初始化 git」按钮                   | 删除 `handleInitGit` + 按钮 + `initializingGit` 状态 + `initGitProject()` + locale 键标注                                                                                                                                             | `components/SessionChangesPanel.tsx`、`api/client.ts`                                                                                                                                                                                                        | ✅ 全清                                                     |
|   6 | 配置保存链路                         | 见 §3（降级为「只读 + 仅 shell 可写 + 复制 JSON」）                                                                                                                                                                                   | `features/settings/components/**`、`api/config.ts`                                                                                                                                                                                                           | ✅ 全清                                                     |
|   7 | `InlineQuestion` 旧渲染路径          | 删除 `InlineQuestion.tsx`、`QuestionDialog.tsx`、`pendingQuestions`、`findQuestionRequestForTool`、`onQuestionReply`/`onQuestionReject`、`ToolPartView`/`MessageRenderer` 的内联分支、`types/api/permission.ts` 的 4 个 Question 类型 | delete 2 文件；`InlineToolRequestContext.tsx`（重写）、`message/parts/ToolPartView.tsx`、`message/MessageRenderer.tsx`、`chat/ChatPane.tsx`、`chat/index.ts`、`types/api/permission.ts`、`types/api/index.ts`、`api/types.ts`                                | ⚠️ **部分清**：`QuestionRenderer.tsx` **特意保留**，见 §1.2 |
|   8 | MCP `needs_client_registration` 分支 | 删除 4 处 switch 分支 + `getErrorMessage` 分支 + `MCPStatusNeedsClientRegistration` 类型 + locale 键                                                                                                                                  | `components/McpPanel.tsx`、`types/api/mcp.ts`、`types/api/index.ts`、`locales/{zh-CN,en}/components.json`                                                                                                                                                    | ✅ 全清                                                     |
|   9 | `gitignore` 灰显（`ignored`）        | 删除 `FileNode.ignored` 字段（改为就地定义 V2 形状）+ FileExplorer 的 `opacity-50` 灰显 + `api/file.ts` 的 `ignored: false`                                                                                                           | `types/api/file.ts`（重写）、`api/file.ts`、`components/FileExplorer.tsx`、`api/file.test.ts`                                                                                                                                                                | ✅ 全清（决策见 §1.3）                                      |

> **9 类全部处置完毕**：8 类「全清」，1 类（question）按 §1.2 的证据**只清了交互侧、保留只读侧**。

### 1.2 🔴 两处**特意保留**：`QuestionRenderer` 与 `TodoRenderer`

3a 报告把这两个渲染器一并归入「V1 残留、归 3b 删除」。**本轮实测证明该前提不成立**，
删掉会造成**功能倒退** —— 所以保留，并在此交代依据。

#### ① `QuestionRenderer.tsx` —— V2 的 `question` 工具**还在**

| 证据         | 内容                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.0.19 源码 | `packages/core/src/tool/plugin/question.ts`：`export const name = "question"`，描述与 V1 一致。它内部改调 `Form.Service.ask(...)` 弹表单，但**工具调用本身照旧落进消息历史**                                                                                                     |
| 实测载荷形状 | `state.input` = `{questions:[{question, header, options:[{label,description}], multiple?}]}`<br>`state.content` = `[{type:'text', text:'User has answered your questions: "Q"="A". …'}]`（`toModelContent()` 生成）<br>`state.metadata` = `{answers: [["A"]], truncated: false}` |
| 本地库统计   | **54 条**这样的 `question` 工具调用，且它们所在会话**全部在 `session_v2` 表里**（即在 V2 的会话列表里可见）                                                                                                                                                                      |
| 结论         | `QuestionRenderer` 是**活代码** → 保留（并把头部注释改写成上面这套依据，避免后来者再误删）                                                                                                                                                                                       |

> **顺带一条对 3a 报告的事实修正**：3a §3 写「V2 的 `Form.Info` 只有 `{id, sessionID, title, fields}`，**没有 tool 关联字段**」——
> **不准确**。v2.0.19 的 `packages/schema/src/form.ts` 里 `InfoBase` 明确含
> `metadata: Metadata.pipe(optional)`，而 `question` 工具正是靠它把表单绑回工具调用：
> `metadata: { kind: "question", tool: { messageID, id: <工具调用 id> } }`。
> → **「按 callID 内联渲染表单」在 V2 技术上可行**；本项目**有意不做**（YAGNI：底部 `FormDialog` 已覆盖全部待处理表单）。
> 将来若要做，匹配键是 `form.metadata.tool.id === part.callID`。这段说明已写进 `InlineToolRequestContext.tsx` 顶部。

#### ② `TodoRenderer.tsx`（+ `todoUtils.ts`）—— 历史 `todowrite` 卡片仍要渲染

| 证据          | 内容                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 无待办能力 | `GET /session/{id}/todo` 已删；事件侧无 `todo.updated`（2b 已确认源码中不存在）；V2 工具集里**没有 todo 工具**（V1 的 `todowrite` 在 `packages/core/src/database/v1-migration.bun.ts:901` 的 `REMOVED_TOOLS` 里） |
| 但历史里有    | 本地 `session_message` 里 **328 条** `todowrite` 工具调用（最后一条 2026-09-24，即 V1 时代的历史被迁移进了 `session_v2` 可见的会话）                                                                              |
| 本轮处置      | **会话级待办 UI 全删**（面板 / store / API）；**只读渲染器保留**（历史工具卡片）                                                                                                                                  |
| 本地库旁证    | `todo` 表 287 行，**最后写入时间 2026-09-24** → V2 时代**零写入**，印证「V2 不产生待办」                                                                                                                          |

### 1.3 `gitignore` 灰显能力丢失的决策（任务 E-4）

**决策：接受丢失，删掉灰显逻辑与 `ignored` 字段，不自己实现 `.gitignore` 解析（KISS）。**

依据：

- V2 的 `fs/list`（`packages/schema` 的 `FileSystemEntry`）只有 `{path, type}`，**没有任何 ignored 标记**；
  且实测**原样列出** gitignore 命中的条目（`.gitignore`、`secret.log`、`ignored-dir/`、`.git/` 都在列表里）。
- 前端自己解析 `.gitignore` 的代价：需要实现完整规则集（嵌套 `.gitignore`、取反 `!`、`**` 通配、目录继承、
  `.git/info/exclude`、全局 excludesfile…），远高于「灰显」这点收益，而且**做不对反而误导用户**。
- 落地：`FileNode` 改成**就地定义的 V2 形状**（去掉 `ignored`），`FileExplorer` 去掉 `${node.ignored ? 'opacity-50' : ''}`，
  `api/file.ts` 去掉 `ignored: false`。**代码里保留了说明注释**，避免后来者以为是漏了。

> 同批还就地重定义了 `FileContent`（去掉 V1 的 `diff`/`patch`）与 `FileStatusItem`，
> 并删掉了只服务已移除搜索功能的 `Symbol` / `SymbolRange` / `SymbolLocation` / `TextSearchMatch` / `FindTextResponse`。

---

## 2. `removedInV2` 清零证明 + 13 处 API 函数的最终去向

### 2.1 清零证明（命令 + 实测输出）

```bash
# 生产代码（排除所有 .test. 文件）—— 这是「清零」的正式口径
$ grep -rn "removedInV2(" src/ --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l
0
$ grep -rn "notMigratedYet(" src/ --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l
0
$ ls src/api/notMigrated.ts
ls: cannot access 'src/api/notMigrated.ts': No such file or directory
```

⚠️ **口径说明（避免误读）**：如果**不带** `grep -v '\.test\.'`，会命中 **2 处** ——
它们全部来自**裁撤守卫测试自己的断言字符串**（`expect(findInSource('removedInV2('))`）：

```
src/features/phase3b.removal.test.ts:110:  it('`removedInV2(` 全仓库 0 命中（定义与调用都清掉）', () => {
src/features/phase3b.removal.test.ts:111:    expect(findInSource('removedInV2(')).toEqual([])
（notMigratedYet( 同理，另 2 处）
```

该守卫在扫描时会**主动排除测试文件自身**，所以「0 命中」的断言是真通过，不是自欺。

**并且做成了自动化断言**：`src/features/phase3b.removal.test.ts`（**21 个用例**）
（下面说的「零命中」都是**排除测试文件自身**后的口径）
在**全部源码（先剥注释）** 里断言 `removedInV2(` / `notMigratedYet(` / 各类被删标识符**零命中**，
并额外断言「该保留的还在」（`QuestionRenderer` / `TodoRenderer` 必须存在）。
→ 以后有人把它们加回来，**测试会红**。

> ⚠️ 为什么「先剥注释」是必须的：3b 的代码里到处是「⛔ 阶段 3b 已删除 xxx」这类说明注释，
> 它们**故意提到**被删的名字（否则后来者看不懂为什么这里空了一块）。
> 该测试还带**扫描器自检**（3 个用例），防止「断言恒真」的空跑。

### 2.2 13 处 `removedInV2()` 的最终去向

图例：**删函数** = 函数与定义整体删除；**删文件** = 文件整体删除。

|   # | 原标记（阶段 3a）                                    | 最终去向                                          | 备注                                                                                           |
| --: | ---------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
|   1 | `session.ts::shareSession`                           | **删函数**                                        | V2 删分享端点；`session_share` 表 0 行、`session_v2.share_url` 全 NULL（实测）                 |
|   2 | `session.ts::unshareSession`                         | **删函数**                                        | 同上                                                                                           |
|   3 | `session.ts::getSessionTodos` + `ApiTodo`            | **删函数**                                        | V2 无待办端点/事件/工具                                                                        |
|   4 | `session.ts::updateSession` 的 `time.archived` 分支  | **删分支 + 删入参**                               | `params.time` 整个移除 → 现在传 `time` **连编译都过不了**（比运行时抛错更早拦住）              |
|   5 | `worktree.ts::resetWorktree` + `WorktreeResetInput`  | **删函数 + 删类型**                               | V2 删端点且无替代能力；UI 按钮 + 确认弹窗一并删                                                |
|   6 | `tool.ts::getToolIds`                                | **删文件**（`api/tool.ts` + `types/api/tool.ts`） | 零调用点；连带删 `types/api/index.ts` 的转发                                                   |
|   7 | `tool.ts::getTools`                                  | **删文件**（同上）                                | 同上                                                                                           |
|   8 | `lsp.ts::getLspStatus`                               | **删文件**（`api/lsp.ts`）                        | 零调用点、零 UI                                                                                |
|   9 | `lsp.ts::getFormatterStatus`                         | **删文件**（同上）                                | 同上                                                                                           |
|  10 | `global.ts::disposeGlobal`                           | **删函数**                                        | V2 无等价物（`debug/location` 只能驱逐单个 location）                                          |
|  11 | `config.ts::updateConfig`                            | **删函数**                                        | V2 的 `/api/config` 只有 GET                                                                   |
|  12 | `config.ts::updateGlobalConfig` 的「含其它字段」分支 | **改为 `throw new Error(...)`**                   | 从「迁移占位符」变成**前端防线**：含其它字段时**前端就报错、且一个字段都不写**（③ 有冒烟实证） |
|  13 | `client.ts::initGitProject`                          | **删函数**                                        | V2 改为 location 首次使用时自动初始化 git；UI 按钮一并删                                       |

**连带删除的「不再被引用的函数」**（任务 A 要求）：

| 函数                            | 为什么变成零引用                                                     |
| ------------------------------- | -------------------------------------------------------------------- |
| `config.ts::getProviderConfigs` | 唯一消费方是配置编辑器的 provider 下拉；编辑器降级后那些组件整体删除 |
| `notMigrated.ts`（整个文件）    | 两个占位符（`notMigratedYet` / `removedInV2`）都已退役               |

> **API 层另外做的一次「零消费点」扫描**（26 个函数），结论是**其余 24 个都是「有意保留」**，
> 不属死代码：`getAgents` / `getDefaultModels` / `updateProject` / `getLocation` / `getPtySession` /
> `completeMcpAuth` / `removeSavedPermission` / `commitRevert` / `coalesceEvents` / `disconnectSSE` …
> —— 3a 报告 §6.15 已逐个说明「保留（API 完整性 + 有测试）」，本阶段**没有**顺手删它们（避免越界）。

---

## 3. 任务 B：配置编辑器降级（已按用户拍板落地）

### 3.1 降级后的形态

设置页「配置」标签 → 一句摘要 + **「打开配置查看器」**按钮 → 弹窗（`min(97vw,880px)` × `min(90vh,820px)`）：

| 区块                                          | 内容                                             | 按钮                                                   |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| 头部                                          | 标题「配置查看器」                               | 关闭                                                   |
| **说明 1**（警告底）                          | 为什么其它字段改不了                             | —                                                      |
| **说明 2**（浅底）                            | 数据来源是**有损视图**                           | —                                                      |
| **shell 区块**（accent 边框 +「可编辑」徽章） | `<select>`（自动 + 服务端 shell 列表）+ 说明     | **保存 shell**（**界面上唯一的保存按钮**）、「已保存」 |
| **当前生效配置**（「只读」徽章）              | 复制说明 + 每个顶层字段一行（点击展开完整 JSON） | 每字段 **复制 JSON**；区块右上角 **复制全部 JSON**     |

**彻底移除**：`保存全部` / `重置` / `未保存修改` / 字段级编辑控件 / schema 校验 / 搜索 / 16 个分页签。

### 3.2 用户可见文案（原文，zh-CN；en 同步）

- **设置页警告**：_V2 服务端的配置写入接口只接受 shell 一个字段，其它配置项无法在界面保存；GET /api/config 返回的是归一化后的有损视图，也不能当作配置文件回写。需要修改其它配置时，请复制 JSON 后粘贴到 opencode.json。_
- **弹窗说明 1（为什么改不了）**：_为什么其它配置项改不了？OpenCode V2 的配置写入接口（PATCH /api/experimental/config）只接受 shell 一个字段，提交其它字段会被服务端静默丢弃（返回成功但不生效）。为了避免「以为保存了其实没有」，这里只保留 shell 的可视化编辑，其它配置请复制 JSON 后粘贴到 opencode.json 保存。_
- **弹窗说明 2（有损视图标注）**：_下面展示的是 opencode 归一化后的生效配置（来自 GET /api/config）。schema 未识别的字段不会出现在这里，所以它不是配置文件的完整内容；完整内容请直接打开 opencode.json 查看。_
- **复制引导**：_每个区块的「复制 JSON」会复制该字段的完整 JSON（含字段名），可直接粘贴进 opencode.json 保存。_
- **shell 说明**：_终端和 bash 工具默认使用的 shell。这是 V2 唯一支持在界面修改并保存的配置项，保存后写入用户全局配置。_

### 3.3 shell 的保存路径（唯一有效写入口）

```
点「保存 shell」
  → ConfigSettings.saveShell()
  → updateGlobalConfig({ shell })            src/api/config.ts
  → sdk.config.update({ shell })             @opencode/client
  → PATCH /api/experimental/config            body = { shell: string | null }
  → 204（成功）
  → 回读 getGlobalConfig() + getConfig(directory)  → 写回下拉与只读区
```

- 选「自动（OpenCode 默认）」→ 空串 → `undefined` → API 层 `?? null` → 提交 `null`（清除该字段）。
- **`updateGlobalConfig` 只剩一道防线**：payload 里若有 `shell` 以外的键，**前端直接抛错**（不再走 `removedInV2`）；
  shell 唯一时正常写入。

### 3.4 「复制 JSON」的实现

| 项       | 实现                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 剪贴板   | 复用项目现成封装 `src/utils/clipboard.ts` 的 `copyTextToClipboard`（优先 `navigator.clipboard.writeText`，失败回退 `execCommand`；Tauri / 浏览器两形态通吃） |
| 每区块   | `JSON.stringify({ [字段名]: 值 }, null, 2)` —— **含字段名**，可直接粘进 opencode.json 顶层                                                                   |
| 整份     | `JSON.stringify(effectiveConfig, null, 2)` —— 即 `getConfig(directory)` 合并后的**生效配置**                                                                 |
| 数据来源 | `getConfig(directory)`（`GET /api/config` 合并结果，**有损视图**）；shell 初值另用 `getGlobalConfig()`                                                       |

### 3.5 🔴 本轮新发现并修掉的一个体验 bug：保存后回读拿到旧值

|                        | 内容                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **现象**               | `PATCH /api/experimental/config` 写完**立刻** `GET /api/config`，`info` 里**还是旧值**（实测是 `{}`）；约 1 秒后才变成新值。`POST /api/location/reload` **也不能**立刻修好 |
| **后果（如果不处理）** | 配置编辑器保存后回读一次 → 把下拉框**回滚成旧值**并置 `savedShell = 旧值` → 用户以为没保存成功                                                                             |
| **处理**               | 新增 `readGlobalShellSettled(expected, 2500)`：**最多重试到期望值**（150ms 间隔），加载初值仍走一次性读取                                                                  |
| **证据**               | 冒烟测试 ② 用轮询后才通过；单测新增 1 例「前两次回读仍是旧值、第三次才是新值」→ 断言最终值是**新值**                                                                       |
| **性质**               | 属 **V2 服务端行为**（配置 watcher 滞后），不是本层 bug；但界面必须适配                                                                                                    |

---

## 4. 任务 C：`v1Model.ts` B 桶收敛（104 → 42）

### 4.1 前后对比

|                      | 前（阶段 3a 结束） | 后（阶段 3b） | 变化     |
| -------------------- | -----------------: | ------------: | -------- |
| 顶层导出数           |            **104** |        **42** | **−62**  |
| 文件行数             |           **1492** |       **920** | **−572** |
| 外部 import 它的文件 |                  8 |             8 | 不变     |

### 4.2 校验方法（复用 2b 的「集合差」法 —— `tsc` 单独不够）

```
① 切分 104 个顶层导出块（按 `^export type ` 定位）
② 从「真正被外部 import 的 31 个名字」出发，求**传递闭包** → kept = 42
③ 删除不在闭包里的 62 个块
④ 三条断言全部通过：
   ✅ before == kept ∪ removed（互斥且无遗漏）
   ✅ 实际导出集合 == kept（想删的都删了）
   ✅ removed ∩ 外部 import == ∅（删掉的确实没人 import）
```

**31 个「被外部 import」的 seed**（逐个 import 行核对，共 8 个文件）：
`agent.ts`(1) · `config.ts`(13) · `model.ts`(5) · `permission.ts`(1) · `project.ts`(3) ·
`session.ts`(6) · `skill.ts`(1) · `vcs.ts`(1)。

**11 个「只被其它 kept 类型引用」的闭包成员**：
`AppSkillsResponses`、`AttachmentConfig`、`ConfigProvidersResponses`、`ConfigV2ExperimentalPolicy`、
`ImageAttachmentConfig`、`PermissionAction`、`PermissionRule`、`PermissionRuleset`、`PolicyEffect`、
`ReferenceConfig`、`ReferenceConfigEntry`。

> ✅ **`tsc` 0 报错 + 全量测试全绿 + 额外做了「误删反向核查」**：
> 对 62 个被删名字逐个在 `src/` 里做**非注释**引用扫描，命中 10 处**全部是假阳性**
> （同名但**就地重定义**在别的模块：`FileContent`/`FileNode` 在 `types/api/file.ts`、
> `Pty` 在 `types/api/pty.ts`、`Worktree*` 在 `types/api/worktree.ts`、
> `QuestionInfo`/`QuestionOption` 是 `QuestionRenderer.tsx` 的**局部 interface**、
> `Symbol` 是 JS 内置、`File` 是图标名）。
> 这正是 2b 误删 `Pty`/`Todo`/`QuestionOption` 的同类风险点 —— **so 做了反向核查而不是只看 tsc**。

### 4.3 删除的 62 个按类别

| 类别                                    | 类型                                                                                                                                                                                                                                          | 为什么能删                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| file / 搜索                             | `File`、`FileNode`、`FileContent`、`Symbol`、`FindTextResponse(s)`                                                                                                                                                                            | `types/api/file.ts` 已**就地重定义** V2 形状；搜索功能 2b 已移除 |
| pty                                     | `Pty`、`PtyCreateData`、`PtyUpdateData`                                                                                                                                                                                                       | `types/api/pty.ts` 就地重定义（3a 已完成）                       |
| worktree                                | `Worktree`、`WorktreeCreateInput`、`WorktreeRemoveInput`、`WorktreeResetInput`                                                                                                                                                                | `types/api/worktree.ts` 就地重定义；`reset` 已下架               |
| mcp                                     | `McpStatus*`(6)、`McpStatusResponse(s)`、`McpResource`                                                                                                                                                                                        | `types/api/mcp.ts` 就地重定义（V2 数组形状）                     |
| question 体系                           | `QuestionTool`、`QuestionOption`、`QuestionInfo`、`QuestionRequest`、`QuestionAnswer`、`QuestionV2*`(4)                                                                                                                                       | V2 用 Form 取代；只读渲染器自己定义最小 interface                |
| todo                                    | `Todo`                                                                                                                                                                                                                                        | 端点 / 事件 / 工具全不存在                                       |
| lsp / formatter                         | `LspStatus`、`FormatterStatus`                                                                                                                                                                                                                | V2 不跑语言服务器                                                |
| tool                                    | `ToolIds`、`ToolList`、`ToolListItem`                                                                                                                                                                                                         | 两个端点已删、零调用点                                           |
| 事件载荷                                | `EventTodoUpdated`、`EventSessionIdle/Status/Diff`、`EventVcsBranchUpdated`、`EventWorktreeReady/Failed`、`EventPermissionReplied`、`EventQuestionReplied/Rejected`、`EventServerInstanceDisposed`、`SyncEventSessionCreated/Updated/Deleted` | 事件层 2b 已重写，这些是残留                                     |
| auth / server / model / location / 策略 | `AuthInfo`、`AuthCredential`、`AuthApiKeyCredential`、`AuthOAuthCredential`、`GlobalHealthResponse(s)`、`ModelV2Info`、`LocationRef`、`VcsDiffData`、`PermissionV2Reply`、`PermissionV2Source`                                                | 对应能力未使用或已随端点消失                                     |

> 附带：`Range` 是 2b 降级为「模块内非导出」的 2 个类型之一，它唯一的引用方 `Symbol` 已删 →
> `Range` 一并消失。现在文件里**只剩 1 个**非导出类型 `SnapshotFileDiff`（仍被 `Session.summary.diffs` 引用）。
> 文件头已写明「**剩余 42 个均有活跃引用**」以及上面的完整依据。

---

## 5. 任务 D：Rust / WSL 启动参数与环境变量核对

> 目标版本 `opencode v2.0.19`（`opencode --version` 实测确认）。
> 依据全部取自 **tag `v2.0.19`**（用 `git show v2.0.19:<path>` / `git grep <pat> v2.0.19 -- <pathspec>` 读取，
> **未 checkout**；注意工作区当前在 `dev` 分支，比目标版本新）。

### 5.1 D-1 🔴 修复的静默 bug：filewatcher 变量名错了

|                        | 内容                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **改前**               | `wsl_commands.rs:913`：`export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true`                                                                                                                                                                                                            |
| **v2.0.19 唯一读取处** | `packages/cli/src/server-process.ts:120`：`filewatcher: !truthy(process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER)`                                                                                                                                    |
| **后果**               | `EXPERIMENTAL_` 前缀那个**零读取处** → **WSL 下 filewatcher 实际一直开着，且不报错**（静默失效）                                                                                                                                                                                          |
| **改后**               | `export OPENCODE_FILEWATCHER_DISABLE=true`（`truthy("true")=true` → `filewatcher:false`）                                                                                                                                                                                                 |
| **旧变量处置**         | **删除**（不是保留）。理由（比“照抄旧名字”更具体）：`bd7eb0603f` 新增 sidecar 时用旧名 → `fb884bb91e` **已改名** → `302e9b45ab`「merge dev into v2」**又改回旧名**。即**官方 sidecar 至今设旧名是一次合并回归 bug**，且改名提交已是 v2.0.19 的祖先 → 保留旧名连“兼容更老版本”的价值都没有 |
| **非 WSL 路径核查**    | ✅ **无需修改**。全量排查后环境变量注入点只有两处：`opencode.rs` 的 `cmd.env(key, value)`（只注入用户在设置页手填的键值对，**不硬编码任何 `OPENCODE_*`**）、以及 WSL 脚本的 `export` 行。`wsl_runtime.rs` / `wsl_types.rs` / `bridge.rs` / `utils.rs` **无** env 注入                     |

### 5.2 D-2 启动参数逐项核对表

| 参数 / 行为                    | 结论                                                                                                                           | v2.0.19 依据                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `--log-level`（**必须小写**）  | ✅ 有效，**已复核全仓库无大写残留**                                                                                            | `effect/unstable/cli` 的**内置全局 flag**（见 §6.3）；取值 `all\|trace\|debug\|info\|warn\|warning\|error\|fatal\|none` |
| `--log-level INFO`（大写）     | 🔴 **报错退出**（`~effect/cli/CliError/InvalidValue`，exit=1）                                                                 | 实测                                                                                                                    |
| `serve` 子命令                 | ✅ 有效                                                                                                                        | `packages/cli/src/commands/commands.ts:517`                                                                             |
| `--hostname` / `--port`        | ✅ 有效                                                                                                                        | `commands.ts:520-521`                                                                                                   |
| `--print-logs`                 | ✅ 有效（**全局** flag）                                                                                                       | `commands.ts:6` 定义；`framework/runtime.ts:85` 注册；`util/.../logging.ts:160` 消费                                    |
| stdout 监听行                  | ✅ `server listening on http://127.0.0.1:<port>`（**未变**）                                                                   | `packages/cli/src/server-process.ts:163`                                                                                |
| `parse_listening_url()` 能解析 | ✅ 能（`opencode.rs:203`：找 `http(s)://` + 取第一个空白分隔片段 + `0.0.0.0`→`127.0.0.1` 归一，对前缀措辞不敏感）              | 读码 + 实测四组                                                                                                         |
| 该行**不依赖** `--print-logs`  | ✅ 是 `console.log` 直写 stdout                                                                                                | 实测（非 WSL 路径不传该 flag 也能拿到 URL）                                                                             |
| 健康检查端点                   | ✅ 已是 `GET /api/info`（无 `/api/health`、无 `/global/health`，后者只出现在解释历史的注释里）                                 | `opencode.rs:90`                                                                                                        |
| 健康检查响应体形状             | ✅ 与真实响应对齐：`{version, pid, urls[], paths:{tmp}}`（**无 `healthy`**）；未就绪返回 **503** → `is_success()` 前置判断保留 | `packages/cli/src/server-process.ts:208` + `handlers/server.ts:18-21`                                                   |

### 5.3 D-3 环境变量盘点表

| 变量                                        | 结论                                                                                                                              | 依据 / 说明                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENCODE_SERVER_PASSWORD`                  | ✅ **有效**                                                                                                                       | `packages/cli/src/env.ts:11`                                                                                                                                                                                                                                                         |
| `OPENCODE_PASSWORD`                         | ✅ 有效（备选名）                                                                                                                 | `env.ts:10`（源码注释写 "legacy name is still honored"）                                                                                                                                                                                                                             |
| `OPENCODE_CLIENT`                           | ✅ **有效**                                                                                                                       | `cli/src/index.ts:126` 等 3 处                                                                                                                                                                                                                                                       |
| `OPENCODE_FILEWATCHER_DISABLE`              | ✅ **有效（本次新增）**                                                                                                           | `server-process.ts:120`                                                                                                                                                                                                                                                              |
| `OPENCODE_DISABLE_FILEWATCHER`              | ✅ 有效（同一条 `??` 链的等价别名）                                                                                               | 同上                                                                                                                                                                                                                                                                                 |
| `OPENCODE_LOG_LEVEL`                        | ✅ 有效（**是另一套机制**：内部 `.toUpperCase()`，只认 DEBUG/INFO/WARN/ERROR；与 `--log-level` 无关）                             | `util/src/observability/logging.ts:165`。本项目未使用                                                                                                                                                                                                                                |
| `XDG_STATE_HOME`                            | ✅ **有效**                                                                                                                       | `util/src/global-roots.ts:8`                                                                                                                                                                                                                                                         |
| `WSLENV=`（空值）                           | ✅ **有意为之**（注意：**不是 opencode 读的**，由 WSL 互操作层消费，置空=关闭 Windows↔WSL 环境变量共享与路径翻译，防污染）        | 官方 `sidecar.ts:30` 同款；已加注释                                                                                                                                                                                                                                                  |
| `OPENCODE_SERVER_USERNAME`                  | ❌ **无效（零读取处）→ 保留 + 注释**                                                                                              | `git grep OPENCODE_SERVER_USERNAME v2.0.19` **无命中**；服务端硬编码 `username: "opencode"`（`packages/server/src/auth.ts:20`、`process.ts:178`）。**保留原因已写进注释**（与健康检查实际发送的用户名一致、便于排查 401、将来恢复读取也不会漂移），并明确标注「对 v2.0.19 是 no-op」 |
| `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` | ❌ 无效 → **已删除**（见 §5.1）                                                                                                   | 零读取处                                                                                                                                                                                                                                                                             |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER`         | ❌ **也是零读取处的死变量**（官方 desktop 在设，但没人读）                                                                        | 全仓库只有设置处 + 文档。本项目未设，仅在注释里点明                                                                                                                                                                                                                                  |
| `OPENCODE_BIN`                              | ⚠️ **本项目自用**（v2.0.19 不读）。注意别与 v2.0.19 真实读取的 **`OPENCODE_BIN_PATH`** 混淆（`packages/cli/bin/opencode.cjs:33`） | `opencode.rs` 的 `patched_env_var`                                                                                                                                                                                                                                                   |

**结论：`src-tauri/` 中已无「冒充有效的无效配置」**；唯一保留的无效变量（`OPENCODE_SERVER_USERNAME`）已附明确注释。

### 5.4 D-4 WSL 路径整体复核（对照官方 `sidecar.ts:25-36`）

| 脚本行为                                       | 本项目                                 | 官方                    | 结论                                                   |
| ---------------------------------------------- | -------------------------------------- | ----------------------- | ------------------------------------------------------ |
| `set -euo pipefail` / `cd "$HOME"`             | ✅                                     | ✅                      | 一致                                                   |
| PATH 清洗 `/mnt/*`                             | ✅                                     | ✅                      | 一致                                                   |
| `export WSLENV=`                               | ✅                                     | ✅                      | 一致（有意清空）                                       |
| filewatcher 关闭                               | ✅ `OPENCODE_FILEWATCHER_DISABLE=true` | ❌ 旧名（**回归 bug**） | **本项目已修正，官方仍失效**                           |
| `OPENCODE_CLIENT=desktop`                      | ✅                                     | ✅                      | 一致                                                   |
| 随机密码注入                                   | ✅ uuid + `shell_escape`               | ✅                      | 一致                                                   |
| `OPENCODE_SERVER_USERNAME=opencode`            | ➕ 额外                                | 无                      | no-op，已注释保留原因                                  |
| `XDG_STATE_HOME="$HOME/.local/state"`          | ✅                                     | ✅                      | 一致                                                   |
| `exec <bin> serve --hostname 0.0.0.0 --port N` | ✅                                     | ✅                      | 一致                                                   |
| `--log-level <info\|warn>`                     | ✅ 小写                                | ✅ 小写                 | 一致                                                   |
| `--print-logs`                                 | ➕ 额外                                | 无                      | **刻意保留**：WSL 路径靠「最近 12 行输出」定位启动失败 |
| `-d <distro>`                                  | ➕ 额外                                | 无                      | 支持多发行版                                           |

**容器内已做**：`bash -n` 语法检查 ✅；干跑（`exec`→echo）后环境变量实测
（`OPENCODE_FILEWATCHER_DISABLE=true` **已生效**、`WSLENV=` 为空、PATH 无 `/mnt/` 残留）✅；
参数向量在本机 v2.0.19 二进制上**真实跑通**（`--print-logs --log-level warn serve --hostname 0.0.0.0 --port N`）✅。

**未实测（如实）**：WSL 端到端（容器内无 `wsl.exe`、非 Windows）—— `wsl.exe` 调用、`bash -se` 下发 stdin、
跨 Windows→WSL 端口转发、WSL 内 `$HOME/.opencode/bin/opencode` 解析、真实 WSL 延迟下的健康轮询。

### 5.5 顺带发现（**未改动**，仅报告）

`wsl_runtime.rs:433` 的 `resolve_opencode` **只检查 `$HOME/.opencode/bin/opencode`**；
而官方 `packages/desktop/src/main/remote/cli.ts:26` 的 `discoverScript()` 还会先试 `command -v opencode`、
再试缓存目录 → **用 npm/bun 全局安装 opencode 的 WSL 用户会被本项目误判为「未安装」**。
建议单开任务评估（超出本轮范围，且会牵动 `resolve_opencode` 的测试）。

### 5.6 D-5 Rust 编译验证（如实：**未通过**）

| 项             | 结果                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo`        | ✅ 存在（1.95.0）                                                                                                                                                                           |
| `cargo check`  | ❌ **失败，但与本项目代码无关**：依赖 `glib-sys` 的 build script 需要 `glib-2.0` 开发库（Tauri 在 Linux 的硬依赖），容器内 `glib-2.0.pc` / `gtk+-3.0.pc` / `libglib-2.0.so*` **全部不存在** |
| 是否安装系统包 | **未安装**（需用户许可，且任务要求「不要为了编译成功去改依赖」）                                                                                                                            |
| 替代验证       | `rustfmt --emit stdout`（纯语法解析）：两个文件 **PARSE OK**；`rustfmt --check` 偏差计数：`wsl_commands.rs` HEAD 28 → 现在 28（**新增 0 处**）、`opencode.rs` 0 → 0。                       |
| 风险判断       | 改动**几乎全是注释 + 一行字符串字面量**（`opencode.rs` 的改动为**纯注释**，无逻辑变更）→ 编译风险极低，但**未编译验证**如实标注                                                             |

---

## 6. 任务 E：3a 交接的其余待办

### 6.1 `src/hooks/useRevertState.ts` —— 已删除（零消费点确认）

删除前复核：全仓库引用只有 `src/hooks/index.ts` 的两行 re-export（`export { useRevertState }` /
`export type { UseRevertStateResult, RevertHistoryItem }`），**没有任何组件/ hook 使用它**。
真正在跑的 undo/redo 是 `useSessionManager`（直接改 `messageStore.revertState`）。
→ 删除文件 + 删除两行导出（并在原处留注释说明为什么空了一块）。

**连带清理**：`src/types/ui.ts` 里**重复且零引用**的 `RevertState` / `RevertHistoryItem` 也删掉了
（真正在用的那份在 `src/store/messageStoreTypes.ts`，有消费方）。

### 6.2 `useFileExplorer` 根目录 10s TTL 缓存 —— 已处理

|          | 内容                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **问题** | `listDirectory()` 对**根目录**有 10 秒 TTL 缓存（为「`useChatSession` 预热 + 面板首次挂载」省一次请求）。而 `softRefresh()`（session idle / 窗口聚焦 / SSE 重连触发）也走它 → **最多滞后 10 秒**才看到新文件 |
| **处理** | 给 `listDirectory()` 增加 `options.force`；`useFileExplorer.loadRoot(force)`；`softRefresh` 传 `force: true`                                                                                                 |
| **保留** | 预热与首次挂载**仍走缓存/并发去重**（原有省请求收益不变）；`force` 时**仍复用进行中的请求**（避免同时打多次）                                                                                                |
| **测试** | 新增 1 例「`force` 绕开 TTL（两次请求）」；原有「缓存命中」「并发去重」两例仍通过                                                                                                                            |

### 6.3 prettier 全仓库格式化 —— 已完成（**含一次惊险拦截**）

- 起点：**139 个文件**漂移（31 `src/components`、13 `src/hooks`、11 `src/features/chat`、9 settings、6 `docs` …）。
- 处理：`npx prettier . --write` → `--check` **全仓库通过**。
- 🔴 **惊险点（必须记）**：prettier 在 `docs/*.md` 里会把**裸的 `prompt_async`** 当成 Markdown 强调标记，
  输出 `prompt*async` + 转义 `\_` —— 这是**内容损坏**（标识符被改坏），而**仓库级 `--write` 恰好没触发它、
  单文件 `--write` 会触发**，所以肉眼很难发现。
  - 我做了两件事：① **全量 grep 复核**（`grep -rn "prompt\*async" docs/` → **0**、`prompt_async` 计数不变）；
    ② 把根因修掉 —— 那两处裸标识符**加上反引号**（`` `prompt_async` ``），既解决 prettier 的误判，
    也让标识符以代码字体呈现。之后 `--check` 通过且内容无损。
  - `docs/` 的其余改动**全是表格对齐重排**（419–971 行/文件），**语义零变化**。

### 6.4 `gitignore` 灰显 —— 见 §1.3（接受丢失，删干净）

### 6.5 `fs/read` base64 全量内存 —— 已加上限

- `MAX_FILE_PREVIEW_BYTES = 50 MB`；`getFileContent()` 读完后立刻判断，超限**丢弃**并抛出友好中文提示：
  _「文件过大，无法预览：`<path>`（`<N>` MB，上限 50.0 MB）。请用系统默认程序打开，或改用终端查看。」_
  → 该消息会被 `useFileExplorer.loadPreview()` 的 `catch` 原样显示在预览面板错误区（不是白屏）。
- ⚠️ **只能「读完后」判断**：`fs/list` 不返回文件大小，V2 也没有 `stat`/HEAD 端点 → 拿不到「读之前」的大小。
  但仍拦住了**base64（×1.33 内存）与 React 渲染**这两步放大。
- 测试：新增 1 例（只分配 50MB+1 字节，断言抛错且提示含大小与上限）。

### 6.6 其它 3a 遗留（主文档 §9.3 点名的死代码）—— 已清理

| 位置                                              | 改动                                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionChangesPanel.tsx` 的 `before/after` 提取  | 删掉「回退到直接的 before/after 字段（旧版后端兼容）」分支 → V2 的 `FileDiff.Info` 的 `patch` **必填**（`packages/schema/src/file-diff.ts`），回退分支是死代码 |
| `SessionChangesPanel.tsx` 的 `getFileStatus()`    | 同上删掉 before/after 回退                                                                                                                                     |
| `useFileExplorer.ts` 的 `getFileStatusFromDiff()` | 同上                                                                                                                                                           |

> ⚠️ **未动** `InlinePermission.tsx` 里读 `metadata.filediff` 的同类写法 —— 它读的是**权限请求的
> `metadata`（`Record<string, unknown>` 开放字段）**，不是 `FileDiff.Info`，属防御性解析，不在 §9.3 范围内。

### 6.7 孤儿文件（`openapi_doc.json` / `openapi_formatted.json`）—— **未删**，如实交待

主文档 §7 P3 与 §8 3b 清单都写了「删除孤儿文件」，但它**不在本轮任务书 A–G 的范围内**，
且它们是**仓库根目录的 git 跟踪文件**（非 `src/**`/`src-tauri/**`）。
按「删除文件属高风险操作」的规则，**留待阶段 4**（或用户一句话我就删）：两者全仓库唯一引用是
`docs/opencode-v2-migration.md` 自己，均为 V1 时代的 openapi 快照。

### 6.8 静态「裁撤守卫」测试（**本轮新增的自动化保护**）

`src/features/phase3b.removal.test.ts`（**21 例**，零依赖、跑得飞快）：
用 Vite 的 `import.meta.glob('/src/**/*.{ts,tsx}', {query:'?raw', eager:true})` 读全部源码
（**不用 `node:fs`** —— `tsconfig.app.json` 的 `types` 只有 `["vite/client"]`，用 node 会 tsc 报错），
**先剥注释**再断言：

1. 迁移占位符清零（`removedInV2(` / `notMigratedYet(` / `notMigrated.ts` 不存在）；
2. **9 类被删 UI 的标识符零命中**（`ShareDialog` / `handleArchiveSession` / `archiveSession` / `Alt+Backspace` /
   `getSessionTodos` / `todoStore` / `useTodos` / `resetWorktree` / `resetConfirm` / `initGitProject` /
   `getLspStatus` / `getToolIds` / `disposeGlobal` / `updateConfig(` / `InlineQuestion` / `QuestionDialog` /
   `findQuestionRequestForTool` / `pendingQuestions` / `needs_client_registration` / `node.ignored` / `useRevertState`）；
3. **该保留的还在**（`QuestionRenderer` / `TodoRenderer` 必须存在）；
4. **扫描器自检 3 例**（文件数 > 100、能命中确实存在的符号、注释确实被剥掉）→ 防止「断言恒真」的空跑。

> 为什么用「静态断言」而不是给每个组件写渲染测试：项目**没有** `Header` / `WorktreePanel` / `McpPanel` /
> `InputFooter` / `SidebarFooter` 的测试文件，从零搭 5 个组件的重 mock 测试收益低；
> 而「入口已消失」这个命题**本质上是「代码里不再有它」**，静态断言更直接、更不可能被绕过。

---

## 7. 任务 F：验证

### 7.1 类型检查 / 格式化 / Lint

```
$ npx tsc -b --force                        → 0 报错（exit 0）
$ npx prettier . --check                    → All matched files use Prettier code style!（全仓库）
$ npx eslint .                              → 0 errors / 43 warnings（警告全是既有的，本阶段新增文件 0 警告）
```

### 7.2 全量单测（**120–180s 超时**，服务未启动）

```
$ timeout 180 npx vitest run --reporter=dot
→ Test Files  108 passed | 5 skipped (113)
  Tests      958 passed | 44 skipped (1002)
  Duration   19.89s
```

**与基线（3a：967 passed / 38 skipped / 1005 total）的精确对账**：

| 项             |   数量 | 明细                                                                                                                                                                                                                                            |
| -------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **删除**的用例 | **36** | 28（4 个 configEditor 测试文件，精确计数：14+7+6+1）· 5（`lsp.test.ts` + `tool.test.ts`，**这两文件未提交过、无法用 git 恢复计数**，与差值反推为 5）· 2（`session.test.ts` 的 share/unshare/todos）· 1（`InlineToolRequestContext` 的提问用例） |
| **新增**的用例 | **27** | 21（裁撤守卫）· 4（`ConfigSettings.test.tsx`）· 2（`file.test.ts`：force 缓存 + 50MB 上限）                                                                                                                                                     |
| **净变化**     | **−9** | 967 → 958 ✅                                                                                                                                                                                                                                    |
| 新增 skip      | **+6** | `phase3b.smoke.test.ts` 默认跳过（未开 `VITE_OPENCODE_SMOKE`）                                                                                                                                                                                  |

**零失败、零功能回归**；被删用例**全部**对应已下架功能，**没有「为了跑绿而删测试」**。

### 7.3 真实服务冒烟（`src/api/phase3b.smoke.test.ts`，**6/6 通过**）

```
# 服务（🔴 必须隔离 XDG_CONFIG_HOME，否则会改到用户全局配置 —— 见 §0.3）
mkdir -p /tmp/opencode/p3b/ws /tmp/opencode/p3b/config
cd /tmp/opencode/p3b/ws && OPENCODE_SERVER_PASSWORD=t1 XDG_CONFIG_HOME=/tmp/opencode/p3b/config \
  opencode --log-level warn serve --hostname 127.0.0.1 --port 4097
VITE_OPENCODE_SMOKE=1 VITE_OPENCODE_SMOKE_DIRECTORY=/tmp/opencode/p3b/ws \
  timeout 240 npx vitest run src/api/phase3b.smoke.test.ts
→ Test Files 1 passed (1) | Tests 6 passed (6)
```

|   # | 用例                                | 结果 | 关键断言                                                                                                                                                                                    |
| --: | ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   ① | 配置**读**                          | ✅   | `getConfig(directory)` / `getGlobalConfig()` 可用；`GET /api/config` 返回**裸数组**、含 `type:'directory'` 的发现来源；**并断言全局配置目录落在 `/tmp/opencode/p3b/` 下**（隔离生效的证据） |
|   ② | 配置**写**（唯一有效路径）          | ✅   | `updateGlobalConfig({shell})` → 服务端真的落库（**轮询**到新值）                                                                                                                            |
|   ③ | 🔴 **「传其它字段被静默丢弃」实证** | ✅   | 裸 REST `PATCH {shell, theme}` → **HTTP 200（不报错）**；shell **生效**；theme **不生效且连字段都不出现** ← **这就是「配置编辑器必须降级」的硬证据**                                        |
|   ④ | **客户端防线**                      | ✅   | `updateGlobalConfig({shell, theme})` → **前端就抛错**（`/只接受 \{ shell \}/`）；且服务端的 shell **一次都没被写**（防「部分保存」）                                                        |
|   ⑤ | 已下架 API 确实不存在               | ✅   | 运行时复核 `shareSession`/`unshareSession`/`getSessionTodos`/`updateConfig`/`getProviderConfigs`/`resetWorktree`/`disposeGlobal`/`initGitProject` 均**不在**模块导出里                      |
|   ⑥ | 数据卫生                            | ✅   | 建会话 → 删会话（证明清理路径可用）                                                                                                                                                         |

**数据卫生实测**：

```
# 通过 API
GET /api/session?directory=/tmp/opencode/p3b/ws   → 会话数 0
GET /api/session（跨项目）                          → phase3b 残留 0

# 直接查 sqlite（只读）
session_v2 总数 660 · title like '%phase3b%' = 0 · title like '%phase3a%' = 0
directory like '/tmp/opencode/p3b%' = 0
```

**测试服务已关闭**：4097 `status=000`（无响应）、`ps` 无残留 opencode 进程；
**用户自己的 4096 服务未触碰**（仍 `401` = 存活）。

> 注：sqlite 的 `session_message` 总数在本次期间增长（19647 → 20025），**不是测试残留**
> —— 是**本对话自身**（我也是一个 opencode 会话）持续写入的消息。上表按 `phase3b` / 目录特征核对，均为 0。

### 7.4 冒烟对「删过的 UI」的覆盖方式（如实）

任务要求「凡是删过 UI 的功能逐个确认『点了不报错、入口已消失』」。由于**没有浏览器人工回归**（沿用前几轮做法），
本轮用**三重证据**代替：

1. **静态守卫**（§6.8，21 例）：断言标识符/组件/API **在代码里零命中**、该保留的还在；
2. **编译期**：`tsc` 0 报错 —— 被删函数**连引用都过不了**（`updateSession` 的 `time` 入参、`resetWorktree` 等）；
3. **API 冒烟 ⑤**：运行时复核这些函数**不在模块导出里**。

**如实**：这三条能证明「入口不存在、调用不报错（因为调不到）」，
但**不能**证明「点了不报错」的交互细节（那需要真的点）—— 浏览器人工回归仍留待阶段 4 的三形态回归。

---

## 8. 🔴 与文档不符之处（本节最重要）

> 共 **11 条**：6 条是 3a 报告的修正/补充，5 条是本阶段新发现。
> 已回填主文档的部分在 §8.7 列出。

### 8.1 🔴🔴 `Form.Info` **有** 可选的 `metadata`（3a 报告 §3 的前提是错的）

|                | 内容                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3a 原文**    | 「V2 的 `Form.Info` 只有 `{id, sessionID, title, fields}`，**没有 tool 关联字段**，无法按 `callID` 内嵌到工具卡片里」                                                   |
| **实测**       | `packages/schema/src/form.ts` 的 `InfoBase` = `{id, sessionID, title, metadata?: Form.Metadata}`；`question` 工具传 `metadata: {kind:"question", tool:{messageID, id}}` |
| **后果**       | 「表单内联渲染」在 V2 **技术上可行**（匹配键 `form.metadata.tool.id === part.callID`），3a 的「做不到」结论不成立                                                       |
| **本阶段处理** | 仍**不做**内联（YAGNI：底部 `FormDialog` 已覆盖全部待处理表单，内联只是第二个入口）；但把事实写进 `InlineToolRequestContext.tsx` 顶部注释，避免「基于错误前提做设计」   |

### 8.2 🔴 **V2 仍然有 `question` 工具**（3a 把它当 V1 残留）

|                | 内容                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3a 原文**    | 把 `QuestionRenderer.tsx` 列入「V1 question 体系残留、归 3b 删除」                                                                                            |
| **实测**       | v2.0.19 有 `packages/core/src/tool/plugin/question.ts`（`name = "question"`）；本地库 **54 条**真实 `question` 工具调用，所在会话**都在 `session_v2` 里可见** |
| **后果**       | 照 3a 删会让 54 条历史消息退化成默认工具卡片                                                                                                                  |
| **本阶段处理** | **保留** `QuestionRenderer`（只删交互侧 `InlineQuestion`/`QuestionDialog`/内联通道），并把依据写进该文件头部                                                  |

### 8.3 🔴 **`TodoRenderer` 同样是活代码**（历史 `todowrite` 卡片）

|                    | 内容                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **未在文档中列出** | 3a 只提「待办展示（InputFooter）」                                                                                                     |
| **实测**           | V2 无待办能力（端点/事件/工具全无）；但本地库有 **328 条** `todowrite` 工具调用，且**会话在 `session_v2` 里可见**（V1 历史被迁移进来） |
| **本阶段处理**     | 会话级待办 UI **全删**；`TodoRenderer` **保留**                                                                                        |

### 8.4 🟡 「归档会话」的 V2 缺失**有官方旁证**（3a 已判定，本轮补强证据）

3a 说「V2 删除了归档会话（`grep archiv` 零命中）」。
本轮补充两条**决定性旁证**：

1. **官方 V2 app 自己也缺**：`packages/app/src/home/sessions/controller.tsx:325`
   → `// TODO: Restore archiving when the V2 client exposes a session archive API.`
2. **数据库列还在但零写入**：`session_v2.time_archived` / `share_url` 列存在，
   但本地库 **660 个会话里 `time_archived` 全为 NULL、`share_url` 全为 NULL**，`session_share` 表 **0 行**
   → 「端点是删了、但数据层保留了列」的典型 V2 状态（不是我们的迁移漏了）。

### 8.5 🔴 「归档」的 UI 入口**比 3a 列的多 4 处**

3a §7.2 只写「`useChatSession.handleArchiveSession`（侧栏）」。
实际上「归档」是一个**完整功能链**，入口有 **5 处**：

|   # | 入口                                                                                    | 3a 是否列出 |
| --: | --------------------------------------------------------------------------------------- | ----------- |
|   1 | `useChatSession.handleArchiveSession`（控制器动作）                                     | ✅ 列出     |
|   2 | `App.tsx` 的**命令面板**项（`id: 'archiveSession'`）                                    | ❌ 未列     |
|   3 | `store/keybindingStore.ts` 的**默认快捷键 `Alt+Backspace`**                             | ❌ 未列     |
|   4 | `settings/KeybindingsSection.tsx` + `settingsSearchCatalog.ts`（设置页快捷键列表/搜索） | ❌ 未列     |
|   5 | `store/paneControllerStore.ts` 的控制器接口字段                                         | ❌ 未列     |

→ 若只按 3a 的清单删，**命令面板与快捷键会残留两个点了会报错的死入口**（它们会调用已删的控制器动作）。
本阶段 5 处一并清理。

### 8.6 🟡 **`GET /api/config` 的线缆形状是「裸数组」**（不是 `{data:[…]}` 信封）

- 实测：`GET /api/config` 返回 **`Config.Entry[]` 裸数组**。
- 与 `GET /api/session/active`（**是** `{data:{…}}` 信封）**相反** —— 又一次印证主文档 §3.3 的
  「**SDK 是否解包 `{data}` 是逐端点决定的**」。
- 我的冒烟测试第一次就是按信封解析 → 永远读到 `undefined`（踩过，已写进测试注释）。

### 8.7 🟡 **配置写入后立刻读会拿到旧值**（服务端 watcher 滞后）

- 实测：`PATCH /api/experimental/config` → **紧接着** `GET /api/config` 的 `info` 是 `{}`（旧值）；
  约 1 秒后才是 `{shell: …}`。`POST /api/location/reload` **也不能**立刻修好。
- 影响：任何「写完回读」的实现都会被它咬（我的冒烟 + 配置编辑器都被咬过）。
- 已处理：冒烟改成**轮询**；配置编辑器新增 `readGlobalShellSettled()`（重试到期望值，上限 2.5s）+ 1 个单测。

### 8.8 🔴 **`--log-level` 不在 opencode 自己的 CLI 定义里**

- 它是 **`effect/unstable/cli` 的内置全局 flag**（取值表在编译后的二进制里）。
- 后果：`git grep log-level v2.0.19 -- packages/` **查不到它的取值表**（只能查到官方 sidecar 的调用）
  → 后续排查**不要**因此误判为「参数不存在」。
- 证据：从编译后二进制提取到内置定义 `Mt = GlobalFlag.setting("log-level")({flag: Flag.choice(…)}); Ds = [help, version, wizard, completions, Mt]`；
  实测 `--log-level INFO` → `~effect/cli/CliError/InvalidValue`，exit=1。

### 8.9 🟡 官方 WSL sidecar 的 filewatcher 变量 bug **根因更具体**（且两条路径都失效）

- 不是「新文件抄了旧名字」，而是 **`302e9b45ab`「merge dev into v2」把已改对的名字改回去了**（diff 可证）。
- 另外 `OPENCODE_EXPERIMENTAL_FILEWATCHER` 在 v2.0.19 里**同样零读取处** ——
  即官方 desktop 在**本地**和 **WSL** 两条路径上设的文件监听变量**都是无效的**。

### 8.10 🟡 `prettier --write` 会**损坏** Markdown 里的裸 `prompt_async`

- prettier 把 `prompt_async` 当作强调标记 → 输出 `prompt*async` + 转义 `\_`（**标识符被改坏**）。
- **危险之处**：仓库级 `npx prettier . --write` **恰好没触发**，而**单文件** `npx prettier --write <file>` **会触发**
  → 极难发现。
- 处理：全量 grep 复核（0 处损坏）+ 把裸标识符改成带反引号（根因消除）。
- **对后续的提醒**：改 `docs/*.md` 后若跑 prettier，务必 diff 一眼这类「下划线标识符」。

### 8.11 🟡 `OPENCODE_SERVER_USERNAME` 保留的**注释义务**（任务要求）

任务要求「凡是 V2 不读的，要么删、要么注释说明『保留原因』」。
`OPENCODE_SERVER_USERNAME` 选择**保留 + 注释**（官方 test/文档都引用它，后续版本可能恢复读取），
理由已写进 `wsl_commands.rs` 的注释；`OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` 选择**删除**。

### 8.12 ✅ 已回填主文档

| 位置  | 内容                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------- |
| §4.4  | 配置编辑器**已降级落地**的口径（只读 + 仅 shell 可写 + 复制 JSON）+ 「写完立刻读会拿到旧值」            |
| §4.2  | 归档：补官方 app 的 TODO 旁证 + 本地库 `time_archived`/`share_url` 全 NULL 的实测                       |
| §4.3  | **`Form.Info` 有可选 `metadata`** 的修正（推翻 3a 的「没有 tool 关联字段」）；`question` 工具**仍存在** |
| §4.5  | `fs/list` 的 gitignore 灰显**决策落地**（接受丢失、已删字段）                                           |
| §4.7  | worktree reset / 分享 / 待办 的 UI 与 API **已全部下架**                                                |
| §3.5  | `XDG_CONFIG_HOME` 隔离是跑配置写冒烟的**前置条件**（新事故教训）                                        |
| §8    | 阶段 3b 逐条勾选 + 产出                                                                                 |
| §9.3  | 兼容物清理**结果**（`SessionRevert` 交叉类型仍保留；patch 回退死代码已删）                              |
| §9.4  | 移除清单**复盘**：`TodoRenderer` / `QuestionRenderer` **不在移除范围内**（前提错了）                    |
| §10.3 | 新增 6 条阶段 3b 实测结论                                                                               |

---

## 9. 阶段 4 交接

|   # | 事项                                      | 说明                                                                                                                                                                                                                                                                                    |
| --: | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | **Docker 锁 opencode 版本**               | `docker/Dockerfile.backend:102`、`docker/backend-entrypoint.sh:34` 仍在拉 `releases/latest` —— **很可能已经装成 V2**，必须钉死 `v2.0.19`                                                                                                                                                |
|   2 | **三形态回归**                            | 多服务器 / WSL / Docker 各跑一遍。重点：`ptyBridge.ts` 的「先取 ticket 再 `bridge_connect`」（**真机未验证**）、`@opencode/client` 的 `subscribe()` 在 Tauri `plugin-http` 下的流式（**未验证**）、WSL 启动脚本（**未实测**）                                                           |
|   3 | **README 版本要求**                       | 明确写「需要 opencode **v2**」                                                                                                                                                                                                                                                          |
|   4 | **删除 5 处历史兼容 shim**（主文档 §9.3） | `src-tauri` 的「先试 `/api/health` 再试 `/global/health`」已在本轮**改成单一 `/api/info`** ✅（阶段 1 即改）。其余见 §9.3 表                                                                                                                                                            |
|   5 | **孤儿文件**                              | `openapi_doc.json` / `openapi_formatted.json`（见 §6.7，本轮**未删**）                                                                                                                                                                                                                  |
|   6 | **可选增强**（本轮未做）                  | ① MCP `templates` / `needs_auth.error` 展示；② Form 的 `metadata` 渲染；③ 打开历史会话时**回填已回答的表单**（`getFormDetail` 已可用）；④ **表单内联渲染**（`form.metadata.tool.id === part.callID`，**技术上可行**，见 §8.1）；⑤ `fs/list` 的 gitignore 前端过滤（本轮决策为「不做」） |
|   7 | **`WSL resolve_opencode` 的行为差异**     | 只查 `$HOME/.opencode/bin/opencode`，官方还会查 `command -v opencode` → npm/bun 全局安装的 WSL 用户会被误判「未安装」（见 §5.5）                                                                                                                                                        |
|   8 | **Rust 编译验证**                         | 容器缺 `glib-2.0` 开发库 → 阶段 4 在能编译的环境（或 CI）里跑一次 `cargo check`                                                                                                                                                                                                         |
|   9 | **`ConfigSettings` 的一个已知语义选择**   | shell 下拉的**当前值**来自 `getGlobalConfig()`（全局），而只读区「生效配置」里的 shell 可能是**项目级**值 → 两者可能不一致（写入口写的是全局，所以显示「会被写入的值」更有用）。已在 `shellDesc` 文案里写明。若认为不妥可调整                                                           |

---

## 10. 附：本阶段改动规模

```
已删除的**跟踪**文件（31 个）：
  src/api/{lsp,tool,todo}.ts
  src/types/api/tool.ts
  src/features/chat/{InlineQuestion,QuestionDialog,ShareDialog}.tsx
  src/hooks/useRevertState.ts
  src/store/todoStore.ts
  src/features/settings/components/ 的 18 个 configEditor* + 4 个测试文件

本阶段**新增**的文件：
  src/api/phase3b.smoke.test.ts            （真实服务冒烟，6 例）
  src/features/phase3b.removal.test.ts     （裁撤守卫，21 例）
  src/features/settings/components/ConfigSettings.test.tsx （配置编辑器，4 例）
  docs/opencode-v2-migration-phase3b.md    （本文件）

v1Model.ts：1492 → 920 行、104 → 42 个导出
src-tauri/：2 文件、+176 / −29（其中 opencode.rs 的改动为纯注释）

注：`git diff --stat` 会把阶段 0/1/2a/2b/3a 的全部未提交改动一起算进来
（整个迁移自阶段 0 起从未提交），所以不单独作为本阶段规模的依据。
```
