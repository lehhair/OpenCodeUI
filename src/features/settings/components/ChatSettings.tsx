import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PathAutoIcon, PathUnixIcon, PathWindowsIcon } from '../../../components/Icons'
import { usePathMode, useTheme } from '../../../hooks'
import { themeStore, type ReasoningDisplayMode, type CompletedAtFormat, type ComposerSelectorStyle } from '../../../store/themeStore'
import { Toggle, SegmentedControl, SettingRow, SettingField, SettingsSection } from './SettingsUI'
import type { PathMode } from '../../../utils/directoryUtils'

const STEP_FINISH_FIELDS = [
  { key: 'latestOnly', label: 'chat.latestOnly', desc: 'chat.showLatestOnly' },
  { key: 'agent', label: 'chat.agent', desc: 'chat.showAgent' },
  { key: 'model', label: 'chat.model', desc: 'chat.showModel' },
  { key: 'tokens', label: 'chat.tokens', desc: 'chat.showTokenUsage' },
  { key: 'cache', label: 'chat.cache', desc: 'chat.showCacheHit' },
  { key: 'cost', label: 'chat.cost', desc: 'chat.showApiCost' },
  { key: 'duration', label: 'chat.duration', desc: 'chat.showResponseTime' },
  { key: 'turnDuration', label: 'chat.totalDuration', desc: 'chat.showTurnElapsed' },
  { key: 'completedAt', label: 'chat.completedAt', desc: 'chat.showCompletedAt' },
] as const

