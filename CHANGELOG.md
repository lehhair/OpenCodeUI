# Changelog

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
