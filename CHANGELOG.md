# Changelog

## [v0.4.1] - 2026-04-03

- fix: disable split-pane entry points on small touch screens (3c1a607)

## [v0.4.0] - 2026-04-03

- fix: align request dialogs with the input dock width (59b5962)
- perf: fix memo-defeating patterns in message rendering pipeline (f678d36)
- fix: stabilize ChatPane tree structure across fullscreen toggle (79b28f1)
- fix: preserve DOM across pane fullscreen toggle and hide split button in fullscreen (13c7f5e)
- fix: keep split resizing off the render path (750dd50)
- fix: normalize panel PTY restoration and dedupe terminal tabs (d1b4565)
- feat: add pane fullscreen mode and refine split header actions (cf959e0)
- fix: remove split container transition side effects (5332f61)
- fix: stabilize split-pane header interactions (6631e01)
- refactor: streamline split-pane chrome and transitions (cdb4a8b)
- fix: avoid first-frame tool expansion flicker on session switch (a71dea2)
- refactor: finish pane-first cleanup and auto-approve wiring (8af9e57)
- fix: unify router state and focused-pane directory sync (2cbb177)
- refactor: remove legacy focused-session compatibility layer (e4d0616)
- refactor: unify chat shell around focused pane state (e45dd17)
- fix: sidebar selectedSessionId follows focused pane in split mode (a82abaf)
- fix: isolate per-pane state — fullAutoMode, agent selection, session eviction, clearSession (18bc9af)
- fix: prevent duplicate SSE subscriptions in split-pane mode (e15ad08)
- feat: add split-pane UI with full-parity ChatPane, SplitContainer, PaneHeader, SplitToolbar (3af6b14)
- refactor: parameterize useChatSession for multi-instance support (1b37d8d)
- refactor: make session infrastructure multi-instance ready (e0ce47d)
- fix: hide assistant fork action when no text can be copied (f734462)
- fix: keep composer action blur out of transform layers (6eb3bf0)

## [v0.3.8] - 2026-03-31

- feat: add fullscreen button to file preview and changes diff preview (9e4ca2d)
- feat: enable fork from assistant messages to preserve AI replies (f2a0079)
- refactor: unify floating component shadows to a consistent two-tier system (shadow-sm / shadow-lg) (1cf526e)
- chore: upgrade dependencies (vite 8, i18next 26, lucide-react 1.x, etc.) (41498bf)
- fix: adjust ModelSelector padding so scrollbar doesn't overlap list content (e7d6e4f)
- refactor: unify ModelSelector into a single component for both PC and mobile (5b81638)
- fix: sync session title to messageStore on SSE update for real-time header refresh (b74bb6a)
- fix: align mobile header toggle spacing (1052826)

## [v0.3.7] - 2026-03-28

- fix: remove double border on attachment meta when no content preview (d29a2f4)
- fix: hide floating actions (undo/redo/permission) during todo panel swap (a3a7231)
- fix: apply glass effect to mobile collapsed capsule (2075818)
- fix: fallback fetch after send to prevent missing user message on SSE drop (e2138df)
- fix: skip overlay scrollbar on elements with no-scrollbar class (506cf24)
- feat: child sessions displayed under parent in sidebar with toggle for always-show (97ce7d8)
- feat: add diff toggle for folder recents (a1ed95e)
- fix: wire compact model selector to global shortcut (d14fb42)

## [v0.3.6] - 2026-03-28

- test: add chatViewport mock to InputBox and InputToolbar tests (7eb80ac)
- fix: remove unused let binding in overlayScrollbar (ab9eaba)
- feat: add horizontal overlay scrollbar support (ad8d21d)
- refactor: rewrite outline index with visual config, focus-based interaction and entry windowing (18bccf9)
- fix: align compact model selector trigger (480dd04)
- refactor: centralize chat viewport state (8512fcb)
- fix: improve coarse pointer support in desktop UI (4cfc8e5)

## [v0.3.5] - 2026-03-27

