// ============================================
// Form API —— V2 的「表单」体系（取代 V1 的 question）
// 基于 @opencode/client（OpenCode V2）: /api/form、/api/session/{id}/form
// ============================================
//
// 🔴 Form **不是 question 的等价替换**，而是全新的 UI 能力（迁移文档 §4.3 已点明）：
//
//   V1 `QuestionRequest` = `{ id, sessionID, questions: [{question, header, options[], multiple, custom?}] }`
//   V2 `Form.Info`       = `{ id, sessionID, title, fields: FormField[], metadata? }`
//
//   结构完全不兼容：V1 是「一组选择题」，V2 是「一张带类型/校验/条件显示的表单」。
//
// ── 六种字段类型（照 v2.0.19 二进制 openapi 的 Form.* schema 核实）───────────
//
//   | type          | 专有字段 |
//   |---------------|---------|
//   | `string`      | `format?`(email/uri/date/date-time) `minLength?` `maxLength?` `pattern?` `placeholder?` `default?` `options?` `custom?` |
//   | `number`      | `minimum?` `maximum?` `default?`（数值，可能是 `'Infinity'`/`'-Infinity'`/`'NaN'` 字符串） |
//   | `integer`     | 同 `number`（额外要求整数） |
//   | `boolean`     | `default?` |
//   | `multiselect` | `options[]`（必填）`minItems?` `maxItems?` `custom?` `default?: string[]` |
//   | `external`    | `url`（必填）—— 不是输入项，是「去外部页面完成」的入口 |
//
//   所有非 external 字段都可有：`title?` `description?` `required?` `hidden?` `when?: FormWhen[]`
//   `FormWhen` = `{key, op: 'eq'|'neq', value: string|number|boolean}`
//   → 语义：`when` 里的**全部条件都满足**时该字段才显示（AND 语义，多个条件数组）。
//     ⚠️ 这是**前端**的渲染职责（服务端不校验显示条件），所以 `when` 求值必须写在前端。
//
// ── 端点 ─────────────────────────────────────────────────────────────────
//
//   | 能力 | 端点 | SDK |
//   |---|---|---|
//   | 会话内待处理表单 | `GET /api/session/{sessionID}/form` | `session.form.list({sessionID})` |
//   | 位置级待处理表单 | `GET /api/form`（location 作用域） | `form.list({location})` |
//   | 单张表单（含状态） | `GET /api/session/{sessionID}/form/{formID}` | `session.form.get` |
//   | 创建表单 | `POST /api/session/{sessionID}/form` | `session.form.create` |
//   | **回复** | `POST /api/session/{sessionID}/form/{formID}/reply` | `session.form.reply({sessionID, formID, answer})` |
//   | **取消** | `DELETE /api/session/{sessionID}/form/{formID}` | `session.form.cancel({sessionID, formID})` |
//
//   回复体：`{ answer: { [key]: string | number | boolean | string[] } }`
//
// ── 事件侧（阶段 2b 已接线）──────────────────────────────────────────────
//   `form.created` 载荷 `{form: Form.Info}`（**包了一层 `form`**）
//   `form.replied` 载荷 `{id, sessionID, answer}`
//   `form.cancelled` 载荷 `{id, sessionID}`
//
// ⚠️ `GET /api/form` 是 **location 作用域**，必须用 `locationInput()` 传目录，
//    否则会被服务端静默回落到 `process.cwd()`（见迁移文档 §3.3 的「静默失效」陷阱）。
// ============================================

import { getSDKClient } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { locationInput } from './v2Convert'
import type { FormAnswer, FormDetail, FormField, FormInfo, FormValue, FormWhen } from '../types/api/form'

export type {
  FormAnswer,
  FormDetail,
  FormField,
  FormFieldOfType,
  FormInfo,
  FormValue,
  FormWhen,
  FormOption,
  FormState,
} from '../types/api/form'

/**
 * 拉取某个 **session** 的待处理表单
 *
 * ⚠️ 是 session 作用域端点：目录由 session 行决定，**不要**传 directory
 * （`directory` 形参只为保持调用点参数顺序，服务端会忽略）。
 */
