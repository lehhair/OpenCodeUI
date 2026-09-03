# Fork 定制记录

> 本文档记录本 fork（`SsparKluo/OpenCodeUI`，作者 Louis LUO `<ssparkluo@gmail.com>`）相对于上游 `lehhair/OpenCodeUI` 的全部定制改动，**目的是在未来 merge upstream 时作为参考**：知道改了什么、为什么改、改了哪些文件，从而预判冲突、避免回退、快速重应用。

最后核对基准：上游 `main` = `c49fb49f`（v0.6.34），fork 集成分支 `dev` = `c6898e6d`。

---

## 1. 分支模型

| 分支            | 角色                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `upstream/main` | 上游 `lehhair/OpenCodeUI` 主干                                       |
| `main`          | **纯上游镜像**，始终与 `upstream/main` 对齐（`merge-base` 相同）     |
| `dev`           | **fork 集成分支**，所有 Louis 的定制都在这里；下游功能分支从此拉出   |
| `feat/*`、`fix/*`| 主题功能分支，完成后合并回 `dev`                                     |
| `deploy/cloudflare` | Cloudflare 部署相关配置分支（当前 checkout）                     |

**合并 upstream 的标准流程**：`git fetch upstream` → 在 `dev` 上 `git merge upstream/main` → 参考**第 3 节**逐个冲突点核对意图 → 解决冲突后跑 `pnpm test`。`main` 分支仅用于 fast-forward 到 `upstream/main`，**不要在 main 上做任何 fork 改动**。

---

## 2. 定制概览（按主题）

fork 共有约 70 个非合并提交，归为 12 个主题。下表按「上游冲突风险」排序——风险越高，merge upstream 时越需要重点关注。

| # | 主题                       | 类型      | 冲突风险 | 主要文件                                        |
| - | -------------------------- | --------- | -------- | ----------------------------------------------- |
| 1 | 滚动系统重构（v2）         | 重写      | 🔴 高    | `useAutoScroll.ts`、`ChatArea.tsx`              |
| 2 | 移动端输入框折叠           | 重写      | 🔴 高    | `InputBox.tsx`、`useMobileCollapse.ts`          |
| 3 | 侧边栏 / 项目选择器重构    | 重写      | 🔴 高    | `SidePanel.tsx`、`Header.tsx`、`useSessions.ts` |
| 4 | 模型选择器移到输入栏       | UI 迁移   | 🟡 中    | `Header.tsx`、`InputToolbar.tsx`、`ModelSelector.tsx` |
| 5 | per-block 自动展开控制     | 功能+设置 | 🟡 中    | `MessageRenderer.tsx`、各 PartView、`themeStore.ts` |
| 6 | 触摸手势 / iOS Safari      | 平台修复  | 🟡 中    | `ChatArea.tsx`、`scrollGesture.ts`、`index.css` |
| 7 | Diff / 代码预览复制按钮    | 功能      | 🟡 中    | `DiffViewer.tsx`、`CodePreview.tsx`、`diffFormat.ts` |
| 8 | API 错误处理 / 鉴权        | 健壮性    | 🟢 低    | `sdk.ts`、`errorHandling.ts`、`ServersSettings.tsx` |
| 9 | aggregateStepFinish 选项   | 功能+设置 | 🟢 低    | `MessageRenderer.tsx`、`ChatSettings.tsx`       |
| 10 | 文本选择浮窗 Quote/Copy   | 功能      | 🟡 中    | `TextSelectionPopup.tsx`、`popupUtils.ts`、`ChatPane.tsx` |
| 11 | 队列消息输入栏             | 功能      | 🟡 中    | `QueuedMessagesBar.tsx`、`useChatSession.ts`、`ChatPane.tsx` |
| 12 | Cloudflare 部署           | 部署专属  | 🟢 低    | `workers/api-proxy/`、`.github/workflows/`      |

---

## 3. 主题详解

### 3.1 滚动系统重构（v2 — 输入事件驱动）🔴

**目的**：上游的聊天滚动实现存在抖动、跟随不可靠、加载新内容时跳屏等问题。fork 用 `@tanstack/react-virtual` 虚拟化聊天页面，配合自研的 `useAutoScroll` hook 重建整个滚动系统。

