// ============================================
// WslServerRow —— 连接列表中的 WSL 服务器卡片（官方 WslServerSettings 行 + 连接能力合并）
// 一台 WSL 服务器只此一张卡片：就绪时点击切换会话、插头订阅侧边栏、健康检查；
// 右侧内聚生命周期操作（设默认 / 安装·更新 opencode / 失败重试 / 彻底删除）。
// 不提供「编辑连接」：端口/鉴权由 sidecar 每次启动动态生成，手改必被同步覆盖
// ============================================

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { CircleIcon, KeyIcon, PlugIcon, SpinnerIcon, WifiIcon, WifiOffIcon } from '../../../components/Icons'
import { wslApi } from '../../../api/wsl'
import { useWslStore } from '../../../store/wslStore'
import { serverStore } from '../../../store/serverStore'
import { useServerStore } from '../../../hooks/useServerStore'
import { notificationStore } from '../../../store/notificationStore'
import { ServerHealthButton } from '../../settings/components/ServerHealthButton'
import { wslOpencodeAction, wslRuntimeRetryable } from '../settings-model'
import type { WslServerItem } from '../types'
import type { ServerHealth } from '../../../store/serverStore'

/** runtime 生命周期状态点：与健康检查（探测 URL 可达性）语义不同，两者并存 */
function StatusDot({ kind }: { kind: WslServerItem['runtime']['kind'] }) {
  switch (kind) {
    case 'starting':
      return <SpinnerIcon size={12} className="shrink-0 animate-spin text-text-400" />
    case 'ready':
      return <WifiIcon size={12} className="shrink-0 text-success-100" />
    case 'failed':
    case 'stopped':
      return <WifiOffIcon size={12} className="shrink-0 text-danger-100" />
    default:
      return <WifiOffIcon size={12} className="shrink-0 text-text-400" />
  }
}

function requestError(err: unknown) {
  console.error('WSL servers request failed', err instanceof Error ? (err.stack ?? err.message) : String(err))
  const message = err instanceof Error ? err.message : String(err)
  notificationStore.push('error', message, message, '')
}

const tagClass =
  'shrink-0 text-[length:var(--fs-xs)] font-medium text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded'
const actionButtonClass =
  'h-7 px-2 rounded-md text-[length:var(--fs-xs)] font-medium text-text-400 hover:text-accent-main-100 hover:bg-accent-main-100/10 transition-colors'

