// ============================================
// Form 类型（OpenCode V2 的「表单」体系，取代 V1 的 question）
// ============================================
//
// ⚠️ 这些类型在 V1 的 SDK 里**不存在**，所以**不能**从 `./v1Model` 转发 ——
// 这里直接复用 `@opencode/client` 的生成类型（它是 openapi 的忠实映射）。
//
// 字段类型清单与语义见 `src/api/form.ts` 的文件头注释。
// ============================================

import type { FormField as SDKFormField } from '@opencode/client'

/** 六种字段的联合（string / number / integer / boolean / multiselect / external） */
export type FormField = SDKFormField

/** 从联合里取出某个 `type` 对应的那一支（渲染器按类型分支时用） */
export type FormFieldOfType<T extends FormField['type']> = Extract<FormField, { type: T }>

/** 字段可见性条件（AND 语义） */
export type FormWhen = Extract<FormField, { type: 'string' }>['when'] extends (infer W)[] | undefined ? W : never

/** 选项（`string` 的 `options` 与 `multiselect` 的 `options` 共用） */
export type FormOption = NonNullable<Extract<FormField, { type: 'string' }>['options']>[number]

/** 表单值：字符串 / 数字 / 布尔 / 字符串数组（`Infinity` 等特殊值以字符串编码） */
export type FormValue = string | number | boolean | string[]

/** 答案映射：字段 key → 值 */
export type FormAnswer = Record<string, FormValue>

/** 表单状态：pending / answered / cancelled */
export type FormState = { status: 'pending' } | { status: 'answered'; answer: FormAnswer } | { status: 'cancelled' }

/** 待处理表单（`form.created` 事件与列表端点都用它） */
export interface FormInfo {
  id: string
  sessionID: string
  title: string
  metadata?: Record<string, unknown>
  fields: FormField[]
}

/** 表单详情（比 FormInfo 多一个 `state`） */
export interface FormDetail extends FormInfo {
  state: FormState
}
