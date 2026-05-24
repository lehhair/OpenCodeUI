import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/Dialog'
import {
  SunIcon,
  GlobeIcon,
  AgentIcon,
  CpuIcon,
  KeyboardIcon,
  CloseIcon,
  BellIcon,
  PlugIcon,
  MessageSquareIcon,
  LayersIcon,
  QuestionIcon,
  SearchIcon,
  ChevronRightIcon,
} from '../../components/Icons'
import { useIsMobile } from '../../hooks'
import { isTauri } from '../../utils/tauri'
import { KeybindingsSection } from './KeybindingsSection'
import { AgentSettings } from './components/AgentSettings'
import { AppearanceSettings } from './components/AppearanceSettings'
import { AboutSettings } from './components/AboutSettings'
import { ChatSettings } from './components/ChatSettings'
import { ModelsSettings } from './components/ModelsSettings'
import { NotificationSettings } from './components/NotificationSettings'
import { ServiceSettings } from './components/ServiceSettings'
import { ServersSettings } from './components/ServersSettings'
import { WorkspaceSettings } from './components/WorkspaceSettings'
import { SettingsHighlightProvider, highlightText } from './components/SettingsUI'

// ============================================
// Types
// ============================================

export type SettingsTab =
  | 'agent'
  | 'appearance'
  | 'chat'
  | 'models'
  | 'notifications'
  | 'service'
  | 'servers'
  | 'keybindings'
  | 'workspace'
  | 'about'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: SettingsTab | 'general'
}

// ============================================
// Nav Tabs
// ============================================

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  servers: <GlobeIcon size={15} />,
  agent: <AgentIcon size={15} />,
  chat: <MessageSquareIcon size={15} />,
  models: <CpuIcon size={15} />,
  appearance: <SunIcon size={15} />,
  workspace: <LayersIcon size={15} />,
  notifications: <BellIcon size={15} />,
  service: <PlugIcon size={15} />,
  keybindings: <KeyboardIcon size={15} />,
  about: <QuestionIcon size={15} />,
}

const TAB_IDS: SettingsTab[] = [
  'servers',
  'models',
  'agent',
  'chat',
  'workspace',
  'appearance',
  'notifications',
  'service',
  'keybindings',
  'about',
]

const TAB_LABEL_KEYS: Record<SettingsTab, string> = {
  servers: 'tabs.servers',
  agent: 'tabs.agent',
  chat: 'tabs.chat',
  models: 'tabs.models',
  appearance: 'tabs.appearance',
  workspace: 'tabs.workspace',
  notifications: 'tabs.notifications',
  service: 'tabs.service',
  keybindings: 'tabs.shortcuts',
  about: 'tabs.about',
}

const TAB_DESC_KEYS: Record<SettingsTab, string> = {
  servers: 'tabs.serversDesc',
  agent: 'tabs.agentDesc',
  chat: 'tabs.chatDesc',
  models: 'tabs.modelsDesc',
  appearance: 'tabs.appearanceDesc',
  workspace: 'tabs.workspaceDesc',
  notifications: 'tabs.notificationsDesc',
  service: 'tabs.serviceDesc',
  keybindings: 'tabs.shortcutsDesc',
  about: 'tabs.aboutDesc',
}

const GROUP_DEFS: { labelKey: string; tabs: SettingsTab[] }[] = [
  { labelKey: 'groups.core', tabs: ['servers', 'models', 'agent', 'chat', 'workspace', 'appearance', 'notifications'] },
  { labelKey: 'groups.advanced', tabs: ['service', 'keybindings', 'about'] },
]

// ============================================
// Settings Search Index
// ============================================

interface SettingsSearchItem {
  tab: SettingsTab
  sectionKey?: string
  itemKey: string
  descKey?: string
  anchorId?: string
}

