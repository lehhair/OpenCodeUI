/**
 * InlineQuestion — 融入信息流的表单交互
 *
 * OpenCode v2 把 v1 的「问题（question）」换成了**表单（form）**：
 *   v1: { questions: [{ header, question, options, multiple, custom }] }，答案是位置数组
 *   v2: { title, fields: FormField[] }，答案是键值对象 { [field.key]: FormValue }
 *
 * 字段类型从「只有选项」扩展到 6 种，渲染与状态集中在 ./formFields。
 * 这里只负责内联卡片的排版与提交/跳过按钮，视觉保持原有风格。
 */

import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiFormInfo, FormAnswer } from '../../api'
import { FormFieldInput, useFormState } from './formFields'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'

interface InlineQuestionProps {
  form: ApiFormInfo
  onReply: (formId: string, answer: FormAnswer) => void
  onCancel: (formId: string) => void
  isReplying: boolean
}

export const InlineQuestion = memo(function InlineQuestion({
  form,
  onReply,
  onCancel,
  isReplying,
}: InlineQuestionProps) {
  const { t } = useTranslation(['chat', 'common'])
  const state = useFormState(form)

  const handleSubmit = useCallback(() => {
    onReply(form.id, state.buildAnswer())
  }, [form.id, state, onReply])

  // 键盘快捷键：和主输入框一致的 send keybinding 提交，Escape 跳过
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel(form.id)
        return
      }
      const sendKey = keybindingStore.getKey('sendMessage')
      if (sendKey && matchesKeybinding(e.nativeEvent, sendKey)) {
        e.preventDefault()
        if (state.canSubmit && !isReplying) {
          handleSubmit()
        }
      }
    },
    [onCancel, form.id, state.canSubmit, isReplying, handleSubmit],
  )

  return (
    <div className="space-y-2" onKeyDown={handleKeyDown}>
      {/* question 表单的 title 是服务端硬编码的 "Questions"
          （packages/core/src/tool/plugin/question.ts:77），与工具头/步骤文案
          重复——官方 SessionQuestionDock 也不渲染它；其它类型表单保留标题 */}
      {form.title && (form.metadata as Record<string, unknown> | undefined)?.kind !== 'question' && (
        <div className="text-[length:var(--fs-md)] text-text-100">{form.title}</div>
      )}

      <div className="space-y-3">
        {state.visibleFields.map(field => (
          <FormFieldInput key={field.key} field={field} state={state} />
        ))}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!state.canSubmit || isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] font-medium bg-text-100 text-bg-000 hover:bg-text-200 transition-colors disabled:opacity-50"
        >
          {t('common:submit')}
        </button>
        <button
          onClick={() => onCancel(form.id)}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors disabled:opacity-50"
        >
          {t('common:skip')}
        </button>
      </div>
    </div>
  )
})
