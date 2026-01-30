import { useState, useCallback } from 'react'
import { CopyIcon, CheckIcon } from '../Icons'
import { clsx } from 'clsx'
import { clipboardErrorHandler } from '../../utils'

interface CopyButtonProps {
  text: string
  className?: string
  position?: 'absolute' | 'static'
  /** 用于指定 group 名称，默认响应任意父级 group */
  groupName?: string
}

export function CopyButton({ text, className, position = 'absolute', groupName }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering parent clicks
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      clipboardErrorHandler('copy', err)
    }
  }, [text])

  // 根据 groupName 决定 hover 触发的 class
  const hoverClass = groupName 
    ? `group-hover/${groupName}:opacity-100`
    : 'group-hover:opacity-100'

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        // Base styles matching IconButton ghost variant
        "inline-flex items-center justify-center",
        "h-7 w-7 p-1.5 rounded-lg",
        "transition-all duration-150 active:scale-90",
        "backdrop-blur-sm z-10",
        // State styles
        copied 
          ? "bg-success-bg text-success-100" 
          : "bg-bg-200/80 text-text-400 hover:text-text-100 hover:bg-bg-100",
        // Position variant
        position === 'absolute' && `absolute top-2 right-2 opacity-0 ${hoverClass}`,
        className
      )}
      title={copied ? "Copied!" : "Copy"}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
