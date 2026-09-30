import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import {
  BellIcon,
  VolumeIcon,
  VolumeOffIcon,
  PlayIcon,
  CheckIcon,
  ShieldIcon,
  QuestionIcon,
  AlertCircleIcon,
} from '../../../components/Icons'
import { useNotification } from '../../../hooks'
import { notificationStore } from '../../../store'
import {
  notificationEventSettingsStore,
  useNotificationEventSettings,
} from '../../../store/notificationEventSettingsStore'
import { soundStore, useSoundSettings } from '../../../store/soundStore'
import { Toggle, SettingRow, SettingField, SettingsSection, SettingsSubgroup } from './SettingsUI'
import { BUILTIN_SOUNDS, SOUND_OPTIONS, isSoundSupported, playSound } from '../../../utils/soundPlayer'
import type { NotificationType } from '../../../store/notificationStore'

// ============================================
// Event type metadata
// ============================================

const EVENT_TYPES: {
  type: NotificationType
  labelKey: string
  descKey: string
  icon: React.ReactNode
  color: string
}[] = [
  {
    type: 'completed',
    labelKey: 'notifications.eventCompleted',
    descKey: 'notifications.eventCompletedDesc',
    icon: <CheckIcon size={14} />,
    color: 'text-green-400',
  },
  {
    type: 'permission',
    labelKey: 'notifications.eventPermission',
    descKey: 'notifications.eventPermissionDesc',
    icon: <ShieldIcon size={14} />,
    color: 'text-yellow-400',
  },
  {
    type: 'question',
    labelKey: 'notifications.eventQuestion',
    descKey: 'notifications.eventQuestionDesc',
    icon: <QuestionIcon size={14} />,
    color: 'text-blue-400',
  },
  {
    type: 'error',
    labelKey: 'notifications.eventError',
    descKey: 'notifications.eventErrorDesc',
    icon: <AlertCircleIcon size={14} />,
    color: 'text-red-400',
  },
]

type AudioOperation = 'upload' | 'remove' | 'export'

const audioOperations = new Map<NotificationType, AudioOperation>()
const audioOperationListeners = new Set<() => void>()

function setAudioOperation(type: NotificationType, operation: AudioOperation | null) {
  if (operation) audioOperations.set(type, operation)
  else audioOperations.delete(type)
  audioOperationListeners.forEach(listener => listener())
}

function beginAudioOperation(type: NotificationType, operation: AudioOperation) {
  if (audioOperations.has(type)) return false
  setAudioOperation(type, operation)
  return true
}

function subscribeAudioOperations(listener: () => void) {
  audioOperationListeners.add(listener)
  return () => audioOperationListeners.delete(listener)
}

function useAudioOperation(type: NotificationType) {
  return useSyncExternalStore(
    subscribeAudioOperations,
    () => audioOperations.get(type) ?? null,
    () => null,
  )
}

// ============================================
// Volume Slider
// ============================================

function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 w-full">
      <VolumeOffIcon size={13} className="text-text-400 shrink-0" />
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer
          bg-bg-200
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-accent-main-100
          [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-bg-000
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-moz-range-thumb]:w-3.5
          [&::-moz-range-thumb]:h-3.5
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-accent-main-100
          [&::-moz-range-thumb]:border-2
          [&::-moz-range-thumb]:border-bg-000
          [&::-moz-range-thumb]:cursor-pointer
          [&::-moz-range-track]:bg-bg-200
          [&::-moz-range-track]:rounded-full
          [&::-moz-range-track]:h-1.5"
      />
      <VolumeIcon size={13} className="text-text-400 shrink-0" />
      <span className="text-[length:var(--fs-sm)] text-text-300 w-8 text-right tabular-nums">{value}</span>
    </div>
  )
}