export function ChatSettings() {
  const { t } = useTranslation(['settings'])
  const { pathMode, setPathMode, effectiveStyle, detectedStyle, isAutoMode } = usePathMode()
  const {
    externalFileDropMode,
    setExternalFileDropMode,
    outlineCurrentHighlight,
    setOutlineCurrentHighlight,
    actionsOnLatestAssistantOnly,
    setActionsOnLatestAssistantOnly,
    desktopCollapsedInputDock,
    setDesktopCollapsedInputDock,
    renderUserMarkdown,
    setRenderUserMarkdown,
    renderHtmlContent,
    setRenderHtmlContent,
    composerSelectorStyle,
    setComposerSelectorStyle,
    streamPacingEnabled,
    setStreamPacingEnabled,
    streamFadeEnabled,
    setStreamFadeEnabled,
  } = useTheme()
  const [collapseUserMessages, setCollapseUserMessages] = useState(themeStore.collapseUserMessages)
  const [stepFinishDisplay, setStepFinishDisplay] = useState(themeStore.stepFinishDisplay)
  const [completedAtFormat, setCompletedAtFormat] = useState(themeStore.completedAtFormat)
  const [reasoningDisplayMode, setReasoningDisplayMode] = useState(themeStore.reasoningDisplayMode)

  const externalDropAlwaysMention = externalFileDropMode === 'mention'

  const toggleCollapse = () => {
    const v = !collapseUserMessages
    setCollapseUserMessages(v)
    themeStore.setCollapseUserMessages(v)
  }

  const toggleStepField = (key: (typeof STEP_FINISH_FIELDS)[number]['key']) => {
    const next = { [key]: !stepFinishDisplay[key] }
    setStepFinishDisplay(prev => ({ ...prev, ...next }))
    themeStore.setStepFinishDisplay(next)
  }

  return (
    <div>
      <SettingsSection title={t('chat.pathsFormatting')} description={t('chat.pathsFormattingDesc')}>
        <div>
          <div className="w-full max-w-[320px]">
            <SegmentedControl
              value={pathMode}
              options={[
                { value: 'auto', label: t('chat.auto'), icon: <PathAutoIcon size={14} /> },
                { value: 'unix', label: t('chat.unixSlash'), icon: <PathUnixIcon size={14} /> },
                { value: 'windows', label: t('chat.winBackslash'), icon: <PathWindowsIcon size={14} /> },
              ]}
              onChange={v => setPathMode(v as PathMode)}
            />
          </div>
          {isAutoMode && (
            <p className="text-[length:var(--fs-xs)] text-text-400 mt-2">
              {t('chat.usingStyle', { style: effectiveStyle === 'windows' ? '\\' : '/' })}
              {detectedStyle &&
                ` · ${t('chat.detectedStyle', {
                  style: detectedStyle === 'windows' ? t('chat.windows') : t('chat.unix'),
                })}`}
            </p>
          )}
        </div>

        <SettingRow
          label={t('chat.externalDropMentionMode')}
          description={t('chat.externalDropMentionModeDesc')}
          onClick={() => setExternalFileDropMode(externalDropAlwaysMention ? 'upload-first' : 'mention')}
        >
          <Toggle
            enabled={externalDropAlwaysMention}
            onChange={() => setExternalFileDropMode(externalDropAlwaysMention ? 'upload-first' : 'mention')}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('chat.conversationExperience')} description={t('chat.conversationExperienceDesc')}>
        <SettingRow
          label={t('chat.collapseLongMessages')}
          description={t('chat.collapseLongMessagesDesc')}
          onClick={toggleCollapse}
        >
          <Toggle enabled={collapseUserMessages} onChange={toggleCollapse} />
        </SettingRow>

        <SettingRow
          label={t('chat.renderUserMarkdown')}
          description={t('chat.renderUserMarkdownDesc')}
          onClick={() => setRenderUserMarkdown(!renderUserMarkdown)}
        >
          <Toggle enabled={renderUserMarkdown} onChange={() => setRenderUserMarkdown(!renderUserMarkdown)} />
        </SettingRow>

        <SettingRow
          label={t('chat.renderHtmlContent')}
          description={t('chat.renderHtmlContentDesc')}
          onClick={() => setRenderHtmlContent(!renderHtmlContent)}
        >
          <Toggle enabled={renderHtmlContent} onChange={() => setRenderHtmlContent(!renderHtmlContent)} />
        </SettingRow>

        <SettingRow
          label={t('chat.outlineCurrentHighlight')}
          description={t('chat.outlineCurrentHighlightDesc')}
          onClick={() => setOutlineCurrentHighlight(!outlineCurrentHighlight)}
        >
          <Toggle
            enabled={outlineCurrentHighlight}
            onChange={() => setOutlineCurrentHighlight(!outlineCurrentHighlight)}
          />
        </SettingRow>

        <SettingRow
          label={t('chat.actionsOnLatestAssistantOnly')}
          description={t('chat.actionsOnLatestAssistantOnlyDesc')}
          onClick={() => setActionsOnLatestAssistantOnly(!actionsOnLatestAssistantOnly)}
        >
          <Toggle
            enabled={actionsOnLatestAssistantOnly}
            onChange={() => setActionsOnLatestAssistantOnly(!actionsOnLatestAssistantOnly)}
          />
        </SettingRow>

        <SettingRow
          label={t('chat.desktopCollapsedInputDock')}
          description={t('chat.desktopCollapsedInputDockDesc')}
          onClick={() => setDesktopCollapsedInputDock(!desktopCollapsedInputDock)}
        >
          <Toggle
            enabled={desktopCollapsedInputDock}
            onChange={() => setDesktopCollapsedInputDock(!desktopCollapsedInputDock)}
          />
        </SettingRow>

        <SettingField label={t('chat.composerSelectorStyle')} description={t('chat.composerSelectorStyleDesc')}>
          <div className="w-full max-w-[320px]">
            <SegmentedControl
              value={composerSelectorStyle}
              options={[
                { value: 'icons', label: t('chat.composerSelectorIcons') },
                { value: 'seat', label: t('chat.composerSelectorSeat') },
              ]}
              onChange={v => setComposerSelectorStyle(v as ComposerSelectorStyle)}
            />
          </div>
        </SettingField>

        <SettingField label={t('chat.thinkingDisplay')} description={t('chat.thinkingDisplayDesc')}>
          <div className="w-full max-w-[320px]">
            <SegmentedControl
              value={reasoningDisplayMode}
              options={[
                { value: 'capsule', label: t('chat.capsule') },
                { value: 'italic', label: t('chat.italic') },
                { value: 'markdown', label: t('chat.markdown') },
              ]}
              onChange={v => {
                setReasoningDisplayMode(v as ReasoningDisplayMode)
                themeStore.setReasoningDisplayMode(v as ReasoningDisplayMode)
              }}
            />
          </div>
        </SettingField>
      </SettingsSection>

      <SettingsSection title={t('chat.streamRendering')} description={t('chat.streamRenderingDesc')}>
        <SettingRow
          label={t('chat.streamPacing')}
          description={t('chat.streamPacingDesc')}
          onClick={() => setStreamPacingEnabled(!streamPacingEnabled)}
        >
          <Toggle enabled={streamPacingEnabled} onChange={() => setStreamPacingEnabled(!streamPacingEnabled)} />
        </SettingRow>

        <SettingRow
          label={t('chat.streamFade')}
          description={t('chat.streamFadeDesc')}
          onClick={() => setStreamFadeEnabled(!streamFadeEnabled)}
        >
          <Toggle enabled={streamFadeEnabled} onChange={() => setStreamFadeEnabled(!streamFadeEnabled)} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('chat.stepFinishInfo')}>
        {STEP_FINISH_FIELDS.map(({ key, label, desc }) => (
          <SettingRow key={key} label={t(label)} description={t(desc)} onClick={() => toggleStepField(key)}>
            <Toggle enabled={stepFinishDisplay[key]} onChange={() => toggleStepField(key)} />
          </SettingRow>
        ))}

        {stepFinishDisplay.completedAt && (
          <SettingField label={t('chat.completedAtFormat')} description={t('chat.completedAtFormatDesc')}>
            <div className="w-full max-w-[280px]">
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
          </SettingField>
        )}
      </SettingsSection>
    </div>
  )
}
