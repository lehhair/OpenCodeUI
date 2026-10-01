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
} from '@opencode/client/promise'

export type Pty = V2Pty

/** PTY 尺寸（update 入参里的 size） */
export type PtySize = { rows: number; cols: number }

/** `pty.create()` 入参 */
export type PtyCreateParams = V2PtyCreateInput

/**
 * `pty.update()` 的可变字段。
 *
 * v2 的 PtyUpdateInput 还包含 ptyID 与 location，但那两项由
 * api/pty.ts 的封装函数负责填，调用点只需给 title / size。
 */
export type PtyUpdateParams = {
  title?: string
  size?: PtySize
}

/** `config.shells()` 返回的可用 shell 列表 */
export type ShellList = ConfigShellsOutput
