import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import {
  BellIcon,
  VolumeIcon,
  VolumeOffIcon,
  PlayIcon,
  UploadIcon,
  DownloadIcon,
  TrashIcon,
  CheckIcon,
  ShieldIcon,
  QuestionIcon,
  AlertCircleIcon,
} from '../../../components/Icons'
import { useNotification } from '../../../hooks'
import { notificationStore } from '../../../store'
import { soundStore, useSoundSettings } from '../../../store/soundStore'
import { Toggle, SettingRow, SettingsCard } from './SettingsUI'
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const soundOptions = SOUND_OPTIONS[type]
  const hasCustom = soundStore.hasCustomAudio(type)

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
      if (!file) return
      setUploadError(null)

      const result = await soundStore.uploadCustomAudio(type, file)
      if (!result.success && result.error) {
        const errorKey = `notifications.error${result.error.charAt(0).toUpperCase()}${result.error.slice(1)}`
        setUploadError(t(errorKey as `notifications.${string}`))
      }

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [type, t],
  )

  const handleRemoveCustom = useCallback(async () => {
    setUploadError(null)
    await soundStore.removeCustomAudio(type)
  }, [type])

  const handleExportCustom = useCallback(async () => {
    await soundStore.exportCustomAudio(type)
  }, [type])

  return (
    <div className="rounded-lg border border-border-200/50 bg-bg-000/40 p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <span className={color}>{icon}</span>
          <div>
            <div className="text-[length:var(--fs-md)] font-medium text-text-100">{t(labelKey as `notifications.${string}`)}</div>
            <div className="text-[length:var(--fs-xs)] text-text-400">{t(descKey as `notifications.${string}`)}</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handlePreview}
          disabled={eventConfig.soundId === 'none'}
          className="gap-1.5 text-[length:var(--fs-sm)]"
        >
          <PlayIcon size={12} />
          {t('notifications.preview')}
        </Button>
      </div>

      {/* Sound Selector */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {/* None option */}
        <button
          type="button"
          onClick={() => handleSoundChange('none')}
          className={`px-2.5 py-1 rounded-md text-[length:var(--fs-sm)] font-medium transition-colors border
            ${
              eventConfig.soundId === 'none'
                ? 'bg-accent-main-100/10 text-accent-main-100 border-accent-main-100/30'
                : 'text-text-400 border-border-200/40 hover:bg-bg-100/60 hover:text-text-200'
            }`}
        >
          {t('notifications.noSound')}
        </button>

        {/* Built-in options */}
        {soundOptions.map(sid => (
          <button
            key={sid}
            type="button"
            onClick={() => handleSoundChange(sid)}
            className={`px-2.5 py-1 rounded-md text-[length:var(--fs-sm)] font-medium transition-colors border
              ${
                eventConfig.soundId === sid
                  ? 'bg-accent-main-100/10 text-accent-main-100 border-accent-main-100/30'
                  : 'text-text-400 border-border-200/40 hover:bg-bg-100/60 hover:text-text-200'
              }`}
          >
            {BUILTIN_SOUNDS[sid]}
          </button>
        ))}

        {/* Custom option — 只要有已上传的自定义音频就显示，可来回切换 */}
        {hasCustom && (
          <button
            type="button"
            onClick={() => handleSoundChange('custom')}
            className={`px-2.5 py-1 rounded-md text-[length:var(--fs-sm)] font-medium transition-colors border
              ${
                eventConfig.soundId === 'custom'
                  ? 'bg-accent-main-100/10 text-accent-main-100 border-accent-main-100/30'
                  : 'text-text-400 border-border-200/40 hover:bg-bg-100/60 hover:text-text-200'
              }`}
          >
            {t('notifications.customSound')}
          </button>
        )}
      </div>

      {/* Custom audio info + actions */}
      {hasCustom && eventConfig.customFileName && (
        <div className="flex items-center gap-2 mb-1.5 px-0.5">
          <span className="text-[length:var(--fs-xs)] text-text-300 truncate max-w-[200px]" title={eventConfig.customFileName}>
            {eventConfig.customFileName}
          </span>
          <Button size="sm" variant="ghost" onClick={handleExportCustom} className="gap-1 text-[length:var(--fs-xs)] h-6 px-1.5">
            <DownloadIcon size={10} />
            {t('notifications.exportAudio')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRemoveCustom}
            className="gap-1 text-[length:var(--fs-xs)] h-6 px-1.5 text-red-400 hover:text-red-300"
          >
            <TrashIcon size={10} />
            {t('notifications.removeCustom')}
          </Button>
        </div>
      )}

      {/* Upload row */}
      <div className="flex items-center gap-2 mt-1">
        <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          className="gap-1.5 text-[length:var(--fs-xs)] h-7"
        >
          <UploadIcon size={11} />
          {hasCustom ? t('notifications.replaceAudio') : t('notifications.uploadAudio')}
        </Button>
        <span className="text-[length:var(--fs-xs)] text-text-500 ml-auto">{t('notifications.supportedFormats')}</span>
      </div>

      {/* Upload Error */}
      {uploadError && (
        <div className="mt-1.5 text-[length:var(--fs-xs)] text-red-400 flex items-center gap-1.5">
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
    <div className="space-y-4">
      {/* Row 1: System Notifications + In-App Alerts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsCard
          title={t('notifications.systemNotifications')}
          description={t('notifications.systemNotificationsDesc')}
        >
          {notificationsSupported ? (
            <div className="space-y-1.5">
              <SettingRow
                label={t('notifications.notificationsLabel')}
                description={
                  notificationPermission === 'denied'
                    ? t('notifications.blockedByBrowser')
                    : t('notifications.notifyWhenComplete')
                }
                onClick={() => notificationPermission !== 'denied' && setNotificationsEnabled(!notificationsEnabled)}
              >
                <Toggle
                  enabled={notificationsEnabled && notificationPermission !== 'denied'}
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
            </div>
          ) : (
            <div className="text-[length:var(--fs-sm)] text-text-400 leading-relaxed">{t('notifications.notAvailable')}</div>
          )}
        </SettingsCard>

        <SettingsCard title={t('notifications.inAppAlerts')} description={t('notifications.inAppAlertsDesc')}>
          <SettingRow
            label={t('notifications.toastNotifications')}
            description={t('notifications.toastDesc')}
            icon={<BellIcon size={14} />}
            onClick={handleToastToggle}
          >
            <Toggle enabled={toastEnabled} onChange={handleToastToggle} />
          </SettingRow>
        </SettingsCard>
      </div>

      {/* Row 2: Sound Settings */}
      <SettingsCard title={t('notifications.soundSettings')} description={t('notifications.soundSettingsDesc')}>
        {soundSupported ? (
          <div className="space-y-4">
            {/* Global Controls */}
            <div className="space-y-1.5">
              <SettingRow
                label={t('notifications.soundEnabled')}
                description={t('notifications.soundEnabledDesc')}
                icon={soundSettings.enabled ? <VolumeIcon size={14} /> : <VolumeOffIcon size={14} />}
                onClick={() => soundStore.setEnabled(!soundSettings.enabled)}
              >
                <Toggle
                  enabled={soundSettings.enabled}
                  onChange={() => soundStore.setEnabled(!soundSettings.enabled)}
                />
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

              {/* Volume Slider */}
              <div className="px-2.5 py-2.5">
                <div className="text-[length:var(--fs-md)] font-medium text-text-100 mb-1">{t('notifications.volume')}</div>
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-2.5">{t('notifications.volumeDesc')}</div>
                <VolumeSlider value={soundSettings.volume} onChange={v => soundStore.setVolume(v)} />
              </div>
            </div>

            {/* Event Sound Cards */}
            {soundSettings.enabled && (
              <div>
                <div className="text-[length:var(--fs-md)] font-semibold text-text-100 mb-1.5 px-1">
                  {t('notifications.eventSounds')}
                </div>
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-3 px-1">{t('notifications.eventSoundsDesc')}</div>
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
              </div>
            )}
          </div>
        ) : (
          <div className="text-[length:var(--fs-sm)] text-text-400 leading-relaxed">{t('notifications.soundNotSupported')}</div>
        )}
      </SettingsCard>
    </div>
  )
}
