import { useTranslation } from 'react-i18next'
import type { ActiveSessionEntry } from '../../../store/activeSessionStore'
import type { ApiSession } from '../../../api'

interface ActiveSessionItemProps {
  entry: ActiveSessionEntry
  /** 从 sessions 列表或 API 拉取到的完整 session 对象 */
  resolvedSession?: ApiSession
  isSelected: boolean
  onSelect: (session: ApiSession) => void
}

export function ActiveSessionItem({ entry, resolvedSession, isSelected, onSelect }: ActiveSessionItemProps) {
  const { t } = useTranslation(['chat', 'common'])
  const isRetry = entry.status.type === 'retry'
  const pending = entry.pendingAction
  // 标题优先从 resolvedSession 取，然后 fallback 到 entry.title（sessionMeta），最后截取 ID
  const displayTitle = resolvedSession?.title || entry.title || entry.sessionId.slice(0, 12) + '...'
  // 目录优先从 resolvedSession 取
  const directory = resolvedSession?.directory || entry.directory

  // 状态显示：permission > question > retry > working
  const statusConfig =
    pending?.type === 'permission'
      ? {
          label: t('activeSession.awaitingPermission'),
          color: 'text-warning-100',
          dotColor: 'bg-warning-100',
          pulse: false,
        }
      : pending?.type === 'question'
        ? { label: t('activeSession.awaitingAnswer'), color: 'text-info-100', dotColor: 'bg-info-100', pulse: false }
        : isRetry
          ? { label: t('activeSession.retrying'), color: 'text-warning-100', dotColor: 'bg-warning-100', pulse: false }
          : { label: t('activeSession.working'), color: 'text-success-100', dotColor: 'bg-success-100', pulse: true }

  const handleClick = () => {
    if (resolvedSession) {
      onSelect(resolvedSession)
    }
    // 如果没有 resolvedSession（极端情况：API 拉取失败），不做任何事
    // 用户可以等 session 数据加载完，或从 Recents tab 找到
  }

  // 拖拽到主信息流进行分屏 / 替换会话
  // 和 SessionListItem 使用完全一致的 dataTransfer 格式，ChatPane 的 drop handler 能识别
  const isDraggable = !!resolvedSession
  const handleDragStart = (e: React.DragEvent) => {
    if (!isDraggable) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('text/x-session-id', entry.sessionId)
    if (directory) {
      e.dataTransfer.setData('text/x-session-directory', directory)
    }
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={`group relative flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-default transition-all duration-200 border border-transparent ${
        isSelected ? 'bg-bg-000 shadow-sm ring-1 ring-border-200/50' : 'hover:bg-bg-200/50'
      } ${!resolvedSession ? 'opacity-50 cursor-default' : ''}`}
    >
      {/* Status dot */}
      <span className="relative shrink-0 flex items-center justify-center w-4 h-4">
        <span className={`absolute w-2 h-2 rounded-full ${statusConfig.dotColor}`} />
        {statusConfig.pulse && (
          <span className={`absolute w-2 h-2 rounded-full ${statusConfig.dotColor} animate-ping opacity-50`} />
        )}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-[length:var(--fs-md)] truncate font-medium ${
            isSelected ? 'text-text-100' : 'text-text-200 group-hover:text-text-100'
          }`}
          title={displayTitle}
        >
          {displayTitle}
        </p>
        <div className="flex items-center mt-0.5 h-4 min-w-0 overflow-hidden text-[length:var(--fs-xxs)] text-text-400 gap-1 whitespace-nowrap">
          <span className={`shrink-0 whitespace-nowrap ${statusConfig.color}`}>{statusConfig.label}</span>
          {pending?.description && (
            <>
              <span className="opacity-30 shrink-0">·</span>
              <span className="truncate min-w-0 flex-1 opacity-60">{pending.description}</span>
            </>
          )}
          {isRetry && entry.status.type === 'retry' && (
            <>
              <span className="opacity-30 shrink-0">·</span>
              <span className="text-text-400 opacity-60 shrink-0 whitespace-nowrap">
                {t('activeSession.attempt', { count: entry.status.attempt })}
              </span>
            </>
          )}
          {directory && (
            <>
              <span className="opacity-30 shrink-0">·</span>
              <span className="truncate min-w-0 flex-1 opacity-50" title={directory}>
                {directory.replace(/\\/g, '/').split('/').filter(Boolean).pop()}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
