// ============================================
// Worktree API - Git Worktree 管理
// 基于 @opencode/client（OpenCode V2）: /api/worktree
// ============================================
//
// 阶段 3a 完成迁移（原先是 `notMigratedYet` 占位）。V2 与 V1 的差异：
//
//   1. 端点转正：`/experimental/worktree` → **`/api/worktree`**；
//      另外新增了 `POST /api/worktree/refresh`（本项目暂未使用，UI 靠事件刷新）。
//
//   2. 🔴 **作用域参数从 `directory` 改成 `projectID`**（这是本次迁移的核心改动）
//      → 每个操作前都必须先解析 projectID，见 `resolveProjectScope()`。
//        解析方式：`GET /api/location`（带 `location[directory]=…`）→ `location.project.id`。
//
//   3. 🔴 `POST /experimental/worktree/reset` **已删除**，V2 无替代能力
//      （`Worktree.Interface` 只有 list / create / remove / refresh）
//      → 阶段 3b 已把 `resetWorktree()` 与 UI 的「重置」按钮一并下架。
//
//   4. 语义差异（已核对 v1.4.14 与 v2.0.19 源码，写在这里避免以后重新踩）：
//
//      | 行为 | V1（v1.4.14 `packages/opencode/src/worktree/index.ts`） | V2（v2.0.19 `packages/core/src/worktree.ts`） |
//      |---|---|---|
//      | 删除 | 固定 `git worktree remove --force`，再 `rm -rf` 目录，再 `git branch -D` | 只做 `git worktree remove [--force]`，**不删分支、不 rm -rf** |
//      | 创建 | `git worktree add --no-checkout -b opencode/<name>`（**新建分支**） | `git worktree add --detach`（**游离 HEAD，不建分支**） |
//      | 创建位置 | 服务端数据目录 `…/worktree/<projectID>` | 默认同样是服务端数据目录（`worktree/<projectID 前 6 位>`） |
//      | 启动脚本 | 请求参数 `startCommand`（额外脚本） | **无该参数**，固定执行项目配置的 `commands.start` |
//
//      ⚠️ 因此删除 worktree 后，V1 会顺手删掉 `opencode/<name>` 分支，V2 不会 ——
//         残留的分支需要用户自己清理（属行为变化，不是 bug）。
// ============================================

import { getSDKClient } from './sdk'
import { locationInput } from './v2Convert'
import type { OpenCodeClient } from '@opencode/client'
import type { Worktree, WorktreeCreateInput, WorktreeRemoveInput } from '../types/api/worktree'

/**
 * 解析 location 作用域 → `{ sdk, projectID }`
 *
 * 🔴 这是 V2 worktree 迁移的关键：V1 用 `?directory=` 定位项目，V2 全部改成 `?projectID=`，
 *    而前端手里只有目录 → 必须先问 `GET /api/location` 拿到 `location.project.id`。
 *
 * ⚠️ 目录必须通过 `locationInput()` 传：
 *    不传时服务端**不会报错**，而是静默回落到它自己的 `process.cwd()` ——
 *    那样会解析出**另一个项目**的 projectID，然后对错误的项目做 list/create/remove。
 *    这是 V2 下最难查的一类 bug（HTTP 全 200）。
 *
 * ⚠️ 代价：每次操作多一次 `location.get` 往返。服务端这是内存查询，可以接受；
 *    如果以后发现 WorktreePanel 刷新过频，可在本函数加一层按目录的短 TTL 缓存。
 */
async function resolveProjectScope(
  directory: string | undefined,
  serverId: string | undefined,
  apiName: string,
): Promise<{ sdk: OpenCodeClient; projectID: string }> {
  const sdk = getSDKClient(serverId)
  const location = await sdk.location.get(locationInput(directory, serverId, apiName))
  return { sdk, projectID: location.project.id }
}

/**
 * 获取所有 worktree 列表
 *
 * V1: `GET /experimental/worktree?directory=…` → `Worktree[]`（`{name, branch?, directory}`）
 * V2: `GET /api/worktree?projectID=…`          → `Worktree.Directory[]`（`{directory, strategy?}`）
 *
 * ⚠️ 返回类型**故意保持 `string[]`**：调用方（`WorktreePanel`、`useGitWorkspaceCatalog`）
 *    只认目录字符串。V2 的 `strategy` 字段在这里被丢弃 —— 它只对服务端
 *    remove / refresh 的内部逻辑有意义，UI 不展示、也不需要。
 */