function EventEnableRow({
  type,
  labelKey,
  descKey,
  icon,
  color,
}: {
  type: NotificationType
  labelKey: string
  descKey: string
  icon: React.ReactNode
  color: string
}) {
  const { t } = useTranslation(['settings'])
  const settings = useNotificationEventSettings()
  const eventConfig = settings.events[type]

  return (
    <SettingRow
      label={t(labelKey as `notifications.${string}`)}
      description={t(descKey as `notifications.${string}`)}
      icon={<span className={color}>{icon}</span>}
      searchContext={t('notifications.notificationTypes')}
      onClick={() => notificationEventSettingsStore.setSystemEnabled(type, !eventConfig.systemEnabled)}
    >
      <Toggle
        enabled={eventConfig.systemEnabled}
        onChange={() => notificationEventSettingsStore.setSystemEnabled(type, !eventConfig.systemEnabled)}
      />
    </SettingRow>
  )
}

// ============================================
// Event Sound Card
// ============================================

function EventSoundCard({
  type,
  labelKey,
  descKey,
  icon,
  color,
}: {
  type: NotificationType
  labelKey: string
  descKey: string
  icon: React.ReactNode
  color: string
}) {
  const { t } = useTranslation(['settings'])
  const settings = useSoundSettings()
  const eventConfig = settings.events[type]
  const [uploadError, setUploadError] = useState<string | null>(null)
  const audioBusy = useAudioOperation(type)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const soundOptions = SOUND_OPTIONS[type]
  const hasCustom = soundStore.hasCustomAudio(type)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handlePreview = useCallback(() => {
    if (eventConfig.soundId === 'none') return
    const customBlob = eventConfig.soundId === 'custom' ? soundStore.getCustomAudioBlob(type) : null
    playSound({
      soundId: eventConfig.soundId,
      customAudioData: customBlob,
      volume: settings.volume,
    })
  }, [eventConfig, settings.volume, type])

  const handleSoundChange = useCallback(
    (soundId: string) => {
      setUploadError(null)
      soundStore.setEventSound(type, soundId)
    },
    [type],
  )

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file || !beginAudioOperation(type, 'upload')) return
      setUploadError(null)
      try {
        const result = await soundStore.uploadCustomAudio(type, file)
        if (mountedRef.current && !result.success && result.error) {
          const errorKey = `notifications.error${result.error.charAt(0).toUpperCase()}${result.error.slice(1)}`
          setUploadError(t(errorKey as `notifications.${string}`))
        }
      } finally {
        if (audioOperations.get(type) === 'upload') setAudioOperation(type, null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [type, t],
  )

  const handleRemoveCustom = useCallback(async () => {
    if (!beginAudioOperation(type, 'remove')) return
    setUploadError(null)
    try {
      await soundStore.removeCustomAudio(type)
    } finally {
      if (audioOperations.get(type) === 'remove') setAudioOperation(type, null)
    }
  }, [type])

  const handleExportCustom = useCallback(async () => {
    if (!beginAudioOperation(type, 'export')) return
    try {
      await soundStore.exportCustomAudio(type)
    } finally {
      if (audioOperations.get(type) === 'export') setAudioOperation(type, null)
    }
  }, [type])

  return (
    <div
      data-setting-label={t(labelKey as `notifications.${string}`)}
      data-setting-context={t('notifications.eventSounds')}
      className="relative rounded-lg border border-border-200/50 p-3 hover:border-border-300/60 transition-colors"
    >
      {/* 试听按钮 — 绝对定位右上角 */}
      <button
        type="button"
        onClick={handlePreview}
        disabled={eventConfig.soundId === 'none'}
        className="absolute right-2 top-2 inline-flex items-center justify-center w-7 h-7 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/60 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-400"
        title={t('notifications.preview')}
        aria-label={t('notifications.preview')}
      >
        <PlayIcon size={13} />
      </button>

      {/* Header — 图标+标题+描述 */}
      <div className="flex items-start gap-2.5 min-w-0 mb-2.5 pr-9">
        <span className={`${color} shrink-0 mt-[3px]`}>{icon}</span>
        <div className="min-w-0">
          <div className="text-[length:var(--fs-md)] font-medium text-text-100 leading-snug">
            {t(labelKey as `notifications.${string}`)}
          </div>
          <div className="text-[length:var(--fs-xs)] text-text-300 mt-0.5">
            {t(descKey as `notifications.${string}`)}
          </div>
        </div>
      </div>

      {/* Sound Selector — 无边框胶囊 */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => handleSoundChange('none')}
          className={`px-2.5 py-1 rounded-md text-[length:var(--fs-sm)] font-medium transition-colors
            ${
              eventConfig.soundId === 'none'
                ? 'bg-accent-main-100/10 text-accent-main-100'
                : 'text-text-400 hover:bg-bg-200/60 hover:text-text-200'
            }`}
        >
          {t('notifications.noSound')}
        </button>

        {soundOptions.map(sid => (
          <button
            key={sid}
            type="button"
            onClick={() => handleSoundChange(sid)}
            className={`px-2.5 py-1 rounded-md text-[length:var(--fs-sm)] font-medium transition-colors
              ${
                eventConfig.soundId === sid
                  ? 'bg-accent-main-100/10 text-accent-main-100'
                  : 'text-text-400 hover:bg-bg-200/60 hover:text-text-200'
              }`}
          >
            {BUILTIN_SOUNDS[sid]}
          </button>
        ))}

        {hasCustom && (
          <button
            type="button"
            onClick={() => handleSoundChange('custom')}
            className={`px-2.5 py-1 rounded-md text-[length:var(--fs-sm)] font-medium transition-colors
              ${
                eventConfig.soundId === 'custom'
                  ? 'bg-accent-main-100/10 text-accent-main-100'
                  : 'text-text-400 hover:bg-bg-200/60 hover:text-text-200'
              }`}
          >
            {t('notifications.customSound')}
          </button>
        )}
      </div>

      {/* Custom audio + actions — 行内 ghost 按钮 */}
      {hasCustom && eventConfig.customFileName && (
        <div className="flex flex-wrap items-center gap-1 mb-1.5">
          <span
            className="min-w-0 flex-1 text-[length:var(--fs-xs)] text-text-400 truncate"
            title={eventConfig.customFileName}
          >
            {eventConfig.customFileName}
          </span>
          <button
            type="button"
            onClick={handleExportCustom}
            disabled={audioBusy !== null}
            className="text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 px-1.5 py-0.5 rounded-md hover:bg-accent-main-100/10 transition-colors"
          >
            {t('notifications.exportAudio')}
          </button>
          <button
            type="button"
            onClick={handleRemoveCustom}
            disabled={audioBusy !== null}
            className="text-[length:var(--fs-xs)] text-text-400 hover:text-danger-100 px-1.5 py-0.5 rounded-md hover:bg-danger-100/10 transition-colors"
          >
            {t('notifications.removeCustom')}
          </button>
        </div>
      )}

      {/* Upload row */}
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileUpload}
          disabled={audioBusy !== null}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={audioBusy !== null}
          className="text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 px-2 py-1 rounded-md hover:bg-accent-main-100/10 transition-colors disabled:opacity-50"
        >
          {hasCustom ? t('notifications.replaceAudio') : t('notifications.uploadAudio')}
        </button>
        <span className="w-full text-[length:var(--fs-xs)] text-text-500 sm:ml-auto sm:w-auto">
          {t('notifications.supportedFormats')}
        </span>
      </div>

      {/* Upload Error */}
      {uploadError && (
        <div aria-live="polite" className="mt-1.5 text-[length:var(--fs-xs)] text-danger-100 flex items-center gap-1.5">
          <AlertCircleIcon size={11} />
          {uploadError}
        </div>
      )}
    </div>
  )
}

