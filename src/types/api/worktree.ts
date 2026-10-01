// ============================================
// Worktree Types — OpenCode v2 原生
//
// v2 的 worktree 以 projectID 为作用域：
//   list({ projectID }) / create / remove / refresh
// 列表项是 `WorktreeDirectory { directory, strategy? }`。
// ============================================

import type {
  WorktreeCreateInput as V2WorktreeCreateInput,
  WorktreeDirectory,
  WorktreeList,
  WorktreeListInput as V2WorktreeListInput,
  WorktreeRefreshInput as V2WorktreeRefreshInput,
  WorktreeRemoveInput as V2WorktreeRemoveInput,
} from '@opencode/client/promise'

export type { WorktreeDirectory, WorktreeList }

/** 向后兼容别名：旧代码称单个 worktree 为 Worktree */
export type Worktree = WorktreeDirectory

export type WorktreeListInput = V2WorktreeListInput

export type WorktreeCreateInput = V2WorktreeCreateInput

export type WorktreeRemoveInput = V2WorktreeRemoveInput

export type WorktreeRefreshInput = V2WorktreeRefreshInput
