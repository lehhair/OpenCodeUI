/**
 * InlinePermission — 融入信息流的权限确认
 *
 * 复用工具调用结果的 ContentBlock 渲染风格。
 * 操作按钮紧跟 ContentBlock 下方。
 */

import { memo } from 'react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiPermissionRequest, PermissionReply } from '../../api'
import { ContentBlock } from '../../components'
import { autoApproveStore } from '../../store'
import { themeStore } from '../../store/themeStore'

interface InlinePermissionProps {
  request: ApiPermissionRequest
  onReply: (requestId: string, reply: PermissionReply) => void
  isReplying: boolean
  /** 权限已批准但工具还没完成，保留渲染避免跳动 */
  resolved?: boolean
  /** ToolBody 已渲染内容时隐藏权限内容区，只显示操作按钮 */
  contentHidden?: boolean
}

export const InlinePermission = memo(function InlinePermission({
  request,
  onReply,
  isReplying,
  resolved = false,
  contentHidden = false,
}: InlinePermissionProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { toolCardStyle } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const isCompact = toolCardStyle === 'compact'

  const metadata = request.metadata
  const diff = metadata?.diff as string | undefined
  const filepath = metadata?.filepath as string | undefined

  let diffData: { before: string; after: string } | string | undefined
  if (metadata?.filediff && typeof metadata.filediff === 'object') {
    const fd = metadata.filediff as Record<string, unknown>
    // 上游 v1.4.0+ 优先 patch 格式
    if (typeof fd.patch === 'string') {
      diffData = fd.patch
    } else if (fd.before !== undefined && fd.after !== undefined) {
      diffData = { before: String(fd.before), after: String(fd.after) }
    }
  }
  if (!diffData && diff) {
    diffData = diff
  }

  const isFileEdit = request.permission === 'edit' || request.permission === 'write'
  const hasPatterns = request.patterns && request.patterns.length > 0
  const patternsText = hasPatterns ? request.patterns.map(p => p.replace(/\\n/g, '\n')).join('\n\n') : ''

  const handleAlways = () => {
    if (autoApproveStore.enabled) {
      const rulePatterns = [...(request.always || []), ...(request.patterns || [])]
      const unique = [...new Set(rulePatterns)]
      if (unique.length > 0) {
        autoApproveStore.addRules(request.sessionID, request.permission, unique)
        onReply(request.id, 'once')
        return
      }
    }
    onReply(request.id, 'always')
  }

  return (
    <div className="space-y-2">
      {/* 内容 — contentHidden 时跳过（ToolBody 已渲染） */}
      {!contentHidden &&
        (isFileEdit && diffData ? (
          <ContentBlock
            label={request.permission}
            filePath={filepath}
            diff={diffData}
            collapsible={false}
            compact={isCompact}
          />
        ) : patternsText ? (
          <ContentBlock
            label={request.permission}
            content={patternsText}
            language="bash"
            collapsible={false}
            compact={isCompact}
          />
        ) : null)}

      {/* 操作按钮 / 已批准状态 */}
      {resolved ? (
        <div className="flex items-center gap-2 text-[length:var(--fs-sm)] text-text-400">
          <span className="inline-block w-3 h-3 border-2 border-accent-main-100 border-t-transparent rounded-full animate-spin" />
          <span>{t('permissionDialog.applying', { defaultValue: 'Applying…' })}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onReply(request.id, 'once')}
            disabled={isReplying}
            className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] font-medium bg-text-100 text-bg-000 hover:bg-text-200 transition-colors disabled:opacity-50"
          >
            {t('permissionDialog.allowOnce')}
          </button>
          <button
            onClick={handleAlways}
            disabled={isReplying}
            className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
          >
            {t('permissionDialog.alwaysAllow')}
          </button>
          <button
            onClick={() => onReply(request.id, 'reject')}
            disabled={isReplying}
            className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] text-text-400 hover:text-danger-100 transition-colors disabled:opacity-50"
          >
            {t('common:reject')}
          </button>
        </div>
      )}
    </div>
  )
})
