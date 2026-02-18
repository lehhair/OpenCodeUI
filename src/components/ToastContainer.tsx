// ============================================
// ToastContainer - 顶部右侧通知弹窗
// ============================================
//
// 位置：PC 右上角固定，移动端顶部居中全宽
// 动画：从上方滑入（translateY 负值），shouldRender + isVisible 两阶段
// 交互：悬停暂停自动消失倒计时，鼠标离开后恢复
// 点击跳转到对应 session

import { useState, useEffect, useCallback } from 'react'
import { useNotificationStore, notificationStore, type ToastItem, type NotificationType } from '../store/notificationStore'
import { CloseIcon, HandIcon, QuestionIcon, CheckIcon, AlertCircleIcon } from './Icons'

// ============================================
// 类型图标映射
// ============================================

const typeConfig: Record<NotificationType, {
  icon: typeof HandIcon
  color: string
  bgAccent: string
}> = {
  permission: { icon: HandIcon, color: 'text-amber-400', bgAccent: 'bg-amber-400/10' },
  question:   { icon: QuestionIcon, color: 'text-blue-400', bgAccent: 'bg-blue-400/10' },
  completed:  { icon: CheckIcon, color: 'text-green-400', bgAccent: 'bg-green-400/10' },
  error:      { icon: AlertCircleIcon, color: 'text-red-400', bgAccent: 'bg-red-400/10' },
}

// ============================================
// 单个 Toast
// ============================================

function Toast({ item, onDismiss, onClick }: {
  item: ToastItem
  onDismiss: () => void
  onClick: () => void
}) {
  const { notification, exiting } = item
  const config = typeConfig[notification.type]
  const Icon = config.icon

  // 进入动画
  const [isVisible, setIsVisible] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsVisible(true))
    })
  }, [])

  // 悬停暂停
  const handleMouseEnter = useCallback(() => {
    notificationStore.pauseToast(notification.id)
  }, [notification.id])

  const handleMouseLeave = useCallback(() => {
    notificationStore.resumeToast(notification.id)
  }, [notification.id])

  const show = isVisible && !exiting

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transition: 'all 250ms cubic-bezier(0.34, 1.15, 0.64, 1)',
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0) translateX(0)' : 'translateY(-8px) translateX(8px)',
        pointerEvents: show ? 'auto' : 'none',
      }}
      className="group relative flex items-start gap-2.5 p-3 pr-8 bg-bg-000 border border-border-200/50 backdrop-blur-xl rounded-xl shadow-lg cursor-pointer hover:bg-bg-100 hover:border-border-300 transition-colors duration-150"
      onClick={onClick}
      role="alert"
    >
      {/* Icon with accent background */}
      <div className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-md ${config.bgAccent}`}>
        <Icon size={14} className={config.color} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-xs font-medium text-text-100 truncate leading-tight">
          {notification.title}
        </div>
        {notification.body && (
          <div className="text-[11px] text-text-300 truncate mt-0.5 leading-tight">
            {notification.body}
          </div>
        )}
      </div>

      {/* Close */}
      <button
        className="absolute top-2 right-2 p-0.5 rounded-md text-text-400 opacity-0 group-hover:opacity-100 hover:text-text-200 hover:bg-bg-200 transition-all duration-150 active:scale-90"
        onClick={(e) => { e.stopPropagation(); onDismiss() }}
        aria-label="Dismiss"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

// ============================================
// Container
// ============================================

export function ToastContainer() {
  const { toasts } = useNotificationStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-3 right-3 left-3 md:left-auto md:w-80 z-50 flex flex-col gap-2">
      {toasts.map(item => (
        <Toast
          key={item.notification.id}
          item={item}
          onDismiss={() => notificationStore.dismissToast(item.notification.id)}
          onClick={() => {
            const { sessionId, directory } = item.notification
            notificationStore.dismissToast(item.notification.id)
            if (sessionId) {
              const dir = directory ? `?dir=${directory}` : ''
              window.location.hash = `#/session/${sessionId}${dir}`
            }
          }}
        />
      ))}
    </div>
  )
}
