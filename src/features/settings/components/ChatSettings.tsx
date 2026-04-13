import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PathAutoIcon, PathUnixIcon, PathWindowsIcon } from '../../../components/Icons'
import { usePathMode, useIsMobile } from '../../../hooks'
import { autoApproveStore } from '../../../store'
import { themeStore, type ReasoningDisplayMode, type ToolCardStyle } from '../../../store/themeStore'
import { Toggle, SegmentedControl, SettingRow, SettingsSection } from './SettingsUI'
import type { PathMode } from '../../../utils/directoryUtils'

export function ChatSettings() {
  const { t } = useTranslation(['settings'])
  const { pathMode, setPathMode, effectiveStyle, detectedStyle, isAutoMode } = usePathMode()
  const [autoApprove, setAutoApprove] = useState(autoApproveStore.enabled)
  const [collapseUserMessages, setCollapseUserMessages] = useState(themeStore.collapseUserMessages)
  const [stepFinishDisplay, setStepFinishDisplay] = useState(themeStore.stepFinishDisplay)
  const [reasoningDisplayMode, setReasoningDisplayMode] = useState(themeStore.reasoningDisplayMode)
  const [descriptiveToolSteps, setDescriptiveToolSteps] = useState(themeStore.descriptiveToolSteps)
  const [inlineToolRequests, setInlineToolRequests] = useState(themeStore.inlineToolRequests)
  const [toolCardStyle, setToolCardStyle] = useState(themeStore.toolCardStyle)
  const [immersiveMode, setImmersiveMode] = useState(themeStore.immersiveMode)
  const [compactInlinePermission, setCompactInlinePermission] = useState(themeStore.compactInlinePermission)
  const [queueFollowupMessages, setQueueFollowupMessages] = useState(themeStore.queueFollowupMessages)
  const isMobile = useIsMobile()
  void isMobile

  const handleAutoApprove = () => {
    const v = !autoApprove
    setAutoApprove(v)
    autoApproveStore.setEnabled(v)
    if (!v) autoApproveStore.clearAllRules()
  }

  const handleCollapseToggle = () => {
    const v = !collapseUserMessages
    setCollapseUserMessages(v)
    themeStore.setCollapseUserMessages(v)
  }

  const handleQueueFollowupMessagesToggle = () => {
    const v = !queueFollowupMessages
    setQueueFollowupMessages(v)
    themeStore.setQueueFollowupMessages(v)
  }

  const handleReasoningDisplayModeChange = (mode: ReasoningDisplayMode) => {
    setReasoningDisplayMode(mode)
    themeStore.setReasoningDisplayMode(mode)
  }

  const handleDescriptiveToolStepsToggle = () => {
    const v = !descriptiveToolSteps
    setDescriptiveToolSteps(v)
    themeStore.setDescriptiveToolSteps(v)
  }

  const handleInlineToolRequestsToggle = () => {
    const v = !inlineToolRequests
    setInlineToolRequests(v)
    themeStore.setInlineToolRequests(v)
  }

  const handleCompactInlinePermissionToggle = () => {
    const v = !compactInlinePermission
    setCompactInlinePermission(v)
    themeStore.setCompactInlinePermission(v)
  }

  const handleToolCardStyleChange = (style: ToolCardStyle) => {
    setToolCardStyle(style)
    themeStore.setToolCardStyle(style)
  }

  const handleImmersiveModeToggle = () => {
    const v = !immersiveMode
    setImmersiveMode(v)
    themeStore.setImmersiveMode(v)
    setInlineToolRequests(v)
    setDescriptiveToolSteps(v)
    setToolCardStyle(v ? 'compact' : 'classic')
    setCompactInlinePermission(v)
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

      {/* 行为 */}
      <SettingsSection title={t('chat.agentBehavior')}>
        <SettingRow label={t('chat.autoApprove')} description={t('chat.autoApproveDesc')} onClick={handleAutoApprove}>
          <Toggle enabled={autoApprove} onChange={handleAutoApprove} />
        </SettingRow>
        <SettingRow
          label={t('chat.queueFollowupMessages')}
          description={t('chat.queueFollowupMessagesDesc')}
          onClick={handleQueueFollowupMessagesToggle}
        >
          <Toggle enabled={queueFollowupMessages} onChange={handleQueueFollowupMessagesToggle} />
        </SettingRow>
        <SettingRow
          label={t('chat.collapseLongMessages')}
          description={t('chat.collapseLongMessagesDesc')}
          onClick={handleCollapseToggle}
        >
          <Toggle enabled={collapseUserMessages} onChange={handleCollapseToggle} />
        </SettingRow>
      </SettingsSection>

      {/* 沉浸模式 */}
      <SettingsSection title={t('chat.immersiveMode')}>
        <SettingRow
          label={t('chat.immersiveMode')}
          description={t('chat.immersiveModeDesc')}
          onClick={handleImmersiveModeToggle}
        >
          <Toggle enabled={immersiveMode} onChange={handleImmersiveModeToggle} />
        </SettingRow>
        <SettingRow
          label={t('chat.inlineToolRequests')}
          description={t('chat.inlineToolRequestsDesc')}
          onClick={handleInlineToolRequestsToggle}
        >
          <Toggle enabled={inlineToolRequests} onChange={handleInlineToolRequestsToggle} />
        </SettingRow>
        <SettingRow
          label={t('chat.descriptiveToolSteps')}
          description={t('chat.descriptiveToolStepsDesc')}
          onClick={handleDescriptiveToolStepsToggle}
        >
          <Toggle enabled={descriptiveToolSteps} onChange={handleDescriptiveToolStepsToggle} />
        </SettingRow>
        <SettingRow
          label={t('chat.compactInlinePermission')}
          description={t('chat.compactInlinePermissionDesc')}
          onClick={handleCompactInlinePermissionToggle}
        >
          <Toggle enabled={compactInlinePermission} onChange={handleCompactInlinePermissionToggle} />
        </SettingRow>
      </SettingsSection>

      {/* 显示 */}
      <SettingsSection title={t('chat.thinkingDisplay')}>
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
        <div>
          <p className="text-[length:var(--fs-md)] text-text-100 mb-1.5">{t('chat.toolCardStyle')}</p>
          <p className="text-[length:var(--fs-sm)] text-text-400 mb-3">{t('chat.toolCardStyleDesc')}</p>
          <SegmentedControl
            value={toolCardStyle}
            options={[
              { value: 'classic', label: t('chat.toolCardClassic') },
              { value: 'compact', label: t('chat.toolCardCompact') },
            ]}
            onChange={v => handleToolCardStyleChange(v as ToolCardStyle)}
          />
        </div>
      </SettingsSection>

      {/* Step 完成信息 */}
      <SettingsSection title={t('chat.stepFinishInfo')}>
        {(
          [
            { key: 'tokens', label: t('chat.tokens'), desc: t('chat.showTokenUsage') },
            { key: 'cache', label: t('chat.cache'), desc: t('chat.showCacheHit') },
            { key: 'cost', label: t('chat.cost'), desc: t('chat.showApiCost') },
            { key: 'duration', label: t('chat.duration'), desc: t('chat.showResponseTime') },
            { key: 'turnDuration', label: t('chat.totalDuration'), desc: t('chat.showTurnElapsed') },
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
      </SettingsSection>
    </div>
  )
}
