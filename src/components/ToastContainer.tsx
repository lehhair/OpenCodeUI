// ============================================
// ToastContainer - 顶部右侧通知弹窗
// ============================================
//
// 位置：PC 右上角固定，移动端顶部居中全宽
// 动画：从上方滑入（translateY 负值），shouldRender + isVisible 两阶段
// 交互：悬停暂停自动消失倒计时，鼠标离开后恢复
// 上限：由 store 的 MAX_TOASTS 控制，新 toast 覆盖最旧的
// 点击：跳转到对应 session + 标记通知已读

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
  permission: { icon: HandIcon, color: 'text-warning-100', bgAccent: 'bg-warning-bg' },
  question:   { icon: QuestionIcon, color: 'text-info-100', bgAccent: 'bg-info-bg' },
  completed:  { icon: CheckIcon, color: 'text-success-100', bgAccent: 'bg-success-bg' },
  error:      { icon: AlertCircleIcon, color: 'text-danger-100', bgAccent: 'bg-danger-bg' },
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
      className="group relative flex items-center gap-2.5 p-3 bg-bg-000 border border-border-200/50 backdrop-blur-xl rounded-xl shadow-lg cursor-pointer hover:bg-bg-100 hover:border-border-300 transition-colors duration-150"
      onClick={onClick}
      role="alert"
    >
      {/* Icon with accent background */}
      <div className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-md ${config.bgAccent}`}>
        <Icon size={14} className={config.color} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-text-100 truncate truncate-fix-desc leading-tight">
          {notification.title}
        </div>
        {notification.body && (
          <div className="text-[11px] text-text-300 truncate truncate-fix-desc mt-0.5 leading-tight">
            {notification.body}
          </div>
        )}
      </div>

      {/* Close — vertically centered, mobile: always visible; PC: visible on hover */}
      <button
        className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-text-400 md:opacity-0 md:group-hover:opacity-100 hover:text-text-200 hover:bg-bg-200 transition-all duration-150 active:scale-90"
        onClick={(e) => { e.stopPropagation(); onDismiss() }}
        aria-label="Dismiss"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

// ============================================
// Container — 平铺布局
// ============================================
//
// toast 上限由 store 的 MAX_TOASTS 控制，新的覆盖旧的。
// 点击 toast 跳转 session 并标记对应通知已读。
// 2+ 条时右对齐显示 clear all 文字按钮。

export function ToastContainer() {
  const { toasts } = useNotificationStore()

  if (toasts.length === 0) return null

  const handleClick = (item: ToastItem) => {
    const { id, sessionId, directory } = item.notification
    notificationStore.dismissToast(id)
    notificationStore.markRead(id)
    if (sessionId) {
      const dir = directory ? `?dir=${directory}` : ''
      window.location.hash = `#/session/${sessionId}${dir}`
    }
  }

  return (
    <div className="fixed top-3 right-3 left-3 md:left-auto md:w-80 z-50 flex flex-col gap-2">
      {toasts.map(item => (
        <Toast
          key={item.notification.id}
          item={item}
          onDismiss={() => notificationStore.dismissToast(item.notification.id)}
          onClick={() => handleClick(item)}
        />
      ))}

      {/* Clear all — 轻量文字按钮，右对齐 */}
      {toasts.length >= 2 && (
        <div className="flex justify-end">
          <button
            className="text-[11px] text-text-300 hover:text-text-100 px-2 py-1 rounded-md hover:bg-bg-200/60 transition-all duration-150 active:scale-95"
            onClick={() => notificationStore.dismissAllToasts()}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