export async function listSessionForms(sessionId: string, _directory?: string, serverId?: string): Promise<FormInfo[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  // ⚠️ V2 客户端的「会话级」form 端点返回**裸数组**（已解包），
  //    而「位置级」的 `client.form.list` 返回 `{location, data}` —— 两者不一致，别照抄。
  return sdk.session.form.list({ sessionID: target.sessionId })
}

/**
 * 拉取某个 **location** 上全部待处理表单（跨会话）
 *
 * 用途：`usePermissionHandler.refreshPendingRequests()` 的兜底刷新
 * （SSE 丢事件时靠它把 pending 列表补回来）。
 */
export async function listPendingForms(directory?: string, serverId?: string): Promise<FormInfo[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.form.list(locationInput(directory, serverId, 'GET /api/form'))
  return result.data
}

/**
 * 拉取单张表单的详情（含 `state`：pending / answered / cancelled）
 *
 * 用途：打开历史会话时确认某张表单是否已经被回答过（`GET /api/session/{id}/form` 只列 pending）。
 */
export async function getFormDetail(
  sessionId: string,
  formId: string,
  _directory?: string,
  serverId?: string,
): Promise<FormDetail> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  // 同上：会话级端点返回裸对象（已解包）
  return sdk.session.form.get({ sessionID: target.sessionId, formID: formId })
}

/**
 * 创建表单（把表单推给用户）
 *
 * 目前**没有调用点**（正常流程是 agent 侧创建、前端只负责渲染），
 * 保留接口是为了 API 完整 + 冒烟测试能用它构造真实表单。
 */
export async function createForm(
  sessionId: string,
  payload: { title: string; fields: FormField[]; metadata?: Record<string, unknown>; id?: string },
  _directory?: string,
  serverId?: string,
): Promise<FormInfo> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.session.form.create({
    sessionID: target.sessionId,
    title: payload.title,
    // `Form.Fields` 是非空元组类型（`[FormField, ...FormField[]]`），这里断言成它
    fields: payload.fields as [FormField, ...FormField[]],
    // ⚠️ `metadata` 是 JSON 值映射；`Record<string, unknown>` 不能直接赋值给 `JsonValue` 索引签名
    metadata: payload.metadata as Record<string, never> | undefined,
    id: payload.id,
  })
  // 会话级 create 也返回裸对象（已解包）
  return result
}

/**
 * 回复表单
 *
 * @param answer 以字段 `key` 为索引的答案映射。值类型必须与字段类型匹配：
 *   字符串 → `string`、数字/整数 → `number`、布尔 → `boolean`、多选 → `string[]`。
 *   ⚠️ 服务端会做**类型校验**，不匹配会 400（`FormInvalidAnswerError`）。
 *   → 渲染器负责在提交前做本地校验（`required` / `minLength` / `pattern` / `minItems` …），
 *     避免把明显的错误丢给服务端。
 */
export async function replyForm(
  sessionId: string,
  formId: string,
  answer: FormAnswer,
  _directory?: string,
  serverId?: string,
): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.form.reply({ sessionID: target.sessionId, formID: formId, answer })
}

/**
 * 取消（拒绝）表单 —— 相当于 V1 的 `POST /question/{id}/reject`
 *
 * 服务端会下发 `form.cancelled` 事件。
 */
export async function cancelForm(
  sessionId: string,
  formId: string,
  _directory?: string,
  serverId?: string,
): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.form.cancel({ sessionID: target.sessionId, formID: formId })
}

// ============================================
// 纯函数：`when` 条件求值 + 表单校验 + answer 组装
// ============================================
//
// 🔴 这三组逻辑**必须与服务端逐字对齐**，否则会出现「前端放行、服务端 400」的假失败。
//    权威实现（tag v2.0.19）：
//      - `packages/core/src/form.ts` 的 `validateAnswer` / `isActive` / `matches` / `validateField`
//      - `packages/core/src/form.ts` 的 `validateFields`（创建期校验 `when` 引用）
//
// 三条**反直觉**的服务端语义（照抄，不要「优化」）：
//
//   ① **`external` 字段必须被「确认」，值是布尔 `true`**
//      `if (value !== true) return 'External form field must be acknowledged'`
//      → 它不是「可选的展示项」，而是**永远必填的确认位**（哪怕字段里没有 `required`）。
//
//   ② **条件引用的字段「未作答」时，`eq` 与 `neq` 都判 false**
//      源码注释原文：*"An unanswered referenced field makes the condition false for both ops.
//      Combined with inactive fields being unanswerable, this cascades: hiding a field
//      falsifies every condition referencing it."*
//      → 不能写成「neq = !eq」（那会让未作答时 neq 变 true，与服务端不一致）。
//
//   ③ **多选字段参与条件比较时是「任一项命中」**
//      `Array.isArray(value) ? value.some(item => item === when.value) : value === when.value`
//
// 另外 `validateAnswer` 会**拒绝答案里的未知 key**（`Unknown form field`），
// 也会**拒绝「条件不成立却带了值」的字段**（`Form field is not active`）
// → 所以组装 answer 时必须严格按可见性过滤（`buildFormAnswer` 就是干这个的）。

