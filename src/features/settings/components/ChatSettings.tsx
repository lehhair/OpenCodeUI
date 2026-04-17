import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PathAutoIcon, PathUnixIcon, PathWindowsIcon } from '../../../components/Icons'
import { usePathMode, useIsMobile } from '../../../hooks'
import { themeStore, type ReasoningDisplayMode, type CompletedAtFormat } from '../../../store/themeStore'
import { Toggle, SegmentedControl, SettingRow, SettingsSection } from './SettingsUI'
import type { PathMode } from '../../../utils/directoryUtils'

export function ChatSettings() {
  const { t } = useTranslation(['settings'])
  const { pathMode, setPathMode, effectiveStyle, detectedStyle, isAutoMode } = usePathMode()
  const [collapseUserMessages, setCollapseUserMessages] = useState(themeStore.collapseUserMessages)
  const [stepFinishDisplay, setStepFinishDisplay] = useState(themeStore.stepFinishDisplay)
  const [completedAtFormat, setCompletedAtFormat] = useState(themeStore.completedAtFormat)
  const [reasoningDisplayMode, setReasoningDisplayMode] = useState(themeStore.reasoningDisplayMode)
  const isMobile = useIsMobile()
  void isMobile

  const handleCollapseToggle = () => {
    const v = !collapseUserMessages
    setCollapseUserMessages(v)
    themeStore.setCollapseUserMessages(v)
  }

  const handleReasoningDisplayModeChange = (mode: ReasoningDisplayMode) => {
    setReasoningDisplayMode(mode)
    themeStore.setReasoningDisplayMode(mode)
  }

  return (
    <div>
      {/* 路径格式 */}
      <SettingsSection title={t('chat.pathsFormatting')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('chat.pathsFormattingDesc')}</p>
        <SegmentedControl
          value={pathMode}
          options={[
            { value: 'auto', label: t('chat.auto'), icon: <PathAutoIcon size={14} /> },
            { value: 'unix', label: t('chat.unixSlash'), icon: <PathUnixIcon size={14} /> },
            { value: 'windows', label: t('chat.winBackslash'), icon: <PathWindowsIcon size={14} /> },
          ]}
          onChange={v => setPathMode(v as PathMode)}
        />
        {isAutoMode && (
          <p className="text-[length:var(--fs-xs)] text-text-400">
            {t('chat.usingStyle', { style: effectiveStyle === 'windows' ? '\\' : '/' })}
            {detectedStyle &&
              t('chat.detectedStyle', {
                style: detectedStyle === 'windows' ? t('chat.windows') : t('chat.unix'),
              })}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title={t('chat.conversationExperience')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('chat.conversationExperienceDesc')}</p>

        <SettingRow
          label={t('chat.collapseLongMessages')}
          description={t('chat.collapseLongMessagesDesc')}
          onClick={handleCollapseToggle}
        >
          <Toggle enabled={collapseUserMessages} onChange={handleCollapseToggle} />
        </SettingRow>

        <div>
          <p className="text-[length:var(--fs-md)] text-text-100 mb-1.5">{t('chat.thinkingDisplay')}</p>
          <p className="text-[length:var(--fs-sm)] text-text-400 mb-3">{t('chat.thinkingDisplayDesc')}</p>
          <SegmentedControl
            value={reasoningDisplayMode}
            options={[
              { value: 'capsule', label: t('chat.capsule') },
              { value: 'italic', label: t('chat.italic') },
              { value: 'markdown', label: t('chat.markdown') },
            ]}
            onChange={v => handleReasoningDisplayModeChange(v as ReasoningDisplayMode)}
          />
        </div>
      </SettingsSection>

      {/* Step 完成信息 */}
      <SettingsSection title={t('chat.stepFinishInfo')}>
        {(
          [
            { key: 'agent', label: t('chat.agent'), desc: t('chat.showAgent') },
            { key: 'model', label: t('chat.model'), desc: t('chat.showModel') },
            { key: 'tokens', label: t('chat.tokens'), desc: t('chat.showTokenUsage') },
            { key: 'cache', label: t('chat.cache'), desc: t('chat.showCacheHit') },
            { key: 'cost', label: t('chat.cost'), desc: t('chat.showApiCost') },
            { key: 'duration', label: t('chat.duration'), desc: t('chat.showResponseTime') },
            { key: 'turnDuration', label: t('chat.totalDuration'), desc: t('chat.showTurnElapsed') },
            { key: 'completedAt', label: t('chat.completedAt'), desc: t('chat.showCompletedAt') },
          ] as const
        ).map(({ key, label, desc }) => (
          <SettingRow
            key={key}
            label={label}
            description={desc}
            onClick={() => {
              const next = { [key]: !stepFinishDisplay[key] }
              setStepFinishDisplay(prev => ({ ...prev, ...next }))
              themeStore.setStepFinishDisplay(next)
            }}
          >
            <Toggle
              enabled={stepFinishDisplay[key]}
              onChange={() => {
                const next = { [key]: !stepFinishDisplay[key] }
                setStepFinishDisplay(prev => ({ ...prev, ...next }))
                themeStore.setStepFinishDisplay(next)
              }}
            />
          </SettingRow>
        ))}

        {stepFinishDisplay.completedAt && (
          <div>
            <p className="text-[length:var(--fs-md)] text-text-100 mb-1.5">{t('chat.completedAtFormat')}</p>
            <p className="text-[length:var(--fs-sm)] text-text-400 mb-3">{t('chat.completedAtFormatDesc')}</p>
            <SegmentedControl
              value={completedAtFormat}
              options={[
                { value: 'time', label: t('chat.completedAtTimeOnly') },
                { value: 'dateTime', label: t('chat.completedAtDateTime') },
              ]}
              onChange={v => {
                const next = v as CompletedAtFormat
                setCompletedAtFormat(next)
                themeStore.setCompletedAtFormat(next)
              }}
            />
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
