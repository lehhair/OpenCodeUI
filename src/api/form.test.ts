import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFormAnswer,
  cancelForm,
  coerceFieldValue,
  createForm,
  getFormDetail,
  isFieldVisible,
  listPendingForms,
  listSessionForms,
  replyForm,
  resolveVisibility,
  validateForm,
} from './form'
import type { FormDraft, FormField } from './form'

const sessionFormListMock = vi.fn()
const sessionFormGetMock = vi.fn()
const sessionFormCreateMock = vi.fn()
const sessionFormReplyMock = vi.fn()
const sessionFormCancelMock = vi.fn()
const formListMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    session: {
      form: {
        list: (...args: unknown[]) => sessionFormListMock(...args),
        get: (...args: unknown[]) => sessionFormGetMock(...args),
        create: (...args: unknown[]) => sessionFormCreateMock(...args),
        reply: (...args: unknown[]) => sessionFormReplyMock(...args),
        cancel: (...args: unknown[]) => sessionFormCancelMock(...args),
      },
    },
    form: {
      list: (...args: unknown[]) => formListMock(...args),
    },
  }),
}))

beforeEach(() => {
  sessionFormListMock.mockReset()
  sessionFormGetMock.mockReset()
  sessionFormCreateMock.mockReset()
  sessionFormReplyMock.mockReset()
  sessionFormCancelMock.mockReset()
  formListMock.mockReset()
})

// ============================================
// 端点口径（V2）
// ============================================

describe('Form API 端点口径', () => {
  it('listSessionForms 直接返回裸数组（会话级端点已解包），且不传 location', async () => {
    sessionFormListMock.mockResolvedValue([{ id: 'frm_1', sessionID: 'ses_1', title: 'T', fields: [] }])

    const forms = await listSessionForms('ses_1', '/workspace', 'local')

    expect(sessionFormListMock).toHaveBeenCalledWith({ sessionID: 'ses_1' })
    expect(forms).toHaveLength(1)
    expect(forms[0].id).toBe('frm_1')
  })

  it('listPendingForms 走 location 作用域端点，解包 {location,data}', async () => {
    formListMock.mockResolvedValue({ location: { directory: '/workspace' }, data: [{ id: 'frm_2' }] })

    const forms = await listPendingForms('/workspace', 'local')

    expect(formListMock).toHaveBeenCalledWith({ location: { directory: '/workspace' } })
    expect(forms).toEqual([{ id: 'frm_2' }])
  })

  it('getFormDetail 解包裸对象（会话级端点已解包）', async () => {
    sessionFormGetMock.mockResolvedValue({ id: 'frm_3', state: { status: 'pending' } })

    const detail = await getFormDetail('ses_1', 'frm_3')

    expect(sessionFormGetMock).toHaveBeenCalledWith({ sessionID: 'ses_1', formID: 'frm_3' })
    expect(detail.state).toEqual({ status: 'pending' })
  })

  it('replyForm 传 {sessionID, formID, answer}', async () => {
    sessionFormReplyMock.mockResolvedValue(undefined)

    await replyForm('ses_1', 'frm_4', { q1: 'A', q2: 3, q3: true, q4: ['x', 'y'] })

    expect(sessionFormReplyMock).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      formID: 'frm_4',
      answer: { q1: 'A', q2: 3, q3: true, q4: ['x', 'y'] },
    })
  })

  it('cancelForm 走 DELETE（SDK 方法名 session.form.cancel）', async () => {
    sessionFormCancelMock.mockResolvedValue(undefined)

    await cancelForm('ses_1', 'frm_5')

    expect(sessionFormCancelMock).toHaveBeenCalledWith({ sessionID: 'ses_1', formID: 'frm_5' })
  })

  it('createForm 把 fields 当作非空元组传给服务端', async () => {
    sessionFormCreateMock.mockResolvedValue({ id: 'frm_new' })

    const created = await createForm('ses_1', {
      title: 'Deploy',
      fields: [{ key: 'env', type: 'string' }],
    })

    expect(sessionFormCreateMock).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      title: 'Deploy',
      fields: [{ key: 'env', type: 'string' }],
      metadata: undefined,
      id: undefined,
    })
    expect(created.id).toBe('frm_new')
  })
})

