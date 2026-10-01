// ============================================
// PTY Types — OpenCode v2 原生
//
// v2 的 PTY 统一为 `Pty`，状态是 `running | exited`。
// v1 的 `pty.shells()` 在 v2 移到 `config.shells()`。
// ============================================

import type {
  ConfigShellsOutput,
  Pty as V2Pty,
  PtyCreateInput as V2PtyCreateInput,
  PtyUpdateInput as V2PtyUpdateInput,
} from '@opencode/client/promise'

export type Pty = V2Pty

/** PTY 尺寸（update 入参里的 size） */
export type PtySize = { rows: number; cols: number }

/** `pty.create()` 入参 */
export type PtyCreateParams = V2PtyCreateInput

/** `pty.update()` 入参 */
export type PtyUpdateParams = V2PtyUpdateInput

/** `config.shells()` 返回的可用 shell 列表 */
export type ShellList = ConfigShellsOutput
