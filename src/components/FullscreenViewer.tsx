/**
 * FullscreenViewer - 通用真全屏容器
 *
 * 纯 UI 壳：ModalShell（铺满视口） + 可选 header + children 填满剩余空间。
 * 不绑定任何业务逻辑——丢什么进去就全屏展示什么。
 *
 * 用法示例：
 *   <FullscreenViewer isOpen={open} onClose={close} title="preview.txt">
 *     <MyContent />
 *   </FullscreenViewer>
 *
 *   <FullscreenViewer isOpen={open} onClose={close} headerRight={<ViewModeSwitch ... />}>
 *     <DiffViewer ... />
 *   </FullscreenViewer>
 */

import { memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DESKTOP_FULLSCREEN_LAYER_Z_INDEX } from '../constants'
import { CloseIcon } from './Icons'
import { ModalShell } from './ui/ModalShell'
import type { ViewMode } from './DiffViewer'

// ============================================
// Types
// ============================================

export interface FullscreenViewerProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  /** 左侧标题（可选） */
  title?: ReactNode
  /** 标题右侧的附加信息，如 diff stats（可选） */
  titleExtra?: ReactNode
  /** header 右侧自定义区域，如 ViewModeSwitch、CopyButton 等（可选） */
  headerRight?: ReactNode
  /** 是否显示默认 header（默认 true，设为 false 则完全由 children 控制布局） */
  showHeader?: boolean
  /** z-index，默认 100 */
  zIndex?: number
}

// ============================================
// Main Component
// ============================================

export const FullscreenViewer = memo(function FullscreenViewer({
  isOpen,
  onClose,
  children,
  title,
  titleExtra,
  headerRight,
  showHeader = true,
  zIndex,
}: FullscreenViewerProps) {
  const { t } = useTranslation('common')

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} zIndex={zIndex ?? DESKTOP_FULLSCREEN_LAYER_Z_INDEX}>
      <div className="w-full h-full flex flex-col bg-bg-100">
        {showHeader && (
          <div className="flex items-center h-11 px-4 border-b border-border-100/40 shrink-0 gap-3">
            {/* Left: title area */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {title &&
                (typeof title === 'string' ? (
                  <span className="text-text-100 font-mono text-[length:var(--fs-md)] font-medium truncate min-w-0 flex-1">
                    {title}
                  </span>
                ) : (
                  title
                ))}
              {titleExtra}
            </div>

            {/* Right: custom actions + close */}
            <div className="flex items-center gap-2 shrink-0">
              {headerRight}
              {headerRight && <div className="w-px h-4 bg-border-200/30" />}
              <button
                onClick={onClose}
                className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-200/60 rounded-lg transition-colors"
                title={t('closeEsc')}
              >
                <CloseIcon size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Content: 填满剩余空间 */}
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </ModalShell>
  )
})

// ============================================
// ViewModeSwitch - 独立的 diff 视图模式切换
// ============================================

export function ViewModeSwitch({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const { t } = useTranslation('components')

  return (
    <div className="flex items-center bg-bg-300/50 rounded-lg p-0.5 text-[length:var(--fs-xs)]">
      <button
        className={`px-2.5 py-1 rounded-md transition-all ${
          viewMode === 'split' ? 'bg-bg-100 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('split')}
      >
        {t('sessionChanges.split')}
      </button>
      <button
        className={`px-2.5 py-1 rounded-md transition-all ${
          viewMode === 'unified' ? 'bg-bg-100 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('unified')}
      >
        {t('sessionChanges.unified')}
      </button>
    </div>
  )
}