/** 界面草稿：渲染器统一用「字符串 / 布尔 / 字符串数组」承载输入控件的原始值 */
export type FormDraft = Record<string, string | boolean | string[] | undefined>

/**
 * 单个条件求值 —— 与服务端 `Form.matches` **逐字一致**
 *
 * ⚠️ `value === undefined` 时**两种 op 都返回 false**（见上方 ②）。
 */
function matchesCondition(when: FormWhen, value: FormValue | undefined): boolean {
  if (value === undefined) return false
  const hit = Array.isArray(value) ? value.some(item => item === when.value) : value === when.value
  return when.op === 'eq' ? hit : !hit
}

/**
 * 字段是否「活跃」（= 显示 + 可作答 + 可校验）—— 与服务端 `Form.isActive` 一致
 *
 * ⚠️ `values` 必须是**已按各字段类型转换好**的值映射（等价于服务端的 answer）：
 *    服务端比对的是 answer 里的真实类型（number 字段的条件值是数字、boolean 是布尔、
 *    multiselect 是字符串数组），拿草稿原值比会错。
 *    → 正常路径请走 `resolveVisibility()`，它负责边遍历边转换。
 * ⚠️ `external` 字段没有 `when`，服务端也跳过 active 判断 → 恒 true。
 */
export function isFieldVisible(field: FormField, values: Record<string, FormValue | undefined>): boolean {
  if (field.type === 'external') return true
  if (!field.when || field.when.length === 0) return true
  return field.when.every(condition => matchesCondition(condition, values[condition.key]))
}

/**
 * 按字段类型把「界面草稿里的原始值」转成 V2 期望的 `FormValue`
 *
 * ⚠️ `string` 字段的 `options` 存的是 option 的 **value**（不是 label）。
 * ⚠️ 数字字段只接受**有限数**：服务端 `validateField` 要求 `Number.isFinite`，
 *    所以 `'Infinity'` 这种输入本地就转成 undefined（当作未填）。
 */
