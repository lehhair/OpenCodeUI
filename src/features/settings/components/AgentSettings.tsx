import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { autoApproveStore } from '../../../store'
import { themeStore, type ToolCardStyle } from '../../../store/themeStore'
import { Toggle, SegmentedControl, SettingRow, SettingsSection } from './SettingsUI'

export function AgentSettings() {
  const { t } = useTranslation(['settings'])
  const [autoApprove, setAutoApprove] = useState(autoApproveStore.enabled)
  const [queueFollowupMessages, setQueueFollowupMessages] = useState(themeStore.queueFollowupMessages)
  const [descriptiveToolSteps, setDescriptiveToolSteps] = useState(themeStore.descriptiveToolSteps)
  const [inlineToolRequests, setInlineToolRequests] = useState(themeStore.inlineToolRequests)
  const [toolCardStyle, setToolCardStyle] = useState(themeStore.toolCardStyle)
  const [immersiveMode, setImmersiveMode] = useState(themeStore.immersiveMode)
  const [compactInlinePermission, setCompactInlinePermission] = useState(themeStore.compactInlinePermission)

  const handleAutoApprove = () => {
    const next = !autoApprove
    setAutoApprove(next)
    autoApproveStore.setEnabled(next)
    if (!next) autoApproveStore.clearAllRules()
  }

  const handleQueueFollowupMessagesToggle = () => {
    const next = !queueFollowupMessages
    setQueueFollowupMessages(next)
    themeStore.setQueueFollowupMessages(next)
  }

  const handleDescriptiveToolStepsToggle = () => {
    const next = !descriptiveToolSteps
    setDescriptiveToolSteps(next)
    themeStore.setDescriptiveToolSteps(next)
  }

  const handleInlineToolRequestsToggle = () => {
    const next = !inlineToolRequests
    setInlineToolRequests(next)
    themeStore.setInlineToolRequests(next)
  }

  const handleCompactInlinePermissionToggle = () => {
    const next = !compactInlinePermission
    setCompactInlinePermission(next)
    themeStore.setCompactInlinePermission(next)
  }

  const handleToolCardStyleChange = (style: ToolCardStyle) => {
    setToolCardStyle(style)
    themeStore.setToolCardStyle(style)
  }

  const handleImmersiveModeToggle = () => {
    const next = !immersiveMode
    setImmersiveMode(next)
    themeStore.setImmersiveMode(next)
    setInlineToolRequests(next)
    setDescriptiveToolSteps(next)
    setToolCardStyle(next ? 'compact' : 'classic')
    setCompactInlinePermission(next)
  }

  return (
    <div>
      <SettingsSection title={t('agent.behavior')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('agent.behaviorDesc')}</p>

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
      </SettingsSection>

      <SettingsSection title={t('agent.toolInteraction')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('agent.toolInteractionDesc')}</p>

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
    </div>
  )
}
