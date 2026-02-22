import { memo, useState, useMemo } from 'react'
import type { MessageError } from '../../../types/message'
import { AlertCircleIcon, ChevronDownIcon } from '../../../components/Icons'
import { useDelayedRender } from '../../../hooks/useDelayedRender'
import { CodeBlock } from '../../../components/CodeBlock'

interface MessageErrorViewProps {
  error: MessageError
}

/**
 * 消息级别的错误显示（紧凑折叠式）
 * 用于 AssistantMessage 的 error 字段
 */
export const MessageErrorView = memo(function MessageErrorView({ error }: MessageErrorViewProps) {
  const { title, description, details, severity } = getErrorInfo(error)
  const hasDetails = !!(details || description)
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)

  const colorClass = severity === 'error' ? 'text-danger-100' : 'text-warning-100'
  const borderClass = severity === 'error' ? 'border-danger-100/20' : 'border-warning-100/20'

  // details 如果是 JSON 就格式化方便阅读，否则原样展示
  const formattedDetails = useMemo(() => {
    if (!details) return undefined
    try {
      return JSON.stringify(JSON.parse(details), null, 2)
    } catch {
      return details
    }
  }, [details])

  // 检测 details 是否为 JSON，决定 CodeBlock 语言
  const detailsLang = useMemo(() => {
    if (!details) return 'text'
    try {
      JSON.parse(details)
      return 'json'
    } catch {
      return 'text'
    }
  }, [details])

  return (
    <div className={`my-2 px-3 py-2 rounded-lg border ${borderClass} bg-bg-100/50`}>
      <div
        className={`flex items-center gap-2 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <AlertCircleIcon className={`w-4 h-4 ${colorClass} flex-shrink-0`} />
        <span className={`text-sm ${colorClass} flex-1 min-w-0 truncate`}>
          {title}
        </span>
        {hasDetails && (
          <ChevronDownIcon className={`w-4 h-4 text-text-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
        expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}>
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className={`mt-2 pt-2 space-y-1.5 border-t ${borderClass}`}>
              <p className="text-xs text-text-300 break-words">
                {description}
              </p>
              {formattedDetails && (
                <CodeBlock
                  code={formattedDetails}
                  language={detailsLang}
                  maxHeight={240}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

/**
 * 解析错误信息
 */
function getErrorInfo(error: MessageError): {
  title: string
  description: string
  details?: string
  severity: 'error' | 'warning'
} {
  switch (error.name) {
    case 'ProviderAuthError':
      return {
        title: 'Authentication Error',
        description: `Failed to authenticate with ${error.data.providerID}: ${error.data.message}`,
        severity: 'error'
      }
    
    case 'MessageOutputLengthError':
      return {
        title: 'Output Too Long',
        description: 'The response exceeded the maximum output length and was truncated.',
        severity: 'warning'
      }
    
    case 'MessageAbortedError':
      return {
        title: 'Message Aborted',
        description: error.data.message || 'The message generation was interrupted.',
        severity: 'warning'
      }
    
    case 'APIError':
      return {
        title: `API Error${error.data.statusCode ? ` (${error.data.statusCode})` : ''}`,
        description: error.data.message,
        details: error.data.responseBody,
        severity: error.data.isRetryable ? 'warning' : 'error'
      }
    
    case 'UnknownError':
    default:
      return {
        title: 'Error',
        description: error.data?.message || 'An unknown error occurred.',
        severity: 'error'
      }
  }
}