// ============================================
// `when` 条件求值
// ============================================
//
// ⚠️ 这一组断言**逐条对齐服务端 `packages/core/src/form.ts` 的 `matches`/`isActive`**：
//    - 未作答（undefined）时，`eq` 与 `neq` **都判 false**（不是「neq 取反」）
//    - 多选字段是「任一项命中」
//    - 只能引用**前面**的字段（服务端创建期强制）

describe('isFieldVisible（when 条件，服务端语义）', () => {
  const base = { key: 'b', type: 'string' as const }

  it('没有 when → 恒显示', () => {
    expect(isFieldVisible(base, {})).toBe(true)
  })

  it('when 为空数组 → 恒显示', () => {
    expect(isFieldVisible({ ...base, when: [] }, {})).toBe(true)
  })

  it('eq 命中 → 显示；未命中 → 隐藏', () => {
    const field: FormField = { ...base, when: [{ key: 'a', op: 'eq', value: 'yes' }] }
    expect(isFieldVisible(field, { a: 'yes' })).toBe(true)
    expect(isFieldVisible(field, { a: 'no' })).toBe(false)
  })

  it('🔴 neq：引用字段**未作答**时也是 false（服务端的反直觉语义）', () => {
    const field: FormField = { ...base, when: [{ key: 'a', op: 'neq', value: 'yes' }] }
    // 作答了且不等 → true
    expect(isFieldVisible(field, { a: 'no' })).toBe(true)
    // 作答了且相等 → false
    expect(isFieldVisible(field, { a: 'yes' })).toBe(false)
    // ⚠️ 未作答 → false（**不是** true）
    expect(isFieldVisible(field, {})).toBe(false)
  })

  it('多个 when 条件是 AND 语义', () => {
    const field: FormField = {
      ...base,
      when: [
        { key: 'a', op: 'eq', value: 1 },
        { key: 'b', op: 'eq', value: true },
      ],
    }
    expect(isFieldVisible(field, { a: 1, b: true })).toBe(true)
    expect(isFieldVisible(field, { a: 1, b: false })).toBe(false)
  })

  it('多选字段参与条件比较时是「任一项命中」', () => {
    const field: FormField = { ...base, when: [{ key: 'tags', op: 'eq', value: 'x' }] }
    expect(isFieldVisible(field, { tags: ['x', 'y'] })).toBe(true)
    expect(isFieldVisible(field, { tags: ['y'] })).toBe(false)
  })

  it('external 字段恒显示（服务端跳过 active 判断）', () => {
    expect(isFieldVisible({ key: 'x', type: 'external', url: 'https://e' }, {})).toBe(true)
  })
})