export function WslServerRow({
  item,
  health,
  isActive,
  subscribed,
  multiServerEnabled,
  onSelect,
  onCheckHealth,
  onToggleSubscribe,
}: {
  item: WslServerItem
  health: ServerHealth | null
  isActive: boolean
  subscribed: boolean
  multiServerEnabled: boolean
  onSelect: () => void
  /** 仅就绪条目由父组件传入（健康检查探测的是连接地址） */
  onCheckHealth?: () => void
  onToggleSubscribe: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const wsl = useWslStore()
  const { defaultServerId } = useServerStore()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ready = item.runtime.kind === 'ready'
  const check = wsl?.opencodeChecks[item.config.distro]
  const opencodeAction = wslOpencodeAction(check)
  const busy = wsl?.job?.kind === 'install-opencode' && wsl.job.distro === item.config.distro

  return (
    <>
      <div
        onClick={ready ? onSelect : undefined}
        className={`group flex items-center gap-1.5 p-2.5 rounded-lg border transition-colors min-w-0
          ${
            isActive ? 'border-accent-main-100/40 bg-accent-main-100/5' : 'border-border-200/40 hover:border-border-300'
          }`}
      >
        <StatusDot kind={item.runtime.kind} />
        <button
          type="button"
          disabled={!ready}
          onClick={e => {
            e.stopPropagation()
            onSelect()
          }}
          aria-current={isActive ? 'true' : undefined}
          className="min-w-0 flex-1 overflow-hidden bg-transparent border-none p-0 text-left"
        >
          <div className="min-w-0">
            <div className="text-[length:var(--fs-md)] font-medium text-text-100 truncate flex items-center gap-1.5">
              <span className="truncate" title={item.config.distro}>
                {item.config.distro}
              </span>
              <span className={tagClass}>{t('wsl.server.label')}</span>
              {defaultServerId === item.config.id && <span className={tagClass}>{t('wsl.server.defaultTag')}</span>}
            </div>
            <div className="text-[length:var(--fs-xs)] text-text-400 truncate font-mono flex items-center gap-1 mt-0.5 min-w-0">
              {item.runtime.kind === 'ready' && (
                <>
                  <span className="truncate min-w-0" title={item.runtime.url}>
                    {item.runtime.url}
                  </span>
                  {item.runtime.password && <KeyIcon size={10} className="shrink-0 text-text-400" />}
                </>
              )}
              {item.runtime.kind !== 'ready' && check?.version && `OpenCode v${check.version}`}
            </div>
            {item.runtime.kind === 'failed' && (
              <div
                className="text-[length:var(--fs-xs)] text-danger-100 mt-0.5 line-clamp-2"
                title={item.runtime.message}
              >
                {item.runtime.message}
              </div>
            )}
          </div>
        </button>
        <div className="shrink-0 flex items-center gap-0.5">
          {ready && (
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
          )}
          {ready && onCheckHealth && <ServerHealthButton health={health} onCheck={onCheckHealth} />}
          {/* 默认服务器偏好（官方 defaultKey）：就绪后启动自动切回该服务器 */}
          {defaultServerId === item.config.id ? (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                serverStore.setDefaultServer(null)
              }}
              className={actionButtonClass}
              title={t('wsl.server.unsetDefault')}
              aria-label={t('wsl.server.unsetDefault')}
            >
              {t('wsl.server.unsetDefault')}
            </button>
          ) : (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                serverStore.setDefaultServer(item.config.id)
              }}
              className={actionButtonClass}
              title={t('wsl.server.setDefault')}
              aria-label={t('wsl.server.setDefault')}
            >
              {t('wsl.server.setDefault')}
            </button>
          )}
          {/* 行内安装/更新 opencode 入口（官方 wslOpencodeAction 驱动） */}
          {opencodeAction && (
            <button
              type="button"
              disabled={busy || !!wsl?.job}
              onClick={e => {
                e.stopPropagation()
                wslApi.installOpencode(item.config.distro).catch((err: unknown) => requestError(err))
              }}
              className={`${actionButtonClass} text-accent-main-100 hover:bg-accent-main-100/10 disabled:opacity-40`}
              title={t(opencodeAction)}
            >
              {busy ? t('wsl.server.updating') : t(opencodeAction)}
            </button>
          )}
          {/* 重试启动：仅 failed/stopped 可重试（官方 wslRuntimeRetryable） */}
          {wslRuntimeRetryable(item.runtime) && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                wslApi.startServer(item.config.id).catch((err: unknown) => requestError(err))
              }}
              className={actionButtonClass}
              title={t('wsl.server.retryStart')}
              aria-label={t('wsl.server.retryStart')}
            >
              {t('wsl.server.retryStart')}
            </button>
          )}
          {/* 彻底删除（区别于普通服务器的「移除连接」）：连同 WSL 侧服务一起移除 */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation()
              setConfirmDelete(true)
            }}
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-400 hover:text-danger-100 hover:bg-danger-100/10 transition-colors"
            title={t('common:delete')}
            aria-label={t('common:delete')}
          >
            ×
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          wslApi.removeServer(item.config.id).catch((err: unknown) => requestError(err))
        }}
        title={t('wsl.deleteServerTitle')}
        description={t('wsl.deleteServerConfirm', { name: item.config.distro })}
        confirmText={t('common:delete')}
        cancelText={t('common:cancel')}
        variant="danger"
      />
    </>
  )
}