**架构演进（v1 → v2）**：
- **v1**（`markBoundaryGesture` + 250ms 时间窗）：用 opencode 的 `markBoundaryGesture` 手工标记手势边界，搭配 `isAuto`/`markAuto` 给程序滚动打标（2px 容差 + 1500ms TTL token）来区分程序 vs 用户滚动。局限：浏览器滚动事件没有 JS 前驱事件（layout shift / find-in-page / history restore）无法归因。
- **v2**（输入事件驱动，`2026-07`）：彻底移除 `markAuto`/`isAuto`。在 **input 事件层**（wheel/touch/pointerdown/keydown/selectionchange）判断用户意图，`handleScroll` 降级为纯响应（clear `userScrolled` 当返回底部、schedule recover-pin 当漂移）。单一 10px 阈值替代原本 10/60-150/80 分裂阈值。

**关键设计**：
- 聊天页面按 `chatPageModel.ts` 分页，**倒序存储、正序渲染**（最旧页面在顶部）。
- `useAutoScroll` 维护「跟随模式」（`userScrolled` ref），用户向上滚动超出 10px 阈值即脱离跟随，返回底部阈值内自动重新跟随。
- 滚动跟随 vs 自定义滚动条整合：全局 `overlayScrollbar.ts` 隐藏原生滚动条并渲染 `.os-thumb` 层。`useAutoScroll` 通过自定义事件 `OS_DRAG_START`/`OS_DRAG_END` 感知滚动条拖拽（原生 scrollbar-width:none 使原 pointerdown 启发式失效）。
- Capsule reasoning、BashRenderer、TaskRenderer 的「智能滚动」统一 60px 阈值（`0c729b0`），仅当距底部 ≤60px 时自动跟随流式内容。
- selectionchange 仅在**流式活跃时**才触发脱离跟随（`c56183f7`）：空闲时选文字复制/引用不打断跟随。
- 方向感知触摸恢复：`onTouchEnd` 仅在 `touchMaxDownRef > 10`（真实向下拖拽）时尝试恢复跟随，避免轻触/上划回弹误触发。
- `<ChatArea>` 用 `@tanstack/react-virtual` 的 `anchorTo:"end"` + `resizeItem` 覆盖 + `overflowAnchor:"none"`，完全通过该路径控制滚动。

**输入事件归因规则**：
- wheel-up 且 target 在 chat root 或 `[data-scrollable]` 内 → 停止跟随（忽略侧栏/输入框/textarea 目标）
- touchstart / pointerdown 在 scrollbar region 或 chat root 包含嵌套 → 停止
- selectionchange 非空 → 停止（仅流式时生效）；清除 → 停止
- scroll 事件驱动的 tryRecover 仅限于：wheel deltaY>0、ArrowDown/PageDown/End、OS_DRAG_END（滚动条拖到底）

**涉及文件**：
- `src/features/chat/virtual/useAutoScroll.ts`（+ `.test.tsx`）— 核心实现，**几乎全量重写**
- `src/features/chat/ChatArea.tsx` — 虚拟化容器，托管 scroll-follow
- `src/features/chat/chatPageModel.ts` + `ChatArea.test.ts` — 页面模型
- `src/features/chat/ChatPane.tsx`
- `src/lib/overlayScrollbar.ts` — 自定义滚动条，派发 OS_DRAG 事件
- `src/features/message/parts/ReasoningPartView.tsx`、`src/features/message/tools/renderers/TaskRenderer.tsx` — 智能滚动适配
- `src/features/chat/DESIGN.md` — 滚动跟随设计文档

**关键 commits**（按 dev 上的最新版本）：
- （v1 基础）`f3b5c6a` feat: overhaul scroll system with useAutoScroll + @tanstack/react-virtual
- （v1 基础）`85cd3c7` fix: reverse chat page order so oldest messages render first
- （v1 基础）`1c5c18c` refactor: replace 250ms scroll gesture window with markBoundaryGesture
- `4a897f25` refactor(chat): input-event-driven scroll-follow redesign（v2 核心）
- `7b00a87` refactor(chat): eliminate stopPendingRef, single-state recovery
- `c56183f7` feat(chat): selection only affects follow state during active streaming
- `ee1dbf3` feat(chat): wheel inside nested scrollable always stops follow
- `db178c8` feat(chat): direction-aware touch recovery + overlayScrollbar events
- `33c887b0` feat(chat): align nested scroll gestures with upstream boundary
- `ba574d0` feat(chat): only expanding disclosure stops follow, collapsing doesn't
- `4b316ee` fix(chat): clearing selection no longer changes follow state
- `354b11c` fix(chat): preserve stop intent for tiny wheel-up via stopPending
- `7cfa63d` fix(reasoning): keep capsule scroll when scrolled up during streaming
- `cdb7e0f` fix(message): stop entry-grow animation on cleanup to avoid stuck height under StrictMode

