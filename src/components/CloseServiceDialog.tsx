// ============================================
// Close Service Dialog
// 关闭应用时询问是否同时关闭 opencode 服务
// ============================================

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { PlugIcon, SpinnerIcon } from './Icons'

interface CloseServiceDialogProps {
  isOpen: boolean
  onConfirm: (stopService: boolean) => void
  onCancel: () => void
}

export function CloseServiceDialog({ isOpen, onConfirm, onCancel }: CloseServiceDialogProps) {
  const { t } = useTranslation(['components', 'common'])
  const [closing, setClosing] = useState(false)

  const handleConfirm = (stopService: boolean) => {
    setClosing(true)
    onConfirm(stopService)
  }

  return (
    <Dialog isOpen={isOpen} onClose={onCancel} title="" width={420} showCloseButton={false}>
      <div className="flex flex-col items-center text-center py-2">
        {/* Icon */}
        <div className="w-12 h-12 rounded-full bg-accent-main-100/10 flex items-center justify-center mb-4">
          <PlugIcon size={24} className="text-accent-main-100" />
        </div>

        {/* Title */}
        <h3 className="text-[length:var(--fs-heading-3)] font-semibold text-text-100 mb-2">
          {t('closeService.title')}
        </h3>

        {/* Description */}
        <p className="text-[length:var(--fs-md)] text-text-300 leading-relaxed mb-6 max-w-[320px]">
          {t('closeService.description')}
        </p>

        {/* Actions */}
        {closing ? (
          <div className="flex items-center gap-2 text-[length:var(--fs-md)] text-text-400">
            <SpinnerIcon size={14} className="animate-spin" />
            {t('common:closing')}
          </div>
        ) : (
          <div className="flex flex-col w-full gap-2">
            <Button onClick={() => handleConfirm(true)} className="w-full justify-center">
              {t('closeService.closeAndStop')}
            </Button>
            <Button variant="ghost" onClick={() => handleConfirm(false)} className="w-full justify-center">
              {t('closeService.closeKeepRunning')}
            </Button>
            <Button variant="ghost" onClick={onCancel} className="w-full justify-center text-text-400">
              {t('common:cancel')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
