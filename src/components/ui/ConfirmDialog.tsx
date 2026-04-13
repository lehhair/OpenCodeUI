import { useTranslation } from 'react-i18next'
import { Dialog } from './Dialog'
import { Button } from './Button'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  isLoading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  variant = 'info',
  isLoading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation(['common'])

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} width={400} showCloseButton={false}>
      {description && <div className="text-[length:var(--fs-base)] text-text-300 leading-relaxed mb-6">{description}</div>}

      <div className="flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>
          {cancelText ?? t('common:cancel')}
        </Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={() => {
            onConfirm()
            // Optional: close automatically or let parent handle it
          }}
          isLoading={isLoading}
        >
          {confirmText ?? t('common:confirm')}
        </Button>
      </div>
    </Dialog>
  )
}
