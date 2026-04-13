import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/Dialog'
import { SunIcon, GlobeIcon, SettingsIcon, KeyboardIcon, CloseIcon, BellIcon, PlugIcon } from '../../components/Icons'
import { useIsMobile } from '../../hooks'
import { isTauri } from '../../utils/tauri'
import { KeybindingsSection } from './KeybindingsSection'
import { AppearanceSettings } from './components/AppearanceSettings'
import { ChatSettings } from './components/ChatSettings'
import { NotificationSettings } from './components/NotificationSettings'
import { ServiceSettings } from './components/ServiceSettings'
import { ServersSettings } from './components/ServersSettings'

// ============================================
// Types
// ============================================

type SettingsTab = 'appearance' | 'chat' | 'notifications' | 'service' | 'servers' | 'keybindings'

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
  chat: <SettingsIcon size={15} />,
  appearance: <SunIcon size={15} />,
  notifications: <BellIcon size={15} />,
  service: <PlugIcon size={15} />,
  keybindings: <KeyboardIcon size={15} />,
}

const TAB_IDS: SettingsTab[] = ['servers', 'chat', 'appearance', 'notifications', 'service', 'keybindings']

const TAB_LABEL_KEYS: Record<SettingsTab, string> = {
  servers: 'tabs.servers',
  chat: 'tabs.chat',
  appearance: 'tabs.appearance',
  notifications: 'tabs.notifications',
  service: 'tabs.service',
  keybindings: 'tabs.shortcuts',
}

const TAB_DESC_KEYS: Record<SettingsTab, string> = {
  servers: 'tabs.serversDesc',
  chat: 'tabs.chatDesc',
  appearance: 'tabs.appearanceDesc',
  notifications: 'tabs.notificationsDesc',
  service: 'tabs.serviceDesc',
  keybindings: 'tabs.shortcutsDesc',
}

const GROUP_DEFS: { labelKey: string; tabs: SettingsTab[] }[] = [
  { labelKey: 'groups.core', tabs: ['servers', 'chat', 'appearance', 'notifications'] },
  { labelKey: 'groups.advanced', tabs: ['service', 'keybindings'] },
]

// ============================================
// Tab Content Router
// ============================================

function TabContent({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case 'appearance':
      return <AppearanceSettings />
    case 'chat':
      return <ChatSettings />
    case 'notifications':
      return <NotificationSettings />
    case 'service':
      return <ServiceSettings />
    case 'servers':
      return <ServersSettings />
    case 'keybindings':
      return <KeybindingsSection />
    default:
      return null
  }
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

  const visibleTabIds = useMemo(
    () => (isTauriDesktop ? TAB_IDS : TAB_IDS.filter(id => id !== 'service')),
    [isTauriDesktop],
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

  // 切换 tab 时重置滚动位置
  const switchTab = useCallback((nextTab: SettingsTab) => {
    setTab(nextTab)
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 })
    })
  }, [])

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        const ids = visibleTabs.map(t => t.id)
        if (ids.length === 0) return
        const next = (ids.indexOf(tab) + dir + ids.length) % ids.length
        switchTab(ids[next])
      }
    },
    [tab, visibleTabs, switchTab],
  )

  const activeTabMeta = visibleTabs.find(vt => vt.id === tab) || visibleTabs[0]

  // 移动端：全屏体验，顶部 sticky tab
  if (isMobile) {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="" width="100%" showCloseButton={false} rawContent>
        <div className="flex flex-col" style={{ height: '92vh' }}>
          {/* Sticky Header + Tabs */}
          <div className="shrink-0">
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="text-[length:var(--fs-heading-3)] font-semibold text-text-100">{t('title')}</div>
              <button
                onClick={onClose}
                className="p-2 -mr-1 text-text-400 hover:text-text-200 active:bg-bg-100 rounded-lg transition-colors"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {/* Tab Bar - horizontal scroll with padding for visual safety */}
            <div className="relative">
              <div className="flex items-center gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-none">
                {visibleTabs.map(vt => (
                  <button
                    key={vt.id}
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
          </div>

          {/* Content - single scroll container */}
          <div ref={scrollRef} className="flex-1 min-h-0 py-4 px-4 overflow-y-auto custom-scrollbar overscroll-contain">
            <TabContent tab={tab} />
          </div>
        </div>
      </Dialog>
    )
  }

  // 桌面端：左侧导航 + 右侧内容
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="" width="min(97vw, 1040px)" showCloseButton={false} rawContent>
      <div className="flex h-[min(90vh,820px)]">
        {/* Left Nav - 窄屏时收缩 */}
        <nav
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
          <div className="shrink-0 border-b border-border-100/60 px-5 xl:px-6 py-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[length:var(--fs-heading-3)] font-semibold text-text-100">{activeTabMeta.label}</div>
              <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5 leading-relaxed truncate">
                {activeTabMeta.description}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors -mr-1 shrink-0"
              aria-label={t('closeSettings')}
            >
              <CloseIcon size={18} />
            </button>
          </div>

          {/* Scroll area - single scroll container for all tab content */}
          <div ref={scrollRef} className="flex-1 min-h-0 py-5 px-5 xl:px-6 overflow-y-auto custom-scrollbar">
            <TabContent tab={tab} />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