describe('resolveVisibility', () => {
  it('hidden 字段恒不可见', () => {
    const fields: FormField[] = [{ key: 'h', type: 'string', hidden: true }]
    expect(resolveVisibility(fields, {})).toEqual({ h: false })
  })

  it('按 fields 顺序逐个求值（后面的字段可依赖前面的值）', () => {
    const fields: FormField[] = [
      { key: 'a', type: 'boolean' },
      { key: 'b', type: 'string', when: [{ key: 'a', op: 'eq', value: true }] },
    ]
    expect(resolveVisibility(fields, { a: true })).toEqual({ a: true, b: true })
    expect(resolveVisibility(fields, { a: false })).toEqual({ a: true, b: false })
  })

  it('数字字段的条件用**转换后的数字**比对（草稿是字符串）', () => {
    const fields: FormField[] = [
      { key: 'n', type: 'integer' },
      { key: 'b', type: 'string', when: [{ key: 'n', op: 'eq', value: 3 }] },
    ]
    // 草稿里是 '3'，但条件值是数字 3 → 必须转换后才命中
    expect(resolveVisibility(fields, { n: '3' }).b).toBe(true)
    expect(resolveVisibility(fields, { n: '4' }).b).toBe(false)
  })

  it('🔴 隐藏字段的值**不参与**后续条件比对（与服务端 answer 一致）', () => {
    const fields: FormField[] = [
      // a 依赖一个恒不成立的条件 → 永远隐藏
      { key: 'a', type: 'string', hidden: true },
      { key: 'b', type: 'string', when: [{ key: 'a', op: 'eq', value: 'x' }] },
    ]
    // 即使草稿里 a='x'，a 被 hidden → 不进 answer → b 的条件看到 undefined → false
    expect(resolveVisibility(fields, { a: 'x' }).b).toBe(false)
  })
})

// ============================================
// 校验（语义对齐服务端 validateAnswer / validateField）
// ============================================

