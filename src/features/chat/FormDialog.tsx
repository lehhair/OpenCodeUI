/**
 * FormDialog —— OpenCode V2 的「表单」渲染器（取代 V1 的 QuestionDialog）
 *
 * ── 为什么是新组件而不是改造 QuestionDialog ──────────────────────────────
 * V1 的 question 是「一组单选题」，V2 的 Form 是「一张带类型/校验/条件显示的表单」：
 *
 *   V1 `QuestionRequest` = `{ questions: [{question, header, options[], multiple, custom?}] }`
 *   V2 `Form.Info`       = `{ title, fields: FormField[] }`
 *
 * 六种字段类型（string / number / integer / boolean / multiselect / external）、
 * `when` 条件显示、`required`/`pattern`/`minLength`… 校验，都是 V1 没有的，
 * 所以按迁移文档 §4.3 的说法，这是**新增 UI 能力**。
 *
 * ── 渲染方案（按 openapi + v2.0.19 服务端 `packages/core/src/form.ts` 核实）──
 *
 *   | 字段类型 | 控件 | 提交值 |
 *   |---|---|---|
 *   | `string`（有 `options`） | 选项按钮组（`custom:true` 时另给自由输入） | `string`（option 的 **value**） |
 *   | `string`（无 `options`） | 单行输入（按 `format` 用原生 email/url/date/datetime-local） | `string` |
 *   | `number` | `<input type="number" step="any">` | `number` |
 *   | `integer` | `<input type="number" step="1">` | `number`（整数） |
 *   | `boolean` | 勾选按钮 | `boolean`（**false 也要提交**） |
 *   | `multiselect` | 多选按钮组（`custom:true` 时另给追加输入） | `string[]` |
 *   | `external` | 链接 + **确认勾选** | `true`（见下） |
 *
 *   🔴 **`external` 字段必须被确认为 `true`**：服务端 `validateAnswer` 里
 *      `if (field.type === 'external') { if (value !== true) return 'External form field must be acknowledged' }`
 *      —— 它不是「可选的展示项」，而是**永远必填的确认位**（字段里没有 `required` 也一样）。
 *      所以这里渲染成「打开链接」+「我已确认」两段式。
 *
 *   🔴 **`when` 条件由前端求值**（服务端不校验显示条件，但会**拒绝**「条件不成立却带了值」的字段）。
 *      求值逻辑全部在 `src/api/form.ts` 的 `resolveVisibility()`，与服务的 `isActive` 逐字对齐。
 *
 * ── 交互约定（对齐现有 QuestionDialog，用户无感切换）──────────────────────
 *   - Escape            → 取消表单（`DELETE .../form/{formID}`）
 *   - send 键位         → 提交（仅在校验通过时）
 *   - 底部动作条        → 「提交」+「跳过」
 *   - 与 PermissionDialog / QuestionDialog 共用同一套视觉与弹入动画
 */

import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, ReturnIcon, ChevronDownIcon, ExternalLinkIcon, QuestionIcon } from '../../components/Icons'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import { usePresence } from '../../hooks'
import { useChatViewport } from './chatViewport'
import {
  buildFormAnswer,
  coerceFieldValue,
  resolveVisibility,
  validateForm,
  type FormAnswer,
  type FormDraft,
  type FormField,
  type FormFieldOfType,
  type FormInfo,
} from '../../api/form'

