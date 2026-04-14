import { memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownIcon, ArrowUpIcon, PermissionListIcon, QuestionIcon } from '../../../components/Icons'
import { UndoStatus } from './UndoStatus'
import { usePresence } from '../../../hooks'
import type { CollapsedDialogInfo } from '../InputBox'

// ============================================
// PresenceItem — 通用的入场/退场动画包装器
// ============================================

export function PresenceItem({ show, children }: { show: boolean; children: ReactNode }) {
  const { shouldRender, ref } = usePresence<HTMLDivElement>(show, {
    from: { opacity: 0 },
    to: { opacity: 1 },
    duration: 0.15,
  })
  if (!shouldRender) return null
  return (
    <div ref={ref} className="shrink-0">
      {children}
    </div>
  )
}

// ============================================
// ScrollToBottomButton — 可复用的滚动到底部按钮
// ============================================

interface ScrollToBottomButtonProps {
  onClick?: () => void
}

export const ScrollToBottomButton = memo(function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
  const { t } = useTranslation(['chat', 'common'])
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[32px] w-[32px] min-w-[32px] rounded-full bg-accent-main-100/10 border border-accent-main-100/20 backdrop-blur-md flex items-center justify-center text-accent-main-000 hover:bg-accent-main-100/20 transition-colors shrink-0"
      aria-label={t('inputActions.scrollToBottom')}
    >
      <ArrowDownIcon size={16} />
    </button>
  )
})

// ============================================
// FloatingActions — 输入框上方的浮动操作栏
// permission capsule / question capsule / undo status / scroll-to-bottom
// ============================================

interface FloatingActionsProps {
  showScrollToBottom?: boolean
  isCollapsed: boolean
  canRedo?: boolean
  revertSteps?: number
  onRedo?: () => void
  onRedoAll?: () => void
  onScrollToBottom?: () => void
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
}

export const FloatingActions = memo(function FloatingActions({
  showScrollToBottom,
  isCollapsed,
  canRedo,
  revertSteps,
  onRedo,
  onRedoAll,
  onScrollToBottom,
  collapsedPermission,
  collapsedQuestion,
}: FloatingActionsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {/* Collapsed Permission Capsule */}
      <PresenceItem show={!!collapsedPermission}>
        {collapsedPermission && (
          <button
            type="button"
            onClick={collapsedPermission.onExpand}
            className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 text-[length:var(--fs-sm)] leading-[14px] text-accent-main-000 hover:bg-accent-main-100/20 transition-colors"
          >
            <PermissionListIcon size={14} />
            <span className="whitespace-nowrap">{collapsedPermission.label}</span>
            {collapsedPermission.queueLength > 1 && (
              <span className="text-[length:var(--fs-xxs)] opacity-70">+{collapsedPermission.queueLength - 1}</span>
            )}
          </button>
        )}
      </PresenceItem>

      {/* Collapsed Question Capsule */}
      <PresenceItem show={!!collapsedQuestion}>
        {collapsedQuestion && (
          <button
            type="button"
            onClick={collapsedQuestion.onExpand}
            className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 text-[length:var(--fs-sm)] leading-[14px] text-accent-main-000 hover:bg-accent-main-100/20 transition-colors"
          >
            <QuestionIcon size={14} />
            <span className="whitespace-nowrap">{collapsedQuestion.label}</span>
            {collapsedQuestion.queueLength > 1 && (
              <span className="text-[length:var(--fs-xxs)] opacity-70">+{collapsedQuestion.queueLength - 1}</span>
            )}
          </button>
        )}
      </PresenceItem>

      <PresenceItem show={!!canRedo}>
        {canRedo && <UndoStatus revertSteps={revertSteps ?? 0} onRedo={onRedo} onRedoAll={onRedoAll} />}
      </PresenceItem>

      <PresenceItem show={!!showScrollToBottom && !isCollapsed}>
        <ScrollToBottomButton onClick={onScrollToBottom} />
      </PresenceItem>
    </div>
  )
})

// ============================================
// CollapsedCapsule — 移动端收起状态的胶囊 UI
// ============================================

interface CollapsedCapsuleProps {
  onExpand: () => void
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
}

export const CollapsedCapsule = memo(function CollapsedCapsule({
  onExpand,
  showScrollToBottom,
  onScrollToBottom,
}: CollapsedCapsuleProps) {
  const { t } = useTranslation(['chat', 'common'])
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={onExpand}
        className="flex items-center gap-1.5 px-3 h-[32px] rounded-full glass border border-border-200/50 shadow-lg text-text-300 hover:text-text-200 hover:bg-bg-000 active:scale-95 transition-all"
      >
        <ArrowUpIcon size={14} />
        <span className="text-[length:var(--fs-xs)]">{t('inputActions.reply')}</span>
      </button>
      {showScrollToBottom && <ScrollToBottomButton onClick={onScrollToBottom} />}
    </div>
  )
})
