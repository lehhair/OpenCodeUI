// ============================================
// VCS 类型（阶段 3a 迁移）
// ============================================
//
// ⚠️ 阶段 3a：`VcsDiffMode` **不再从 `v1Model` 转发**，改为就地定义 V2 的枚举。
//
// 枚举值不兼容（这是本次迁移最容易踩的坑之一）：
//   V1 `GET /vcs/diff?mode=`      → `git | branch`
//   V2 `GET /api/vcs/diff?mode=`  → `working | branch | committed`（契约：`Vcs.Mode`）
//
// 🔴 实测（v2.0.19 本机二进制）：传 V1 的 `git` → **400 InvalidRequestError
//    "Expected Vcs.Mode at [\"mode\"]"**。也就是说写错 mode 会**硬报错**，
//    不会静默返回空数据 —— 这点比目录参数友好。
//
// 语义对照（取自 V2 openapi 的官方 description）：
//   working   = "Diff HEAD to the working copy"            ← V1 的 `git`（未提交的工作区改动）
//   branch    = "base merge-base to the working copy"      ← V1 的 `branch`
//   committed = "base merge-base to HEAD"                  ← V1 没有对应物（本阶段无 UI 使用）
//
// ⚠️ UI 侧的「变更范围」是另一套概念，值仍是 V1 的 `git | branch | session | turn`
//    （`src/store/changeScopeStore.ts` 的 `ChangeScopeMode`）。
//    所以调用 `getVcsDiff()` 之前**必须把 `git` 翻译成 `working`** —— 见
//    `useFileExplorer.ts` 与 `SessionChangesPanel.tsx` 里的映射。

import type { VcsInfo as SDKVcsInfo } from './v1Model'

/**
 * V1 形状的 VCS 信息（`branch` / `default_branch`）
 *
 * 下游（`useVcsInfo` / `WorktreePanel` / `SessionChangesPanel` / `FolderRecentList`）
 * 全部按这个形状读，所以 `src/api/vcs.ts` 负责把 V2 的
 * `{ provider?, branch: { current?, default? } }` 映射回来。
 */
export type VcsInfo = SDKVcsInfo

/**
 * `GET /api/vcs/diff` 的 mode 取值（V2 的 `Vcs.Mode`）
 *
 * ⚠️ **不是** V1 的 `git | branch`，枚举值不兼容（见文件头注释）。
 */
export type VcsDiffMode = 'working' | 'branch' | 'committed'
