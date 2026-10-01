import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Button } from '../../components/ui'
import { DownloadIcon, UploadIcon, SpinnerIcon, AlertCircleIcon } from '../../components/Icons'
import { exportSession, importSession } from '../../api'
import { useShareSessionMeta } from '../../store'
import { apiErrorHandler } from '../../utils'

interface ShareDialogProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * 会话导出 / 导入。
 *
 * OpenCode v2 移除了会话分享（没有 share URL），取而代之的是
 * `session.export()` / `session.import()`：导出一份 JSON 会话转写文件，
 * 可在另一台机器或另一个服务器上导入。
 *
 * 因此这个对话框从「生成公开链接」改为「导出 / 导入会话文件」，
 * 视觉与交互沿用原有结构（同样的 Dialog / Button / 图标与文案层级）。
 */
export function ShareDialog({ isOpen, onClose }: ShareDialogProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { sessionId, sessionDirectory } = useShareSessionMeta()
  const [loading, setLoading] = useState<'export' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setError(null)
      setNotice(null)
    }
  }, [isOpen])

  const handleExport = async () => {
    if (!sessionId) return
    setLoading('export')
    setError(null)
    setNotice(null)
    try {
      const transfer = await exportSession(sessionId, sessionDirectory)
      const blob = new Blob([JSON.stringify(transfer, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${transfer.info.title || transfer.info.id}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice(t('shareDialog.exported'))
    } catch (e) {
      setError(t('shareDialog.failedExport'))
      apiErrorHandler('export session', e)
    } finally {
      setLoading(null)
    }
  }

  const handleImportClick = () => {
    if (!sessionId) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setLoading('import')
      setError(null)
      setNotice(null)
      try {
        const transfer = JSON.parse(await file.text())
        const imported = await importSession(transfer, sessionDirectory)
        setNotice(t('shareDialog.imported', { title: imported.title || imported.id }))
      } catch (e) {
        setError(t('shareDialog.failedImport'))
        apiErrorHandler('import session', e)
      } finally {
        setLoading(null)
      }
    }
    input.click()
  }

  if (!sessionId) return null

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('shareDialog.title')} className="w-full max-w-md">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 p-3 bg-bg-200/30 rounded-lg border border-border-200">
          <div className="p-2 bg-bg-200 rounded-full text-text-400">
            <DownloadIcon size={20} />
          </div>
          <div>
            <h3 className="font-medium text-text-100">{t('shareDialog.exportTitle')}</h3>
            <p className="text-[length:var(--fs-base)] text-text-400 mt-1">{t('shareDialog.exportDesc')}</p>
          </div>
        </div>

        {error && <div className="text-danger-100 text-[length:var(--fs-base)] px-1">{error}</div>}

        {notice && (
          <div className="flex items-start gap-2 text-success-100 text-[length:var(--fs-base)] px-1">
            <AlertCircleIcon size={14} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end mt-2">
          <Button variant="secondary" onClick={handleImportClick} disabled={loading !== null}>
            {loading === 'import' ? (
              <>
                <SpinnerIcon className="animate-spin mr-2" />
                {t('shareDialog.importing')}
              </>
            ) : (
              <>
                <UploadIcon className="mr-2" size={16} />
                {t('shareDialog.importSession')}
              </>
            )}
          </Button>
          <Button onClick={handleExport} disabled={loading !== null}>
            {loading === 'export' ? (
              <>
                <SpinnerIcon className="animate-spin mr-2" />
                {t('shareDialog.exporting')}
              </>
            ) : (
              <>
                <DownloadIcon className="mr-2" size={16} />
                {t('shareDialog.exportSession')}
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
