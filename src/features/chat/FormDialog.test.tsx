// ============================================
// FormDialog 渲染器单测（六种字段类型 + when 联动 + external 确认位）
// ============================================
//
// 这是「表单渲染」这一新增 UI 能力的**组件级**验证，与
//   - `src/api/form.test.ts`（纯函数：可见性 / 校验 / answer 组装）
//   - `src/api/phase3a.smoke.test.ts`（真实服务：create → reply → detail）
// 一起构成完整覆盖。
//
// 重点验证四件容易错的事：
//   1. 六种字段类型都能渲染出对应控件
//   2. `when` 条件满足/不满足时字段出现/消失（联动）
//   3. `external` 必须点「我已打开并完成」才可提交（服务端强制 `true`）
//   4. 提交的值形态正确（数字是 number、多选是 string[]、boolean 的 false 也提交）

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormDialog } from './FormDialog'
import type { FormField, FormInfo } from '../../api/form'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../hooks', () => ({
  usePresence: () => ({ shouldRender: true, ref: { current: null } }),
}))

vi.mock('./chatViewport', () => ({
  useChatViewport: () => ({ presentation: { isCompact: false } }),
}))

vi.mock('../../store/keybindingStore', () => ({
  keybindingStore: { getKey: () => undefined },
  matchesKeybinding: () => false,
}))

function makeForm(fields: FormField[]): FormInfo {
  return { id: 'frm_test', sessionID: 'ses_1', title: '测试表单', fields }
}

describe('FormDialog 渲染器', () => {
  it('六种字段类型都能渲染出对应控件', () => {
    const fields: FormField[] = [
      { key: 's', type: 'string', title: '字符串', placeholder: '写点什么' },
      { key: 'n', type: 'number', title: '数字' },
      { key: 'i', type: 'integer', title: '整数' },
      { key: 'b', type: 'boolean', title: '布尔' },
      { key: 'm', type: 'multiselect', title: '多选', options: [{ value: 'a', label: '选项A' }] },
      { key: 'x', type: 'external', url: 'https://example.com/auth', title: '外部授权' },
    ]

    render(<FormDialog form={makeForm(fields)} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    // string → text input（用字段自己的 placeholder）
    expect(screen.getByPlaceholderText('写点什么')).toBeTruthy()
    // number / integer → 两个 number input
    expect(document.querySelectorAll('input[type="number"]').length).toBe(2)
    // boolean → 一个可点的按钮（用 title 作为文案）
    expect(screen.getByText('布尔')).toBeTruthy()
    // multiselect → 选项按钮
    expect(screen.getByText('选项A')).toBeTruthy()
    // external → 链接 + 确认按钮
    expect(document.querySelector('a[href="https://example.com/auth"]')).toBeTruthy()
    expect(screen.getByText('formDialog.acknowledge')).toBeTruthy()
  })

  it('string 带 options 时渲染选项按钮组；custom:true 时另给自由输入', () => {
    const closed: FormField[] = [
      { key: 's', type: 'string', title: '闭集', options: [{ value: 'v1', label: '标签一' }] },
    ]
    const { unmount } = render(<FormDialog form={makeForm(closed)} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('标签一')).toBeTruthy()
    // 闭集**不给**自由输入框（服务端只接受 option 的 value）
    expect(screen.queryByPlaceholderText('questionDialog.typeYourAnswer')).toBeNull()
    unmount()

    const open: FormField[] = [
      { key: 's', type: 'string', title: '开集', custom: true, options: [{ value: 'v1', label: '标签一' }] },
    ]
    render(<FormDialog form={makeForm(open)} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByPlaceholderText('questionDialog.typeYourAnswer')).toBeTruthy()
  })

  it('`when` 条件联动：被依赖字段变化时字段出现 / 消失', () => {
    const fields: FormField[] = [
      { key: 'needReason', type: 'boolean', title: '需要原因' },
      { key: 'reason', type: 'string', title: '原因', when: [{ key: 'needReason', op: 'eq', value: true }] },
    ]

    render(<FormDialog form={makeForm(fields)} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    // 初始 needReason=false → reason 不渲染
    expect(screen.queryByText('原因')).toBeNull()

    // 打开开关 → reason 出现
    act(() => {
      fireEvent.click(screen.getByText('需要原因'))
    })
    expect(screen.getByText('原因')).toBeTruthy()
  })

  it('🔴 external 未确认时不能提交（服务端强制 answer=true）', () => {
    const onSubmit = vi.fn()
    const fields: FormField[] = [{ key: 'x', type: 'external', url: 'https://example.com/auth' }]

    render(<FormDialog form={makeForm(fields)} onSubmit={onSubmit} onCancel={vi.fn()} />)

    // 未确认 → 点提交不触发 onSubmit，而是显示错误
    act(() => {
      fireEvent.click(screen.getByText('common:submit'))
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('请先打开链接并确认完成')).toBeTruthy()

    // 确认后可提交，且 answer 里是 `true`
    act(() => {
      fireEvent.click(screen.getByText('formDialog.acknowledge'))
    })
    act(() => {
      fireEvent.click(screen.getByText('common:submit'))
    })
    expect(onSubmit).toHaveBeenCalledWith({ x: true })
  })

  it('提交的值形态正确：数字转 number、多选是 string[]、boolean 的 false 也提交', () => {
    const onSubmit = vi.fn()
    const fields: FormField[] = [
      { key: 'n', type: 'number' },
      { key: 'm', type: 'multiselect', options: [{ value: 'a', label: '选项A' }] },
      { key: 'b', type: 'boolean', title: '开关' },
    ]

    render(<FormDialog form={makeForm(fields)} onSubmit={onSubmit} onCancel={vi.fn()} />)

    act(() => {
      fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '1.5' } })
    })
    act(() => {
      fireEvent.click(screen.getByText('选项A'))
    })
    act(() => {
      fireEvent.click(screen.getByText('common:submit'))
    })

    expect(onSubmit).toHaveBeenCalledWith({ n: 1.5, m: ['a'], b: false })
  })

  it('Escape 触发取消', () => {
    const onCancel = vi.fn()
    render(<FormDialog form={makeForm([{ key: 's', type: 'string' }])} onSubmit={vi.fn()} onCancel={onCancel} />)

    act(() => {
      fireEvent.keyDown(screen.getByText('common:submit').closest('div')!.parentElement!, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalled()
  })
})
