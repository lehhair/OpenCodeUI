import type React from 'react'

// ============================================
// Shared Settings UI Primitives
// section + border-bottom 分隔，
// 标题左+描述左+控件右，无装饰图标，干净利落。
// ============================================

/**
 * Toggle switch — 36×20，即时生效。
 * 圆角 full，hover 有 ring 反馈，checked 时 accent 色。
 */
export function Toggle({
  enabled,
  onChange,
  ariaLabel,
}: {
  enabled: boolean
  onChange: () => void
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      onClick={e => {
        e.stopPropagation()
        onChange()
      }}
      className={`group/switch relative select-none cursor-pointer rounded-full transition-all
        ring-[0.5px] ring-border-200 hover:ring-[1px]
        focus-visible:outline focus-visible:outline-[1px] focus-visible:outline-accent-main-100 focus-visible:outline-offset-2
        ${enabled ? 'bg-accent-main-100 !ring-[0px] hover:!ring-[1px] hover:ring-accent-main-100/60' : 'bg-bg-300'}`}
      style={{ width: 36, height: 20 }}
    >
      <div
        className={`absolute flex items-center justify-center top-[2px] left-[2px] rounded-full transition-all
          bg-white ring-[0.5px] ring-inset ring-border-200
          ${enabled ? '!ring-[0px]' : ''}`}
        style={{
          height: 16,
          width: 16,
          transform: enabled ? 'translateX(16px)' : 'translateX(0px)',
        }}
      />
    </button>
  )
}

/**
 * Segmented control — 多选一切换器，保留滑块动画。
 */
export interface SegmentedControlProps<T extends string> {
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T, event?: React.MouseEvent) => void
}

export function SegmentedControl<T extends string>({ value, options, onChange }: SegmentedControlProps<T>) {
  const activeIndex = options.findIndex(o => o.value === value)

  return (
    <div
      className="bg-bg-100/50 p-0.5 rounded-lg flex border border-border-200/50 relative isolate"
      role="tablist"
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const dir = e.key === 'ArrowRight' ? 1 : -1
          const next = (activeIndex + dir + options.length) % options.length
          onChange(options[next].value)
        }
      }}
    >
      <div
        className="absolute top-0.5 bottom-0.5 left-0.5 bg-bg-000 rounded-md shadow-sm ring-1 ring-border-200/50 transition-transform duration-300 ease-out -z-10"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map(opt => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={opt.value === value}
          tabIndex={opt.value === value ? 0 : -1}
          onClick={e => onChange(opt.value, e)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[length:var(--fs-md)] font-medium transition-colors duration-200
            ${opt.value === value ? 'text-text-100' : 'text-text-400 hover:text-text-200'}`}
        >
          {opt.icon}
          <span className="truncate">{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Setting row — 标题+描述左侧，控件右侧，flex justify-between。
 * 无边框无圆角无背景色，纯行。
 */
export interface SettingRowProps {
  label: string
  description?: string
  icon?: React.ReactNode
  children: React.ReactNode
  onClick?: () => void
  className?: string
}

export function SettingRow({ label, description, icon, children, onClick, className }: SettingRowProps) {
  return (
    <div
      className={`w-full flex flex-row gap-x-8 gap-y-3 justify-between items-center
        ${onClick ? 'cursor-pointer' : ''}
        ${className || ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {icon && <span className="text-text-400 shrink-0">{icon}</span>}
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className="text-[length:var(--fs-md)] font-medium text-text-100">{label}</p>
          {description && <p className="text-[length:var(--fs-sm)] text-text-400 leading-relaxed">{description}</p>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/**
 * Settings section — 分区块。
 * h2 标题 + 内容 + 底部 border 分隔。最后一个 section 无 border。
 */
export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-b border-border-200/50 last:!border-b-0 mb-7 pb-7 last:mb-0 last:pb-0">
      <h2 className="text-[length:var(--fs-base)] font-semibold text-text-100">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Settings card — 保留，用于需要视觉隔离的独立功能块（ServersSettings 等）。
 */
export function SettingsCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-border-200/55 bg-bg-050/55 p-3.5 ${className || ''}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[length:var(--fs-md)] font-semibold text-text-100">{title}</div>
          {description && (
            <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5 leading-relaxed">{description}</div>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
