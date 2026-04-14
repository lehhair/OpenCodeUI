import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { TrashIcon, WifiIcon, WifiOffIcon, SpinnerIcon, StopIcon } from '../../../components/Icons'
import { useServerStore, useIsMobile } from '../../../hooks'
import { serviceStore, useServiceStore } from '../../../store/serviceStore'
import { isTauri } from '../../../utils/tauri'
import { apiErrorHandler } from '../../../utils'
import { Toggle, SettingRow, SettingsCard } from './SettingsUI'

export function ServiceSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const isMobile = useIsMobile()
  const {
    autoStart: autoStartService,
    binaryPath,
    envVars,
    running: serviceRunning,
    startedByUs,
    starting: serviceStarting,
  } = useServiceStore()
  const { activeServer } = useServerStore()
  const isTauriDesktop = isTauri() && !isMobile

  // 本地编辑状态（debounce 保存）
  const [localBinaryPath, setLocalBinaryPath] = useState(binaryPath)
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 启动失败的错误信息
  const [serviceError, setServiceError] = useState('')

  // 同步外部变化
  useEffect(() => {
    setLocalBinaryPath(binaryPath)
  }, [binaryPath])

  // 打开设置页时自动检测一次服务状态
  useEffect(() => {
    if (!isTauriDesktop) return
    handleCheckService()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauriDesktop])

  const handleAutoStartToggle = () => {
    serviceStore.setAutoStart(!autoStartService)
  }

  const handleBinaryPathChange = (v: string) => {
    setLocalBinaryPath(v)
    if (pathDebounceRef.current) clearTimeout(pathDebounceRef.current)
    pathDebounceRef.current = setTimeout(() => serviceStore.setBinaryPath(v), 400)
  }

  const getServerUrl = () => activeServer?.url || 'http://127.0.0.1:4096'

  const handleStartService = async () => {
    setServiceError('')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      serviceStore.setStarting(true)
      const weStarted = await invoke<boolean>('start_opencode_service', {
        url: getServerUrl(),
        binaryPath: serviceStore.effectiveBinaryPath,
        envVars: serviceStore.envVarsRecord,
      })
      serviceStore.setStartedByUs(weStarted)
      serviceStore.setRunning(true)
    } catch (e) {
      const msg = String(e)
      apiErrorHandler('start service', msg)
      setServiceError(msg)
    } finally {
      serviceStore.setStarting(false)
    }
  }

  const handleStopService = async () => {
    setServiceError('')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('stop_opencode_service')
      serviceStore.setStartedByUs(false)
      serviceStore.setRunning(false)
    } catch (e) {
      apiErrorHandler('stop service', e)
    }
  }

  const handleCheckService = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const running = await invoke<boolean>('check_opencode_service', { url: getServerUrl() })
      serviceStore.setRunning(running)
      if (running) {
        const byUs = await invoke<boolean>('get_service_started_by_us')
        serviceStore.setStartedByUs(byUs)
      } else {
        serviceStore.setStartedByUs(false)
      }
    } catch (e) {
      apiErrorHandler('check service', e)
    }
  }

  if (!isTauriDesktop) {
    return (
      <SettingsCard title={t('service.localService')} description={t('service.desktopOnlyDesc')}>
        <div className="text-[length:var(--fs-sm)] text-text-400 leading-relaxed">{t('service.webModeDesc')}</div>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard title={t('service.localService')} description={t('service.localServiceDesc')}>
      <div className="space-y-3">
        <div>
          <div className="text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('service.binaryPath')}</div>
          <input
            type="text"
            value={localBinaryPath}
            onChange={e => handleBinaryPathChange(e.target.value)}
            placeholder={t('service.binaryPathPlaceholder')}
            className="w-full h-8 px-3 text-[length:var(--fs-md)] font-mono bg-bg-200/50 border border-border-200 rounded-md
              focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-400"
          />
          <div className="text-[length:var(--fs-xs)] text-text-400 mt-1">{t('service.binaryPathHelp')}</div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <SettingRow
            label={t('service.autoStart')}
            description={t('service.autoStartDesc')}
            onClick={handleAutoStartToggle}
            className="bg-bg-100/35 border-border-200/45"
          >
            <Toggle enabled={autoStartService} onChange={handleAutoStartToggle} />
          </SettingRow>

          <SettingRow
            label={t('service.serviceStatus')}
            description={
              serviceStarting
                ? t('service.starting')
                : serviceRunning
                  ? startedByUs
                    ? t('service.runningStartedByApp')
                    : t('service.runningExternal')
                  : t('service.notRunning')
            }
            icon={
              serviceStarting ? (
                <SpinnerIcon size={14} className="animate-spin text-text-400" />
              ) : serviceRunning ? (
                <WifiIcon size={14} className="text-success-100" />
              ) : (
                <WifiOffIcon size={14} className="text-text-400" />
              )
            }
            className="bg-bg-100/35 border-border-200/45"
          >
            <div className="flex items-center gap-2">
              {!serviceStarting && !serviceRunning && (
                <Button size="sm" variant="ghost" onClick={handleStartService}>
                  {t('common:start')}
                </Button>
              )}
              {!serviceStarting && serviceRunning && startedByUs && (
                <Button size="sm" variant="ghost" onClick={handleStopService}>
                  <StopIcon size={12} className="mr-1" />
                  {t('common:stop')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleCheckService} disabled={serviceStarting}>
                {t('common:refresh')}
              </Button>
            </div>
          </SettingRow>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[length:var(--fs-xs)] font-medium text-text-300">{t('service.envVars')}</div>
            <button
              className="text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-100/80 transition-colors"
              onClick={() => serviceStore.setEnvVars([...envVars, { key: '', value: '' }])}
            >
              + {t('common:add')}
            </button>
          </div>
          <div className="text-[length:var(--fs-xs)] text-text-400 mb-2">{t('service.envVarsDesc')}</div>
          {envVars.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {envVars.map((env, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={env.key}
                    onChange={e => {
                      const updated = [...envVars]
                      updated[idx] = { ...updated[idx], key: e.target.value }
                      serviceStore.setEnvVars(updated)
                    }}
                    placeholder={t('service.keyPlaceholder')}
                    className="w-[120px] shrink-0 h-7 px-2 text-[length:var(--fs-xs)] font-mono bg-bg-200/50 border border-border-200 rounded
                      focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-500"
                  />
                  <span className="text-text-500 text-[length:var(--fs-xs)] shrink-0">=</span>
                  <input
                    type="text"
                    value={env.value}
                    onChange={e => {
                      const updated = [...envVars]
                      updated[idx] = { ...updated[idx], value: e.target.value }
                      serviceStore.setEnvVars(updated)
                    }}
                    placeholder={t('service.valuePlaceholder')}
                    className="flex-1 min-w-0 h-7 px-2 text-[length:var(--fs-xs)] font-mono bg-bg-200/50 border border-border-200 rounded
                      focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-500"
                  />
                  <button
                    className="shrink-0 w-7 h-7 flex items-center justify-center text-text-400 hover:text-danger-100
                      hover:bg-danger-100/10 rounded transition-colors"
                    onClick={() => {
                      const updated = envVars.filter((_, i) => i !== idx)
                      serviceStore.setEnvVars(updated)
                    }}
                    title={t('common:remove')}
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {serviceError && (
          <div className="text-[length:var(--fs-xs)] text-danger-100 bg-danger-100/10 border border-danger-100/20 rounded-md px-2.5 py-2 leading-relaxed break-all">
            {serviceError}
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