> ⚠️ **上游冲突高发区**。上游对 `ChatArea` / 滚动逻辑改动频繁，每次 merge 几乎必然冲突。核对意图时优先保证 `useAutoScroll` 的「跟随/脱离/回弹」语义不被破坏，特别留意 `overflowAnchor:"none"` 和 `anchorTo:"end"` 不被上游覆盖。

---

### 3.2 移动端输入框折叠 🔴

**目的**：移动端输入框展开/收起原本用 auto-collapse，体验割裂。fork 改为**手动折叠 + CSS `grid-rows` 过渡**，并把 textarea 高度测量从直接读 DOM 改为**隐藏 mirror 元素**测量，避免输入时布局抖动和页脚被顶出可视区。

**关键设计**：
- `InputBox.tsx` 用 CSS grid 双行轨道（展开行 / 折叠行）做过渡，折叠时**完全回收**空间（不留 gap — `587f580`）。
- textarea 高度由 `measureTextareaContentHeight.ts` 隐藏 mirror 测量，`useTextareaAutoHeight.ts` 消费；不再在 auto-resize 时重置高度（`e9bff81`）。
- Mention/SlashCommand 菜单移出 `overflow-hidden` 容器，防止被裁切（`46a079d`）。

**涉及文件**：
- `src/features/chat/InputBox.tsx` — **重灾区**，几乎每次 merge 都冲突
- `src/features/chat/input/useMobileCollapse.ts`
- `src/features/chat/input/useTextareaAutoHeight.ts`
- `src/features/chat/input/measureTextareaContentHeight.ts`（新增）
- `src/features/chat/input/InputActions.tsx`、`InputToolbar.tsx`
- `src/constants/ui.ts`

**关键 commits**：
- `d89d815` refactor: mobile input collapse bar with CSS grid-rows transition
- `a28cac2` refactor: replace auto-collapse with manual collapse toggle on mobile
- `55c41ca` fix: restructure expanded track grid so collapse fully reclaims space
- `c5b3601` fix: use textarea mirror for stable height measurement
- `92fbf69` fix: use hidden mirror element to measure textarea content height
- `e9bff81` fix: remove unnecessary textarea height reset on auto-resize
- `587f580` fix: remove collapsed input track gap over chat history
- `b2b8776` fix: drop expandedHeight reference
- `46a079d` fix: move MentionMenu/SlashCommandMenu outside overflow-hidden
- `8911b67` fix(chat): make collapsed input dock click-through except capsule
- `a7d6d75` fix(chat): 修复输入框折叠的两个滚动态bug

---

### 3.3 侧边栏 / 项目选择器重构 🔴

**目的**：重做侧边栏顶部交互——用「添加项目」按钮替换原项目选择器，并新增**工作区 header location**（会话头部显示/切换所属工作区目录）。同时让 Sidebar 始终挂载，修复折叠/展开过渡丢失的问题。

**关键设计**：
- `SidePanel.tsx` 顶部改为「Open Project」按钮 + 工作区列表。
- 新增 `SessionHeaderLocation.tsx` / `SessionHeaderLocationPicker.tsx` / `sessionHeaderContext.ts`，把工作区目录绑定到会话 header。
- 新增 `useRecentWorkspaceDirectories.ts`、`useSwitchWorkspaceDirectory.ts`、`recentWorkspaceDirectories.ts`、`draftNewChatSession.ts` 等工具。
- `Sidebar.tsx` 始终挂载（`7f16c55`），靠 CSS 控制可见性，保证过渡动画。

**涉及文件**：
- `src/features/chat/sidebar/SidePanel.tsx`、`FolderRecentList.tsx`
- `src/features/chat/Header.tsx`、`PaneHeader.tsx`
- `src/features/chat/SessionHeaderLocation.tsx`、`SessionHeaderLocationPicker.tsx`、`sessionHeaderContext.ts`（新增）
- `src/features/chat/sidebar/{draftNewChatSession,recentWorkspaceDirectories}.ts`（新增）
- `src/features/chat/{useRecentWorkspaceDirectories,useSwitchWorkspaceDirectory}.ts`（新增）
- `src/features/sessions/SessionList.tsx`、`src/hooks/useSessions.ts`
- `src/features/chat/{Sidebar.tsx,ChatPane.tsx,InputBox.tsx}`、`src/App.tsx`

