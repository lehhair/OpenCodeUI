// ============================================
// Close Service Dialog
// 关闭应用时询问是否同时关闭 opencode 服务
// ============================================

import { useState } from 'react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { PlugIcon, SpinnerIcon } from './Icons'

interface CloseServiceDialogProps {
  isOpen: boolean
  onConfirm: (stopService: boolean) => void
  onCancel: () => void
}

export function CloseServiceDialog({ isOpen, onConfirm, onCancel }: CloseServiceDialogProps) {
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
        <h3 className="text-[15px] font-semibold text-text-100 mb-2">
          Close OpenCode
        </h3>

        {/* Description */}
        <p className="text-[13px] text-text-300 leading-relaxed mb-6 max-w-[320px]">
          The opencode service was started by this app. Do you want to stop it as well?
        </p>

        {/* Actions */}
        {closing ? (
          <div className="flex items-center gap-2 text-[13px] text-text-400">
            <SpinnerIcon size={14} className="animate-spin" />
            Closing...
          </div>
        ) : (
          <div className="flex flex-col w-full gap-2">
            <Button
              onClick={() => handleConfirm(true)}
              className="w-full justify-center"
            >
              Close and stop service
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleConfirm(false)}
              className="w-full justify-center"
            >
              Close, keep service running
            </Button>
            <Button
              variant="ghost"
              onClick={onCancel}
              className="w-full justify-center text-text-400"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
