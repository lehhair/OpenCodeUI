import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionStructuredError } from '@opencode/client/promise'
import { AlertCircleIcon, ChevronDownIcon } from '../../../components/Icons'
import { useDisclosureScrollLock } from '../../../hooks'
import { CodeBlock } from '../../../components/CodeBlock'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { isInterruptedError, unwrapErrorMessage } from '../../../utils/errorMessage'
import { chevronClass, MessageExpandPanel, useMessageExpandRender } from '../messageExpand'

interface MessageErrorViewProps {
  /** v2 原生结构化错误：`{ type, message, status?, response? }` */
  error: SessionStructuredError
  stateKey?: string
}

/**
 * 消息级别的错误显示（紧凑折叠式）
 * 用于 AssistantMessage 的 error 字段 / 失败的 compaction
 *
 * v2 的错误没有 `name` 判别字段，只有 `type` 字符串，因此这里按
 * `type` 的关键字（abort / length / auth）与是否存在 HTTP status 分支，
 * 与 v1 那套 `MessageError` 联合表达的语义一一对应。
 */
export const MessageErrorView = memo(function MessageErrorView({ error, stateKey }: MessageErrorViewProps) {
  const { t } = useTranslation('message')
  const { title, description, details, severity } = getErrorInfo(error, t)
  const hasDetails = !!(details || description)
  const [expanded, setExpanded] = useUiDisclosureState(stateKey ?? `message-error:${title}`, false)
  const shouldRenderBody = useMessageExpandRender(expanded)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()

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
    <div ref={rootRef} className={`px-3 py-2 rounded-md border ${borderClass} bg-bg-100/50`}>
      <div
        ref={headerRef}
        className={`flex items-center gap-2 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && withScrollLock(() => setExpanded(!expanded))}
      >
        <AlertCircleIcon className={`w-4 h-4 ${colorClass} flex-shrink-0`} />
        <span className={`text-[length:var(--fs-base)] ${colorClass} flex-1 min-w-0 truncate`}>{title}</span>
        {hasDetails && <ChevronDownIcon className={chevronClass(expanded)} />}
      </div>

      <MessageExpandPanel open={expanded} variant="fade" innerClassName="overflow-hidden">
        {shouldRenderBody && (
          <div className={`mt-2 pt-2 space-y-1.5 border-t ${borderClass}`}>
            <p className="text-[length:var(--fs-sm)] text-text-300 break-words">{description}</p>
            {formattedDetails && <CodeBlock code={formattedDetails} language={detailsLang} maxHeight={240} />}
          </div>
        )}
      </MessageExpandPanel>
    </div>
  )
})

/**
 * 把 v2 结构化错误映射成「标题 / 描述 / 详情 / 严重度」。
 *
 * 分支依据（对齐 v1 的 MessageError 联合语义）：
 *   abort/interrupt          → 消息被中断（warning）
 *   length / max_token / context → 输出超长（warning）
 *   auth                     → 认证失败（error）
 *   带 status 或 response     → API 错误（429/5xx 视为可重试 warning）
 *   其余                     → 未知错误（error）
 */
function getErrorInfo(
  error: SessionStructuredError,
  t: (key: string, opts?: Record<string, unknown>) => string,
): {
  title: string
  description: string
  details?: string
  severity: 'error' | 'warning'
} {
  const type = (error.type ?? '').toLowerCase()
  // v2 的 message 常是「JSON 串里套 JSON」，官方同样先解包再展示
  const message = unwrapErrorMessage(error.message ?? '')
  const responseBody = error.response?.body

  if (isInterruptedError(error)) {
    return {
      title: t('errors.messageAborted'),
      description: message || t('errors.messageAbortedDesc'),
      severity: 'warning',
    }
  }

  if (type.includes('length') || type.includes('max_token') || type.includes('context')) {
    return {
      title: t('errors.outputTooLong'),
      description: message || t('errors.outputTooLongDesc'),
      severity: 'warning',
    }
  }

  if (type.includes('auth')) {
    return {
      title: t('errors.authError'),
      description: message,
      severity: 'error',
    }
  }

  if (error.status != null || responseBody) {
    // 429/5xx 这类通常是可重试的瞬时错误
    const isRetryable = error.status == null || error.status === 429 || error.status >= 500
    return {
      title: error.status != null ? t('errors.apiErrorWithCode', { code: error.status }) : t('errors.apiError'),
      description: message,
      details: responseBody,
      severity: isRetryable ? 'warning' : 'error',
    }
  }

  return {
    title: t('errors.unknownError'),
    description: message || t('errors.unknownErrorDesc'),
    severity: 'error',
  }
}
