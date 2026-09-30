import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderIcon } from '../../components/Icons'
import { PANE_CENTER_STYLE } from './PaneDropOverlay'

/** 只高亮 pane 正中心（与 session drop center 同几何） */
export const FolderProjectDropOverlay = memo(function FolderProjectDropOverlay({ active }: { active: boolean }) {
  const { t } = useTranslation('chat')
  if (!active) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className="absolute flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-accent-main-100 bg-accent-main-100/12 shadow-[inset_0_0_0_1px_hsl(var(--accent-main-100)/0.15)] transition-opacity duration-150 ease-out"
        style={PANE_CENTER_STYLE}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-main-100/15 text-accent-main-100">
          <FolderIcon size={24} />
        </div>
        <div className="px-4 text-center">
          <div className="text-[length:var(--fs-base)] font-medium text-accent-main-100">
            {t('chatArea.dropFolderToAddProject')}
          </div>
          <div className="mt-1 text-[length:var(--fs-sm)] text-text-300">
            {t('chatArea.dropFolderToAddProjectHint')}
          </div>
        </div>
      </div>
    </div>
  )
})