**关键 commits**：
- `261e7b4` refactor: replace project selector with add-project button, add workspace header location
- `c7527af` feat: rename 'add project' to 'open project' and always show new chat in sidebar
- `7f16c55` fix: restore sidebar collapse/expand transition by always mounting Sidebar
- `50c7876` fix: clean up merge fallout — 上次 merge upstream 后的清理性修复

---

### 3.4 模型选择器移到输入栏 🟡

**目的**：把模型选择器从顶部 Header 移到输入框工具栏，让用户在输入时即可切换模型，释放 Header 空间。

**涉及文件**：
- `src/features/chat/Header.tsx` — 移除 ModelSelector
- `src/features/chat/input/InputToolbar.tsx` — 接入 ModelSelector
- `src/features/chat/ModelSelector.tsx`
- `src/features/chat/ChatPane.tsx`

**关键 commits**：
- `15f3ed2` feat: move model selector from header to input toolbar

> 上游若调整 Header 或 InputToolbar 布局会冲突；语义上很简单，冲突时保留「ModelSelector 在 InputToolbar」即可。

---

### 3.5 per-block 自动展开控制 🟡

**目的**：给 reasoning / subtask / tool 等消息块增加**逐块自动展开控制**，并新增「沉浸式未读工具折叠」模式——活跃工具运行期间，未读的工具块按用户偏好折叠，避免刷屏。

**关键设计**：
- 新增 `utils/blockCollapseMode.ts`（+ test）定义折叠模式枚举。
- 设置项写入 `themeStore.ts`，UI 在 `ChatSettings.tsx`。
- 各 `PartView` 根据 mode + 「是否活跃运行」决定展开/折叠。

**涉及文件**：
- `src/features/message/MessageRenderer.tsx`
- `src/features/message/parts/{ReasoningPartView,SubtaskPartView,ToolPartView}.tsx`
- `src/utils/blockCollapseMode.ts`（新增）+ `.test.ts`
- `src/features/settings/components/ChatSettings.tsx`
- `src/store/themeStore.ts`

**关键 commits**：
- `a589062` feat: per-block auto-expand control with immersive unread tool option
- `1c455ca` fix: respect immersive unread tool collapse mode during active tool run

---

### 3.6 触摸手势 / iOS Safari 🟡

**目的**：移动端在 `ChatArea` 上需要同时支持**水平翻页（pager）手势**和**纵向滚动**，但 iOS Safari 默认 `touch-action` 会拦截斜向手势。fork 通过 `touch-pan-y` + 沿 DOM 链向上传播，让 pager 与滚动共存。（曾尝试给 popup 开启垂直 touch pan，最终 revert——iOS 上副作用大于收益。）

**涉及文件**：
- `src/features/chat/ChatArea.tsx`、`ChatPane.tsx`
- `src/features/chat/scrollGesture.ts`、`useScrollGestureDetector.ts`（+ tests）
- `src/index.css` — `touch-action` 相关规则

**关键 commits**：
- `9a33b19` fix: add touch-pan-y to ChatArea to allow horizontal pager gestures on mobile
- `fa3c13c` fix: propagate touch-pan-y up the DOM chain to enable horizontal pager gestures
- `e0e4397`→`41d9ec7`（已 revert）尝试给 iOS Safari popup 开启垂直 touch pan

---

### 3.7 Diff / 代码预览复制按钮 🟡

**目的**：给 diff viewer 和 code preview 加复制按钮，提升可用性。`diffFormat.ts` 抽取统一的 diff 文本格式化逻辑。

**涉及文件**：
- `src/components/DiffViewer.tsx`（+ `.test.tsx`）、`DiffView.tsx`
- `src/components/CodePreview.tsx`（+ `.test.tsx`）
- `src/components/ContentBlock.tsx`、`SessionChangesPanel.tsx`
- `src/features/message/tools/renderers/DefaultRenderer.tsx`
- `src/utils/diffFormat.ts`（+ `.test.ts`）

**关键 commits**：
- `69892a4` feat: add copy button to diff viewer and code preview
- `c30ded2` fix: close JSX expression in CopyButton conditional render（构建修复）

---

### 3.8 API 错误处理 / 鉴权 🟢

**目的**：上游对 opencode server 错误静默失败，fork 把错误**通过 toast 显式暴露给用户**；并支持**在默认 server 上配置鉴权凭据**（原本只能对自定义 server 配）；**允许在存在其他 server 时删除默认 server**（桌面端除外——桌面端的默认 server 既是配置项也是 app 后端）。