export function coerceFieldValue(
  field: FormField,
  raw: string | boolean | string[] | undefined,
): FormValue | undefined {
  if (raw === undefined) return undefined
  switch (field.type) {
    case 'string':
      return typeof raw === 'string' ? raw : String(raw)
    case 'number':
    case 'integer': {
      if (typeof raw !== 'string') return undefined
      const trimmed = raw.trim()
      if (trimmed === '') return undefined
      const num = Number(trimmed)
      return Number.isFinite(num) ? num : undefined
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : raw === 'true'
    case 'multiselect':
      return Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []
    case 'external':
      // external 不参与值转换：它只认「确认位」true（见 buildFormAnswer）
      return undefined
  }
}

/** 从草稿里取某个字段的已转换值 */
function coerceDraftValue(field: FormField, draft: FormDraft): FormValue | undefined {
  return coerceFieldValue(field, draft[field.key])
}

/**
 * 单次遍历同时算出「可见性」与「参与条件比对的已转换值」
 *
 * ⚠️ **这是本文件最容易写错的地方**，必须与服务端语义逐条对齐：
 *
 *   1. 必须**按 fields 数组顺序**逐个求值：服务端在创建期就强制
 *      「`when` 只能引用**前面**的字段」（`Form field condition must reference an earlier field`）。
 *   2. **只有「可见」字段的值才会进入 `values`**。
 *      因为服务端比对的是一份 answer，而 `buildFormAnswer` **不会**提交隐藏字段
 *      → 服务端看到 `answer[hiddenKey] === undefined` → 引用它的条件**两种 op 都判 false**。
 *      如果这里把隐藏字段的值也放进去，就会出现「前端认为可见、服务端认为 not active」→ 400。
 *   3. `hidden: true` 的字段：服务端**不校验** `hidden`（它是纯展示提示），
 *      但既然它不显示，用户也填不了 → 这里按「不可见且不参与比对」处理，与 answer 一致。
 *   4. `external` 字段：恒可见、值不参与条件比对（它只认确认位 `true`）。
 */
function computeFormState(
  fields: FormField[],
  draft: FormDraft,
): { visible: Record<string, boolean>; values: Record<string, FormValue | undefined> } {
  const visible: Record<string, boolean> = {}
  const values: Record<string, FormValue | undefined> = {}

  for (const field of fields) {
    if (field.type === 'external') {
      visible[field.key] = true
      continue
    }
    const isVisible = field.hidden ? false : isFieldVisible(field, values)
    visible[field.key] = isVisible
    // 只有可见字段的值才会进入 answer，因此也只有它们参与后续条件比对
    if (isVisible) values[field.key] = coerceDraftValue(field, draft)
  }

  return { visible, values }
}

/** 求值整张表单里每个字段的可见性（渲染器按它决定渲染哪些字段） */
export function resolveVisibility(fields: FormField[], draft: FormDraft): Record<string, boolean> {
  return computeFormState(fields, draft).visible
}

/** 表单校验结果 */
export interface FormValidationResult {
  ok: boolean
  /** key → 中文错误信息（供 UI 就地提示） */
  errors: Record<string, string>
}

/** 数值字段的「特殊值」字符串（Effect Schema 对 Infinity / NaN 的 JSON 编码） */
const NUMERIC_SPECIALS = new Set(['Infinity', '-Infinity', 'NaN'])

/** 把 `minimum` / `maximum` 这类可能是特殊值字符串的字段转成数字（服务端用 JS 比较，会自动转换） */
function toBound(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && NUMERIC_SPECIALS.has(value)) return Number(value)
  return undefined
}

/** 服务端的 `isDate`：格式 + 「真实存在的日期」（2026-02-30 要拒掉） */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * 表单本地校验 —— 语义对齐服务端 `validateAnswer` + `validateField`
 *
 * 目的：把「必然 400」的错误在本地拦下来（服务端会返回 `FormInvalidAnswerError`，
 * 但那时用户已经点过提交、体验更差）。
 *
 * 覆盖：`external` 确认位、`required`、string 的 min/maxLength/pattern/format/闭集选项、
 * number/integer 的有限性与 min/max、multiselect 的 min/maxItems 与闭集选项。
 *
 * ⚠️ **只校验「当前可见」的字段**：服务端对「条件不成立却带了值」的字段直接报
 *    `Form field is not active`，所以隐藏字段既不校验也不提交（见 buildFormAnswer）。
 * ⚠️ 非必填字段留空时，我们**不提交该 key**（`buildFormAnswer` 会丢掉空值），
 *    服务端看到 `undefined` 就只检查 `required` —— 所以 minLength/minItems 这类
 *    约束在「留空」时**不生效**（这是服务端的语义，不是我们的疏漏）。
 */