- fix: use previous stable tag for release changelog (b00cff7)
- fix: load chat header title from session detail (0b8443c)
- fix: stabilize chat history loading scroll behavior (87190c6)
- fix: animate todo panel swap without layout jank (ca8a672)
- feat: add frosted glass toggle in appearance settings (662070c)
- fix: apply overlay scrollbar to textarea, hide all native scrollbars (5dce51f)
- fix: frosted glass not rendering in Tauri production build & overlay scrollbar positioning (96e72c1)
- feat: replace native scrollbars with global overlay scrollbar system (da09781)
- refactor: simplify @ and / menus with cleaner layout and unified style (f5bddec)
- refactor: redesign ModelSelector for glass aesthetic (33a9dd2)
- refactor: unify frosted glass system with CSS utility classes (0e459f9)
- style: introduce frosted glass effect to all floating surfaces (ae10178)
- fix: remove extra padding from message toggles (4eb916a)

## [v0.3.4] - 2026-03-24

- fix: align markdown copy buttons with header text (80e59ce)
- fix: render markdown images without streamdown wrapper controls (650851f)
- fix: remove code size-based rendering limits (42171e7)
- fix: remove contain-intrinsic-size that caused scroll jank (7942144)

## [v0.3.3] - 2026-03-24

- fix: resolve TypeScript errors in MarkdownRenderer for release (1abcdf1)
- fix: exclude task tool from compact inline permission mode (5f39aff)
- style: remove left accent line from TaskRenderer, restore badge status colors (1cb6044)
- style: refine TaskRenderer visual hierarchy (263b74b)
- fix: show tool description from input while running, not just after completion (b65d16e)
- fix: reduce excessive right padding in expanded reasoning content (885668d)
- fix: panel dropdown menu hover overflow — use inset padding with rounded items (02653bf)
- fix: table copy button pinned outside scroll, mobile always-visible copy buttons (2cdef17)
- style: unify tool output header height to h-8 (32px) (c566b1a)
- style: unify message flow border-radius to a tighter 3-tier system (4a8a89f)
- refactor: redesign markdown code blocks, tables, and inline code styles (11f6222)

## [v0.3.2] - 2026-03-24

- fix: align fullscreen diff test mocks with typed children (fdf1a74)
- fix: restore release validation after fullscreen refactor (ef2d755)
- fix: adjust outline index spacing for visual balance (fb98097)
- refactor: unify fullscreen components into generic FullscreenViewer (9e6d8ed)
- refactor: redesign settings UI with section-based layout and cleaner primitives (478351a)

## [v0.3.1] - 2026-03-23

- fix: unify chevron arrow direction - collapsed points right, expanded points down (3557e5a)
- feat: compact inline permission - hide duplicate content when tool body already renders (63d571b)
- refactor: redesign descriptive steps summary - merge categories, per-category errors, truncation (870f490)
- fix: move diff stats next to title and remove exit code from descriptive steps (74e69c0)
- fix: deferred permission unmount and multi-select question answer parsing (a8dc9bd)
- fix: auto-expand readable tools that finish instantly in immersive mode (06dd4d4)

## [v0.3.0] - 2026-03-22

- fix: lint warnings, error tool diff stats, descriptive steps partial error coloring (ea53836)
- feat: add diff stats summary to descriptive steps, fix write tool diff display (ce29807)
- fix: immersive mode keeps non-readable tool groups collapsed even during execution (be61de2)
- fix: resolve lint errors and remove unused eslint-disable directives (6037d19)
- feat: add immersive mode with smart tool expand/collapse (0d4252d)
- fix: skip QuestionRenderer when user dismissed or error (2029584)
- feat: add QuestionRenderer with InlineQuestion-style read-only answered view (207f0c6)
- fix: allow long bash commands to wrap in terminal view (8a7ddfd)
- simplify: BashRenderer remove buttons, click command to copy, inline exit code (72186b5)
- refactor: BashRenderer with fixed bottom bar, exit code, fullscreen, mobile-friendly buttons (cb7bb70)
- fix: restore height limit and fullscreen button in compact mode (8f8689d)
- feat: add BashRenderer with terminal style, Shiki highlighting, ANSI color support (856d74d)
- feat: descriptive steps default collapsed, show output status on tool row (b25a0f2)
- refactor: unify InlinePermission with tool output style, remove unused inline variant (ac510d7)
- feat: add compact tool output mode (hide input, no collapse, no height limit) (1036133)
- feat: add descriptive tool steps mode (d7e153f)
- refactor: remove ambient tool mode and make inline requests opt-in (06034a2)