**关键设计**（默认 server 可删除）：
- `serverStore.removeServer` 守卫由 `server.isDefault` 改为 `server.isDefault && (isTauri() || servers.length <= 1)`。
- 桌面端（`isTauri()`）禁止删除默认 server——避免 `ServiceSettings` 的「启动本地服务」功能静默失效（`setLocalServerRuntimeUrl` 依赖默认 server 存在）。
- UI 上删除按钮对默认 server 在 `!isTauri() && servers.length > 1` 时显示；编辑按钮仍隐藏（保持作用域最小）。
- 持久化无改动——`loadFromStorage` 的「空列表重建默认」逻辑是安全的，因为删除默认 server 必导致列表非空。唯一能清空列表的路径（删完所有 server）会触发重建默认，这是合理的 reset 行为。

**涉及文件**：
- `src/api/sdk.ts`、`src/utils/errorHandling.ts`（新增）
- `src/contexts/SessionContext.tsx`、`src/hooks/useSessions.ts`
- `src/features/chat/sidebar/{FolderRecentList,SidePanel}.tsx`（错误展示接入点）
- `src/features/settings/components/ServersSettings.tsx`（+ `.test.tsx`）
- `src/store/serverStore.ts`（+ `.test.ts`）— 删除守卫

**关键 commits**：
- `ad838c6` fix: surface opencode server errors to users via toast
- `edd8f49` fix: allow configuring auth credentials on the default server
- （pending）feat: allow deleting the default server when others exist (non-desktop)

---

### 3.9 aggregateStepFinish 选项 🟢

**目的**：新增设置项控制 step-finish 事件的展示方式（聚合显示），写入 `themeStore`。

**涉及文件**：
- `src/features/message/MessageRenderer.tsx`（+ `.test.tsx`）
- `src/features/settings/components/ChatSettings.tsx`
- `src/store/themeStore.ts`

**关键 commits**：
- `9fc58a6` feat: add aggregateStepFinish option for step-finish display

---

### 3.10 文本选择浮窗 Quote/Copy 🟡

**目的**：在聊天面板选中文本时浮出 Quote 和 Copy 按钮，提升引用/复制体验。Quote 将选中文本转为 Markdown 块引用，插入当前面板输入框的光标位置；Copy 将原文写入剪贴板。

**关键设计**：
- 全局挂载一次（`App.tsx`），通过 `createPortal` 渲染到 `document.body`。
- `selectionchange` 仅维护 pending ref，浮窗在 `mouseup/touchend/Shift+Arrow keyup` 才提交，避免拖拽过程中闪烁。
- 定位依据鼠标/触摸释放点或键盘选择的 selection rect。
- 自动关闭条件：外部 pointerdown、scroll、resize、Escape 键。
- `data-pane-id` 添加到 ChatPane 根元素，使跨分屏面板的选择能解析到正确的 textarea。
- 过滤 `<input>` / `<textarea>` / `contenteditable` / `[data-no-selection-popup]` 内的选择。
- Quote 间距遵循 Slack/Notion 惯例（至少一个空行环绕块引用）。

**涉及文件**：
- `src/features/text-selection-popup/TextSelectionPopup.tsx`（+ `.test.tsx`）— 浮窗组件
- `src/features/text-selection-popup/popupUtils.ts`（+ `.test.ts`）— 工具函数
- `src/App.tsx` — 全局挂载
- `src/features/chat/ChatPane.tsx` — `data-pane-id`
- `src/locales/{en,zh-CN}/chat.json` — i18n

**关键 commits**：
- `51a0ec6` feat(text-selection-popup): Quote + Copy actions on chat text selection

---

### 3.11 队列消息输入栏 🟡

**目的**：当会话忙（`isSessionBusy`）时，用户发送的消息不再丢弃或静默排队，而是以 `QueuedFollowupDraft` 存储在 `followupQueueStore` 中，并在输入区域上方显示 `QueuedMessagesBar`，让用户知道消息已排队、等待发送。

**关键设计**：
- 忙时发送的消息包装为 `QueuedFollowupDraft`，keyed by session ID。
- 本地占位 `UIMessage`（ID 前缀 `queued_`）插入时间线，通过 `messageStore.upsertLocalMessage` 渲染为普通 `UserMessageView`（无视觉区分）。
- `QueuedMessagesBar` 显示在输入框上方，展示队列数量。
- `isSessionBusy` 变 false 时 effect 出队头消息、移除占位、走正常发送路径。