export async function listWorktrees(directory?: string, serverId?: string): Promise<string[]> {
  const { sdk, projectID } = await resolveProjectScope(
    directory,
    serverId,
    'GET /api/location（worktree 列表前置解析 projectID）',
  )
  const entries = await sdk.worktree.list({ projectID })
  return entries.map(entry => entry.directory)
}

/**
 * 创建新的 worktree
 *
 * V1: `POST /experimental/worktree` body `{ name?, startCommand? }`
 * V2: `POST /api/worktree`          body `{ projectID, from?, branch?, directory?, name? }`
 *
 * ⚠️ 两个 `directory` 含义完全不同，别搞混：
 *   - 第二个**位置参数** `directory`：V1/V2 的 **location 作用域**（「在哪个项目里操作」），
 *     只用来解析 projectID，**不会**传给服务端。
 *     （V1 也是这样：`POST /experimental/worktree?directory=…` 里的 directory 是作用域，
 *       创建位置由服务端数据目录决定 —— 所以这里不转发它，行为才和 V1 一致。）
 *   - `params.directory`：V2 的 **新 worktree 父目录**（「建到哪儿去」），原样透传。
 *
 * 返回内部 `Worktree` 形状（V2 的 `Worktree.Info` 只有 `directory`，`strategy` 不回传）。
 */
export async function createWorktree(params: WorktreeCreateInput, directory?: string): Promise<Worktree> {
  // params 里若已经带了 projectID 就直接用，省掉一次 location 往返
  const { projectID: providedProjectID, ...input } = params

  let sdk = getSDKClient()
  let projectID = providedProjectID
  if (!projectID) {
    const scope = await resolveProjectScope(
      directory,
      undefined,
      'POST /api/worktree 前置：GET /api/location 解析 projectID',
    )
    sdk = scope.sdk
    projectID = scope.projectID
  }

  const created = await sdk.worktree.create({ projectID, ...input })
  return { directory: created.directory }
}

/**
 * 删除 worktree
 *
 * V1: `DELETE /experimental/worktree?directory=…` body `{ directory }`
 * V2: `DELETE /api/worktree` body `{ projectID, directory, force }`（**三个字段都必填**）
 *
 * ⚠️ `force` 默认 **true**：V1 的实现里固定是 `git worktree remove --force`（v1.4.14 源码），
 *    所以默认 true 才与迁移前行为一致。
 *    显式传 `false` 时，工作区有未提交改动 / 未跟踪文件会被服务端拒绝，
 *    返回 `OperationError`（带 `forceRequired: true`）—— 那时 UI 可以提示用户二次确认，
 *    这个交互属**阶段 3b**。
 *
 * ⚠️ 第二个位置参数 `directory` 同 `createWorktree`：只是 location 作用域，不转发。
 *    （注意本函数里 `params.directory` 才是「要删哪个 worktree」。）
 */
export async function removeWorktree(params: WorktreeRemoveInput, directory?: string): Promise<boolean> {
  const { projectID: providedProjectID, directory: worktreeDirectory, force } = params

  let sdk = getSDKClient()
  let projectID = providedProjectID
  if (!projectID) {
    const scope = await resolveProjectScope(
      directory,
      undefined,
      'DELETE /api/worktree 前置：GET /api/location 解析 projectID',
    )
    sdk = scope.sdk
    projectID = scope.projectID
  }

  await sdk.worktree.remove({
    projectID,
    directory: worktreeDirectory,
    force: force ?? true,
  })
  // V2 的 remove 返回 204 无内容；这里保持调用方的 boolean 约定
  return true
}

// ⛔ 阶段 3b 已移除 `resetWorktree()`：
//   V2 删除了 `POST /experimental/worktree/reset`，且**没有替代能力**
//   （`Worktree.Interface` 只剩 list / create / remove / refresh）。
//   V1 的 reset 语义是「git reset --hard <默认分支> + git clean -ffdx」
//   ＝丢弃该 worktree 的全部本地改动；V2 下只能由用户手动进目录执行。
//   对应的 UI 入口（WorktreePanel 的「重置」按钮 + 确认弹窗）已一并删除。
