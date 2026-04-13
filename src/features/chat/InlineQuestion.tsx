/**
 * InlineQuestion — 融入信息流的提问交互
 *
 * 紧凑的 inline 卡片，选项清晰，自定义输入居中对齐。
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon } from '../../components/Icons'
import type { ApiQuestionRequest, ApiQuestionInfo, QuestionAnswer } from '../../api'

interface InlineQuestionProps {
  request: ApiQuestionRequest
  onReply: (requestId: string, answers: QuestionAnswer[]) => void
  onReject: (requestId: string) => void
  isReplying: boolean
}

export const InlineQuestion = memo(function InlineQuestion({
  request,
  onReply,
  onReject,
  isReplying,
}: InlineQuestionProps) {
  const { t } = useTranslation(['chat', 'common'])

  const [answers, setAnswers] = useState<Map<number, Set<string>>>(() => {
    const map = new Map<number, Set<string>>()
    request.questions.forEach((_, idx) => map.set(idx, new Set()))
    return map
  })

  const [customEnabled, setCustomEnabled] = useState<Map<number, boolean>>(() => {
    const map = new Map<number, boolean>()
    request.questions.forEach((_, idx) => map.set(idx, false))
    return map
  })

  const [customValues, setCustomValues] = useState<Map<number, string>>(() => {
    const map = new Map<number, string>()
    request.questions.forEach((_, idx) => map.set(idx, ''))
    return map
  })

  const selectOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => {
      const m = new Map(prev)
      m.set(qIdx, new Set([label]))
      return m
    })
    setCustomEnabled(prev => {
      const m = new Map(prev)
      m.set(qIdx, false)
      return m
    })
  }, [])

  const selectCustom = useCallback((qIdx: number) => {
    setAnswers(prev => {
      const m = new Map(prev)
      m.set(qIdx, new Set())
      return m
    })
    setCustomEnabled(prev => {
      const m = new Map(prev)
      m.set(qIdx, true)
      return m
    })
  }, [])

  const toggleOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => {
      const m = new Map(prev)
      const s = new Set(prev.get(qIdx) || [])
      if (s.has(label)) s.delete(label)
      else s.add(label)
      m.set(qIdx, s)
      return m
    })
  }, [])

  const toggleCustom = useCallback((qIdx: number) => {
    setCustomEnabled(prev => {
      const m = new Map(prev)
      m.set(qIdx, !prev.get(qIdx))
      return m
    })
  }, [])

  const updateCustomValue = useCallback((qIdx: number, value: string) => {
    setCustomValues(prev => {
      const m = new Map(prev)
      m.set(qIdx, value)
      return m
    })
  }, [])

  const handleSubmit = useCallback(() => {
    const result: QuestionAnswer[] = request.questions.map((q, idx) => {
      const selected = Array.from(answers.get(idx) || [])
      const isCustom = customEnabled.get(idx)
      const customValue = customValues.get(idx)?.trim()
      if (q.multiple) {
        return isCustom && customValue && q.custom !== false ? [...selected, customValue] : selected
      }
      return isCustom && customValue ? [customValue] : selected
    })
    onReply(request.id, result)
  }, [request, answers, customEnabled, customValues, onReply])

  const canSubmit = request.questions.every((_q, idx) => {
    const selected = answers.get(idx) || new Set()
    const isCustom = customEnabled.get(idx)
    const customValue = customValues.get(idx)?.trim()
    return selected.size > 0 || (isCustom && !!customValue)
  })

  return (
    <div className="space-y-2">
      {/* 问题列表 */}
      <div className="space-y-3">
        {request.questions.map((question, qIdx) => (
          <InlineQuestionItem
            key={qIdx}
            question={question}
            selected={answers.get(qIdx) || new Set()}
            isCustomEnabled={customEnabled.get(qIdx) || false}
            customValue={customValues.get(qIdx) || ''}
            onSelectOption={label => selectOption(qIdx, label)}
            onSelectCustom={() => selectCustom(qIdx)}
            onToggleOption={label => toggleOption(qIdx, label)}
            onToggleCustom={() => toggleCustom(qIdx)}
            onCustomValueChange={value => updateCustomValue(qIdx, value)}
          />
        ))}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] font-medium bg-text-100 text-bg-000 hover:bg-text-200 transition-colors disabled:opacity-50"
        >
          {t('common:submit')}
        </button>
        <button
          onClick={() => onReject(request.id)}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors disabled:opacity-50"
        >
          {t('common:skip')}
        </button>
      </div>
    </div>
  )
})