**涉及文件**：
- `src/features/chat/input/QueuedMessagesBar.tsx`（新增）
- `src/features/chat/ChatPane.tsx`、`InputBox.tsx`
- `src/hooks/useChatSession.ts`
- `src/features/chat/input/InputActions.tsx`

**关键 commits**：
- `bf61aef` feat(chat): replace queue placeholder messages with QueuedMessagesBar in input area

---

### 3.12 Cloudflare 部署 🟢

**目的**：fork 专属的 Cloudflare Pages + Workers 部署链路。上游无此部分，**理论上不会与上游冲突**（文件隔离），但 merge 后需确认 `pnpm-workspace.yaml` / `package.json` 的 workspace 声明没被上游覆盖。

**关键设计**：
- `workers/api-proxy/`：独立子包，用 wrangler 部署的 API 代理 Worker；**显式转发请求头**（`58f57ac`，标准 `RequestInit`）。
- CI 用 `pnpm --ignore-workspace` 让 api-proxy 独立安装，缓存键单独维护。
- Pages 用 `_routes.json` 优化路由（`be41fe7`），仅必要路径走 Functions。

**涉及文件**：
- `workers/api-proxy/`（`src/index.ts`、`wrangler.toml`、`package.json`、`tsconfig.json`、`vitest.config.ts`）
- `.github/workflows/deploy-worker.yml`、`deploy.yml`
- `docs/cloudflare-pages.md`
- `functions/`（Cloudflare Pages Functions）
- `pnpm-workspace.yaml`（声明 workers/api-proxy 为 workspace 成员）

**关键 commits**：
- `be41fe7` feat(cloudflare): optimize Pages deployment with `_routes.json`
- `356d8d5` fix(ci): repair deploy-worker pnpm cache on non-monorepo root
- `6cba3ad` fix(ci): use `pnpm --ignore-workspace` for isolated api-proxy
- `58f57ac` fix(worker): explicitly forward request headers via standard RequestInit
- `891a21d` docs(cloudflare): `pnpm install --ignore-workspace` for local api-proxy

---

## 4. 上游合并备忘

### 4.1 必然冲突的「热线」文件

以下文件被多个主题反复修改，且上游也频繁改动，merge 时几乎必冲突：

- `src/features/chat/ChatArea.tsx`（滚动 + 触摸 + 输入事件归因）
- `src/features/chat/InputBox.tsx`（移动端折叠 + 点击穿透）
- `src/features/chat/Header.tsx`（侧边栏 + 模型选择器）
- `src/features/chat/ChatPane.tsx`（多个主题接入 + data-pane-id + QueuedMessagesBar）
- `src/features/message/MessageRenderer.tsx`（per-block + aggregateStepFinish + entry-grow）
- `src/features/chat/virtual/useAutoScroll.ts`（滚动核心，几乎全量重写）
- `src/features/chat/input/QueuedMessagesBar.tsx`（新增，队列消息展示）
- `src/features/text-selection-popup/TextSelectionPopup.tsx`（新增，选中文本浮窗）

### 4.2 合并后自检清单

1. `pnpm install`（确认 `pnpm-workspace.yaml` 仍含 `workers/api-proxy`）
2. `pnpm test`（重点看 `useAutoScroll`、`blockCollapseMode`、`diffFormat`、`chatPageModel`、`TextSelectionPopup` 相关测试）
3. 移动端实测：输入框折叠/展开过渡、折叠点击穿透、水平翻页手势、textarea 高度跟随
4. 桌面端实测：模型选择器在输入栏、侧边栏「Open Project」、会话 header 工作区切换
5. 滚动实测：跟随/脱离/回弹、输入事件归因（空闲选择不打断跟随、capsule 流式不拽回）、新内容增长时位置保持
6. 文本选中浮窗：Quote/Copy 在各面板（含分屏）中的定位正确性、自动关闭
7. 队列消息：忙时发送后看到 QueuedMessagesBar、忙完自动发送
8. Cloudflare 部署链路（若该分支要发布）：`pnpm --ignore-workspace` 在 `workers/api-proxy` 可独立构建

### 4.3 维护本文档

每次 merge upstream 或新增 fork 主题后，**同步更新第 2、3 节**：新增主题补进概览表，已有主题追加 commits 和文件。保持「每个定制都有目的 + 文件 + commit」三元组，未来任何一次 merge 都能快速还原意图。