interface FormDialogProps {
  form: FormInfo
  /** 提交：已组装好的答案映射（字段 key → FormValue） */
  onSubmit: (answer: FormAnswer) => void
  /** 取消（等价于 V1 的「跳过」） */
  onCancel: () => void
  queueLength?: number
  isReplying?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

/** 界面草稿的初始值：尽量用字段的 `default`，否则给空 */
function initialDraft(fields: FormField[]): FormDraft {
  const draft: FormDraft = {}
  for (const field of fields) {
    switch (field.type) {
      case 'string':
        draft[field.key] = field.default ?? ''
        break
      case 'number':
      case 'integer':
        draft[field.key] = field.default === undefined ? '' : String(field.default)
        break
      case 'boolean':
        draft[field.key] = field.default ?? false
        break
      case 'multiselect':
        draft[field.key] = field.default ? [...field.default] : []
        break
      case 'external':
        // external 的「值」是确认位：默认未确认
        draft[field.key] = false
        break
    }
  }
  return draft
}

export const FormDialog = memo(function FormDialog({
  form,
  onSubmit,
  onCancel,
  queueLength = 1,
  isReplying = false,
  collapsed = false,
  onCollapsedChange,
}: FormDialogProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { presentation } = useChatViewport()
  const isCompact = presentation.isCompact

  const [draft, setDraft] = useState<FormDraft>(() => initialDraft(form.fields))
  const [showErrors, setShowErrors] = useState(false)

  const fields = form.fields

  // 可见性（`when` 求值）。草稿变化 → 可见性跟着变（联动显示）
  const visible = useMemo(() => resolveVisibility(fields, draft), [fields, draft])

  // 校验（语义与服务端 validateAnswer/validateField 对齐，见 src/api/form.ts）
  const validation = useMemo(() => validateForm(fields, draft), [fields, draft])
  const canSubmit = validation.ok

  const setValue = useCallback((key: string, value: string | boolean | string[]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      // 第一次提交失败 → 把错误提示显示出来（此前不显示，避免刚打开就一片红）
      setShowErrors(true)
      return
    }
    onSubmit(buildFormAnswer(fields, draft))
  }, [canSubmit, fields, draft, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      const sendKey = keybindingStore.getKey('sendMessage')
      if (sendKey && matchesKeybinding(e.nativeEvent, sendKey)) {
        e.preventDefault()
        if (!isReplying) handleSubmit()
      }
    },
    [onCancel, isReplying, handleSubmit],
  )

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
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center justify-center text-text-100 w-5 h-5 shrink-0">
                  <QuestionIcon />
                </div>
                <h3 className="text-[length:var(--fs-base)] leading-none font-medium text-text-100 truncate">
                  {form.title || t('formDialog.title')}
                </h3>
                {queueLength > 1 && (
                  <span className="text-[length:var(--fs-sm)] text-text-400 bg-bg-200 px-1.5 py-0.5 rounded shrink-0">
                    {t('questionDialog.moreCount', { count: queueLength - 1 })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onCollapsedChange?.(true)}
                className="p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200 transition-colors shrink-0"
                title={t('questionDialog.minimize')}
                aria-label={t('questionDialog.minimize')}
              >
                <ChevronDownIcon size={16} />
              </button>
            </div>

            <div className="border-t border-border-300/30" />

            {/* Fields */}
            <div className="px-4 py-3 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
              {fields.map((field, idx) => (
                <FormFieldView
                  key={`${field.key}:${idx}`}
                  field={field}
                  value={draft[field.key]}
                  visible={visible[field.key] !== false}
                  error={showErrors ? validation.errors[field.key] : undefined}
                  onChange={value => setValue(field.key, value)}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="px-3 py-3 space-y-[6px]">
              <button
                onClick={handleSubmit}
                disabled={isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg bg-text-100 text-bg-000 hover:bg-text-200 transition-colors font-medium text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{isReplying ? t('common:sending') : t('common:submit')}</span>
                {!isReplying && <ReturnIcon />}
              </button>

              <button
                onClick={onCancel}
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
})

// ============================================
// 单个字段
// ============================================

interface FormFieldViewProps {
  field: FormField
  value: string | boolean | string[] | undefined
  visible: boolean
  error?: string
  onChange: (value: string | boolean | string[]) => void
}

function FormFieldView({ field, value, visible, error, onChange }: FormFieldViewProps) {
  const { t } = useTranslation('chat')

  // `when` 条件不满足 → 不渲染（服务端不校验显示条件，纯前端职责）
  if (!visible) return null

  // `hidden` 字段也不渲染（它的值通常由其它机制填充）
  if (field.type !== 'external' && field.hidden) return null

  return (
    <div className="space-y-1.5">
      <FieldLabel
        // ⚠️ boolean 的按钮里已经显示了 `title`，这里不再重复渲染标题（只保留 description）
        title={field.type === 'boolean' ? undefined : field.title}
        description={field.description}
        // ⚠️ external 没有 `required` 字段，但服务端**永远要求确认** → 标上必填星号
        required={field.type === 'external' ? true : field.required}
      />
      {renderControl(field, value, onChange, t)}
      {error && <p className="text-[length:var(--fs-sm)] text-danger-100">{error}</p>}
    </div>
  )
}

function FieldLabel({ title, description, required }: { title?: string; description?: string; required?: boolean }) {
  if (!title && !description && !required) return null
  return (
    <div>
      <div className="flex items-center gap-1">
        {title && <span className="text-[length:var(--fs-base)] text-text-100">{title}</span>}
        {required && <span className="text-danger-100 text-[length:var(--fs-sm)]">*</span>}
      </div>
      {description && <p className="text-[length:var(--fs-sm)] text-text-400 mt-0.5">{description}</p>}
    </div>
  )
}

/** 输入控件（按字段类型分支） */
function renderControl(
  field: FormField,
  value: string | boolean | string[] | undefined,
  onChange: (value: string | boolean | string[]) => void,
  t: (key: string) => string,
) {
  switch (field.type) {
    case 'string':
      return <StringControl field={field} value={typeof value === 'string' ? value : ''} onChange={onChange} t={t} />
    case 'number':
    case 'integer':
      return <NumberControl field={field} value={typeof value === 'string' ? value : ''} onChange={onChange} />
    case 'boolean':
      return <BooleanControl field={field} value={value === true} onChange={onChange} />
    case 'multiselect':
      return <MultiselectControl field={field} value={Array.isArray(value) ? value : []} onChange={onChange} t={t} />
    case 'external':
      return <ExternalControl field={field} acknowledged={value === true} onChange={onChange} t={t} />
    default:
      return null
  }
}

// ---- string ----
function StringControl({
  field,
  value,
  onChange,
  t,
}: {
  field: FormFieldOfType<'string'>
  value: string
  onChange: (v: string) => void
  t: (key: string) => string
}) {
  const hasOptions = (field.options?.length ?? 0) > 0
  // ⚠️ 闭集选项：有 options 且 `custom !== true` 时，服务端**只接受 option 的 value**
  //    （`validateField`：`if (field.options && !field.custom && !field.options.some(...)) → Invalid option`）
  //    → 这时不能给自由输入框，否则用户填什么都被拒。
  const allowCustom = field.custom === true
  const isCustomValue = hasOptions && value !== '' && !field.options!.some(o => o.value === value)
  const [customMode, setCustomMode] = useState(isCustomValue)

  if (hasOptions) {
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {field.options!.map(option => {
            const selected = value === option.value && !customMode
            return (
              <button
                key={option.value}
                onClick={() => {
                  setCustomMode(false)
                  onChange(option.value)
                }}
                title={option.description}
                className={`inline-flex min-h-7 items-start gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 rounded-md border transition-all ${
                  selected
                    ? 'border-text-100 text-text-100 bg-bg-300/40'
                    : 'border-border-200/60 text-text-300 hover:border-text-400 hover:text-text-200'
                }`}
              >
                <span className="min-w-0 whitespace-normal break-words text-left">{option.label}</span>
              </button>
            )
          })}
        </div>
        {allowCustom && (
          <input
            type={inputTypeFor(field.format)}
            value={customMode ? value : ''}
            placeholder={field.placeholder ?? t('questionDialog.typeYourAnswer')}
            onFocus={() => setCustomMode(true)}
            onChange={e => {
              setCustomMode(true)
              onChange(e.target.value)
            }}
            className="w-full px-2.5 py-1.5 rounded-md border border-border-200/60 bg-transparent text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-text-400"
          />
        )}
      </div>
    )
  }

  return (
    <input
      type={inputTypeFor(field.format)}
      value={value}
      placeholder={field.placeholder ?? ''}
      minLength={field.minLength}
      maxLength={field.maxLength}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 rounded-md border border-border-200/60 bg-transparent text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-text-400"
    />
  )
}

/** `format` → 原生 input type（浏览器自带的校验与日期选择器比手写更可靠） */
function inputTypeFor(format?: 'email' | 'uri' | 'date' | 'date-time'): string {
  switch (format) {
    case 'email':
      return 'email'
    case 'uri':
      return 'url'
    case 'date':
      return 'date'
    case 'date-time':
      return 'datetime-local'
    default:
      return 'text'
  }
}

// ---- number / integer ----
function NumberControl({
  field,
  value,
  onChange,
}: {
  field: FormFieldOfType<'number'> | FormFieldOfType<'integer'>
  value: string
  onChange: (v: string) => void
}) {
  const step = field.type === 'integer' ? 1 : 'any'
  // 数值特殊值（Infinity 等）不能塞进 <input type="number"> 的 min/max，忽略之
  const min = typeof field.minimum === 'number' ? field.minimum : undefined
  const max = typeof field.maximum === 'number' ? field.maximum : undefined
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 rounded-md border border-border-200/60 bg-transparent text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-text-400"
    />
  )
}

// ---- boolean ----
function BooleanControl({
  field,
  value,
  onChange,
}: {
  field: FormFieldOfType<'boolean'>
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
        value ? 'border-text-100 bg-bg-200' : 'border-border-200/50 hover:bg-bg-200'
      }`}
    >
      <span
        className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
          value ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
        }`}
      >
        {value && <CheckIcon size={10} className="shrink-0" />}
      </span>
      <span className="text-[length:var(--fs-base)] text-text-100">{field.title ?? field.key}</span>
    </button>
  )
}

// ---- multiselect ----
function MultiselectControl({
  field,
  value,
  onChange,
  t,
}: {
  field: FormFieldOfType<'multiselect'>
  value: string[]
  onChange: (v: string[]) => void
  t: (key: string) => string
}) {
  // 同 string：`custom !== true` 时服务端只接受 options 里的值
  const allowCustom = field.custom === true
  const knownValues = new Set(field.options.map(o => o.value))
  const customValues = value.filter(v => !knownValues.has(v))
  const [customDraft, setCustomDraft] = useState('')

  const toggle = (optionValue: string) => {
    onChange(value.includes(optionValue) ? value.filter(v => v !== optionValue) : [...value, optionValue])
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {field.options.map(option => {
          const selected = value.includes(option.value)
          return (
            <button
              key={option.value}
              onClick={() => toggle(option.value)}
              title={option.description}
              className={`inline-flex min-h-7 items-start gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 rounded-md border transition-all ${
                selected
                  ? 'border-text-100 text-text-100 bg-bg-300/40'
                  : 'border-border-200/60 text-text-300 hover:border-text-400 hover:text-text-200'
              }`}
            >
              <span className="inline-flex h-5 w-3.5 shrink-0 items-center justify-center">
                <span
                  className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                    selected ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
                  }`}
                >
                  {selected && <CheckIcon size={10} className="shrink-0" />}
                </span>
              </span>
              <span className="min-w-0 whitespace-normal break-words text-left">{option.label}</span>
            </button>
          )
        })}
      </div>

      {/* 已填的自定义值（可删） */}
      {customValues.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customValues.map(v => (
            <button
              key={v}
              onClick={() => onChange(value.filter(item => item !== v))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-text-100 text-text-100 text-[length:var(--fs-sm)]"
            >
              {v} <span className="text-text-400">×</span>
            </button>
          ))}
        </div>
      )}

      {allowCustom && (
        <input
          value={customDraft}
          placeholder={t('questionDialog.typeYourAnswer')}
          onChange={e => setCustomDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const trimmed = customDraft.trim()
            if (!trimmed || value.includes(trimmed)) return
            onChange([...value, trimmed])
            setCustomDraft('')
          }}
          className="w-full px-2.5 py-1.5 rounded-md border border-border-200/60 bg-transparent text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-text-400"
        />
      )}
    </div>
  )
}

// ---- external ----
/**
 * `external` 字段：链接 + 确认位
 *
 * 🔴 服务端强制 `answer[key] === true`（`External form field must be acknowledged`），
 *    所以这里必须给一个显式的确认动作，不能只渲染链接。
 */
function ExternalControl({
  field,
  acknowledged,
  onChange,
  t,
}: {
  field: FormFieldOfType<'external'>
  acknowledged: boolean
  onChange: (v: boolean) => void
  t: (key: string) => string
}) {
  return (
    <div className="space-y-1.5">
      <a
        href={field.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-200/60 text-text-200 hover:bg-bg-200 transition-colors text-[length:var(--fs-base)]"
      >
        <ExternalLinkIcon size={14} />
        <span>{t('formDialog.openExternal')}</span>
      </a>
      <button
        type="button"
        onClick={() => onChange(!acknowledged)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
          acknowledged ? 'border-text-100 bg-bg-200' : 'border-border-200/50 hover:bg-bg-200'
        }`}
      >
        <span
          className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
            acknowledged ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
          }`}
        >
          {acknowledged && <CheckIcon size={10} className="shrink-0" />}
        </span>
        <span className="text-[length:var(--fs-base)] text-text-100">{t('formDialog.acknowledge')}</span>
      </button>
    </div>
  )
}

/** 供测试引用：把草稿里某个字段的值转成提交值（等价 `buildFormAnswer` 的单项行为） */
export { coerceFieldValue }