## [v0.2.10] - 2026-03-21

- feat: restore forked prompts in the composer (0792cf6)
- fix: keep folder recents aligned with live updates (a0c8899)
- fix: improve long duration formatting (62e6d94)

## [v0.2.9] - 2026-03-19

- fix: preserve custom audio when switching to builtin sounds (57119da)
- fix: resolve all eslint warnings across codebase (4b31da3)
- feat: add notification sound system with per-event configuration (b6019e2)
- perf: defer offscreen chat message rendering (52d8ba8)
- refactor: unify file and changes preview panels (9f315d8)

## [v0.2.8] - 2026-03-18

- fix: wrap panel tab label case blocks (d353b80)
- feat: expand right panel resize range (3e67623)
- feat: add tabbed session changes workspaces (ace0259)
- feat: add tabbed file preview workspaces (ffad629)
- fix: stabilize mobile terminal toolbar layout (1eb23b7)
- feat: refine mobile terminal extra keys behavior (6e04254)
- feat: add mobile extra keys toolbar for terminal (Termux-style) (2b185ac)
- feat: show collapsed folder activity status (0bd1378)
- feat: mark completed sessions as unread in recents (90cf8c3)

## [v0.2.7] - 2026-03-18

- feat: add markdown reasoning display mode (20fa476)
- fix: avoid action overlap in folder recents on mobile (83b40b9)
- feat: animate folder recents expansion (1b8ea13)
- fix: preserve folder recents expansion across tab switches (058c289)
- fix: limit streaming layout animation to bottom-follow mode (95c6aca)
- fix: restore reasoning thinking shimmer transition (5c631c8)
- feat: refine reasoning markdown presentation (71a012a)
- fix(chat): extract formatDuration to shared formatUtils (c405092)
- fix(chat): preserve aborted turn durations (13633fb)
- feat: add diff gutter style setting (markers vs change bars) (4c5e7b8)
- fix(i18n): improve permission dialog labels for request/rule clarity (e3730d5)
- refactor: replace react-markdown with Streamdown for streaming-optimized markdown rendering (fcf3307)
- refactor: extract useResponsiveMaxHeight hook for shared viewport-aware sizing (1993eb8)
- fix: make ContentBlock maxHeight responsive to viewport size (b584071)
- fix: resolve drag-to-reorder race condition causing stale closures (b08a763)

## [v0.2.6] - 2026-03-17

- refactor: redesign folder recents with drag-to-reorder and compact session items (88b4139)
- fix: resolve bugs introduced by Python-to-Rust router migration (335b82e)
- refactor: migrate gateway router from Python to Rust (290087f)
- Feature: Add ability for router to read config from environment variables (bddc46b)
- refactor: create new Rust project opencodeui-router (dd96377)
- Update image previews in README.md (be84586)
- fix: 服务器编辑/删除按钮始终可见 (0037a17)

## [v0.2.5] - 2026-03-16

- fix: 修复胶囊按钮和弹窗 header 图标与文字对齐 (a65e34e)
- fix: 工具 icon 光晕不再被父容器裁切 (c946f19)
- fix: 移动端设置 tab 选中态被 overflow 裁切 (027fcf9)
- refactor: 设置界面优化 — 修复双滚动条、服务器编辑/删除确认 (ec75fad)
- fix(i18n): 保留开发者工具常见英文术语不翻译 (f4a6022)
- fix(i18n): 修正中文翻译质量 (f2bd269)
- feat: add full i18n support with react-i18next (en + zh-CN) (bcd9850)

