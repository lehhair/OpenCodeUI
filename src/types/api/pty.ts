// ============================================
// PTY 类型（阶段 3a：就地定义，不再从 v1Model 转发）
// ============================================
//
// 为什么不再从 `./v1Model` 转发：
//   V2 的 `Pty` 与 V1 **字段不兼容** —— V1 用 `running: boolean` 表示「还活着」，
//   V2 换成了枚举 `status: 'running' | 'exited'`，并新增可选的 `exitCode`。
//   如果继续转发 V1 形状，API 层会「编译期以为有 running、运行期拿到 undefined」
//   —— 终端面板的存活判断会全部失效，而且**不报错**（最阴的一类 bug）。
//
// ⚠️ 不要删除 `src/types/api/v1Model.ts` 里的同名导出：
//   阶段 3 还有别的模块在用那一份，这里只是**不复用**它。
//
// 形状来源：openapi v2.0.19 `components.schemas.Pty`（已用真实服务实测一致）。
// ============================================

/** PTY 生命周期状态。V2 新增「已退出」终态（V1 只有一个布尔量） */
export type PtyStatus = 'running' | 'exited'

/**
 * PTY 会话（V2 形状）
 *
 * 与 V1 的差异：
 *   - `running: boolean`  → **`status: 'running' | 'exited'`**
 *     消费方判断「是否活着」要写 `pty.status === 'running'`，
 *     判断「已退出」写 `pty.status === 'exited'`。
 *   - 新增可选 `exitCode`（仅在 `status === 'exited'` 时由服务端给出）
 *
 * 实测样本（`POST /api/pty` 返回的 data）：
 *   { id, title, command, args, cwd, status: 'running', pid }
 */
export type Pty = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: PtyStatus
  pid: number
  /** 进程退出码；仅 `status === 'exited'` 时存在 */
  exitCode?: number
}

/**
 * 创建 PTY 的请求体（V2）
 *
 * 字段与 V1 完全同名同形状（`command?` / `args?` / `cwd?` / `title?` / `env?`），
 * 所以调用方（`App.tsx`、`BottomPanel.tsx`、`RightPanel.tsx` 传 `{ cwd }`）无需改动。
 */
export type PtyCreateParams = {
  command?: string
  args?: string[]
  cwd?: string
  title?: string
  env?: Record<string, string>
}

/** 终端尺寸。V2 与 V1 同名同形状（rows/cols），终端 resize 调用点零改动 */
export type PtySize = {
  rows: number
  cols: number
}

/**
 * 更新 PTY 的请求体（V2）
 *
 * ⚠️ 请求体形状没变，变的是 **HTTP 方法**：V1 `PATCH /pty/{id}` → V2 `PUT /api/pty/{ptyID}`
 * （SDK 内部已处理，`src/api/pty.ts` 的 `updatePtySession` 有注释说明）。
 */
export type PtyUpdateParams = {
  title?: string
  size?: PtySize
}
