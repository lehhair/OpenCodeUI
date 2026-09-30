// ============================================
// Permission API Functions
// 基于 @opencode/client（OpenCode V2）
// ============================================
//
// V2 变化（迁移文档 §4.3）：
//   - `GET /permission`                       → `GET /api/permission/request`（另有 `/saved` 已保存规则）
//   - `POST /session/{id}/permissions/{pid}`   → `POST /api/session/{id}/permission/{rid}/reply`
//                                                请求体改为 `{ decision, message? }`
//   - 🔴 `question.*` 三个端点**全部删除** → 改为全新的 **Form 表单体系**（见 `src/api/form.ts`）
//
// ── 🔴 `decision` 的枚举值以 openapi 为准（**不是** V1 惯性的那套）─────────────
//
//   `Permission.Reply`（openapi，v2.0.19 二进制导出）= `"once" | "always" | "reject"`
//   —— 与内部 `PermissionReply` 类型完全一致，所以**枚举值零改动**。
//   ⚠️ 但要注意语义：
//     - `once`   = 只允许这一次
//     - `always` = 允许并**保存规则**（对应 V2 的 `/api/permission/saved` 体系）
//     - `reject` = 拒绝（V1 里可能叫 `deny`，别混）
//
// ── 🔴 V2 的回复**必须带 sessionID** ───────────────────────────────────────
//   V1 有两条分支（有/无 sessionID），V2 的路径参数里就有 `{sessionID}`，
//   所以 `replyPermission` 在缺 sessionID 时会**显式抛错**，而不是发一个必错的请求。
//
// ── 载荷字段（阶段 2b 实测修正，已由 v2Convert.toInternalPermissionRequest 转换）──
//   V1 `permission`/`patterns`/`always`/`tool:{messageID,callID}`
//   V2 `action`    /`resources`/`save`  /`source:{type:'tool',messageID,id}`
// ============================================

import { getSDKClient } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { locationInput, toInternalPermissionRequest } from './v2Convert'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ApiPermissionRequest, PermissionReply, PermissionSavedRule, PermissionSavedListParams } from './types'

// ============================================
// Permission API
// ============================================

/**
 * 获取待处理的权限请求列表
 *
 * V1: `GET /permission`（可选 sessionId 过滤）
 * V2: `GET /api/permission/request`（**location 作用域**，返回 `{location, data: Permission.Request[]}`）
 *
 * ⚠️ 两点与 V1 不同：
 *   1. 端点**没有 sessionId 过滤参数** → 只能拉全量后在前端按 sessionID 过滤
 *      （`usePermissionHandler` / `useChatSession` 本来就是这么做的，所以调用方零改动）。
 *   2. `sessionId` 形参**保留但不再发给服务端** —— 只为不改调用点签名。
 *      ⚠️ 别以为传了它就能过滤，那样会静默拿到别的会话的请求。
 */
