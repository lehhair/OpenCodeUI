import type { SettingsTab } from './SettingsDialog'

export interface SettingsSearchDefinition {
  tab: SettingsTab
  labelKey: string
  targetKey?: string
  fallbackKey?: string
  contextKey?: string
}

export interface SearchMenuItem {
  id: string
  label: string
  tabLabel: string
  description?: string
  searchText?: string
}

export interface SettingsSearchItem extends SearchMenuItem {
  tab: SettingsTab
  targetLabel: string
  fallbackLabel?: string
  targetContext?: string
}

const definitions = (tab: SettingsTab, labelKeys: string[]): SettingsSearchDefinition[] =>
  labelKeys.map(labelKey => ({ tab, labelKey }))

export const SETTINGS_SEARCH_DEFINITIONS: SettingsSearchDefinition[] = [
  ...definitions('servers', ['servers.connections']),
  ...definitions('models', ['models.visibility']),
  ...definitions('agent', [
    'agent.behavior',
    'agent.toolInteraction',
    'chat.alwaysAllowMode',
    'chat.approvePendingOnFullAuto',
    'chat.queueFollowupMessages',
    'chat.immersiveMode',
    'chat.inlineToolRequests',
    'chat.descriptiveToolSteps',
    'chat.processCollapse',
    'chat.compactInlinePermission',
    'chat.toolCardStyle',
  ]),
  ...definitions('chat', [
    'chat.pathsFormatting',
    'chat.conversationExperience',
    'chat.stepFinishInfo',
    'chat.externalDropMentionMode',
    'chat.collapseLongMessages',
    'chat.renderUserMarkdown',
    'chat.outlineCurrentHighlight',
    'chat.actionsOnLatestAssistantOnly',
    'chat.desktopCollapsedInputDock',
    'chat.thinkingDisplay',
    'chat.latestOnly',
    'chat.agent',
    'chat.model',
    'chat.tokens',
    'chat.cache',
    'chat.cost',
    'chat.duration',
    'chat.totalDuration',
    'chat.completedAt',
  ]),
  {
    tab: 'chat',
    labelKey: 'chat.completedAtFormat',
    fallbackKey: 'chat.completedAt',
  },
  ...definitions('workspace', [
    'workspace.layout',
    'workspace.terminal',
    'workspace.sidebar',
    'appearance.wideMode',
    'appearance.wakeLock',
    'appearance.codeWordWrap',
    'workspace.manualTerminalTitles',
    'appearance.diffStyle',
    'workspace.terminalCopyOnSelect',
    'workspace.terminalRightClickPaste',
    'appearance.folderStyleRecents',
    'appearance.folderStyleRecentsShowDiff',
    'appearance.showChildSessions',
  ]),
  ...definitions('appearance', [
    'appearance.themePresets',
    'appearance.customCss',
    'appearance.display',
    'appearance.savedOverrides',
    'appearance.colorMode',
    'appearance.glassEffect',
    'appearance.uiFontScale',
    'appearance.codeFontScale',
    'appearance.language',
    'appearance.codeBlockThemes',
    'appearance.codeBlockThemeLight',
    'appearance.codeBlockThemeDark',
  ]),
  {
    tab: 'notifications',
    labelKey: 'notifications.notificationsLabel',
    fallbackKey: 'notifications.systemNotifications',
  },
  ...definitions('notifications', [
    'notifications.systemNotifications',
    'notifications.inAppAlerts',
    'notifications.toastNotifications',
    'notifications.soundSettings',
  ]),
  {
    tab: 'notifications',
    labelKey: 'notifications.testNotification',
    fallbackKey: 'notifications.systemNotifications',
  },
  {
    tab: 'notifications',
    labelKey: 'notifications.notificationTypes',
    fallbackKey: 'notifications.systemNotifications',
  },
  ...['eventCompleted', 'eventPermission', 'eventQuestion', 'eventError'].flatMap(label => [
    {
      tab: 'notifications' as const,
      labelKey: `notifications.${label}`,
      contextKey: 'notifications.notificationTypes',
      fallbackKey: 'notifications.systemNotifications',
    },
    {
      tab: 'notifications' as const,
      labelKey: `notifications.${label}`,
      contextKey: 'notifications.eventSounds',
      fallbackKey: 'notifications.soundSettings',
    },
  ]),
  ...['soundEnabled', 'currentSessionSound', 'volume', 'eventSounds'].map(label => ({
    tab: 'notifications' as const,
    labelKey: `notifications.${label}`,
    fallbackKey: 'notifications.soundSettings',
  })),
  ...definitions('service', [
    'service.localService',
    'service.binaryPath',
    'service.autoStart',
    'service.serviceStatus',
    'service.envVars',
  ]),
  ...definitions('config', ['config.sourceTitle']),
  ...definitions('keybindings', ['keybindings.title']),
  ...[
    'openSettings',
    'openProject',
    'commandPalette',
    'toggleSidebar',
    'toggleRightPanel',
    'focusInput',
    'newSession',
    'previousSession',
    'nextSession',
    'focusNextPane',
    'focusPrevPane',
    'splitRight',
    'splitDown',
    'closePane',
    'togglePaneFullscreen',
    'toggleTerminal',
    'newTerminal',
    'terminalCopySelection',
    'terminalPaste',
    'selectModel',
    'toggleAgent',
    'sendMessage',
    'cancelMessage',
    'copyLastResponse',
    'toggleFullAuto',
  ].map(label => ({ tab: 'keybindings' as const, labelKey: `commands:${label}` })),
  ...definitions('about', ['about.versionCardTitle', 'about.backupCardTitle']),
]

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

export function filterSettingsSearchItems<T extends SearchMenuItem>(items: T[], query: string): T[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []

  return items
    .map((item, index) => {
      const label = normalizeSearchText(item.label)
      const tabLabel = normalizeSearchText(item.tabLabel)
      const description = normalizeSearchText(item.description ?? '')
      const extra = normalizeSearchText(item.searchText ?? '')
      const rank =
        label === normalizedQuery
          ? 0
          : label.startsWith(normalizedQuery)
            ? 1
            : label.includes(normalizedQuery)
              ? 2
              : tabLabel.includes(normalizedQuery)
                ? 3
                : description.includes(normalizedQuery)
                  ? 4
                  : extra.includes(normalizedQuery)
                    ? 5
                    : -1
      return { item, index, rank }
    })
    .filter(result => result.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(result => result.item)
}