## [v0.2.4] - 2026-03-16

- fix: 会话级 Full Auto 恢复原有行为 — 只在当前所在页面的 session 生效，切走后不再自动放行 (e98bd4e)
- fix: Full Auto 全局模式在 SSE 事件层拦截，确保非当前会话的权限请求也能自动放行 (1046837)
- feat: Full Auto 三态模式 — 单击循环 off/会话级(黄)/全局(红)，会话级只放行当前会话，全局放行所有，纯内存刷新即清 (db95fc7)
- fix: 去掉 steps header 入场动画，保持与其他元素一致不做特殊处理 (1e725a5)
- fix: 虚拟滚动横向滚动条修复 — 去掉 probe 元素改用 scrollWidth 历史最大值追踪，SplitDiffView proxy scrollbar 加 gutter 占位对齐 (beee631)

## [v0.2.3] - 2026-03-15

- fix: probe 最长行选取改用 monoDisplayWidth 估算渲染宽度，CJK/全角字符按双倍计，修复含中文注释时横向滚动不到位 (d1fb35a)
- Revert "fix: probe 元素去掉 overflow:hidden 修复横向滚动不到位 — hidden 在两个方向截断内容导致 scrollWidth 偏小" (0e5353f)
- fix: probe 元素去掉 overflow:hidden 修复横向滚动不到位 — hidden 在两个方向截断内容导致 scrollWidth 偏小 (c9788fc)
- fix: lint warnings — ref 写入移入 useEffect，CodePreview 提取 tokens 避免 render 期间读 ref，修复 CodePreview 测试，清理多余依赖和 eslint-disable (96955f7)
- fix: 消除胶囊⇄输入框切换闪烁 — FloatingActions 改为同一 DOM 切换定位避免 remount，胶囊去掉入场动画和防抖回归纯 UI (bc3cc0c)
- fix: 移动端胶囊⇄输入框过渡优化 — 胶囊退场不延迟避免与输入框重叠闪烁，收起方向加 120ms 防抖消除滚动边界抖动 (4060e83)
- refactor: 统一动画体系 — UndoStatus 去自带动画改由 PresenceItem 控制，CollapsedCapsule 从 CSS animate-in 换成 usePresence，PresenceItem 加 shrink-0 防挤压，清理 CSS 死代码 (5106ac0)
- fix: probe 元素精确撑开 scrollWidth 修复横向滚动不到位，去掉 backdrop-blur (0f3b764)
- Revert "fix: 代码预览/diff 横向滚动重构 — CodePreview/UnifiedDiffView 改原生滚动+sticky gutter，SplitDiffView 用 probe 元素精确撑宽，去掉 backdrop-blur" (9d12d72)
- fix: 代码预览/diff 横向滚动重构 — CodePreview/UnifiedDiffView 改原生滚动+sticky gutter，SplitDiffView 用 probe 元素精确撑宽，去掉 backdrop-blur (9e37646)
- feat: usePresence hook + 浮动按钮/权限框/提问框入场退场动画 — 命令式 animate() 零额外 bundle (fb8c59f)
- fix: 消息流底部间距增大，为浮动按钮预留空间 (7f32fa2)
- fix: 删除 Output 的 Running... 文字，Input/Output spinner 统一无文字对齐 (e8c409e)
- fix: 单工具调用始终 compact 布局，消除流结束时的缩进跳变 — SmoothHeight 平滑过渡 + steps header 入场动画 (031502f)
- fix: 代码预览和 diff 行号背景色统一 — gutter 去掉硬编码背景，继承父容器颜色 (9ef8223)

## [v0.2.2] - 2026-03-15

