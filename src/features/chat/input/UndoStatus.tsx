import { useTranslation } from 'react-i18next'
import { RedoIcon } from '../../../components/Icons'

interface UndoStatusProps {
  revertSteps: number
  onRedo?: () => void
  onRedoAll?: () => void
}

/** 纯展示组件 — 显隐动画由外层 PresenceItem 负责 */
export function UndoStatus({ revertSteps, onRedo, onRedoAll }: UndoStatusProps) {
  const { t } = useTranslation(['chat', 'common'])
  return (
    <div className="flex items-center gap-2 px-3 h-[32px] bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 rounded-full">
      <div className="w-1.5 h-1.5 bg-accent-main-100 rounded-full animate-pulse" />
      <span className="text-[length:var(--fs-xs)] text-accent-main-000 whitespace-nowrap">
        {t('undoStatus.editing')}
        {revertSteps > 1 ? ` (${revertSteps})` : ''}
      </span>
      <button
        onClick={onRedo}
        className="flex items-center gap-1 px-2 py-0.5 text-[length:var(--fs-xs)] text-accent-main-000 hover:bg-accent-main-100/20 rounded-md transition-colors"
      >
        <RedoIcon size={12} />
        <span>{t('undoStatus.redo')}</span>
      </button>
      {revertSteps > 1 && (
        <button
          onClick={onRedoAll}
          className="flex items-center gap-1 px-2 py-0.5 text-[length:var(--fs-xs)] text-accent-main-000 hover:bg-accent-main-100/20 rounded-md transition-colors"
        >
          <span>{t('undoStatus.redoAll')}</span>
        </button>
      )}
    </div>
  )
}
