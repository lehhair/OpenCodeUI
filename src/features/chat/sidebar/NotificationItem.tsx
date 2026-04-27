import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, AlertCircleIcon, CloseIcon, HandIcon, QuestionIcon } from '../../../components/Icons'
import { notificationStore } from '../../../store/notificationStore'
import { useInputCapabilities } from '../../../hooks/useInputCapabilities'
import { formatNotificationTime } from './sidebarUtils'
import type { NotificationEntry } from '../../../store/notificationStore'
import type { ApiSession } from '../../../api'

const notifTypeConfig = {
  completed: {
    icon: CheckIcon,
    color: 'text-success-100',
    labelKey: 'notification.completed',
  },
  error: { icon: AlertCircleIcon, color: 'text-danger-100', labelKey: 'notification.error' },
  permission: {
    icon: HandIcon,
    color: 'text-warning-100',
    labelKey: 'notification.permission',
  },
  question: { icon: QuestionIcon, color: 'text-info-100', labelKey: 'notification.question' },
} as const

interface NotificationItemProps {
  entry: NotificationEntry
  resolvedSession?: ApiSession
  onSelect: (session: ApiSession) => void
}

export function NotificationItem({ entry, resolvedSession, onSelect }: NotificationItemProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { preferTouchUi } = useInputCapabilities()
  const displayTitle = resolvedSession?.title || entry.title || entry.sessionId.slice(0, 12) + '...'
  const directory = resolvedSession?.directory || entry.directory
  const [showActions, setShowActions] = useState(false)
  const [hasFocusWithin, setHasFocusWithin] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMoved = useRef(false)

  const config = notifTypeConfig[entry.type]
  const Icon = config.icon
  const actionsVisible = preferTouchUi ? showActions : false

  const handleTouchStart = useCallback(() => {
    if (!preferTouchUi) return
    touchMoved.current = false
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        setShowActions(true)
      }
    }, 500)
  }, [preferTouchUi])

  const handleTouchMove = useCallback(() => {
    if (!preferTouchUi) return
    touchMoved.current = true
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [preferTouchUi])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  useEffect(() => {
    if (!showActions) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
        setShowActions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [showActions])

  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
      }
    }
  }, [])

  const handleClick = () => {
    if (showActions) {
      setShowActions(false)
      return
    }
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
      ref={itemRef}
      onFocusCapture={() => {
        if (!preferTouchUi) setHasFocusWithin(true)
      }}
      onBlurCapture={e => {
        if (preferTouchUi) return
        const nextTarget = e.relatedTarget as Node | null
        if (!nextTarget || !itemRef.current?.contains(nextTarget)) {
          setHasFocusWithin(false)
        }
      }}
      className={`group relative flex items-start pl-[6px] pr-3 py-2 rounded-lg cursor-default select-none transition-all duration-200 border border-transparent hover:bg-bg-200/50 ${showActions ? 'bg-bg-200/50' : ''} ${entry.read ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex flex-1 min-w-0 bg-transparent border-none p-0 text-left"
      >
        {/* Content */}
        <div
          className={`flex-1 min-w-0 transition-[padding] duration-200 ${actionsVisible ? 'pr-9' : 'pr-1 group-hover:pr-9 group-focus-within:pr-9'}`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <p
              className="min-w-0 flex-1 truncate text-[length:var(--fs-md)] font-medium text-text-200 group-hover:text-text-100"
              title={displayTitle}
            >
              {displayTitle}
            </p>
            {!entry.read && !actionsVisible && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-main-100 group-hover:hidden group-focus-within:hidden" />
            )}
          </div>
          <div className="mt-1 flex h-4 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[length:var(--fs-xxs)] text-text-400">
            <span className={`relative shrink-0 flex h-3 w-3 items-center justify-center ${config.color}`}>
              <Icon size={10} />
            </span>
            <span className="opacity-30 shrink-0">·</span>
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
      </button>

      {/* Dismiss action */}
      <div
        className={`absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 transition-all duration-200 ${
          actionsVisible
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto'
        }`}
      >
        <button
          type="button"
          className="p-1.5 rounded-md hover:bg-danger-bg active:bg-danger-bg text-text-400 hover:text-danger-100 active:text-danger-100 transition-colors focus-visible:ring-1 focus-visible:ring-danger-100/40 focus-visible:ring-inset"
          onClick={handleDismiss}
          aria-label={t('common:dismiss')}
          tabIndex={preferTouchUi ? (actionsVisible ? 0 : -1) : hasFocusWithin ? 0 : -1}
        >
          <CloseIcon size={10} />
        </button>
      </div>
    </div>
  )
}
