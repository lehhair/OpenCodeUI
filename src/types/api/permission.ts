import type { PermissionRequest as SDKPermissionRequest } from './v1Model'

export type PermissionToolInfo = NonNullable<SDKPermissionRequest['tool']>

export type PermissionRequest = SDKPermissionRequest

/**
 * 权限回复的判定值
 *
 * ⚠️ **阶段 3a 核实**：V2 的 `Permission.Reply` 枚举（openapi）是
 * `"once" | "always" | "reject"` —— 与本类型**完全一致**，无需改动。
 * （这条是任务点名要「以 openapi 为准、别照 V1 惯性」的地方：结果是 V1 与 V2 相同，
 *   真正变了的是**载荷字段名**与**必须带 sessionID**，不是枚举值。）
 */
export type PermissionReply = 'once' | 'always' | 'reject'

/**
 * 已保存的权限规则（V2 新增能力）
 *
 * 来源：`GET /api/permission/saved` → `PermissionSaved.Info[]`
 *   `{ id, projectID, action, resource, time: { created, updated } }`
 *
 * V1 没有对应物 —— 「总是允许」的规则在 V1 里既看不到也删不掉。
 */
export interface PermissionSavedRule {
  id: string
  projectID: string
  /** 权限类别（V2 的 `action`，V1 叫 `permission`） */
  action: string
  /** 匹配的资源（V2 的 `resource`，V1 叫 `pattern`） */
  resource: string
  time: { created: number; updated: number }
}

/** `listSavedPermissions()` 的查询参数 */
export interface PermissionSavedListParams {
  /** 只看某个项目的规则；不传 = 全部项目 */
  projectID?: string
}

// ⛔ 阶段 3b 已删除 V1 的 Question 类型（QuestionOption / QuestionInfo /
//    QuestionRequest / QuestionAnswer）：
//      - V2 用 **Form 体系**取代 question（类型见 `src/types/api/form.ts`）；
//      - 交互侧：`InlineQuestion.tsx` / `QuestionDialog.tsx` 与内联通道已整体删除，
//        表单统一走底部的 `FormDialog`；
//      - 只读侧：`src/features/message/tools/renderers/QuestionRenderer.tsx`
//        **仍然保留**（V2 的 `question` 工具还在，本地库有 54 条真实调用），
//        但它自己就地定义了所需的最小 interface，**不依赖这里的 V1 类型**。
