# Changelog

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
