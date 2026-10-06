// ============================================
// ProvidersSettings — Provider 管理页（对齐官方 settings/providers/providers.tsx）
//
// 官方页面结构：
//   已连接列表（名称 + 来源标签 env/api/account/config/custom + 断开按钮）
//   + 常用 provider（未连接的 featured，点击进连接对话框）
//
// 来源标签的推导与官方 source() 同款：
//   integration.connections 有 credential → method oauth ? account : api
//   有 env 连接 → env；integration 存在但无连接 → config；否则 → custom
// 断开：遍历 credential connections 逐个 credential.remove（官方同款）
// ============================================

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui'
import { SpinnerIcon, PlusIcon } from '../../../components/Icons'
import { useModels } from '../../../hooks'
import { getIntegrations, type IntegrationInfo } from '../../../api'
import { removeCredential } from '../../../api/credential'
import { refreshModels } from '../../../hooks/useModels'
import { notificationStore } from '../../../store/notificationStore'
import { ProviderConnectDialog } from './ProviderConnectDialog'
import { SettingsSection } from './SettingsUI'
import type { Provider } from '../../../api'

type ProviderSource = 'env' | 'api' | 'account' | 'config' | 'custom'

/** 官方 providers 页的 featured 顺序同款（picker 用的同一列表） */
const POPULAR = ['opencode-go', 'opencode', 'anthropic', 'openai', 'google', 'openrouter', 'vercel']

export function ProvidersSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const { providers, isLoading } = useModels()
  const [integrations, setIntegrations] = useState<IntegrationInfo[] | undefined>(undefined)
  const [disconnecting, setDisconnecting] = useState<string | undefined>(undefined)
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectProvider, setConnectProvider] = useState<string | undefined>(undefined)

  const loadIntegrations = () => {
    getIntegrations()
      .catch(() => [] as IntegrationInfo[])
      .then(list => setIntegrations(list))
  }

  useEffect(() => {
    loadIntegrations()
  }, [])

  // v2 的 provider.list 只返回可用（已连接）provider——connected 即全表
  // （官方 normalizeProviderList: connected = providers.map(id) 同款）
  const connected = useMemo(() => [...providers].sort((a, b) => a.name.localeCompare(b.name)), [providers])

  /** Console 系 provider 走 opencode integration（官方 integration() 同款） */
  const integrationFor = (item: Provider): IntegrationInfo | undefined => {
    const id = item.integrationID ?? item.id
    return integrations?.find(entry => entry.id === id)
  }

  /** 官方 source() 同款推导 */
  const sourceOf = (item: Provider): ProviderSource => {
    const current = integrationFor(item)
    const credential = current?.connections.find(connection => connection.type === 'credential')
    if (credential) return credential.method === 'oauth' ? 'account' : 'api'
    if (current?.connections.some(connection => connection.type === 'env')) return 'env'
    if (current) return 'config'
    return 'custom'
  }

  const canDisconnect = (item: Provider) =>
    integrationFor(item)?.connections.some(connection => connection.type === 'credential') ?? false

  /** 官方 disconnect 同款：遍历 credential connections 逐个 remove */
  const disconnect = async (item: Provider) => {
    const current = integrationFor(item)
    if (!current) return
    const credentials = current.connections.filter(connection => connection.type === 'credential')
    if (credentials.length === 0) return
    setDisconnecting(item.id)
    try {
      for (const credential of credentials) {
        await removeCredential(credential.id)
      }
      notificationStore.push('completed', t('settings:providers.disconnected', { provider: item.name }), '', '')
      await refreshModels().catch(() => undefined)
      loadIntegrations()
    } catch (err) {
      notificationStore.push('error', t('common:failed'), err instanceof Error ? err.message : String(err), '')
    } finally {
      setDisconnecting(undefined)
    }
  }

  // 常用 provider：featured 中未连接的（点击直接进该 provider 的连接流程）
  const popular = useMemo(() => {
    if (!integrations) return []
    const connectedIds = new Set(connected.map(p => p.integrationID ?? p.id))
    return POPULAR.flatMap(id => {
      if (connectedIds.has(id)) return []
      const entry = integrations.find(i => i.id === id)
      return entry ? [{ id: entry.id, name: entry.name }] : []
    })
  }, [integrations, connected])

  const openConnect = (provider?: string) => {
    setConnectProvider(provider)
    setConnectOpen(true)
  }

  return (
    <>
      <SettingsSection
        title={t('providers.connectedTitle')}
        description={t('providers.connectedDesc')}
        actions={
          <Button variant="secondary" size="sm" onClick={() => openConnect()}>
            <PlusIcon size={13} />
            {t('providerConnect.title')}
          </Button>
        }
      >
        {isLoading || integrations === undefined ? (
          <div className="flex items-center gap-2 py-2 text-text-400">
            <SpinnerIcon size={14} className="animate-spin" />
            <span>{t('common:loading')}</span>
          </div>
        ) : connected.length === 0 ? (
          <div className="py-2 text-[length:var(--fs-sm)] text-text-400">{t('providers.empty')}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {connected.map(provider => {
              const source = sourceOf(provider)
              return (
                <div
                  key={provider.id}
                  className="flex items-center gap-3 rounded-lg border border-border-200/60 bg-bg-200/40 px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[length:var(--fs-base)] font-medium text-text-100">
                    {provider.name}
                  </span>
                  <span className="shrink-0 rounded-md bg-bg-300/60 px-1.5 py-0.5 text-[length:var(--fs-xs)] text-text-400">
                    {t(`providers.source.${source}`)}
                  </span>
                  {canDisconnect(provider) &&
                    (disconnecting === provider.id ? (
                      <SpinnerIcon size={13} className="animate-spin shrink-0 text-text-400" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => void disconnect(provider)}
                        className="shrink-0 rounded-md px-2 py-1 text-[length:var(--fs-sm)] text-text-400 hover:bg-danger-bg hover:text-danger-100 transition-colors"
                      >
                        {t('providers.disconnect')}
                      </button>
                    ))}
                </div>
              )
            })}
          </div>
        )}
      </SettingsSection>

      {popular.length > 0 && (
        <SettingsSection title={t('providers.popularTitle')}>
          <div className="flex flex-col gap-1">
            {popular.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => openConnect(item.id)}
                className="flex items-center gap-3 rounded-lg border border-border-200/60 bg-bg-200/40 px-3 py-2.5 text-left hover:bg-bg-200/70 transition-colors"
              >
                <span className="min-w-0 flex-1 truncate text-[length:var(--fs-base)] text-text-200">{item.name}</span>
                <span className="shrink-0 text-[length:var(--fs-sm)] text-text-400">{t('providers.connect')}</span>
              </button>
            ))}
          </div>
        </SettingsSection>
      )}

      <ProviderConnectDialog
        isOpen={connectOpen}
        onClose={() => {
          setConnectOpen(false)
          setConnectProvider(undefined)
          loadIntegrations()
        }}
        initialProvider={connectProvider}
      />
    </>
  )
}