// ============================================
// InlineQuestionItem
// ============================================

interface InlineQuestionItemProps {
  question: ApiQuestionInfo
  selected: Set<string>
  isCustomEnabled: boolean
  customValue: string
  onSelectOption: (label: string) => void
  onSelectCustom: () => void
  onToggleOption: (label: string) => void
  onToggleCustom: () => void
  onCustomValueChange: (value: string) => void
}

function InlineQuestionItem({
  question,
  selected,
  isCustomEnabled,
  customValue,
  onSelectOption,
  onSelectCustom,
  onToggleOption,
  onToggleCustom,
  onCustomValueChange,
}: InlineQuestionItemProps) {
  const { t } = useTranslation('chat')
  const isMultiple = question.multiple || false
  const allowCustom = question.custom !== false
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isCustomEnabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isCustomEnabled])

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 100)}px`
    }
  }, [])

  return (
    <div className="space-y-2">
      {/* 问题文字 */}
      <div>
        {question.header && <div className="text-[length:var(--fs-xs)] text-text-400 font-medium mb-0.5">{question.header}</div>}
        <div className="text-[length:var(--fs-md)] text-text-100">{question.question}</div>
      </div>

      {/* 选项 — 紧凑按钮组 */}
      <div className="flex flex-wrap gap-1.5">
        {question.options.map((option, idx) => {
          const isSelected = selected.has(option.label)
          return (
            <button
              key={idx}
              onClick={() => (isMultiple ? onToggleOption(option.label) : onSelectOption(option.label))}
              title={option.description}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] rounded-md border transition-all ${
                isSelected
                  ? 'border-text-100 text-text-100 bg-bg-300/40'
                  : 'border-border-200/60 text-text-300 hover:border-text-400 hover:text-text-200'
              }`}
            >
              {isMultiple && (
                <span
                  className={`inline-flex w-3.5 h-3.5 rounded items-center justify-center border transition-colors ${
                    isSelected ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
                  }`}
                >
                  {isSelected && <CheckIcon size={10} />}
                </span>
              )}
              {option.label}
            </button>
          )
        })}
      </div>

      {/* 自定义输入 */}
      {allowCustom && (
        <div
          onClick={() => {
            if (!isCustomEnabled) {
              if (isMultiple) onToggleCustom()
              else onSelectCustom()
            }
          }}
          className={`flex items-center rounded-md border transition-colors ${
            isCustomEnabled ? 'border-text-100 bg-bg-300/20' : 'border-border-200/60 hover:border-text-400'
          }`}
        >
          {isMultiple && (
            <span
              className={`ml-2.5 inline-flex w-3.5 h-3.5 rounded items-center justify-center border shrink-0 transition-colors ${
                isCustomEnabled ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
              }`}
            >
              {isCustomEnabled && <CheckIcon size={10} />}
            </span>
          )}
          <textarea
            ref={textareaRef}
            value={customValue}
            onChange={e => {
              onCustomValueChange(e.target.value)
              adjustHeight()
            }}
            onClick={e => {
              e.stopPropagation()
              if (!isCustomEnabled) {
                if (isMultiple) onToggleCustom()
                else onSelectCustom()
              }
            }}
            placeholder={t('questionDialog.typeYourAnswer')}
            rows={1}
            className="flex-1 bg-transparent text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-500 focus:outline-none resize-none min-h-[32px] px-2.5 py-1.5 leading-relaxed"
          />
        </div>
      )}
    </div>
  )
}
