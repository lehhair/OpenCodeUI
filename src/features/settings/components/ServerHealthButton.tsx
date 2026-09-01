// ============================================
// ServerHealthButton —— 服务器健康检查按钮
// 图标反映 serverStore healthMap 状态，title 展示延迟/版本/错误详情。
// ServerItem 与 WslServerRow 共用，保证两类连接卡片行为一致
// ============================================

import { useTranslation } from 'react-i18next'
import { KeyIcon, SpinnerIcon, WifiIcon, WifiOffIcon } from '../../../components/Icons'
import type { ServerHealth } from '../../../store/serverStore'

export function ServerHealthButton({ health, onCheck }: { health: ServerHealth | null; onCheck: () => void }) {
  const { t } = useTranslation(['settings', 'common'])

  const statusTitle = () => {
    if (!health) return t('servers.checkHealth')
    switch (health.status) {
      case 'checking':
        return t('servers.checking')
      case 'online':
        return `${t('servers.onlineLatency', { latency: health.latency })}${health.version ? ` · OpenCode v${health.version}` : ''}`
      case 'unauthorized':
        return t('servers.invalidCredentials')
      case 'offline':
        return health.error || t('common:offline')
      case 'error':
        return health.error || t('common:error')
      default:
        return t('common:unknown')
    }
  }

  const statusIcon = () => {
    if (!health || health.status === 'checking') return <SpinnerIcon size={12} className="animate-spin text-text-400" />
    if (health.status === 'online') return <WifiIcon size={12} className="text-success-100" />
    if (health.status === 'unauthorized') return <KeyIcon size={12} className="text-warning-100" />
    return <WifiOffIcon size={12} className="text-danger-100" />
  }

  return (
    <button
      type="button"
      className="p-1.5 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/70 transition-colors"
      onClick={e => {
        e.stopPropagation()
        onCheck()
      }}
      title={statusTitle()}
      aria-label={statusTitle()}
    >
      {statusIcon()}
    </button>
  )
}
