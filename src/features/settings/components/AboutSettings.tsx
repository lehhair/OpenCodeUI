import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { DownloadIcon, ExternalLinkIcon, UploadIcon } from '../../../components/Icons'
import { useUpdateStore, RELEASES_PAGE_URL } from '../../../store/updateStore'
import { saveData } from '../../../utils/downloadUtils'
import { exportSettingsBackup, importSettingsBackup, previewBackupMeta } from '../../../utils/settingsBackup'
import { isTauri } from '../../../utils/tauri'
import { SettingsSection } from './SettingsUI'

async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await import('@tauri-apps/plugin-opener')
      .then(mod => mod.openUrl(url))
      .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

export function AboutSettings() {
  const { t } = useTranslation(['settings'])
  const updateState = useUpdateStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const handleOpenReleases = useCallback(() => {
    void openExternalUrl(RELEASES_PAGE_URL)
  }, [])

  const handleExportBackup = useCallback(async () => {
    setBackupError(null)
    setBackupBusy('export')
    try {
      const { fileName, data } = await exportSettingsBackup()
      saveData(data, fileName, 'application/json;charset=utf-8')
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : t('about.backupExportFailed'))
    } finally {
      setBackupBusy(null)
    }
  }, [t])

  const handleImportClick = useCallback(() => {
    setBackupError(null)
    fileInputRef.current?.click()
  }, [])

  const handleImportBackup = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      setBackupError(null)
      setBackupBusy('import')

      try {
        const { createdAt } = await previewBackupMeta(file)
        const confirmed = window.confirm(
          createdAt
            ? t('about.backupImportConfirmWithDate', { date: new Date(createdAt).toLocaleString() })
            : t('about.backupImportConfirm'),
        )
        if (!confirmed) return

        await importSettingsBackup(file)
        window.location.reload()
      } catch (error) {
        setBackupError(error instanceof Error ? error.message : t('about.backupImportFailed'))
      } finally {
        setBackupBusy(null)
      }
    },
    [t],
  )

  return (
    <div>
      <SettingsSection title={t('about.versionCardTitle')} description={t('about.versionCardDesc')}>
        <div className="divide-y divide-border-200/35">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="text-[length:var(--fs-sm)] text-text-300">{t('about.currentVersion')}</div>
            <div className="shrink-0 text-[length:var(--fs-sm)] font-semibold text-text-100 font-mono tabular-nums">
              v{updateState.currentVersion}
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-warning-bg/40 border border-warning-100/20 px-3.5 py-3 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
          <div className="font-medium text-text-100">{t('about.eolTitle')}</div>
          <div className="mt-1">{t('about.eolBody')}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={handleOpenReleases}>
            <ExternalLinkIcon size={12} />
            {t('about.openReleases')}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title={t('about.backupCardTitle')} description={t('about.backupCardDesc')}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportBackup}
          className="hidden"
        />
        <div className="rounded-lg bg-warning-bg/40 border border-warning-100/20 px-3.5 py-3 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
          {t('about.backupWarning')}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" isLoading={backupBusy === 'export'} onClick={handleExportBackup}>
            {backupBusy !== 'export' && <DownloadIcon size={12} />}
            {t('about.exportBackup')}
          </Button>
          <Button size="sm" variant="ghost" isLoading={backupBusy === 'import'} onClick={handleImportClick}>
            {backupBusy !== 'import' && <UploadIcon size={12} />}
            {t('about.importBackup')}
          </Button>
        </div>

        {backupError && (
          <div className="min-w-0 break-all rounded-lg bg-danger-100/10 border border-danger-100/20 px-3.5 py-2.5 text-[length:var(--fs-sm)] text-danger-100 leading-relaxed">
            {backupError}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
