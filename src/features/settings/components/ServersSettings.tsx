import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { DropdownMenu } from '../../../components/ui/DropdownMenu'
import { MenuItem } from '../../../components/ui/MenuItem'
import { TrashIcon, KeyIcon, PencilIcon, RetryIcon, PlugIcon, CircleIcon } from '../../../components/Icons'
import { useServerStore, useRouter } from '../../../hooks'
import { messageStore } from '../../../store'
import { useMultiServerStore, multiServerStore } from '../../../store/multiServerStore'
import { useWslStore } from '../../../store/wslStore'
import { settingsFieldClass, SettingsSection, SettingRow, Toggle } from './SettingsUI'
import { ServerHealthButton } from './ServerHealthButton'
import type { ServerConfig, ServerHealth } from '../../../store/serverStore'
import { isTauri, getDesktopPlatform } from '../../../utils/tauri'
import { DialogAddWslServer } from '../../wsl/components/DialogAddWslServer'
import { WslServerRow } from '../../wsl/components/WslServerRow'
import { isWslServerId } from '../../wsl/settings-model'

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/
/** 显示名长度上限，避免列表项把右侧操作按钮挤穿 */
const SERVER_NAME_MAX_LENGTH = 40

function isHttpsIpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    return parsed.protocol === 'https:' && (IPV4_PATTERN.test(hostname) || hostname.includes(':'))
  } catch {
    return false
  }
}

// ============================================
// Server Item
// ============================================

