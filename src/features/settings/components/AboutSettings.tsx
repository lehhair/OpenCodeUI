import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { DownloadIcon, ExternalLinkIcon, RetryIcon, UploadIcon } from '../../../components/Icons'
import { hasUpdateAvailable, updateStore, useUpdateStore, RELEASES_PAGE_URL } from '../../../store/updateStore'
import { saveData } from '../../../utils/downloadUtils'
import { exportSettingsBackup, importSettingsBackup, previewBackupMeta } from '../../../utils/settingsBackup'
import { openExternalUrl } from '../../../utils/externalUrl'
import { SettingsSection } from './SettingsUI'
import { getRecentRenderFailures } from '../../../utils/renderDiagnostics'
import { getLastFrameStats } from '../../../utils/frameSampler'
import { messageStore } from '../../../store/messageStore'

export function AboutSettings() {
  const { t } = useTranslation(['settings'])
  const updateState = useUpdateStore()
  const hasUpdate = hasUpdateAvailable(updateState)
  const latestRelease = updateState.latestRelease
  const latestVersion = latestRelease?.tagName || t('about.unknownVersion')
  const releaseDate = latestRelease?.publishedAt ? new Date(latestRelease.publishedAt).toLocaleString() : null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const handleCheckUpdates = useCallback(() => {
    void updateStore.checkForUpdates({ force: true })
  }, [])

  const handleOpenRelease = useCallback(() => {
    const targetUrl = latestRelease?.url || RELEASES_PAGE_URL
    updateStore.hideToastForCurrentVersion()
    void openExternalUrl(targetUrl)
  }, [latestRelease?.url])

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

  let statusText = t('about.statusIdle')
  if (updateState.checking) {
    statusText = t('about.statusChecking')
  } else if (updateState.error) {
    statusText = t('about.statusError', { error: updateState.error })
  } else if (hasUpdate) {
    statusText = t('about.statusUpdateAvailable', { version: latestVersion })
  } else if (latestRelease) {
    statusText = t('about.statusUpToDate')
  }

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
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="text-[length:var(--fs-sm)] text-text-300">{t('about.latestVersion')}</div>
            <div className="shrink-0 text-[length:var(--fs-sm)] font-semibold text-text-100 font-mono tabular-nums">{latestVersion}</div>
          </div>
        </div>

        <div className="min-w-0 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
          <div className="break-words font-medium text-text-100">{statusText}</div>
          {releaseDate && <div className="mt-1 text-text-400">{t('about.publishedAt', { date: releaseDate })}</div>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" isLoading={updateState.checking} onClick={handleCheckUpdates}>
            {!updateState.checking && <RetryIcon size={12} />}
            {t('about.checkNow')}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleOpenRelease}>
            <ExternalLinkIcon size={12} />
            {hasUpdate ? t('about.viewUpdate') : t('about.openReleases')}
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

      {import.meta.env.DEV && <DiagnosticsSection />}
    </div>
  )
}

/** 仅开发期：把已有的渲染失败、帧统计和持有量放在一个地方，排障不用翻 console */
function DiagnosticsSection() {
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now())
  const failures = getRecentRenderFailures()
  const frame = getLastFrameStats()
  const held = messageStore.getHeldChatSize()

  return (
    <SettingsSection title="诊断（仅开发期）" description="最近渲染失败、流式帧统计与会话持有量">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setRefreshedAt(Date.now())}>
          <RetryIcon size={12} />
          刷新
        </Button>
        <span className="text-[length:var(--fs-sm)] text-text-400">
          {new Date(refreshedAt).toLocaleTimeString()}
        </span>
      </div>

      <div className="rounded-lg bg-bg-200/40 border border-border-200/40 px-3.5 py-3 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
        <div>
          持有：{held.sessions.length} 个会话 / {held.totalMessages} 条消息 /{' '}
          {(held.totalChars / 1024).toFixed(1)} KB
        </div>
        {frame ? (
          <div>
            最近流式帧：frames={frame.stats.frames} avg={frame.stats.avgFrameMs.toFixed(1)}ms p95=
            {frame.stats.p95FrameMs}ms max={frame.stats.longestFrameMs.toFixed(1)}ms dropped=
            {frame.stats.droppedFrames}
          </div>
        ) : (
          <div className="text-text-500">还没有流式帧统计（跑一次流式对话后再看）</div>
        )}
      </div>

      {failures.length === 0 ? (
        <div className="text-[length:var(--fs-sm)] text-text-500">没有渲染失败记录</div>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-auto rounded-lg bg-bg-200/30 border border-border-200/40 px-3.5 py-2 text-[length:var(--fs-xxs)] font-mono leading-relaxed">
          {failures
            .slice(-12)
            .reverse()
            .map((failure, index) => (
              <li key={`${failure.at}-${index}`} className="break-all text-text-400">
                [{failure.kind}] {failure.scope}: {failure.reason}
              </li>
            ))}
        </ul>
      )}
    </SettingsSection>
  )
}
