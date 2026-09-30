import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { TrashIcon, WifiIcon, WifiOffIcon, SpinnerIcon, StopIcon } from '../../../components/Icons'
import { useServerStore, useIsMobile } from '../../../hooks'
import { API_BASE_URL } from '../../../constants'
import { LOCAL_SERVER_ID } from '../../../store/serverStore'
import { serviceStore, useServiceStore } from '../../../store/serviceStore'
import { isTauri } from '../../../utils/tauri'
import { apiErrorHandler } from '../../../utils'
import { applyLocalServiceUrl } from '../../../utils/localServiceUrl'
import { settingsFieldClass, Toggle, SettingRow, SettingField, SettingsSection } from './SettingsUI'

interface StartOpencodeServiceResult {
  started: boolean
  startedByUs: boolean
  url?: string | null
}

export function ServiceSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const isMobile = useIsMobile()
  const {
    autoStart: autoStartService,
    binaryPath,
    detectedBinaryPath,
    envVars,
    running: serviceRunning,
    startedByUs,
    starting: serviceStarting,
  } = useServiceStore()
  const { servers } = useServerStore()
  const localServer = servers.find(server => server.id === LOCAL_SERVER_ID)
  const isTauriDesktop = isTauri() && !isMobile

  // 本地编辑状态（debounce 保存）
  const [localBinaryPath, setLocalBinaryPath] = useState(binaryPath)
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingBinaryPathRef = useRef<string | null>(null)
  const [detectingBinary, setDetectingBinary] = useState(false)
  const [checkingService, setCheckingService] = useState(false)
  const [stoppingService, setStoppingService] = useState(false)
  const serviceOperationRef = useRef(0)
  const mountedRef = useRef(true)
  // 启动失败的错误信息
  const [serviceError, setServiceError] = useState('')

  // 同步外部变化
  useEffect(() => {
    if (pathDebounceRef.current) {
      clearTimeout(pathDebounceRef.current)
      pathDebounceRef.current = null
    }
    pendingBinaryPathRef.current = null
    setLocalBinaryPath(binaryPath)
  }, [binaryPath])

  useEffect(
    () => () => {
      if (pathDebounceRef.current) clearTimeout(pathDebounceRef.current)
      if (pendingBinaryPathRef.current !== null) serviceStore.setBinaryPath(pendingBinaryPathRef.current)
    },
    [],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 打开设置页时自动检测一次服务状态
  useEffect(() => {
    if (!isTauriDesktop) return
    handleCheckService()
    handleDetectBinary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauriDesktop])

  const handleAutoStartToggle = () => {
    serviceStore.setAutoStart(!autoStartService)
  }

  const handleBinaryPathChange = (v: string) => {
    setLocalBinaryPath(v)
    pendingBinaryPathRef.current = v
    if (pathDebounceRef.current) clearTimeout(pathDebounceRef.current)
    pathDebounceRef.current = setTimeout(() => {
      pathDebounceRef.current = null
      pendingBinaryPathRef.current = null
      serviceStore.setBinaryPath(v)
    }, 400)
  }

  const getServerUrl = () => localServer?.url || API_BASE_URL

  const handleDetectBinary = async () => {
    if (!isTauriDesktop) return
    setDetectingBinary(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const detected = await invoke<string | null>('detect_opencode_binary', { envVars: serviceStore.envVarsRecord })
      serviceStore.setDetectedBinaryPath(detected)
    } catch (e) {
      apiErrorHandler('detect opencode binary', e)
      serviceStore.setDetectedBinaryPath(null)
    } finally {
      if (mountedRef.current) setDetectingBinary(false)
    }
  }

  const handleStartService = async () => {
    const operation = ++serviceOperationRef.current
    setServiceError('')
    serviceStore.setStarting(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const detected = await invoke<string | null>('detect_opencode_binary', {
        envVars: serviceStore.envVarsRecord,
      }).catch(() => null)
      if (operation !== serviceOperationRef.current) return
      serviceStore.setDetectedBinaryPath(detected)
      const result = await invoke<StartOpencodeServiceResult>('start_opencode_service', {
        url: getServerUrl(),
        binaryPath: serviceStore.effectiveBinaryPath,
        envVars: serviceStore.envVarsRecord,
      })
      if (operation !== serviceOperationRef.current) return
      applyLocalServiceUrl(result.url)
      serviceStore.setStartedByUs(result.startedByUs)
      serviceStore.setRunning(true)
    } catch (e) {
      if (operation !== serviceOperationRef.current) return
      const msg = String(e)
      apiErrorHandler('start service', msg)
      if (mountedRef.current) setServiceError(msg)
    } finally {
      serviceStore.setStarting(false)
    }
  }

  const handleStopService = async () => {
    const operation = ++serviceOperationRef.current
    setServiceError('')
    setStoppingService(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('stop_opencode_service')
      if (operation !== serviceOperationRef.current) return
      serviceStore.setStartedByUs(false)
      serviceStore.setRunning(false)
    } catch (e) {
      if (operation !== serviceOperationRef.current) return
      apiErrorHandler('stop service', e)
    } finally {
      if (operation === serviceOperationRef.current && mountedRef.current) setStoppingService(false)
    }
  }

  const handleCheckService = async () => {
    const operation = ++serviceOperationRef.current
    setCheckingService(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const running = await invoke<boolean>('check_opencode_service', { url: getServerUrl() })
      if (operation !== serviceOperationRef.current) return
      serviceStore.setRunning(running)
      if (running) {
        const byUs = await invoke<boolean>('get_service_started_by_us')
        if (operation !== serviceOperationRef.current) return
        serviceStore.setStartedByUs(byUs)
      } else {
        serviceStore.setStartedByUs(false)
      }
    } catch (e) {
      if (operation !== serviceOperationRef.current) return
      apiErrorHandler('check service', e)
    } finally {
      if (operation === serviceOperationRef.current && mountedRef.current) setCheckingService(false)
    }
  }

  if (!isTauriDesktop) {
    return (
      <SettingsSection title={t('service.localService')} description={t('service.desktopOnlyDesc')}>
        <div className="text-[length:var(--fs-xs)] text-text-300 leading-relaxed">{t('service.webModeDesc')}</div>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title={t('service.localService')} description={t('service.localServiceDesc')}>
      <SettingField
        label={t('service.binaryPath')}
        description={t('service.binaryPathHelp')}
        actions={
          <button
            type="button"
            className="h-7 px-2 rounded-md text-[length:var(--fs-xs)] font-medium text-accent-main-100 hover:bg-accent-main-100/10 transition-colors disabled:opacity-50"
            onClick={handleDetectBinary}
            disabled={detectingBinary}
          >
            {detectingBinary ? t('service.detectingBinary') : t('service.detectBinary')}
          </button>
        }
      >
        <input
          type="text"
          value={localBinaryPath}
          onChange={e => handleBinaryPathChange(e.target.value)}
          placeholder={t('service.binaryPathPlaceholder')}
          className={`${settingsFieldClass} font-mono`}
        />
        <div className="text-[length:var(--fs-xs)] text-text-500 mt-1.5 font-mono break-all">
          {localBinaryPath.trim()
            ? t('service.usingManualBinary')
            : detectedBinaryPath
              ? t('service.detectedBinary', { path: detectedBinaryPath })
              : t('service.detectedBinaryMissing')}
        </div>
      </SettingField>

      <SettingRow
        label={t('service.autoStart')}
        description={t('service.autoStartDesc')}
        onClick={handleAutoStartToggle}
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
      >
        <div className="flex items-center gap-1.5">
          {!serviceStarting && !serviceRunning && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleStartService}
              disabled={checkingService || stoppingService}
            >
              {t('common:start')}
            </Button>
          )}
          {!serviceStarting && serviceRunning && startedByUs && (
            <Button size="sm" variant="ghost" onClick={handleStopService} disabled={checkingService || stoppingService}>
              <StopIcon size={12} className="mr-1" />
              {t('common:stop')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCheckService}
            disabled={serviceStarting || checkingService || stoppingService}
          >
            {t('common:refresh')}
          </Button>
        </div>
      </SettingRow>

      <SettingField
        label={t('service.envVars')}
        description={t('service.envVarsDesc')}
        actions={
          <button
            type="button"
            className="h-7 px-2 rounded-md text-[length:var(--fs-xs)] font-medium text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
            onClick={() => serviceStore.setEnvVars([...envVars, { key: '', value: '' }])}
          >
            + {t('common:add')}
          </button>
        }
      >
        {envVars.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {envVars.map((env, idx) => (
              <div
                key={idx}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1.5fr)_auto] items-center gap-1.5 sm:flex sm:items-center"
              >
                <input
                  type="text"
                  value={env.key}
                  onChange={e => {
                    const updated = [...envVars]
                    updated[idx] = { ...updated[idx], key: e.target.value }
                    serviceStore.setEnvVars(updated)
                  }}
                  placeholder={t('service.keyPlaceholder')}
                  className={`${settingsFieldClass} min-w-0 font-mono text-[length:var(--fs-xs)] sm:w-[120px] sm:shrink-0`}
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
                  className={`${settingsFieldClass} min-w-0 font-mono text-[length:var(--fs-xs)] sm:flex-1`}
                />
                <button
                  type="button"
                  className="shrink-0 w-8 h-8 flex items-center justify-center text-text-400 hover:text-danger-100
                    hover:bg-danger-100/10 rounded-lg transition-colors"
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
        ) : null}
      </SettingField>

      {serviceError && (
        <div className="text-[length:var(--fs-sm)] text-danger-100 bg-danger-100/10 border border-danger-100/20 rounded-lg px-3 py-2.5 leading-relaxed break-all">
          {serviceError}
        </div>
      )}
    </SettingsSection>
  )
}
