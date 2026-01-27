import { forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  children: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent-main-000 hover:bg-accent-main-200 text-oncolor-100',
  secondary: 'bg-bg-200 hover:bg-bg-300 text-text-200 hover:text-text-100',
  ghost: 'bg-transparent hover:bg-bg-200 text-text-300 hover:text-text-100',
  danger: 'bg-danger-100 hover:bg-danger-200 text-oncolor-100',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-3 text-sm',
  lg: 'h-10 px-4 text-base',
}

import { SpinnerIcon } from '../Icons'

// ...

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', isLoading = false, className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`
          inline-flex items-center justify-center gap-2
          rounded-lg font-medium
          transition-all duration-150
          active:scale-95
          disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {isLoading && <SpinnerIcon size={14} className="animate-spin" />}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