const SETTINGS_SEARCH_INDEX: SettingsSearchItem[] = [
  // Servers
  { tab: 'servers', sectionKey: 'servers.connections', itemKey: 'servers.connections', descKey: 'servers.connectionsDesc' },
  // Models
  { tab: 'models', sectionKey: 'models.visibility', itemKey: 'models.visibility', descKey: 'models.visibilityDesc' },
  // Agent
  { tab: 'agent', sectionKey: 'agent.behavior', itemKey: 'agent.behavior', descKey: 'agent.behaviorDesc' },
  { tab: 'agent', sectionKey: 'agent.toolInteraction', itemKey: 'agent.toolInteraction', descKey: 'agent.toolInteractionDesc' },
  // Chat
  { tab: 'chat', sectionKey: 'chat.agentBehavior', itemKey: 'chat.autoApprove', descKey: 'chat.autoApproveDesc' },
  { tab: 'chat', sectionKey: 'chat.agentBehavior', itemKey: 'chat.queueFollowupMessages', descKey: 'chat.queueFollowupMessagesDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.conversationExperience', descKey: 'chat.conversationExperienceDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.collapseLongMessages', descKey: 'chat.collapseLongMessagesDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.descriptiveToolSteps', descKey: 'chat.descriptiveToolStepsDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.inlineToolRequests', descKey: 'chat.inlineToolRequestsDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.compactInlinePermission', descKey: 'chat.compactInlinePermissionDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.toolCardStyle', descKey: 'chat.toolCardStyleDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.immersiveMode', descKey: 'chat.immersiveModeDesc' },
  { tab: 'chat', sectionKey: 'chat.conversationExperience', itemKey: 'chat.thinkingDisplay', descKey: 'chat.thinkingDisplayDesc' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.stepFinishInfo' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showAgent' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showModel' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showTokenUsage' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showCacheHit' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showApiCost' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showResponseTime' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showTurnElapsed' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.showCompletedAt' },
  { tab: 'chat', sectionKey: 'chat.stepFinishInfo', itemKey: 'chat.completedAtFormat', descKey: 'chat.completedAtFormatDesc' },
  { tab: 'chat', sectionKey: 'chat.sidebarRecents', itemKey: 'chat.sidebarRecents', descKey: 'chat.sidebarRecentsDesc' },
  { tab: 'chat', sectionKey: 'chat.sidebarRecents', itemKey: 'chat.folderStyleRecents', descKey: 'chat.folderStyleRecentsDesc' },
  // Workspace
  { tab: 'workspace', sectionKey: 'workspace.layout', itemKey: 'appearance.wideMode', descKey: 'appearance.wideModeDesc' },
  { tab: 'workspace', sectionKey: 'workspace.layout', itemKey: 'appearance.wakeLock', descKey: 'appearance.wakeLockDesc', anchorId: 'setting-wakeLock' },
  { tab: 'workspace', sectionKey: 'workspace.layout', itemKey: 'appearance.codeWordWrap', descKey: 'appearance.codeWordWrapDesc', anchorId: 'setting-codeWordWrap' },
  { tab: 'workspace', sectionKey: 'workspace.layout', itemKey: 'workspace.manualTerminalTitles', descKey: 'workspace.manualTerminalTitlesDesc' },
  { tab: 'workspace', sectionKey: 'workspace.layout', itemKey: 'appearance.diffStyle', descKey: 'appearance.diffStyleDesc' },
  { tab: 'workspace', sectionKey: 'workspace.terminal', itemKey: 'workspace.terminalCopyOnSelect', descKey: 'workspace.terminalCopyOnSelectDesc' },
  { tab: 'workspace', sectionKey: 'workspace.terminal', itemKey: 'workspace.terminalRightClickPaste', descKey: 'workspace.terminalRightClickPasteDesc' },
  { tab: 'workspace', sectionKey: 'workspace.sidebar', itemKey: 'appearance.folderStyleRecents', descKey: 'appearance.folderStyleRecentsDesc' },
  { tab: 'workspace', sectionKey: 'workspace.sidebar', itemKey: 'appearance.folderStyleRecentsShowDiff', descKey: 'appearance.folderStyleRecentsShowDiffDesc' },
  { tab: 'workspace', sectionKey: 'workspace.sidebar', itemKey: 'appearance.showChildSessions', descKey: 'appearance.showChildSessionsDesc' },
  // Appearance
  { tab: 'appearance', sectionKey: 'appearance.themePresets', itemKey: 'appearance.themePresets', descKey: 'appearance.themePresetsDesc' },
  { tab: 'appearance', sectionKey: 'appearance.customCss', itemKey: 'appearance.customCss', descKey: 'appearance.customCssDesc' },
  { tab: 'appearance', sectionKey: 'appearance.display', itemKey: 'appearance.colorMode' },
  { tab: 'appearance', sectionKey: 'appearance.display', itemKey: 'appearance.glassEffect', descKey: 'appearance.glassEffectDesc' },
  { tab: 'appearance', sectionKey: 'appearance.display', itemKey: 'appearance.uiFontScale', descKey: 'appearance.uiFontScaleDesc' },
  { tab: 'appearance', sectionKey: 'appearance.display', itemKey: 'appearance.codeFontScale', descKey: 'appearance.codeFontScaleDesc' },
  { tab: 'appearance', sectionKey: 'appearance.display', itemKey: 'appearance.language', descKey: 'appearance.languageDesc' },
  // Notifications
  { tab: 'notifications', sectionKey: 'notifications.systemNotifications', itemKey: 'notifications.notificationsLabel', descKey: 'notifications.systemNotificationsDesc' },
  { tab: 'notifications', sectionKey: 'notifications.systemNotifications', itemKey: 'notifications.notifyWhenComplete' },
  { tab: 'notifications', sectionKey: 'notifications.inAppAlerts', itemKey: 'notifications.toastNotifications', descKey: 'notifications.toastDesc' },
  { tab: 'notifications', sectionKey: 'notifications.soundSettings', itemKey: 'notifications.soundEnabled', descKey: 'notifications.soundEnabledDesc' },
  { tab: 'notifications', sectionKey: 'notifications.soundSettings', itemKey: 'notifications.currentSessionSound', descKey: 'notifications.currentSessionSoundDesc' },
  { tab: 'notifications', sectionKey: 'notifications.soundSettings', itemKey: 'notifications.volume', descKey: 'notifications.volumeDesc' },
  // Service
  { tab: 'service', sectionKey: 'service.localService', itemKey: 'service.autoStart', descKey: 'service.autoStartDesc' },
  { tab: 'service', sectionKey: 'service.localService', itemKey: 'service.serviceStatus' },
  // About
  { tab: 'about', sectionKey: 'about.versionCardTitle', itemKey: 'about.checkNow' },
  { tab: 'about', sectionKey: 'about.backupCardTitle', itemKey: 'about.exportBackup' },
  { tab: 'about', sectionKey: 'about.backupCardTitle', itemKey: 'about.importBackup' },
]

// ============================================
// Tab Content Router
// ============================================

function TabContent({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case 'agent':
      return <AgentSettings />
    case 'appearance':
      return <AppearanceSettings />
    case 'chat':
      return <ChatSettings />
    case 'models':
      return <ModelsSettings />
    case 'notifications':
      return <NotificationSettings />
    case 'service':
      return <ServiceSettings />
    case 'servers':
      return <ServersSettings />
    case 'keybindings':
      return <KeybindingsSection />
    case 'workspace':
      return <WorkspaceSettings />
    case 'about':
      return <AboutSettings />
    default:
      return null
  }
}

// ============================================
// Search Results
// ============================================

function SettingsSearchResults({
  query,
  results,
  t,
  tabIcons,
  tabLabels,
  onSelect,
}: {
  query: string
  results: SettingsSearchItem[]
  t: (key: string) => string
  tabIcons: Record<SettingsTab, React.ReactNode>
  tabLabels: { id: SettingsTab; label: string }[]
  onSelect: (item: SettingsSearchItem) => void
}) {
  const groups = useMemo(() => {
    const map = new Map<SettingsTab, SettingsSearchItem[]>()
    for (const item of results) {
      const list = map.get(item.tab) || []
      list.push(item)
      map.set(item.tab, list)
    }
    return [...map.entries()]
  }, [results])

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-text-400 text-[length:var(--fs-sm)]">
        {t('models.noResults')}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {groups.map(([tabId, items]) => {
        const tabLabel = tabLabels.find(vt => vt.id === tabId)
        return (
          <div key={tabId}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-text-400">{tabIcons[tabId]}</span>
              <span className="text-[length:var(--fs-sm)] font-semibold text-text-200">
                {tabLabel?.label ?? tabId}
              </span>
            </div>
            <div className="space-y-0.5">
              {items.map((item, idx) => (
                <button
                  key={`${item.tab}-${item.itemKey}-${idx}`}
                  onClick={() => onSelect(item)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg-100/70 transition-colors flex items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[length:var(--fs-sm)] text-text-200">
                      {highlightText(t(item.itemKey), query)}
                    </div>
                    {item.descKey && (
                      <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5 leading-relaxed line-clamp-2">
                        {highlightText(t(item.descKey), query)}
                      </div>
                    )}
                  </div>
                  <ChevronRightIcon size={12} className="text-text-400 mt-0.5 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================
// Main Settings Dialog
// ============================================

export function SettingsDialog({ isOpen, onClose, initialTab = 'servers' }: SettingsDialogProps) {
  const { t } = useTranslation(['settings'])
  const isMobile = useIsMobile()
  const isTauriDesktop = isTauri() && !isMobile
  const scrollRef = useRef<HTMLDivElement>(null)
  const normalizeTab = useCallback((next: SettingsDialogProps['initialTab']): SettingsTab => {
    if (!next || next === 'general') return 'chat'
    return next
  }, [])
  const [tab, setTab] = useState<SettingsTab>(normalizeTab(initialTab))
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearchResults, setShowSearchResults] = useState(false)

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    const matchedTabs = new Set<SettingsTab>()
    const items: SettingsSearchItem[] = []
    for (const item of SETTINGS_SEARCH_INDEX) {
      const tabLabel = t(TAB_LABEL_KEYS[item.tab]).toLowerCase()
      const tabDesc = t(TAB_DESC_KEYS[item.tab]).toLowerCase()
      const itemLabel = t(item.itemKey).toLowerCase()
      const itemDesc = item.descKey ? t(item.descKey).toLowerCase() : ''
      const sectionLabel = item.sectionKey ? t(item.sectionKey).toLowerCase() : ''
      if (
        tabLabel.includes(q) || tabDesc.includes(q) ||
        itemLabel.includes(q) || itemDesc.includes(q) ||
        sectionLabel.includes(q)
      ) {
        matchedTabs.add(item.tab)
        items.push(item)
      }
    }
    return { items, matchedTabs }
  }, [searchQuery, t])

  const visibleTabIds = useMemo(
    () => {
      const ids = isTauriDesktop ? TAB_IDS : TAB_IDS.filter(id => id !== 'service')
      if (!searchResults) return ids
      return ids.filter(id => searchResults.matchedTabs.has(id))
    },
    [isTauriDesktop, searchResults],
  )

  const visibleTabs = useMemo(
    () =>
      visibleTabIds.map(id => ({
        id,
        label: t(TAB_LABEL_KEYS[id]),
        description: t(TAB_DESC_KEYS[id]),
        icon: TAB_ICONS[id],
      })),
    [visibleTabIds, t],
  )

  const groupedTabs = useMemo(
    () =>
      GROUP_DEFS.map(group => ({
        label: t(group.labelKey),
        tabs: group.tabs
          .map(id => visibleTabs.find(vt => vt.id === id))
          .filter((vt): vt is (typeof visibleTabs)[number] => !!vt),
      })).filter(group => group.tabs.length > 0),
    [visibleTabs, t],
  )

  useEffect(() => {
    if (!isOpen) return

    const frameId = requestAnimationFrame(() => {
      setTab(normalizeTab(initialTab))
    })

    return () => cancelAnimationFrame(frameId)
  }, [isOpen, initialTab, normalizeTab])

  useEffect(() => {
    if (visibleTabs.some(t => t.id === tab)) return

    const frameId = requestAnimationFrame(() => {
      setTab(visibleTabs[0]?.id || 'appearance')
    })

    return () => cancelAnimationFrame(frameId)
  }, [tab, visibleTabs])

  useEffect(() => {
    if (!isOpen) return

    const frameId = requestAnimationFrame(() => {
      document.getElementById(`settings-tab-${tab}`)?.focus()
    })

    return () => cancelAnimationFrame(frameId)
  }, [isOpen, tab])

  // 切换 tab 时重置滚动位置
  const switchTab = useCallback((nextTab: SettingsTab) => {
    setTab(nextTab)
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 })
    })
  }, [])

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
        const ids = visibleTabs.map(t => t.id)
        if (ids.length === 0) return
        const next = (ids.indexOf(tab) + dir + ids.length) % ids.length
        switchTab(ids[next])
        requestAnimationFrame(() => {
          document.getElementById(`settings-tab-${ids[next]}`)?.focus()
        })
      }
    },
    [tab, visibleTabs, switchTab],
  )

  const activeTabMeta = visibleTabs.find(vt => vt.id === tab) || visibleTabs[0]
  const activePanelId = `settings-panel-${tab}`

  // 移动端：全屏体验，顶部 sticky tab
  if (isMobile) {
    return (
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title=""
        ariaLabel={t('title')}
        width="100%"
        showCloseButton={false}
        rawContent
      >
        <div className="flex flex-col" style={{ height: '92vh' }}>
          {/* Sticky Header + Tabs */}
          <div className="shrink-0">
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="text-[length:var(--fs-heading-3)] font-semibold text-text-100">{t('title')}</div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('closeSettings')}
                className="p-2 -mr-1 text-text-400 hover:text-text-200 active:bg-bg-100 rounded-lg transition-colors"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {/* Tab Bar - horizontal scroll with padding for visual safety */}
            <div className="relative">
              <div
                role="tablist"
                aria-label={t('title')}
                onKeyDown={handleTabKeyDown}
                className="flex items-center gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-none"
              >
                {visibleTabs.map(vt => (
                  <button
                    key={vt.id}
                    id={`settings-tab-${vt.id}`}
                    type="button"
                    role="tab"
                    aria-selected={vt.id === tab}
                    aria-controls={`settings-panel-${vt.id}`}
                    tabIndex={vt.id === tab ? 0 : -1}
                    onClick={() => switchTab(vt.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[length:var(--fs-md)] font-medium transition-colors whitespace-nowrap shrink-0 border
                      ${
                        vt.id === tab
                          ? 'bg-accent-main-100/10 text-accent-main-100 border-accent-main-100/30'
                          : 'text-text-400 border-transparent active:bg-bg-100/60'
                      }`}
                  >
                    {vt.icon}
                    {vt.label}
                  </button>
                ))}
              </div>
              <div className="absolute bottom-0 left-0 right-0 border-b border-border-100/40" />
            </div>

            {/* Search */}
            <div className="px-4 pb-2">
              <div className="relative">
                <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setShowSearchResults(true) }}
                  placeholder={t('searchPlaceholder')}
                  className="w-full h-8 pl-8 pr-7 bg-bg-100 text-text-200 text-[length:var(--fs-sm)] rounded-md outline-none placeholder:text-text-400/50 border border-border-100/40 focus:border-border-100/70"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setShowSearchResults(false) }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-400 hover:text-text-100"
                  >
                    <CloseIcon size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Content - single scroll container */}
          <div
            id={activePanelId}
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            ref={scrollRef}
            className="flex-1 min-h-0 py-4 px-4 overflow-y-auto custom-scrollbar overscroll-contain"
          >
            {showSearchResults && searchQuery.trim() ? (
              <SettingsSearchResults
                query={searchQuery}
                results={searchResults?.items ?? []}
                t={t}
                tabIcons={TAB_ICONS}
                tabLabels={visibleTabs}
                onSelect={(item) => {
                  switchTab(item.tab)
                  setShowSearchResults(false)
                }}
              />
            ) : (
              <SettingsHighlightProvider query={searchQuery}>
                <TabContent tab={tab} />
              </SettingsHighlightProvider>
            )}
          </div>
        </div>
      </Dialog>
    )
  }

  // 桌面端：左侧导航 + 右侧内容
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title=""
      ariaLabel={t('title')}
      width="min(97vw, 1040px)"
      showCloseButton={false}
      rawContent
    >
      <div className="flex h-[min(90vh,820px)]">
        {/* Left Nav - 窄屏时收缩 */}
        <nav
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('title')}
          className="w-[200px] xl:w-[236px] shrink-0 border-r border-border-100/60 py-4 px-2 xl:px-2.5 flex flex-col overflow-y-auto scrollbar-none"
          onKeyDown={handleTabKeyDown}
        >
          <div className="px-2.5 xl:px-3 mb-4">
            <div className="text-[length:var(--fs-base)] font-semibold text-text-100">{t('title')}</div>
            <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5 leading-relaxed hidden xl:block">
              {t('subtitle')}
            </div>
          </div>
          <div className="space-y-3">
            {groupedTabs.map(group => (
              <div key={group.label}>
                <div className="px-2.5 xl:px-3 mb-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-400/90">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.tabs.map(vt => (
                    <button
                      key={vt.id}
                      id={`settings-tab-${vt.id}`}
                      type="button"
                      role="tab"
                      aria-selected={vt.id === tab}
                      aria-controls={`settings-panel-${vt.id}`}
                      onClick={() => switchTab(vt.id)}
                      tabIndex={vt.id === tab ? 0 : -1}
                      className={`w-full flex items-center gap-2.5 px-2.5 xl:px-3 py-2 xl:py-2.5 rounded-lg text-[length:var(--fs-md)] font-medium transition-colors
                        ${
                          vt.id === tab
                            ? 'bg-bg-100 text-text-100 ring-1 ring-border-200/60'
                            : 'text-text-400 hover:text-text-200 hover:bg-bg-100/50'
                        }`}
                    >
                      {vt.icon}
                      <span className="truncate">{vt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-auto pt-3 px-2.5 xl:px-3 text-[length:var(--fs-xxs)] text-text-400">
            {t('version', { version: __APP_VERSION__ })}
          </div>
        </nav>

        {/* Right Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Content Header - sticky at top */}
          <div className="shrink-0 border-b border-border-100/60 px-5 xl:px-6 py-3 flex items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full h-8 pl-7 pr-7 bg-bg-100 text-text-200 text-[length:var(--fs-sm)] rounded-md outline-none placeholder:text-text-400/50 border border-border-100/40 focus:border-border-100/70"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-400 hover:text-text-100"
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors shrink-0"
              aria-label={t('closeSettings')}
            >
              <CloseIcon size={16} />
            </button>
          </div>

          {/* Scroll area */}
          <div
            id={activePanelId}
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            ref={scrollRef}
            className="flex-1 min-h-0 py-5 px-5 xl:px-6 overflow-y-auto custom-scrollbar"
          >
            {showSearchResults && searchQuery.trim() ? (
              <SettingsSearchResults
                query={searchQuery}
                results={searchResults?.items ?? []}
                t={t}
                tabIcons={TAB_ICONS}
                tabLabels={visibleTabs}
                onSelect={(item) => {
                  switchTab(item.tab)
                  setShowSearchResults(false)
                  if (item.anchorId) {
                    requestAnimationFrame(() => {
                      document.getElementById(item.anchorId)?.scrollIntoView({ block: 'center' })
                    })
                  }
                }}
              />
            ) : (
              <SettingsHighlightProvider query={searchQuery}>
                <TabContent tab={tab} />
              </SettingsHighlightProvider>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