function ServerItem({
  server,
  health,
  isActive,
  subscribed,
  multiServerEnabled,
  onSelect,
  onDelete,
  onEdit,
  onCheckHealth,
  onToggleSubscribe,
}: {
  server: ServerConfig
  health: ServerHealth | null
  isActive: boolean
  subscribed: boolean
  multiServerEnabled: boolean
  onSelect: () => void
  onDelete: () => void
  onEdit: (updates: { name: string; url: string; username?: string; password?: string }) => void
  onCheckHealth: () => void
  onToggleSubscribe: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (editing) {
    return (
      <EditServerForm
        server={server}
        onSave={updates => {
          onEdit(updates)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <>
      <div
        onClick={onSelect}
        className={`group flex items-center gap-1.5 p-2.5 rounded-lg border transition-colors min-w-0
          ${
            isActive ? 'border-accent-main-100/40 bg-accent-main-100/5' : 'border-border-200/40 hover:border-border-300'
          }`}
      >
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onSelect()
          }}
          aria-current={isActive ? 'true' : undefined}
          className="min-w-0 flex-1 overflow-hidden bg-transparent border-none p-0 text-left"
        >
          <div className="min-w-0">
            <div
              className="text-[length:var(--fs-md)] font-medium text-text-100 truncate"
              title={server.name}
            >
              {server.name}
            </div>
            <div className="text-[length:var(--fs-xs)] text-text-400 truncate font-mono flex items-center gap-1 mt-0.5 min-w-0">
              <span className="truncate min-w-0" title={server.url}>
                {server.url}
              </span>
              {server.auth?.password && <KeyIcon size={10} className="shrink-0 text-text-400" />}
            </div>
          </div>
        </button>
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            disabled={!multiServerEnabled}
            onClick={e => {
              e.stopPropagation()
              onToggleSubscribe()
            }}
            title={
              !multiServerEnabled
                ? t('servers.enableMultiServerFirst', { defaultValue: 'Enable multi-server mode first' })
                : subscribed
                  ? t('servers.unsubscribe')
                  : t('servers.subscribe')
            }
            aria-label={subscribed ? t('servers.unsubscribe') : t('servers.subscribe')}
            className={`p-1.5 rounded-md transition-colors ${
              subscribed
                ? 'text-accent-main-100 hover:bg-accent-main-100/10'
                : 'text-text-400 hover:text-text-200 hover:bg-bg-200/70'
            } ${!multiServerEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {subscribed ? <PlugIcon size={13} /> : <CircleIcon size={11} className="opacity-50" />}
          </button>
          <ServerHealthButton health={health} onCheck={onCheckHealth} />
          {!server.isDefault && (
            <>
              <button
                type="button"
                className="p-1.5 rounded-md text-text-400 hover:text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
                onClick={e => {
                  e.stopPropagation()
                  setEditing(true)
                }}
                title={t('servers.editServer')}
                aria-label={t('servers.editServer')}
              >
                <PencilIcon size={13} />
              </button>
              <button
                type="button"
                className="p-1.5 rounded-md text-text-400 hover:text-danger-100 hover:bg-danger-100/10 transition-colors"
                onClick={e => {
                  e.stopPropagation()
                  setConfirmDelete(true)
                }}
                title={t('common:remove')}
                aria-label={t('common:remove')}
              >
                <TrashIcon size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
        title={t('servers.deleteServer')}
        description={t('servers.deleteServerConfirm', { name: server.name })}
        confirmText={t('common:delete')}
        cancelText={t('common:cancel')}
        variant="danger"
      />
    </>
  )
}

// ============================================
// Edit Server Form (inline)
// ============================================

function EditServerForm({
  server,
  onSave,
  onCancel,
}: {
  server: ServerConfig
  onSave: (updates: { name: string; url: string; username?: string; password?: string }) => void
  onCancel: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [name, setName] = useState(server.name)
  const [url, setUrl] = useState(server.url)
  const [username, setUsername] = useState(server.auth?.username || '')
  const [password, setPassword] = useState(server.auth?.password || '')
  const [showAuth, setShowAuth] = useState(!!server.auth?.password)
  const [error, setError] = useState('')
  const showHttpsIpWarning = isHttpsIpUrl(url)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim().slice(0, SERVER_NAME_MAX_LENGTH)
    if (!trimmedName) {
      setError(t('servers.nameRequired'))
      return
    }
    if (!url.trim()) {
      setError(t('servers.urlRequired'))
      return
    }
    try {
      new URL(url)
    } catch {
      setError(t('servers.invalidUrl'))
      return
    }
    onSave({
      name: trimmedName,
      url: url.trim(),
      username: password.trim() ? username.trim() || 'opencode' : undefined,
      password: password.trim() || undefined,
    })
  }

  const inputCls = settingsFieldClass

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 rounded-lg border border-accent-main-100/30 bg-accent-main-100/[0.02] space-y-2.5"
    >
      <div>
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.name')}</label>
        <input
          type="text"
          value={name}
          maxLength={SERVER_NAME_MAX_LENGTH}
          onChange={e => {
            setName(e.target.value.slice(0, SERVER_NAME_MAX_LENGTH))
            setError('')
          }}
          placeholder={t('servers.namePlaceholder')}
          className={inputCls}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.url')}</label>
        <input
          type="text"
          value={url}
          onChange={e => {
            setUrl(e.target.value)
            setError('')
          }}
          placeholder={t('servers.urlPlaceholder')}
          className={`${inputCls} font-mono`}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAuth(!showAuth)}
        className="flex items-center gap-1.5 text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 transition-colors"
      >
        <KeyIcon size={10} />
        {showAuth ? t('servers.hideAuth') : t('servers.addAuth')}
      </button>

      {showAuth && (
        <>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.username')}</label>
            <input
              type="text"
              value={username}
              onChange={e => {
                setUsername(e.target.value)
                setError('')
              }}
              placeholder={t('servers.usernamePlaceholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder={t('servers.passwordPlaceholder')}
              className={inputCls}
            />
          </div>
        </>
      )}

      {showHttpsIpWarning && (
        <div className="text-[length:var(--fs-xs)] text-warning-100 bg-warning-bg border border-warning-100/20 rounded-md px-2.5 py-2 leading-relaxed">
          {t('servers.httpsIpWarning')}
        </div>
      )}

      {error && <p className="text-[length:var(--fs-xs)] text-danger-100">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button type="submit" size="sm">
          {t('common:save')}
        </Button>
      </div>
    </form>
  )
}

// ============================================
// Add Server Form
// ============================================

function AddServerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, url: string, username?: string, password?: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim().slice(0, SERVER_NAME_MAX_LENGTH)
    if (!trimmedName) {
      setError(t('servers.nameRequired'))
      return
    }
    if (!url.trim()) {
      setError(t('servers.urlRequired'))
      return
    }
    try {
      new URL(url)
    } catch {
      setError(t('servers.invalidUrl'))
      return
    }

    onAdd(
      trimmedName,
      url.trim(),
      password.trim() ? username.trim() || 'opencode' : undefined,
      password.trim() || undefined,
    )
  }

  const isCrossOrigin = (() => {
    if (!url.trim()) return false
    try {
      const serverUrl = new URL(url)
      return serverUrl.origin !== window.location.origin
    } catch {
      return false
    }
  })()
  const showHttpsIpWarning = isHttpsIpUrl(url)

  const inputCls = settingsFieldClass

  return (
    <form onSubmit={handleSubmit} className="p-3 rounded-lg border border-border-200 bg-bg-100 space-y-2.5">
      <div>
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.name')}</label>
        <input
          type="text"
          value={name}
          maxLength={SERVER_NAME_MAX_LENGTH}
          onChange={e => {
            setName(e.target.value.slice(0, SERVER_NAME_MAX_LENGTH))
            setError('')
          }}
          placeholder={t('servers.namePlaceholder')}
          className={inputCls}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.url')}</label>
        <input
          type="text"
          value={url}
          onChange={e => {
            setUrl(e.target.value)
            setError('')
          }}
          placeholder={t('servers.urlPlaceholder')}
          className={`${inputCls} font-mono`}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAuth(!showAuth)}
        className="flex items-center gap-1.5 text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 transition-colors"
      >
        <KeyIcon size={10} />
        {showAuth ? t('servers.hideAuth') : t('servers.addAuth')}
      </button>

      {showAuth && (
        <>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.username')}</label>
            <input
              type="text"
              value={username}
              onChange={e => {
                setUsername(e.target.value)
                setError('')
              }}
              placeholder={t('servers.usernamePlaceholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder={t('servers.passwordPlaceholder')}
              className={inputCls}
            />
          </div>

          {isCrossOrigin && password.trim() && (
            <div className="text-[length:var(--fs-xs)] text-warning-100 bg-warning-bg border border-warning-100/20 rounded-md px-2.5 py-2 leading-relaxed">
              {t('servers.crossOriginWarning')}{' '}
              <a
                href="https://github.com/anomalyco/opencode/issues/10047"
                target="_blank"
                rel="noopener"
                className="underline hover:no-underline"
              >
                #10047
              </a>
            </div>
          )}

          <div className="text-[length:var(--fs-xs)] text-text-400 leading-relaxed">{t('servers.credentialsStorage')}</div>
        </>
      )}

      {showHttpsIpWarning && (
        <div className="text-[length:var(--fs-xs)] text-warning-100 bg-warning-bg border border-warning-100/20 rounded-md px-2.5 py-2 leading-relaxed">
          {t('servers.httpsIpWarning')}
        </div>
      )}

      {error && <p className="text-[length:var(--fs-xs)] text-danger-100">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button type="submit" size="sm">
          {t('common:add')}
        </Button>
      </div>
    </form>
  )
}

// ============================================
// Tab: Servers
// ============================================

export function ServersSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const [addingServer, setAddingServer] = useState(false)
  const [addingWslServer, setAddingWslServer] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLButtonElement>(null)
  // portal 到 body 的菜单内容不在 addMenuRef 内，外部点击判定必须同时覆盖它，
  // 否则点击菜单项会被当作「点外面」立即关闭，onClick 永远收不到
  const addMenuContentRef = useRef<HTMLDivElement>(null)
  const isWindowsDesktop = isTauri() && getDesktopPlatform() === 'windows'
  const multiServerConfig = useMultiServerStore()
  const subscribedCount = multiServerConfig.subscribedServerIds.length
  const {
    servers,
    activeServer,
    addServer,
    removeServer,
    updateServer,
    setActiveServer,
    checkHealth,
    checkAllHealth,
    getHealth,
  } = useServerStore()
  const { navigateHome, sessionId: routeSessionId } = useRouter()
  const orderedServers = useMemo(() => {
    if (!activeServer) return servers
    const active = servers.find(s => s.id === activeServer.id)
    if (!active) return servers
    return [active, ...servers.filter(s => s.id !== active.id)]
  }, [servers, activeServer])

  // WSL 服务器统一由 wslStore 驱动渲染：就绪条目已同步进 serverStore（跟随上面的排序），
  // 未就绪条目只存在于 wslStore，追加在列表尾部。这样一台 WSL 服务器永远只有一张卡片
  const wslState = useWslStore()
  const wslItems = isWindowsDesktop ? (wslState?.servers ?? []).filter(s => isWslServerId(s.config.id)) : []
  const wslItemById = new Map(wslItems.map(item => [item.config.id, item]))
  const unreadyWslItems = wslItems.filter(item => !servers.some(s => s.id === item.config.id))

  useEffect(() => {
    checkAllHealth()
  }, [checkAllHealth])

  // M3: 下拉菜单外部点击关闭（trigger 与 portal 菜单内容都算「里面」）
  useEffect(() => {
    if (!addMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (addMenuRef.current?.contains(target) || addMenuContentRef.current?.contains(target)) return
      setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [addMenuOpen])

  // 切换服务器：设置 active + 清理当前 session + 导航回首页
  const handleSelectServer = useCallback(
    (id: string) => {
      if (activeServer?.id === id) return // 没变，不做事

      // 清理当前 session 的 store 状态
      if (routeSessionId) {
        messageStore.clearSession(routeSessionId)
      }

      setActiveServer(id) // 内部触发 serverChangeListeners → reconnectSSE()
      navigateHome()
      void checkHealth(id)
    },
    [activeServer?.id, checkHealth, routeSessionId, setActiveServer, navigateHome],
  )

  return (
    <>
      <SettingsSection
        title={t('servers.multiServerMode', { defaultValue: 'Multi-server mode' })}
        description={t('servers.multiServerModeDesc', {
          defaultValue:
            'Subscribe to multiple servers at once. Sidebar session list is grouped by server, and you can interact with sessions on any connected server simultaneously.',
        })}
      >
        <SettingRow
          label={t('servers.multiServerMode', { defaultValue: 'Multi-server mode' })}
          description={
            multiServerConfig.enabled
              ? t('servers.subscribedCountHint', {
                  defaultValue: '{{count}} servers subscribed. Use the plug icon on each server to join/leave the whitelist.',
                  count: subscribedCount,
                })
              : t('servers.multiServerModeOffHint', {
                  defaultValue: 'Only the servers you subscribe to appear in the sidebar session list.',
                })
          }
        >
          <Toggle
            enabled={multiServerConfig.enabled}
            onChange={() => multiServerStore.setEnabled(!multiServerConfig.enabled)}
            ariaLabel={t('servers.multiServerMode', { defaultValue: 'Multi-server mode' })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('servers.connections')}
        description={t('servers.connectionsDesc')}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={checkAllHealth}
              className="flex items-center justify-center w-7 h-7 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/70 transition-colors"
              title={t('common:refresh')}
              aria-label={t('common:refresh')}
            >
              <RetryIcon size={14} />
            </button>
            {isWindowsDesktop ? (
              <div className="relative">
                <button
                  ref={addMenuRef}
                  onClick={() => setAddMenuOpen(!addMenuOpen)}
                  className="h-7 px-2.5 rounded-md text-[length:var(--fs-sm)] font-medium text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
                >
                  {t('common:add')} ▾
                </button>
                {/* 设置弹窗本身是 z-[300]，portal 到 body 的菜单默认 zIndex=100 会被压在下面（看起来点了没反应） */}
                <DropdownMenu triggerRef={addMenuRef} isOpen={addMenuOpen} align="right" zIndex={400}>
                  <div ref={addMenuContentRef}>
                    <MenuItem
                      label={t('servers.addRemote')}
                      onClick={() => { setAddMenuOpen(false); setAddingServer(true) }}
                    />
                    <MenuItem
                      label={t('servers.addWsl')}
                      onClick={() => { setAddMenuOpen(false); setAddingWslServer(true) }}
                    />
                  </div>
                </DropdownMenu>
              </div>
            ) : (
              <button
                onClick={() => setAddingServer(true)}
                disabled={addingServer}
                className="h-7 px-2.5 rounded-md text-[length:var(--fs-sm)] font-medium text-accent-main-100 hover:bg-accent-main-100/10 transition-colors disabled:opacity-40"
              >
                {t('common:add')}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-1.5">
          {orderedServers.map(s => {
            if (isWslServerId(s.id)) {
              const item = wslItemById.get(s.id)
              // wsl 条目必须由 wslStore 状态驱动渲染；状态未到达时跳过，
              // 避免出现没有生命周期管理能力的孤立连接条目
              if (!item) return null
              return (
                <WslServerRow
                  key={s.id}
                  item={item}
                  health={getHealth(s.id)}
                  isActive={activeServer?.id === s.id}
                  subscribed={multiServerStore.isSubscribed(s.id)}
                  multiServerEnabled={multiServerConfig.enabled}
                  onSelect={() => handleSelectServer(s.id)}
                  onCheckHealth={() => void checkHealth(s.id)}
                  onToggleSubscribe={() => multiServerStore.setSubscribed(s.id, !multiServerStore.isSubscribed(s.id))}
                />
              )
            }
            return (
              <ServerItem
                key={s.id}
                server={s}
                health={getHealth(s.id)}
                isActive={activeServer?.id === s.id}
                subscribed={multiServerStore.isSubscribed(s.id)}
                multiServerEnabled={multiServerConfig.enabled}
                onSelect={() => handleSelectServer(s.id)}
                onDelete={() => {
                  // 删除服务器时同步移出多服务器白名单（避免残留订阅连到已删地址）
                  if (multiServerStore.isSubscribed(s.id)) {
                    multiServerStore.setSubscribedServerIds(
                      multiServerStore.getSubscribedServerIds().filter(id => id !== s.id),
                    )
                  }
                  removeServer(s.id)
                }}
                onEdit={updates => {
                  const auth = updates.password
                    ? { username: updates.username || 'opencode', password: updates.password }
                    : undefined
                  updateServer(s.id, { name: updates.name, url: updates.url, auth })
                  void checkHealth(s.id)
                }}
                onCheckHealth={() => void checkHealth(s.id)}
                onToggleSubscribe={() => multiServerStore.setSubscribed(s.id, !multiServerStore.isSubscribed(s.id))}
              />
            )
          })}

          {/* 未就绪的 WSL 服务器（starting/failed/stopped）不在连接列表里，同样以卡片形态展示 */}
          {unreadyWslItems.map(item => (
            <WslServerRow
              key={item.config.id}
              item={item}
              health={null}
              isActive={false}
              subscribed={false}
              multiServerEnabled={multiServerConfig.enabled}
              onSelect={() => handleSelectServer(item.config.id)}
              onToggleSubscribe={() => multiServerStore.setSubscribed(item.config.id, true)}
            />
          ))}

        {addingServer && (
          <AddServerForm
            onAdd={(n, u, user, pass) => {
              const auth = pass ? { username: user || 'opencode', password: pass } : undefined
              const s = addServer({ name: n, url: u, auth })
              setAddingServer(false)
              void checkHealth(s.id)
            }}
            onCancel={() => setAddingServer(false)}
          />
        )}

        {servers.length === 0 && unreadyWslItems.length === 0 && !addingServer && (
          <div className="text-[length:var(--fs-md)] text-text-400 text-center py-8">{t('servers.noServersConfigured')}</div>
        )}
      </div>
      </SettingsSection>

      <DialogAddWslServer
        isOpen={addingWslServer}
        onClose={() => setAddingWslServer(false)}
        onAdded={() => void checkAllHealth()}
      />
    </>
  )
}
