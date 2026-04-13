import { useTranslation } from 'react-i18next'
import { CheckIcon, AlertCircleIcon, CloseIcon, HandIcon, QuestionIcon } from '../../../components/Icons'
import { notificationStore } from '../../../store/notificationStore'
import { formatNotificationTime } from './sidebarUtils'
import type { NotificationEntry } from '../../../store/notificationStore'
import type { ApiSession } from '../../../api'

const notifTypeConfig = {
  completed: {
    icon: CheckIcon,
    color: 'text-success-100',
    bgAccent: 'bg-success-bg',
    labelKey: 'notification.completed',
  },
  error: { icon: AlertCircleIcon, color: 'text-danger-100', bgAccent: 'bg-danger-bg', labelKey: 'notification.error' },
  permission: {
    icon: HandIcon,
    color: 'text-warning-100',
    bgAccent: 'bg-warning-bg',
    labelKey: 'notification.permission',
  },
  question: { icon: QuestionIcon, color: 'text-info-100', bgAccent: 'bg-info-bg', labelKey: 'notification.question' },
} as const

interface NotificationItemProps {
  entry: NotificationEntry
  resolvedSession?: ApiSession
  onSelect: (session: ApiSession) => void
}

export function NotificationItem({ entry, resolvedSession, onSelect }: NotificationItemProps) {
  const { t } = useTranslation(['chat', 'common'])
  const displayTitle = resolvedSession?.title || entry.title || entry.sessionId.slice(0, 12) + '...'
  const directory = resolvedSession?.directory || entry.directory

  const config = notifTypeConfig[entry.type]
  const Icon = config.icon

  const handleClick = () => {
    notificationStore.markRead(entry.id)
    if (resolvedSession) {
      onSelect(resolvedSession)
    } else {
      const dir = entry.directory ? `?dir=${entry.directory}` : ''
      window.location.hash = `#/session/${entry.sessionId}${dir}`
    }
  }

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation()
    notificationStore.dismiss(entry.id)
  }

  return (
    <div
      onClick={handleClick}
      className={`group relative flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-default transition-all duration-200 border border-transparent hover:bg-bg-200/50 ${entry.read ? 'opacity-50' : ''}`}
    >
      {/* Status icon — matches toast style */}
      <div className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-md ${config.bgAccent}`}>
        <Icon size={14} className={config.color} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[length:var(--fs-md)] truncate font-medium text-text-200 group-hover:text-text-100" title={displayTitle}>
          {displayTitle}
        </p>
        <div className="flex items-center mt-0.5 min-w-0 overflow-hidden text-[length:var(--fs-xxs)] text-text-400 gap-1">
          <span className={`shrink-0 ${config.color}`}>{t(config.labelKey)}</span>
          {entry.body && (
            <>
              <span className="opacity-30 shrink-0">·</span>
              <span className="truncate">{entry.body}</span>
            </>
          )}
          <span className="opacity-30 shrink-0">·</span>
          <span className="tabular-nums shrink-0">{formatNotificationTime(entry.timestamp)}</span>
          {directory && (
            <>
              <span className="opacity-30 shrink-0">·</span>
              <span className="truncate opacity-50" title={directory}>
                {directory.replace(/\\/g, '/').split('/').filter(Boolean).pop()}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Unread dot + dismiss */}
      <div className="shrink-0 flex items-center gap-1">
        {!entry.read && <span className="w-1.5 h-1.5 rounded-full bg-accent-main-100" />}
        <button
          className="p-0.5 rounded-md text-text-400 opacity-0 group-hover:opacity-100 hover:text-text-200 hover:bg-bg-200 transition-all duration-150 active:scale-90"
          onClick={handleDismiss}
          aria-label={t('common:dismiss')}
        >
          <CloseIcon size={10} />
        </button>
      </div>
    </div>
  )
}