describe('validateForm', () => {
  it('required + 空值 → 报错', () => {
    const fields: FormField[] = [{ key: 'name', type: 'string', required: true }]
    expect(validateForm(fields, {}).ok).toBe(false)
    expect(validateForm(fields, {}).errors.name).toBeTruthy()
  })

  it('非必填 + 空值 → 放过', () => {
    const fields: FormField[] = [{ key: 'name', type: 'string' }]
    expect(validateForm(fields, {}).ok).toBe(true)
  })

  it('boolean 的 false 是合法值，不算「未填」', () => {
    const fields: FormField[] = [{ key: 'ok', type: 'boolean', required: true }]
    expect(validateForm(fields, { ok: false }).ok).toBe(true)
  })

  it('🔴 external 必须被确认（值是 true），且与 required 无关', () => {
    const fields: FormField[] = [{ key: 'x', type: 'external', url: 'https://e' }]
    expect(validateForm(fields, {}).ok).toBe(false)
    expect(validateForm(fields, { x: false }).ok).toBe(false)
    expect(validateForm(fields, { x: true }).ok).toBe(true)
  })

  it('string 的 minLength / maxLength / pattern', () => {
    const fields: FormField[] = [{ key: 's', type: 'string', minLength: 3, maxLength: 5 }]
    expect(validateForm(fields, { s: 'ab' }).errors.s).toBeTruthy()
    expect(validateForm(fields, { s: 'abc' }).ok).toBe(true)
    expect(validateForm(fields, { s: 'abcdef' }).errors.s).toBeTruthy()

    const patterned: FormField[] = [{ key: 'p', type: 'string', pattern: '^\\d+$' }]
    expect(validateForm(patterned, { p: 'abc' }).errors.p).toBeTruthy()
    expect(validateForm(patterned, { p: '123' }).ok).toBe(true)
  })

  it('string 的 format 校验（含「日期必须真实存在」）', () => {
    const email: FormField[] = [{ key: 'e', type: 'string', format: 'email' }]
    expect(validateForm(email, { e: 'not-an-email' }).errors.e).toBeTruthy()
    expect(validateForm(email, { e: 'a@b.co' }).ok).toBe(true)

    const uri: FormField[] = [{ key: 'u', type: 'string', format: 'uri' }]
    expect(validateForm(uri, { u: 'nope' }).errors.u).toBeTruthy()
    expect(validateForm(uri, { u: 'https://x.dev/a' }).ok).toBe(true)

    const date: FormField[] = [{ key: 'd', type: 'string', format: 'date' }]
    expect(validateForm(date, { d: '2026/01/01' }).errors.d).toBeTruthy()
    expect(validateForm(date, { d: '2026-01-01' }).ok).toBe(true)
    // 服务端的 isDate 会拒掉「格式对但日期不存在」
    expect(validateForm(date, { d: '2026-02-30' }).errors.d).toBeTruthy()
  })

  it('🔴 string 有 options 且 custom!==true 时是闭集（自由输入必被服务端拒）', () => {
    const fields: FormField[] = [
      {
        key: 's',
        type: 'string',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    ]
    expect(validateForm(fields, { s: 'a' }).ok).toBe(true)
    expect(validateForm(fields, { s: 'zzz' }).errors.s).toBeTruthy()

    const custom: FormField[] = [{ key: 's', type: 'string', custom: true, options: [{ value: 'a', label: 'A' }] }]
    expect(validateForm(custom, { s: 'zzz' }).ok).toBe(true)
  })

  it('number / integer 的边界、整数性与有限性', () => {
    const num: FormField[] = [{ key: 'n', type: 'number', minimum: 1, maximum: 10 }]
    expect(validateForm(num, { n: '0' }).errors.n).toBeTruthy()
    expect(validateForm(num, { n: '5' }).ok).toBe(true)
    expect(validateForm(num, { n: '11' }).errors.n).toBeTruthy()
    // 服务端要求 Number.isFinite
    expect(validateForm(num, { n: 'Infinity' }).errors.n).toBeTruthy()

    const int: FormField[] = [{ key: 'i', type: 'integer' }]
    expect(validateForm(int, { i: '1.5' }).errors.i).toBeTruthy()
    expect(validateForm(int, { i: '2' }).ok).toBe(true)
    expect(validateForm(int, { i: 'abc' }).errors.i).toBeTruthy()
  })

  it('multiselect 的 minItems / maxItems 与闭集', () => {
    const fields: FormField[] = [
      { key: 'm', type: 'multiselect', options: [{ value: 'a', label: 'A' }], minItems: 1, maxItems: 2 },
    ]
    // ⚠️ 非必填时「留空」是合法的（服务端只在 value !== undefined 时才跑字段级约束）
    expect(validateForm(fields, { m: [] }).ok).toBe(true)
    expect(validateForm(fields, { m: ['a'] }).ok).toBe(true)
    expect(validateForm(fields, { m: ['a', 'b', 'c'] }).errors.m).toBeTruthy()
    // 闭集：不在 options 里的值必被服务端拒
    expect(validateForm(fields, { m: ['zzz'] }).errors.m).toBeTruthy()

    const required: FormField[] = [
      { key: 'm', type: 'multiselect', required: true, options: [{ value: 'a', label: 'A' }] },
    ]
    expect(validateForm(required, { m: [] }).errors.m).toBeTruthy()
  })

  it('被 when 隐藏的字段不参与校验（否则会变成无法提交的死局）', () => {
    const fields: FormField[] = [
      { key: 'a', type: 'boolean' },
      { key: 'b', type: 'string', required: true, when: [{ key: 'a', op: 'eq', value: true }] },
    ]
    expect(validateForm(fields, { a: false, b: '' }).ok).toBe(true)
    expect(validateForm(fields, { a: true, b: '' }).ok).toBe(false)
  })
})

// ============================================
// 草稿 → FormValue 转换
// ============================================

describe('coerceFieldValue', () => {
  it('string 原样', () => {
    expect(coerceFieldValue({ key: 's', type: 'string' }, 'hi')).toBe('hi')
  })

  it('number / integer 把界面字符串转成数字；空串/非数/无穷 → undefined', () => {
    expect(coerceFieldValue({ key: 'n', type: 'number' }, '1.5')).toBe(1.5)
    expect(coerceFieldValue({ key: 'i', type: 'integer' }, '3')).toBe(3)
    expect(coerceFieldValue({ key: 'n', type: 'number' }, '')).toBeUndefined()
    expect(coerceFieldValue({ key: 'n', type: 'number' }, 'abc')).toBeUndefined()
    expect(coerceFieldValue({ key: 'n', type: 'number' }, 'Infinity')).toBeUndefined()
  })

  it('boolean 透传', () => {
    expect(coerceFieldValue({ key: 'b', type: 'boolean' }, true)).toBe(true)
    expect(coerceFieldValue({ key: 'b', type: 'boolean' }, false)).toBe(false)
  })

  it('multiselect 数组原样，非数组包一层', () => {
    expect(coerceFieldValue({ key: 'm', type: 'multiselect', options: [] }, ['a', 'b'])).toEqual(['a', 'b'])
    expect(coerceFieldValue({ key: 'm', type: 'multiselect', options: [] }, 'a')).toEqual(['a'])
  })

  it('external 不产生值（只认确认位）', () => {
    expect(coerceFieldValue({ key: 'x', type: 'external', url: 'u' }, 'v')).toBeUndefined()
    expect(coerceFieldValue({ key: 'x', type: 'external', url: 'u' }, true)).toBeUndefined()
  })
})

// ============================================
// answer 组装（提交给服务端的最终形态）
// ============================================

describe('buildFormAnswer', () => {
  it('只提交可见字段；隐藏字段被丢掉（否则服务端报 not active）', () => {
    const fields: FormField[] = [
      { key: 'a', type: 'boolean' },
      { key: 'b', type: 'string', when: [{ key: 'a', op: 'eq', value: true }] },
    ]
    expect(buildFormAnswer(fields, { a: false, b: 'hidden text' })).toEqual({ a: false })
    expect(buildFormAnswer(fields, { a: true, b: 'shown' })).toEqual({ a: true, b: 'shown' })
  })

  it('external 只有确认后才提交 true', () => {
    const fields: FormField[] = [{ key: 'x', type: 'external', url: 'https://e' }]
    expect(buildFormAnswer(fields, { x: false })).toEqual({})
    expect(buildFormAnswer(fields, { x: true })).toEqual({ x: true })
  })

  it('boolean 的 false 必须保留；空字符串/空数组不提交', () => {
    const fields: FormField[] = [
      { key: 'b', type: 'boolean' },
      { key: 's', type: 'string' },
      { key: 'm', type: 'multiselect', options: [{ value: 'a', label: 'A' }] },
    ]
    expect(buildFormAnswer(fields, { b: false, s: '', m: [] })).toEqual({ b: false })
  })

  it('数字字符串转成数字、整数保持整数', () => {
    const fields: FormField[] = [
      { key: 'n', type: 'number' },
      { key: 'i', type: 'integer' },
    ]
    expect(buildFormAnswer(fields, { n: '1.5', i: '2' })).toEqual({ n: 1.5, i: 2 })
  })

  it('多选保留数组、string 的选项用 option 的 value', () => {
    const fields: FormField[] = [
      {
        key: 'm',
        type: 'multiselect',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
      { key: 's', type: 'string', options: [{ value: 'v1', label: 'Label One' }] },
    ]
    expect(buildFormAnswer(fields, { m: ['a', 'b'], s: 'v1' })).toEqual({ m: ['a', 'b'], s: 'v1' })
  })

  it('提交的 answer 一定通过本地校验（可见性 + 校验 + 组装三者一致）', () => {
    const fields: FormField[] = [
      {
        key: 'kind',
        type: 'string',
        required: true,
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
      { key: 'detail', type: 'string', required: true, when: [{ key: 'kind', op: 'eq', value: 'b' }] },
      { key: 'count', type: 'integer', minimum: 1 },
      { key: 'flags', type: 'multiselect', options: [{ value: 'x', label: 'X' }] },
      { key: 'ack', type: 'external', url: 'https://e' },
    ]

    const draft: FormDraft = { kind: 'a', detail: 'ignored', count: '3', flags: ['x'], ack: true }
    expect(validateForm(fields, draft).ok).toBe(true)
    expect(buildFormAnswer(fields, draft)).toEqual({ kind: 'a', count: 3, flags: ['x'], ack: true })
  })
})
