import { CheckIcon } from '../Icons'

interface MenuItemProps {
  label: string
  description?: string
  icon?: React.ReactNode
  disabled?: boolean
  selected?: boolean
  selectionRole?: 'menuitemradio' | 'option'
  onClick?: () => void
}

export function MenuItem({
  label,
  description,
  icon,
  disabled = false,
  selected = false,
  selectionRole,
  onClick,
}: MenuItemProps) {
  const selectionProps =
    selectionRole === 'menuitemradio'
      ? { role: selectionRole, 'aria-checked': selected }
      : selectionRole === 'option'
        ? { role: selectionRole, 'aria-selected': selected }
        : {}

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      {...selectionProps}
      className={`
        w-full px-2 py-2 rounded-lg flex items-start gap-2 text-left bg-transparent border-none
        transition-all duration-150 select-none
        ${disabled ? 'text-text-500 cursor-not-allowed' : 'cursor-pointer hover:bg-bg-200 active:scale-[0.98]'}
        ${selected && !disabled ? 'text-text-100' : ''}
      `}
    >
      {icon && (
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5 text-text-400">{icon}</span>
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-[length:var(--fs-base)] ${disabled ? 'text-text-500' : selected ? 'text-text-100' : 'text-text-200'}`}>
          {label}
        </div>
        {description && (
          <div className="text-[length:var(--fs-sm)] text-text-500 mt-0.5 line-clamp-2" title={description}>
            {description}
          </div>
        )}
      </div>
      {selected && !disabled && (
        <span className="text-accent-secondary-100 flex-shrink-0 mt-0.5">
          <CheckIcon />
        </span>
      )}
    </button>
  )
}
