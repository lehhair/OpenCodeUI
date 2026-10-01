import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { QuestionIcon, ReturnIcon, ChevronDownIcon } from '../../components/Icons'
import type { ApiFormInfo, FormAnswer } from '../../api'
import { FormFieldInput, useFormState } from './formFields'
import { usePresence } from '../../hooks'
import { useChatViewport } from './chatViewport'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'

interface QuestionDialogProps {
  form: ApiFormInfo
  onReply: (formId: string, answer: FormAnswer) => void
  onCancel: (formId: string) => void
  queueLength?: number
  isReplying?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

/**
 * 表单弹窗（停靠在输入框上方）。
 *
 * v2 把 v1 的 question 换成 form：字段类型从「只有选项」扩展到 6 种，
 * 答案从位置数组变成 { [field.key]: FormValue }。字段渲染与作答状态
 * 与内联卡片共用 ./formFields，这里只保留弹窗的排版、动画与动作栏。
 */
export function QuestionDialog({
  form,
  onReply,
  onCancel,
  queueLength = 1,
  isReplying = false,
  collapsed = false,
  onCollapsedChange,
}: QuestionDialogProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { presentation } = useChatViewport()
  const isCompact = presentation.isCompact
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

  // 弹出/收起动画
  const { shouldRender, ref: animRef } = usePresence<HTMLDivElement>(!collapsed, {
    from: { opacity: 0, transform: 'translateY(16px)' },
    to: { opacity: 1, transform: 'translateY(0px)' },
    duration: 0.2,
  })

  if (!shouldRender) return null

  return (
    <div ref={animRef} className="absolute bottom-0 left-0 right-0 z-[10]" onKeyDown={handleKeyDown}>
      <div
        className="mx-auto max-w-3xl pointer-events-auto transition-[max-width] duration-300 ease-in-out pb-2"
        style={{
          paddingLeft: isCompact ? 6 : 14,
          paddingRight: isCompact ? 6 : 14,
          paddingBottom: 'max(8px, var(--safe-area-inset-bottom, 8px))',
        }}
      >
        <div className="border border-border-300/40 rounded-[14px] shadow-float bg-bg-100 overflow-hidden">
          <div className="bg-bg-000 rounded-t-[14px]">
            {/* Header */}
            <div className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center text-text-100 w-5 h-5">
                  <QuestionIcon />
                </div>
                <h3 className="text-[length:var(--fs-base)] leading-none font-medium text-text-100">
                  {form.title || t('questionDialog.title')}
                </h3>
                {queueLength > 1 && (
                  <span className="text-[length:var(--fs-sm)] text-text-400 bg-bg-200 px-1.5 py-0.5 rounded">
                    {t('questionDialog.moreCount', { count: queueLength - 1 })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onCollapsedChange?.(true)}
                className="p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200 transition-colors"
                title={t('questionDialog.minimize')}
                aria-label={t('questionDialog.minimize')}
              >
                <ChevronDownIcon size={16} />
              </button>
            </div>

            <div className="border-t border-border-300/30" />

            {/* 字段 */}
            <div className="px-4 py-3 space-y-5 max-h-[50vh] overflow-y-auto custom-scrollbar">
              {state.visibleFields.map(field => (
                <FormFieldInput key={field.key} field={field} state={state} />
              ))}
            </div>

            {/* Actions */}
            <div className="px-3 py-3 space-y-[6px]">
              <button
                onClick={handleSubmit}
                disabled={!state.canSubmit || isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg bg-text-100 text-bg-000 hover:bg-text-200 transition-colors font-medium text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{isReplying ? t('common:sending') : t('common:submit')}</span>
                {!isReplying && <ReturnIcon />}
              </button>

              <button
                onClick={() => onCancel(form.id)}
                disabled={isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-text-300 hover:bg-bg-200 transition-colors text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{t('common:skip')}</span>
                <span className="text-[length:var(--fs-sm)] text-text-500">{t('common:esc')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
