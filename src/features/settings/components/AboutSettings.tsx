import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { ExternalLinkIcon, RetryIcon } from '../../../components/Icons'
import { hasUpdateAvailable, updateStore, useUpdateStore, RELEASES_PAGE_URL } from '../../../store/updateStore'
import { isTauri } from '../../../utils/tauri'
import { SettingsCard, SettingsSection } from './SettingsUI'

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
  const hasUpdate = hasUpdateAvailable(updateState)
  const latestRelease = updateState.latestRelease
  const latestVersion = latestRelease?.tagName || t('about.unknownVersion')
  const releaseDate = latestRelease?.publishedAt ? new Date(latestRelease.publishedAt).toLocaleString() : null

  const handleCheckUpdates = useCallback(() => {
    void updateStore.checkForUpdates({ force: true })
  }, [])

  const handleOpenRelease = useCallback(() => {
    const targetUrl = latestRelease?.url || RELEASES_PAGE_URL
    updateStore.hideToastForCurrentVersion()
    void openExternalUrl(targetUrl)
  }, [latestRelease?.url])

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
    <div className="space-y-7">
      <SettingsSection title={t('about.title')}>
        <SettingsCard title={t('about.versionCardTitle')} description={t('about.versionCardDesc')}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border-200/50 bg-bg-000/35 px-3 py-2.5">
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-1">{t('about.currentVersion')}</div>
                <div className="text-[length:var(--fs-base)] font-semibold text-text-100 font-mono">
                  v{updateState.currentVersion}
                </div>
              </div>
              <div className="rounded-lg border border-border-200/50 bg-bg-000/35 px-3 py-2.5">
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-1">{t('about.latestVersion')}</div>
                <div className="text-[length:var(--fs-base)] font-semibold text-text-100 font-mono">
                  {latestVersion}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border-200/50 bg-bg-100/35 px-3 py-3 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
              <div className="font-medium text-text-100">{statusText}</div>
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
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