- ci: 恢复 codegen-units=1 减小产物体积，Rust cache 按平台隔离，精简工作流 (5018e3b)
- chore: 清理 suppressAutoScroll 死代码 (d47085e)
- fix: loadMore 不跳变 — 去掉 inner wrapper，消息反序直接作为 flex 子元素，prepend 时临时禁用 content-visibility (657e7a4)
- refactor: 用 column-reverse 替代 ResizeObserver 实现原生 stick-to-bottom (591a8eb)
- refactor: DiffView 复用 DiffViewer 组件，删除 150 行重复 diff 渲染代码 (e78d987)

## [v0.2.1] - 2026-03-14

- refactor: 用 ResizeObserver 替代 RAF 轮询实现流式自动滚动 (10d9e6a)
- fix: 空消息不参与可见列表，消除 abort 时的滚动跳变 (9dbaa4d)

## [v0.2.0] - 2026-03-14

- feat: RECENTS 列表标记活跃 session 状态 (closes #25) (98ecce9)
- fix: motion animate() 类型歧义 — 改用 motion/mini 单签名 API 解决 tsc -b TS2769 (7927bcf)
- fix: 移除 ContentBlock loading skeleton 骨架条，避免输出短于占位时的负增长跳变 (f6db986)
- feat: 消息入场生长动画 — 用户和助手消息统一从 height 0 平滑展开 (ce055fb)
- fix: SmoothHeight 激活时锁定 outer 高度，修复动画不触发的问题 (e5f6cf5)
- feat: 命令式 animate() 动画方案 — 高性能 + 零 React 组件开销 (4481aba)
- fix: 修复流结束后闪烁回弹问题 (192944e)
- fix: 修复流式文本不实时渲染的问题，移除 useSmoothStream (005b6bf)
- refactor: 连续助手消息分组渲染，共享容器浑然一体 (cfadad0)
- Revert "fix: 复制按钮始终占位，避免 text 到达时布局跳变" (1af197a)
- fix: 移除未使用的 hasMoreHistory 解构变量，修复 TS6133 编译错误 (cf9419b)
- fix: 复制按钮始终占位，避免 text 到达时布局跳变 (d51e7a8)
- fix: 移除 'Beginning of conversation' 常驻提示，仅保留加载中 spinner (11484c6)

## [v0.1.18] - 2026-03-13

- ci: 加速 release 编译 — Rust 多线程 codegen + Android 双架构并行 (2398c54)
- fix: FloatingActions 高度抖动、滚动按钮误显示 (466f4ea)
- refactor: gutter/content 分离架构 + 水平滚动独立化 + FullscreenViewer 确定高度 (e327e59)
- perf: streaming 渲染地基优化 — rAF 滚动、delta 批量化、布局稳定性 (f689910)

## [v0.1.17] - 2026-03-11

- fix: update CodePreview test mock to use useSyntaxHighlightRef (a10075f)
- fix: move history loading indicator below top spacing so it's visible (4cfc71c)
- fix: remove MAX_HISTORY_MESSAGES cap and restore loading UI (43d2273)
- perf: reduce sidebar resize lag with CSS containment and DOM-only sidebar drag (63bc0c5)
- fix: enable virtual scrolling in CodePreview by adding height constraint (43c9e3a)
- fix: mobile input collapses when tapping FloatingActions buttons (a777334)
- refactor: simplify loadMore pagination and remove prependedCount (8614df4)
- refactor: rewrite messageStore and ChatArea, remove IndexedDB cache layer (eecdeaf)
- refactor: remove loading spinners/skeletons and reduce scroll-related re-renders (eb7ebff)

## [v0.1.16] - 2026-03-11

- fix: scroll jitter after streaming ends caused by content-visibility height mismatch (765052a)
- fix: stop auto-scroll jitter when user scrolls slightly during streaming (171a62e)

## [v0.1.15] - 2026-03-10

- fix: default revertSteps to 0 in FloatingActions (400fbb4)
- chore: bump version to 0.1.15 (3f57df2)
- fix: slow scroll during streaming causes jitter by pulling user back to bottom (860683e)
- fix: isFocused stuck after toolbar button click prevents capsule collapse (aaaa727)
- refactor: extract FloatingActions and CollapsedCapsule components from InputBox (273bd98)
- refactor: extract useInputHistory hook from InputBox (d920da9)
- refactor: extract useAttachmentRail hook from InputBox (2150d82)
- refactor: extract useMobileCollapse hook from InputBox (c5fd39b)
- fix: mobile input capsule state not resetting on session switch + blur collapsing on toolbar interaction (474938e)

## [v0.1.14] - 2026-03-10

- fix: session switch scroll + eliminate all content flicker during load (d823799)
- fix: infinite history loading loop + stabilize observer + cleaner scroll-to-bottom (fe28777)
- fix: smooth shimmer gradient + disable browser scroll restoration + multi-frame scroll-to-bottom (2144260)
- fix: shimmer highlight sweep + remove unused visibleMessageIds state (ae767ca)
- fix: outline click retract, prepend scroll preservation, cross-message merge continuation (e3ca11a)
- fix: desktop label click navigation + mobile passive touch events in OutlineIndex (f35f758)
- refactor: rewrite OutlineIndex with clean fisheye engine (1057c1c)
- refactor: replace react-virtuoso with native scroll + content-visibility (2dc550a)
- fix: correct shimmer animation direction (left-to-right) and use linear timing (16bc419)
- fix: endsWithTool skips empty reasoning/text so cross-message tool merging works correctly (fdedbcd)
- style: replace thinking breath-bar with shimmer text animation in italic mode (1bed06b)

## [v0.1.13] - 2026-03-10

- fix: SSE reconnect race conditions and stale timeout constant (7614d53)
- test: add unit tests for HTTP module and Tauri environment detection (79b77af)
- chore: eliminate all 8 lint warnings (0 errors, 0 warnings) (b312bb6)
- fix: URL-encode query string values in buildQueryString (f6a434e)
- fix: add AbortController-based timeout to HTTP request() (7962278)
- fix: pending permission/question cache supports multiple requests per session (b421172)
- fix: SSE parser now handles CRLF line endings and multi-line data correctly (d4553d5)
- chore: remove dead storage key exports (WIDE_MODE, THEME_MODE, SIDEBAR_WIDTH, MODEL_VARIANT_PREFIX) (2901c99)
- refactor: replace bare console.error with unified error handlers across 14 files (7a0c86c)
- refactor: move theme/wideMode into themeStore, eliminate prop drilling through Sidebar and SettingsDialog (9c8b2d7)
- refactor: split messageStore into store, types, and React hooks layers (caef036)
- refactor: extract App.tsx hooks (useViewportHeight, useCancelHint, useCloseServiceDialog) (2dd70e3)
- refactor: split SidePanel into focused sidebar components (673db54)
- refactor: extract InputBox utility functions to input/inputUtils.ts (a1c0eee)
- refactor: split SettingsDialog into focused component files (72f5ed4)
- refactor: consolidate duplicated formatting functions into utils/formatUtils.ts (a981c89)
- refactor: deduplicate diff content extraction (fad37d4)
- refactor: extract ModalShell to unify modal overlay infrastructure (ae9f96e)
- chore: remove unnecessary eslint-disable in logger.ts (118740c)
- chore: clean up dependencies (0c50ac0)
- refactor: add dev-only logger, replace bare console.log with logger.log (91fc303)
- refactor: remove dead code files (test-shiki.ts, editorUtils.ts, toolUtils.ts) (3a3f37a)

## [v0.1.12] - 2026-03-09

- fix: preserve changelog ordering during release prep (039b906)
- chore: ignore generated tauri assets in lint (071e2db)
- fix: keep slash command composer responsive (42cdcf6)
- fix: restore cross-platform Tauri app handling (6b84717)
- perf: replace std default hasher with rapidhash (c6d5bdb)
- refactor: reorganize the file structure of Tauri backend (fa5edf6)
- perf: refactor OpenDirectoryState with papaya HashMap to reduce lock contention (6efd2a0)
- perf: optimize ServiceState.child_pid with AtomicU32 to reduce Mutex contention (a42df0b)
- perf: optimize SseState implementation - replace Mutex+Hashmap with papaya library to reduce contention and improve performance (f586a84)

## [v0.1.11] - 2026-03-08

- feat: add an optional folder-style Recent view while preserving the original session row details and per-folder ordering controls
- feat: aggregate Active sessions across all saved projects instead of limiting the list to the currently selected directory

## [v0.1.10] - 2026-03-08

- fix: harden session message sync and failed sends (b788dce)
- chore: add validated release preparation flow (010ffbe)
- docs: consolidate v0.1.9 release notes (79113da)

## [v0.1.9] - 2026-03-08

- fix: restore message attachment expand animation (2975fe3)
- fix: streamline composer attachment rail interactions (99db58a)
- fix: constrain expanded attachments and preserve composer blank lines (dd2d7ba)
- fix: harden composer attachment rail scrolling (b2bac29)

## [v0.1.7] - 2026-03-08

- fix: truncate tool description overflow in tool call row (3782c67)
- fix: tighten mobile model menu and attachment width (60b34a2)
- fix: preserve utf-8 across tauri stream chunks (1dcb15a)

## [v0.1.6] - 2026-03-07

- fix: restore tauri mobile file attachments (ffe3398)

## [v0.1.5] - 2026-03-07

- chore: keep tauri config formatted on release (48f6045)
- fix: sync settings version with app release (b815d18)
- chore: format release workflow (aef533b)
- ci: add build validation workflow (491a544)
- other: add "zed/\*" as ignored file (8f32b7d)

## [v0.1.4] - 2026-03-07

- fix: split frontend and api slash commands (bdb2e33)
- fix: support clipboard fallback in insecure contexts (edf4dd0)
- fix: align slash command descriptions (9d84a78)

## [v0.1.3] - 2026-03-07

- chore: restore release workflow formatting (73a41a4)
- perf: split code preview from file explorer (b94bfc5)
- perf: lazy load optional panels and split vendor chunks (9e0f7d6)
- chore: add test baseline and clean lint debt (0d5f175)
- chore: establish lint and formatting baseline (762786d)
- fix: shorten input footer disclaimer copy (d691b7b)
- chore: automate lockfile updates in release script (e678349)

## [v0.1.2] - 2026-03-07

- fix: scope active session state to the current directory (2503c6b)

## [v0.1.1] - 2026-03-07

Patch release focused on chat input polish, session list consistency, and smoother permission handling.

### Fixes

- Restored collapsed input dock bottom spacing
- Kept the session list in sync across directory filters and live updates
- Returned gracefully to a new chat after deleting the currently open session
- Aligned the todo popover with the input dock for desktop and mobile
- Removed extra polling from permission/question flows and synced reply state immediately

### Improvements

- Preloaded `@` root listing and `/` command data when entering a session to reduce first-open lag

## [v0.1.0] - 2026-03-05

First stable release of OpenCodeUI.

### Features

- Drag-and-drop file attachment support (desktop & mobile)
- Material file icons for file/folder display
- File @mention from explorer sidebar
- Context breakdown visualization in sidebar
- Live retry status display with expand/collapse
- Attachment detail viewer with copy/save functionality
- Capability-based file attachment upload

### Fixes

- Aligned capsule thinking chevron with italic/tool toggle arrows
- Stabilized Tauri desktop file drag-and-drop handling
- Fixed multiple task windows rendering the latest child session
- Eliminated scroll jank from high-frequency re-renders
- Fixed mobile overflow in project and diff headers
- Fixed sidebar notification/session meta row overflow
- Fixed attachment pill truncation and compact tool layout

### Improvements

- Migrated all icons to lucide-react
- Unified message part spacing and alignment
- Added Docker support with material icons build step
