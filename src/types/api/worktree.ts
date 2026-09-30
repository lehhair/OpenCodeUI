// ============================================
// Worktree 类型（OpenCode V2 形状）
// ============================================
//
// 阶段 3a：就地按 **V2 契约**重新定义（原先是从 `./v1Model` 转发 V1 类型）。
//
// 对应 `@opencode/client` 的：
//   `Worktree.Directory`     ← List 的元素
//   `Worktree.CreateInput`   ← 见下方「去掉了 projectID」
//   `Worktree.RemoveInput`   ← 见下方「projectID / force 改为可选」
//   `Worktree.Info`          ← Create 的返回（只有 directory）
//
// ⚠️ 为什么 projectID / force 在这里是**可选**的：
//    V2 的 SDK 类型要求调用方必填 `projectID`（List/Create/Remove 都按项目作用域），
//    但本项目 API 层手里只有**目录**，所以由 `src/api/worktree.ts` 负责
//    用 `GET /api/location` 把目录解析成 `location.project.id` 再补上。
//    `force` 同理：V2 必填，本层给了默认值（见 `removeWorktree` 的注释）。
//    → 业务代码（UI）只需要传它真正关心的字段，作用域参数由 API 层兜底。
// ============================================

// ⛔ 阶段 3b 已删除 `WorktreeResetInput` 的 V1 类型转发：
//   V2 删除了 `POST /experimental/worktree/reset`（无替代能力），
//   `resetWorktree()` 与 UI 的「重置」按钮已一并下架。
//   → 本文件现在**不再引用 `v1Model.ts` 的任何导出**（阶段 3b 收敛成果之一）。

/**
 * 一个 worktree 条目
 *
 * V1 的 `Worktree` 是 `{ name, branch?, directory }`；
 * V2 换成 `{ directory, strategy? }` —— **name / branch 不再由服务端记账**
 * （V2 的 `git worktree add --detach` 不建分支，所以没有 branch 字段可给）。
 *
 * `strategy`：该 worktree 由哪个策略创建（内置 git 策略或插件注册的策略），
 * 只参与服务端 remove/refresh 的内部逻辑，UI 不展示。
 */
export type Worktree = {
  directory: string
  strategy?: string
}

/**
 * 创建 worktree 的入参
 *
 * V2 的 `Worktree.CreateInput = { projectID, from?, branch?, directory?, name? }`。
 *
 * ⚠️ 字段含义容易搞混，务必看清：
 *   - `directory`：**新 worktree 的父目录**（即「建到哪儿去」）。
 *     不传时服务端回落到自己的数据目录 `…/worktree/<projectID 前 6 位>` ——
 *     这正是 V1 的行为（v1.4.14 `makeWorktreeInfo()` 用的就是 `Global.Path.data/worktree/<projectID>`）。
 *   - `from`：**复制来源目录**（默认项目根）。
 *   - V1 的 `startCommand` 在 V2 **不存在**：V2 总是自动执行项目配置里的 `commands.start`。
 */
export type WorktreeCreateInput = {
  /** 缺省时由 `src/api/worktree.ts` 用 `GET /api/location` 解析（V2 必填） */
  projectID?: string
  /** 复制来源目录，缺省为项目根 */
  from?: string
  /** 新分支名（只有插件策略会用；内置 git 策略是 `--detach` 游离 HEAD） */
  branch?: string
  /** 新 worktree 的**父目录**（不是它自己的路径） */
  directory?: string
  /** worktree 目录名，缺省由服务端生成随机 slug */
  name?: string
}

/**
 * 删除 worktree 的入参
 *
 * V2 的 `Worktree.RemoveInput = { projectID, directory, force }`（三个都必填）。
 * 这里 `projectID` / `force` 可省略，由 API 层补齐，见文件头说明。
 */
export type WorktreeRemoveInput = {
  /** 缺省时由 `src/api/worktree.ts` 用 `GET /api/location` 解析（V2 必填） */
  projectID?: string
  /** 要删除的 worktree 目录（服务端会 canonical 化后比对项目账本） */
  directory: string
  /**
   * 是否强制删除（`git worktree remove --force`）。
   * 缺省 **true** —— 与 V1 行为一致（V1 内部固定带 `--force`）；
   * 显式传 false 时，工作区有未提交改动会被服务端拒绝（`OperationError.forceRequired`）。
   */
  force?: boolean
}

/**
 * 重置 worktree 的入参 —— ⛔ 阶段 3b 已删除（V2 无该端点、无替代能力）。
 * 原先转发 `v1Model.ts` 的 `WorktreeResetInput`，现已随 `resetWorktree()` 一起下架。
 */
