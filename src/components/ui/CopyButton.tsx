import { useState, useCallback, useRef, useEffect } from 'react'
import { CopyIcon, CheckIcon } from '../Icons'
import { clsx } from 'clsx'
import { clipboardErrorHandler, copyTextToClipboard } from '../../utils'

interface CopyButtonProps {
  /** 字符串，或点击时才取值的 getter（流式长消息避免每帧拼接全文） */
  text: string | (() => string)
  className?: string
  position?: 'absolute' | 'static'
  /** 用于指定 group 名称，默认响应任意父级 group */
  groupName?: string
}

export function CopyButton({ text, className, position = 'absolute', groupName }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 清理 timeout，防止内存泄漏
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent triggering parent clicks
      try {
        await copyTextToClipboard(typeof text === 'function' ? text() : text)
        setCopied(true)
        // 清理之前的 timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        clipboardErrorHandler('copy', err)
      }
    },
    [text],
  )

  // 根据 groupName 决定 hover 触发的 class
  const hoverClass = groupName ? `group-hover/${groupName}:opacity-100` : 'group-hover:opacity-100'

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        'inline-flex items-center justify-center',
        'h-7 w-7 p-1.5 rounded-md',
        'transition-colors duration-150',
        // State styles
        copied ? 'text-success-100' : 'text-text-400 hover:text-text-200',
        // Position variant
        position === 'absolute' && `absolute top-2 right-2 z-10 opacity-0 ${hoverClass}`,
        className,
      )}
      title={copied ? 'Copied!' : 'Copy'}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
