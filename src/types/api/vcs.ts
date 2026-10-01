// ============================================
// VCS Types — OpenCode v2 原生
//
// v2 的 VCS 走 `vcs.*` 命名空间：get / base / status / branch.list / diff。
// 文件状态复用 FileDiffInfo 的形状（见 file.ts 的 VcsFileStatus）。
// ============================================

import type {
  FileDiffInfo,
  VcsBaseOutput,
  VcsBranchListOutput,
  VcsDiffInput,
  VcsDiffOutput,
  VcsGetOutput,
  VcsInfo,
  VcsStatusOutput,
} from '@opencode/client/promise'

export type { VcsInfo, VcsBaseOutput, VcsBranchListOutput, VcsDiffOutput, VcsGetOutput, VcsStatusOutput }

/** `vcs.diff()` 的模式（工作区 / 暂存 / 分支等） */
export type VcsDiffMode = NonNullable<VcsDiffInput['mode']>

/** v2 的文件状态：FileDiffInfo 去掉 patch */
export type VcsFileStatus = Omit<FileDiffInfo, 'patch'>