export function validateForm(fields: FormField[], draft: FormDraft): FormValidationResult {
  const errors: Record<string, string> = {}
  const visibility = resolveVisibility(fields, draft)

  for (const field of fields) {
    const raw = draft[field.key]

    // ---- external：永远必须确认为 true ----
    if (field.type === 'external') {
      if (raw !== true) errors[field.key] = '请先打开链接并确认完成'
      continue
    }

    if (!visibility[field.key]) continue

    const value = coerceDraftValue(field, draft)
    const rawText = typeof raw === 'string' ? raw.trim() : undefined
    const isEmpty = value === undefined || (Array.isArray(value) && value.length === 0) || value === ''

    if (isEmpty) {
      // 必填校验（服务端：`required && active` 且 value === undefined 才算缺失；
      // 字符串另有 `required && length === 0` 一条）
      if (field.required) errors[field.key] = '此项为必填'
      // ⚠️ 用户**填了东西**但转换不出有效值（数字字段输入 `abc` / `Infinity`）：
      //    不能当成「留空」静默丢掉，否则用户以为提交了、服务端却看不到这个 key。
      else if ((field.type === 'number' || field.type === 'integer') && rawText) {
        errors[field.key] = '请输入数字'
      }
      // 非必填留空 → 放过（不提交该 key，服务端也不会跑字段级约束）
      continue
    }

    switch (field.type) {
      case 'string': {
        const text = String(value)
        if (field.minLength !== undefined && text.length < field.minLength) {
          errors[field.key] = `至少 ${field.minLength} 个字符`
        } else if (field.maxLength !== undefined && text.length > field.maxLength) {
          errors[field.key] = `最多 ${field.maxLength} 个字符`
        } else if (field.pattern) {
          try {
            if (!new RegExp(field.pattern).test(text)) errors[field.key] = '格式不符合要求'
          } catch {
            // 正则本身非法：本地无法判断，交给服务端（它会报 `invalid pattern`）
          }
        } else if (field.format === 'email') {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[field.key] = '请输入有效的邮箱地址'
        } else if (field.format === 'uri') {
          if (!URL.canParse(text)) errors[field.key] = '请输入有效的链接'
        } else if (field.format === 'date') {
          if (!isRealDate(text)) errors[field.key] = '请输入有效日期（YYYY-MM-DD）'
        } else if (field.format === 'date-time') {
          if (Number.isNaN(new Date(text).getTime())) errors[field.key] = '请输入有效的日期时间'
        }
        // 闭集选项（服务端：`options && !custom` → 值必须在 options 里）
        if (!errors[field.key] && field.options && field.custom !== true) {
          if (!field.options.some(option => option.value === text)) errors[field.key] = '请从给出的选项中选择'
        }
        break
      }
      case 'number':
      case 'integer': {
        const num = typeof value === 'number' ? value : NaN
        if (!Number.isFinite(num)) {
          errors[field.key] = '请输入数字'
        } else if (field.type === 'integer' && !Number.isInteger(num)) {
          errors[field.key] = '请输入整数'
        } else {
          const min = toBound(field.minimum)
          const max = toBound(field.maximum)
          if (min !== undefined && num < min) errors[field.key] = `不能小于 ${min}`
          else if (max !== undefined && num > max) errors[field.key] = `不能大于 ${max}`
        }
        break
      }
      case 'multiselect': {
        const list = Array.isArray(value) ? value : []
        if (field.minItems !== undefined && list.length < field.minItems) {
          errors[field.key] = `至少选择 ${field.minItems} 项`
        } else if (field.maxItems !== undefined && list.length > field.maxItems) {
          errors[field.key] = `最多选择 ${field.maxItems} 项`
        } else if (field.custom !== true && field.options.length > 0) {
          // 闭集选项（服务端：`!custom` → 每一项都必须在 options 里）
          const allowed = new Set(field.options.map(option => option.value))
          if (list.some(item => !allowed.has(item))) errors[field.key] = '含无效选项'
        }
        break
      }
      case 'boolean':
        break
    }
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

/**
 * 组装服务端期望的 `answer`
 *
 * 规则（严格对齐服务端 `validateAnswer`）：
 *   1. 只包含**当前可见**的字段（隐藏字段带了值会被拒：`Form field is not active`）
 *   2. `external` 字段必须带 `true`（确认位），没确认就不提交该 key（会被服务端拒）
 *   3. 空值（`undefined` / `''` / `[]`）不提交 —— 服务端把「缺 key」当作「未作答」，
 *      对非必填字段是合法的；而 `''` / `[]` 会被字段级约束拒绝（如 `minLength`）
 *   4. `boolean` 的 `false` 是**合法值**，必须保留
 */
export function buildFormAnswer(fields: FormField[], draft: FormDraft): FormAnswer {
  const visibility = resolveVisibility(fields, draft)
  const answer: FormAnswer = {}

  for (const field of fields) {
    if (field.type === 'external') {
      // 未确认就不提交 —— 服务端会回 `External form field must be acknowledged`
      if (draft[field.key] === true) answer[field.key] = true
      continue
    }
    if (!visibility[field.key]) continue

    const value = coerceDraftValue(field, draft)
    if (value === undefined) continue
    if (field.type === 'boolean') {
      // false 是合法值，必须保留
      answer[field.key] = value
      continue
    }
    if (value === '' || (Array.isArray(value) && value.length === 0)) continue
    answer[field.key] = value
  }

  return answer
}
