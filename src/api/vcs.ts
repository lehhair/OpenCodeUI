// ============================================
// VCS API - 版本控制信息
// 基于 @opencode/client（OpenCode V2）: /api/vcs/*
// ============================================
//
// V2 变化（迁移文档 §4.7）：
//   - `GET /vcs`      → `GET /api/vcs`（location 作用域）
//   - `GET /vcs/diff` → `GET /api/vcs/diff`（location 作用域 + mode 枚举改名，见下）
//   - 新增 `GET /api/vcs/status` —— 替代被 V2 删除的 `GET /file/status`，
//     实现在 `src/api/file.ts` 的 `getFileStatus()`（它属于「文件改动状态」，不是 VCS 信息）
//   - 新增 `GET /api/vcs/branch`、`GET /api/vcs/base`（本阶段未接入 UI）
//
// ⚠️ 两个端点都是 **location 作用域**：目录必须走 `locationInput()`（不要绕过）。
//    漏传不会报错 —— 实测服务端静默回落到它自己的 `process.cwd()`
//    （用 `opencode serve` 的启动目录验证过：不传 location 时返回的是启动目录的内容）。
//
// ── 阶段 3a 收尾 ───────────────────────────────────────────────────────
//   本文件原有 2 处 `notMigratedYet` 占位已全部落地。
// ============================================

import { getSDKClient } from './sdk'
import { locationInput } from './v2Convert'
import { normalizeFileDiffs } from '../types/api/file'
import type { FileDiff } from './types'
import type { VcsDiffMode, VcsInfo } from '../types/api/vcs'

/**
 * 获取 VCS 信息
 *
 * V2: `GET /api/vcs`（SDK：`vcs.get({ location })`）
 *     返回 `{ location, data: { provider?, branch: { current?, default? } } }`
 *     → 映射回 V1 形状：`branch.current` → `branch`，`branch.default` → `default_branch`
 *
 * ⚠️ **必须保留 V1 的「VCS 不可用 → null」语义**（V1 实现是 try/catch 吞掉异常后 return null）。
 *    实测 v2.0.19 有**两种**「不可用」形态，两条都要收敛成 null：
 *      ① 目录不是 git 仓库 → **HTTP 200** + `{"branch":{}}`（`current` / `default` 都是 undefined）。
 *         ⚠️ 这种情况**不抛异常**，所以只靠 try/catch 会把它当成「有 VCS」放过去，
 *         进而让 UI 显示一个空分支名 —— 必须再判 `branch.current` 是否存在。
 *      ② location 无效 / 服务端异常 → 4xx/5xx，SDK 抛 `ClientError` → 走 catch。
 *
 * 为什么返回值是 null 而不是空对象：下游 `useVcsInfo` / `SessionChangesPanel` 用
 * `vcsInfo?.branch` 判断「要不要显示分支徽章」，`{branch: undefined}` 与 `null` 表现一致，
 * 但 null 语义更明确（迁移前就是这个语义，保持不动）。
 */
export async function getVcsInfo(directory?: string, serverId?: string): Promise<VcsInfo | null> {
  try {
    const sdk = getSDKClient(serverId)
    const result = await sdk.vcs.get(locationInput(directory, serverId, 'GET /api/vcs'))

    // 形态 ①：非 git 仓库（200 + 空 branch）→ 视为「VCS 不可用」
    const current = result.data.branch?.current
    if (!current) return null

    return { branch: current, default_branch: result.data.branch?.default }
  } catch {
    // 形态 ②：4xx/5xx（保留 V1 的 try/catch 语义）
    return null
  }
}

/**
 * UI 的「变更范围」→ V2 的 `Vcs.Mode`
 *
 * 只有 `git` 需要改名：V1 的 `git`（HEAD ↔ 工作区）在 V2 叫 **`working`**；`branch` 两边同名。
 *
 * 为什么做成函数而不是在调用点写三元：`useFileExplorer` 与 `SessionChangesPanel`
 * 两处都要用，漏改/写错一处就是 400（实测 `mode=git` → `Expected Vcs.Mode`）。
 *
 * ⚠️ UI 侧还有 `session` / `turn` 两种变更范围，但它们**不走 VCS diff**
 *    （分别走会话快照 diff），所以不在这个映射里。
 */
export function toVcsDiffMode(mode: 'git' | 'branch'): VcsDiffMode {
  return mode === 'git' ? 'working' : 'branch'
}

/**
 * 获取 Git 或分支维度的 diff
 *
 * V2: `GET /api/vcs/diff`（SDK：`vcs.diff({ mode, location, base?, context? })`）
 *     返回 `{ location, data: FileDiffInfo[] }` —— 用现成的 `normalizeFileDiffs()`
 *     收敛成内部 `FileDiff[]`（它会过滤掉 `file` 为空的条目，V1 也是这么做的）
 *
 * 🔴 `mode` 是 V2 的 `working | branch | committed`，**不是** UI 侧的 `git | branch`：
 *    实测传 V1 的 `git` 直接 400（`Expected Vcs.Mode`）。
 *    调用方必须先把 UI 的 `git` 翻译成 `working` —— 见 `useFileExplorer.ts` / `SessionChangesPanel.tsx`。
 *
 * 不需要 try/catch：非 git 目录实测返回 200 + `data: []`（不报错），
 * 上层 `loadStatuses()` / `loadDiffMode()` 本来就把异常吞成空状态。
 */
export async function getVcsDiff(mode: VcsDiffMode, directory?: string, serverId?: string): Promise<FileDiff[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.vcs.diff({
    mode,
    ...locationInput(directory, serverId, 'GET /api/vcs/diff'),
  })
  return normalizeFileDiffs(result.data)
}
