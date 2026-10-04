// ============================================
// Permission & Form Types — OpenCode v2 原生
//
// ## v1 → v2 的两处根本变化
//
// ### 1. Permission 不再是「工具授权」
// v1 的 PermissionRequest 带 `tool: { messageID, callID }`，UI 围绕
// 「哪个工具要执行什么」渲染。v2 改为**动作 + 资源**模型：
//
//   { id, sessionID, action, resources[], save?, metadata?, source?, message? }
//
// 没有 `tool` 字段。UI 应展示 `action`（动作名）与 `resources`（受影响资源）。
// 回复时字段名是 **`decision`**（不是 v1 的 `reply`）。
//
// ### 2. Question → Form
// v1 的 `question.*`（list/reply/reject）在 v2 完全由 `form.*` 取代：
//   - `form.list()`           全局表单（返回 `{ location, data }`，取 .data）
//   - `session.form.list()`   会话内表单（返回 `{ location, data }`，取 .data）
//   - `session.form.get()`    → FormDetail（含 state，已解包）
//   - `session.form.reply()`  → 提交答案
//   - `session.form.cancel()` → 取消
//
// 字段（FormField）是判别联合：string / number / integer / boolean /
// multiselect / external。答案（FormAnswer）是 `{ [key]: FormValue }`。
// ============================================

import type {
  FormAnswer,
  FormBooleanField,
  FormDetail,
  FormExternalField,
  FormField,
  FormFields,
  FormInfo,
  FormIntegerField,
  FormMetadata,
  FormMultiselectField,
  FormNumberField,
  FormOption,
  FormState,
  FormStringField,
  FormValue,
  FormWhen,
  PermissionAsked,
  PermissionEffect,
  PermissionReply,
  PermissionRequest,
  PermissionSavedInfo,
  PermissionSource,
} from '@opencode/client/promise'

// ============================================
// Permission
// ============================================

export type { PermissionReply, PermissionEffect, PermissionSavedInfo }

export type PermissionRequestType = PermissionRequest

export type PermissionRequestPayload = PermissionAsked['data']

/**
 * 权限请求。
 *
 * 注意：v2 没有 v1 的 `tool` 字段，改为动作/资源模型。
 */
export type PermissionRequestModel = PermissionRequest

/** 权限请求的来源（v2 为 tool 来源描述） */
export type PermissionSourceInfo = PermissionSource

/**
 * 兼容别名：v1 的 `PermissionToolInfo` 描述被请求的工具。
 * v2 不再提供该信息，改为从 `action` + `resources` + `source` 推断。
 */
export interface PermissionToolInfo {
  action?: string
  resources?: string[]
  source?: PermissionSource
}

// ============================================
// Form（取代 v1 的 Question）
// ============================================

export type { FormInfo, FormDetail, FormField, FormFields, FormState, FormValue, FormAnswer, FormMetadata }

export type FormOptionInfo = FormOption

export type FormWhenCondition = FormWhen

export type FormStringFieldType = FormStringField

export type FormNumberFieldType = FormNumberField

export type FormIntegerFieldType = FormIntegerField

export type FormBooleanFieldType = FormBooleanField

export type FormMultiselectFieldType = FormMultiselectField

export type FormExternalFieldType = FormExternalField

// ---- v1 Question 别名的收敛 ----
// v1 的 QuestionRequest 是「一个问题 + 若干选项」，v2 用 FormInfo（字段数组）
// 表达。这里保留别名指向 v2 形状，避免旧引用悬空。

export type QuestionRequest = FormInfo

export type QuestionInfo = FormInfo

export type QuestionOption = FormOption

export type QuestionAnswer = FormAnswer

/**
 * 表单字段是否属于「有选项可点」的类型。
 *
 * 注意：**不是**类型谓词。v2 的 `FormStringField.options` 是可选的，
 * 「有没有选项」不是类型层面的判别式；若声明成
 * `field is FormMultiselectField | FormStringField`，TypeScript 会在
 * 否定分支里把 FormStringField 一并排除，导致「无选项的字符串字段」
 * 被窄化成 never。因此这里只返回 boolean。
 */
export function isChoiceField(field: FormField): boolean {
  if (field.type === 'multiselect') return true
  if (field.type === 'string') return Array.isArray(field.options) && field.options.length > 0
  return false
}
