import { useState, useCallback, useRef, useEffect } from 'react'
import { QuestionIcon, CheckIcon, ReturnIcon, ChevronDownIcon } from '../../components/Icons'
import type { ApiQuestionRequest, ApiQuestionInfo, QuestionAnswer } from '../../api'

interface QuestionDialogProps {
  request: ApiQuestionRequest
  onReply: (answers: QuestionAnswer[]) => void
  onReject: () => void
  queueLength?: number
  isReplying?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

export function QuestionDialog({ request, onReply, onReject, queueLength = 1, isReplying = false, collapsed = false, onCollapsedChange }: QuestionDialogProps) {
  // 每个问题选中的选项 labels
  const [answers, setAnswers] = useState<Map<number, Set<string>>>(() => {
    const map = new Map<number, Set<string>>()
    request.questions.forEach((_, idx) => map.set(idx, new Set()))
    return map
  })
  
  // 每个问题是否启用了自定义输入
  const [customEnabled, setCustomEnabled] = useState<Map<number, boolean>>(() => {
    const map = new Map<number, boolean>()
    request.questions.forEach((_, idx) => map.set(idx, false))
    return map
  })
  
  // 每个问题的自定义输入值
  const [customValues, setCustomValues] = useState<Map<number, string>>(() => {
    const map = new Map<number, string>()
    request.questions.forEach((_, idx) => map.set(idx, ''))
    return map
  })

  // 单选：选择一个选项
  const selectOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, new Set([label]))
      return newMap
    })
    // 取消自定义
    setCustomEnabled(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, false)
      return newMap
    })
  }, [])

  // 单选：选择自定义
  const selectCustom = useCallback((qIdx: number) => {
    setAnswers(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, new Set())
      return newMap
    })
    setCustomEnabled(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, true)
      return newMap
    })
  }, [])

  // 多选：toggle 选项
  const toggleOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => {
      const newMap = new Map(prev)
      const current = new Set(prev.get(qIdx) || [])
      if (current.has(label)) {
        current.delete(label)
      } else {
        current.add(label)
      }
      newMap.set(qIdx, current)
      return newMap
    })
  }, [])

  // 多选：toggle 自定义启用状态
  const toggleCustom = useCallback((qIdx: number) => {
    setCustomEnabled(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, !prev.get(qIdx))
      return newMap
    })
  }, [])

  // 更新自定义输入值
  const updateCustomValue = useCallback((qIdx: number, value: string) => {
    setCustomValues(prev => {
      const newMap = new Map(prev)
      newMap.set(qIdx, value)
      return newMap
    })
  }, [])

  // 提交
  const handleSubmit = useCallback(() => {
    const result: QuestionAnswer[] = request.questions.map((q, idx) => {
      const selected = Array.from(answers.get(idx) || [])
      const isCustomEnabled = customEnabled.get(idx)
      const customValue = customValues.get(idx)?.trim()
      
      if (q.multiple) {
        // 多选：合并选中的选项 + 启用的自定义值
        if (isCustomEnabled && customValue && q.custom !== false) {
          return [...selected, customValue]
        }
        return selected
      } else {
        // 单选：要么是选中的选项，要么是自定义值
        if (isCustomEnabled && customValue) {
          return [customValue]
        }
        return selected
      }
    })
    onReply(result)
  }, [request.questions, answers, customEnabled, customValues, onReply])

  // 检查能否提交
  const canSubmit = request.questions.every((q, idx) => {
    const selected = answers.get(idx) || new Set()
    const isCustomEnabled = customEnabled.get(idx)
    const customValue = customValues.get(idx)?.trim()
    
    if (q.multiple) {
      // 多选：有选项或（启用自定义且有值）
      return selected.size > 0 || (isCustomEnabled && customValue)
    } else {
      // 单选：有选项，或（选了自定义且有值）
      return selected.size > 0 || (isCustomEnabled && customValue)
    }
  })

  // 折叠态：由 InputBox 渲染胶囊，这里不渲染任何内容
  if (collapsed) return null

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[50]">
      <div className="mx-auto max-w-3xl px-4 pb-4">
        <div className="border border-border-300/40 rounded-[14px] shadow-float bg-bg-100 overflow-hidden">
          <div className="bg-bg-000 rounded-t-[14px]">
            {/* Header */}
            <div className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center text-text-100 w-5 h-5">
                  <QuestionIcon />
                </div>
                <h3 className="text-sm font-medium text-text-100">Question</h3>
                {queueLength > 1 && (
                  <span className="text-xs text-text-400 bg-bg-200 px-1.5 py-0.5 rounded">
                    +{queueLength - 1} more
                  </span>
                )}
              </div>
              <button
                onClick={() => onCollapsedChange?.(true)}
                className="p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200 transition-colors"
                title="Minimize"
              >
                <ChevronDownIcon size={16} />
              </button>
            </div>

            <div className="border-t border-border-300/30" />

            {/* Questions */}
            <div className="px-4 py-3 space-y-5 max-h-[50vh] overflow-y-auto custom-scrollbar">
              {request.questions.map((question, qIdx) => (
                <QuestionItem
                  key={qIdx}
                  question={question}
                  selected={answers.get(qIdx) || new Set()}
                  isCustomEnabled={customEnabled.get(qIdx) || false}
                  customValue={customValues.get(qIdx) || ''}
                  onSelectOption={(label) => selectOption(qIdx, label)}
                  onSelectCustom={() => selectCustom(qIdx)}
                  onToggleOption={(label) => toggleOption(qIdx, label)}
                  onToggleCustom={() => toggleCustom(qIdx)}
                  onCustomValueChange={(value) => updateCustomValue(qIdx, value)}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="px-3 py-3 space-y-[6px]">
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg bg-text-100 text-bg-000 hover:bg-text-200 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{isReplying ? 'Sending...' : 'Submit'}</span>
                {!isReplying && <ReturnIcon />}
              </button>

              <button
                onClick={onReject}
                disabled={isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-text-300 hover:bg-bg-200 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>Skip</span>
                <span className="text-xs text-text-500">Esc</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// 单个问题
interface QuestionItemProps {
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

function QuestionItem({
  question,
  selected,
  isCustomEnabled,
  customValue,
  onSelectOption,
  onSelectCustom,
  onToggleOption,
  onToggleCustom,
  onCustomValueChange,
}: QuestionItemProps) {
  const isMultiple = question.multiple || false
  const allowCustom = question.custom !== false
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动调整 textarea 高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [])

  // 单选模式下，选中自定义时自动聚焦
  useEffect(() => {
    if (!isMultiple && isCustomEnabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isMultiple, isCustomEnabled])

  // 多选模式下，启用自定义时自动聚焦
  useEffect(() => {
    if (isMultiple && isCustomEnabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isMultiple, isCustomEnabled])

  return (
    <div className="space-y-2.5">
      {/* Question text */}
      <div>
        <p className="text-xs text-text-400 mb-0.5">{question.header}</p>
        <p className="text-sm text-text-100">{question.question}</p>
      </div>

      {/* Options */}
      <div className="space-y-1.5">
        {question.options.map((option, idx) => {
          const isSelected = selected.has(option.label)
          
          return (
            <button
              key={idx}
              onClick={() => isMultiple ? onToggleOption(option.label) : onSelectOption(option.label)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                isSelected
                  ? 'border-text-100 bg-bg-200'
                  : 'border-border-200/50 hover:bg-bg-200'
              }`}
            >
              <Indicator type={isMultiple ? 'checkbox' : 'radio'} checked={isSelected} />
              
              <div className="flex-1 min-w-0">
                <span className="text-sm text-text-100">{option.label}</span>
                {option.description && (
                  <p className="text-xs text-text-400 mt-0.5">{option.description}</p>
                )}
              </div>
            </button>
          )
        })}

        {/* Custom option */}
        {allowCustom && (
          <div
            onClick={() => isMultiple ? onToggleCustom() : onSelectCustom()}
            className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
              isCustomEnabled
                ? 'border-text-100 bg-bg-200'
                : 'border-border-200/50 hover:bg-bg-200'
            }`}
          >
            <div className="pt-0.5">
              <Indicator type={isMultiple ? 'checkbox' : 'radio'} checked={isCustomEnabled} />
            </div>
            
            <textarea
              ref={textareaRef}
              value={customValue}
              onChange={(e) => {
                onCustomValueChange(e.target.value)
                adjustTextareaHeight()
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (!isCustomEnabled) {
                  if (isMultiple) onToggleCustom()
                  else onSelectCustom()
                }
              }}
              placeholder="Type your own answer..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-text-100 placeholder:text-text-500 focus:outline-none resize-none min-h-[20px]"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// Radio / Checkbox indicator
function Indicator({ type, checked }: { type: 'radio' | 'checkbox'; checked: boolean }) {
  const baseClass = `flex-shrink-0 w-[18px] h-[18px] border-2 flex items-center justify-center transition-colors`
  const shapeClass = type === 'radio' ? 'rounded-full' : 'rounded'
  const stateClass = checked
    ? 'border-text-100 bg-text-100 text-bg-000'
    : 'border-border-300'

  return (
    <span className={`${baseClass} ${shapeClass} ${stateClass}`}>
      {checked && <CheckIcon />}
    </span>
  )
}