// ============================================
// Main NotificationSettings
// ============================================

export function NotificationSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const {
    enabled: notificationsEnabled,
    setEnabled: setNotificationsEnabled,
    supported: notificationsSupported,
    permission: notificationPermission,
    sendNotification,
  } = useNotification()
  const [toastEnabled, setToastEnabledState] = useState(notificationStore.toastEnabled)
  const soundSettings = useSoundSettings()
  const soundSupported = isSoundSupported()

  const handleTestNotification = () => {
    sendNotification(t('notifications.testTitle'), t('notifications.testBody'))
  }

  const handleToastToggle = () => {
    const v = !toastEnabled
    setToastEnabledState(v)
    notificationStore.setToastEnabled(v)
  }

  return (
    <div>
      <SettingsSection
        title={t('notifications.systemNotifications')}
        description={t('notifications.systemNotificationsDesc')}
      >
        {notificationsSupported ? (
          <div className="space-y-3">
            <SettingRow
              label={t('notifications.notificationsLabel')}
              description={
                notificationPermission === 'denied'
                  ? t('notifications.blockedByBrowser')
                  : t('notifications.notifyWhenComplete')
              }
              onClick={() => notificationPermission !== 'denied' && setNotificationsEnabled(!notificationsEnabled)}
              disabled={notificationPermission === 'denied'}
            >
              <Toggle
                enabled={notificationsEnabled && notificationPermission !== 'denied'}
                disabled={notificationPermission === 'denied'}
                onChange={() => notificationPermission !== 'denied' && setNotificationsEnabled(!notificationsEnabled)}
              />
            </SettingRow>

            <SettingRow
              label={t('notifications.testNotification')}
              description={notificationsEnabled ? t('notifications.sendSampleDesc') : t('notifications.enableToTest')}
            >
              <Button
                size="sm"
                variant="ghost"
                onClick={handleTestNotification}
                disabled={!notificationsEnabled || notificationPermission === 'denied'}
              >
                {t('common:send')}
              </Button>
            </SettingRow>

            {notificationsEnabled && notificationPermission !== 'denied' && (
              <SettingsSubgroup
                title={t('notifications.notificationTypes')}
                description={t('notifications.notificationTypesDesc')}
              >
                {EVENT_TYPES.map(evt => (
                  <EventEnableRow
                    key={evt.type}
                    type={evt.type}
                    labelKey={evt.labelKey}
                    descKey={evt.descKey}
                    icon={evt.icon}
                    color={evt.color}
                  />
                ))}
              </SettingsSubgroup>
            )}
          </div>
        ) : (
          <div className="text-[length:var(--fs-xs)] text-text-300 leading-relaxed">
            {t('notifications.notAvailable')}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={t('notifications.inAppAlerts')} description={t('notifications.inAppAlertsDesc')}>
        <SettingRow
          label={t('notifications.toastNotifications')}
          description={t('notifications.toastDesc')}
          icon={<BellIcon size={14} />}
          onClick={handleToastToggle}
        >
          <Toggle enabled={toastEnabled} onChange={handleToastToggle} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('notifications.soundSettings')} description={t('notifications.soundSettingsDesc')}>
        {soundSupported ? (
          <div className="space-y-4">
            <SettingRow
              label={t('notifications.soundEnabled')}
              description={t('notifications.soundEnabledDesc')}
              icon={soundSettings.enabled ? <VolumeIcon size={14} /> : <VolumeOffIcon size={14} />}
              onClick={() => soundStore.setEnabled(!soundSettings.enabled)}
            >
              <Toggle enabled={soundSettings.enabled} onChange={() => soundStore.setEnabled(!soundSettings.enabled)} />
            </SettingRow>

            <SettingRow
              label={t('notifications.currentSessionSound')}
              description={t('notifications.currentSessionSoundDesc')}
              onClick={() => soundStore.setCurrentSessionEnabled(!soundSettings.currentSessionEnabled)}
            >
              <Toggle
                enabled={soundSettings.currentSessionEnabled}
                onChange={() => soundStore.setCurrentSessionEnabled(!soundSettings.currentSessionEnabled)}
              />
            </SettingRow>

            <SettingField label={t('notifications.volume')} description={t('notifications.volumeDesc')}>
              <VolumeSlider value={soundSettings.volume} onChange={v => soundStore.setVolume(v)} />
            </SettingField>

            {soundSettings.enabled && (
              <SettingField label={t('notifications.eventSounds')} description={t('notifications.eventSoundsDesc')}>
                <div className="grid gap-3 xl:grid-cols-2">
                  {EVENT_TYPES.map(evt => (
                    <EventSoundCard
                      key={evt.type}
                      type={evt.type}
                      labelKey={evt.labelKey}
                      descKey={evt.descKey}
                      icon={evt.icon}
                      color={evt.color}
                    />
                  ))}
                </div>
              </SettingField>
            )}
          </div>
        ) : (
          <div className="text-[length:var(--fs-xs)] text-text-300 leading-relaxed">
            {t('notifications.soundNotSupported')}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