export async function getPendingPermissions(
  _sessionId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiPermissionRequest[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.permission.request.list(locationInput(directory, serverId, 'GET /api/permission/request'))
  return result.data.map(toInternalPermissionRequest)
}

/**
 * 回复权限请求
 *
 * V1: `POST /session/{id}/permissions/{pid}`，body `{ response, message? }`（且 sessionId 可选）
 * V2: `POST /api/session/{sessionID}/permission/{requestID}/reply`，body `{ decision, message? }`
 *
 * 🔴 `sessionID` 在 V2 是**路径参数**，必须提供 → 缺失时显式抛错（见文件头注释）。
 *
 * 形参顺序保持 V1 原样（`requestId, reply, message?, directory?, sessionId?, serverId?`），
 * 以免改动全部调用点；`directory` 在 V2 里**不需要**（session 作用域端点），仅用于多服务器定位。
 */
export async function replyPermission(
  requestId: string,
  reply: PermissionReply,
  message?: string,
  _directory?: string,
  sessionId?: string,
  serverId?: string,
): Promise<boolean> {
  if (!sessionId) {
    throw new Error(
      '[OpenCode V2] 回复权限请求必须提供 sessionID —— ' +
        'V2 的端点路径是 `POST /api/session/{sessionID}/permission/{requestID}/reply`，' +
        `没有 sessionID 就无法构造请求（requestID=${requestId}）。` +
        '调用方应从 `permission.asked` 事件载荷或 `GET /api/permission/request` 的返回里取 `sessionID`。',
    )
  }

  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.permission.reply({
    sessionID: target.sessionId,
    requestID: requestId,
    decision: reply,
    message,
  })
  return true
}

// ============================================
// 已保存的权限规则（V2 新增能力）
// ============================================
//
// 用户回复 `decision: 'always'` 时，服务端会把规则**保存**下来
// （`PermissionSaved.Info = {id, projectID, action, resource, time}`），
// 下次同类请求直接放行、不再弹窗。
//
// V1 **没有**「查看/删除已保存规则」的端点，所以这两个函数是**新增能力**。
// UI 入口暂不接（属可选优化，见阶段 3a 报告），但 API 先补齐以便：
//   ① 冒烟测试能验证 saved 体系真的可用；② 阶段 3b 做设置面板时直接可用。

/**
 * 列出已保存的权限规则
 *
 * @param params.projectID 可选：只看某个项目的规则（不传 = 全部项目）
 */
export async function listSavedPermissions(params: PermissionSavedListParams = {}): Promise<PermissionSavedRule[]> {
  const sdk = getSDKClient()
  // ⚠️ `permission.saved.list` 返回**裸数组**（已解包），不是 `{data}` 信封
  return sdk.permission.saved.list({ projectID: params.projectID })
}

/**
 * 删除一条已保存的权限规则
 *
 * ⚠️ 删除后该类请求会**重新开始弹窗**（不再自动放行）—— 这是「撤销『总是允许』」的唯一途径。
 */
export async function removeSavedPermission(id: string): Promise<void> {
  const sdk = getSDKClient()
  await sdk.permission.saved.remove({ id })
}

// ============================================
// Question → Form（迁移到独立模块）
// ============================================
//
// V1 的 `getPendingQuestions` / `replyQuestion` / `rejectQuestion` 三个函数**已删除**：
//   - `GET /question`            → `GET /api/session/{id}/form` + `GET /api/form`
//   - `POST /question/{id}/reply`→ `POST /api/session/{id}/form/{formID}/reply`
//   - `POST /question/{id}/reject`→ `DELETE /api/session/{id}/form/{formID}`
//
// 新实现全部在 `src/api/form.ts`（Form 是**新 UI 能力**，不是等价替换，
// 所以独立成模块、独立成渲染器，而不是塞进 permission.ts 里做别名）。
//
// 调用方迁移情况：
//   - `usePermissionHandler`：`pendingQuestionRequests` → `pendingForms`（FormInfo[]）
//   - `ChatPane`：`QuestionDialog` → `FormDialog`
//
// ⛔ 阶段 3b 已删除 question 的**交互**链路（`InlineQuestion.tsx` / `QuestionDialog.tsx` /
//    `InlineToolRequestContext.pendingQuestions` / 本文件里的 Question* 类型）。
//    ⚠️ 但**只读渲染器 `QuestionRenderer.tsx` 保留** —— V2 的 `question` 工具还在
//    （本地库有 54 条真实调用），详见该文件头部注释。

/** 仅供需要「V2 已无 question 体系」这一事实的调用方引用（错误文案统一在这里） */
export const QUESTION_REMOVED_IN_V2_NOTE =
  'V2 用 Form 表单体系取代了 question：' +
  '`GET /api/session/{id}/form`、`POST .../form/{formID}/reply`、`DELETE .../form/{formID}`。' +
  '请改用 src/api/form.ts 的 listSessionForms / replyForm / cancelForm。'

/** 便捷转出：把「目录」描述成给错误信息用的一行（保持与其它模块一致的写法） */
export function describeDirectory(directory?: string, serverId?: string): string {
  return formatPathForApi(directory, serverId) ?? '(未指定)'
}
