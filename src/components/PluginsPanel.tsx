// ============================================
// PluginsPanel - 插件管理面板
// 对应官方 settings/providers/extensions.tsx 的 plugins 页签
// （外加 server-panel.tsx:285 的 status/error 展示与 outdated 更新）
// ============================================

import { memo, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PlugIcon, RetryIcon, SpinnerIcon, AlertCircleIcon } from './Icons'
import { getPlugins, pluginLabel, updatePlugins, type PluginInfo } from '../api/plugin'
import { subscribeToEvents } from '../api/events'
import { useDirectory } from '../hooks'

interface PluginsPanelProps {
  isResizing?: boolean
}

export const PluginsPanel = memo(function PluginsPanel({ isResizing: _isResizing }: PluginsPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { currentDirectory } = useDirectory()
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const list = await getPlugins(currentDirectory || undefined)
      // 官方 extensions.tsx / server-panel.tsx 都过滤 builtin
      setPlugins(list.filter(plugin => plugin.source.type !== 'builtin'))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pluginsPanel.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }, [currentDirectory, t])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // plugin.updated → 刷新（官方 server-panel.tsx:317 同款）
  useEffect(() => {
    return subscribeToEvents({
      onPluginUpdated: () => {
        void load()
      },
    })
  }, [load])

  const handleUpdate = useCallback(
    async (target: string) => {
      setUpdating(target)
      try {
        await updatePlugins([target], currentDirectory || undefined)
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : t('pluginsPanel.failedToUpdate'))
      } finally {
        setUpdating(null)
      }
    },
    [currentDirectory, load, t],
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-200/40 shrink-0">
        <div className="flex items-center gap-1.5 text-[length:var(--fs-sm)] text-text-300 font-medium">
          <PlugIcon size={13} className="text-text-400" />
          {t('pluginsPanel.title')}
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          title={t('common:retry')}
          aria-label={t('common:retry')}
          className="p-1 rounded-md text-text-400 hover:text-text-100 hover:bg-bg-200/50 transition-colors"
        >
          <RetryIcon size={12} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-400 text-[length:var(--fs-sm)] gap-2">
            <SpinnerIcon size={14} className="animate-spin" />
            <span>{t('common:loading')}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-400">
            <AlertCircleIcon size={16} className="text-danger-100" />
            <span className="text-[length:var(--fs-sm)]">{error}</span>
          </div>
        ) : plugins.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-400/70 text-[length:var(--fs-sm)]">
            {t('pluginsPanel.empty')}
          </div>
        ) : (
          <div className="space-y-0.5">
            {plugins.map(plugin => {
              const label = pluginLabel(plugin)
              const state = plugin.state
              const failed = state.status === 'failed'
              const source = plugin.source
              const pkg = source.type === 'package' ? source : null
              const outdated = pkg?.outdated === true
              const updatingThis = updating !== null && pkg?.target === updating
              return (
                <div key={label} className="group flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-bg-200/50 transition-colors">
                  <div className="w-7 h-7 rounded-md bg-bg-200/60 flex items-center justify-center shrink-0">
                    <PlugIcon size={14} className={failed ? 'text-danger-100' : 'text-text-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[length:var(--fs-sm)] text-text-100 font-medium truncate" title={label}>
                      {label}
                    </div>
                    <div className="text-[length:var(--fs-xxs)] truncate">
                      {failed ? (
                        <span className="text-danger-100" title={state.error}>
                          {t('pluginsPanel.failed')}: {state.error}
                        </span>
                      ) : (
                        <span className="text-text-400/70">
                          {pkg?.version ? `${pkg.target}@${pkg.version}` : t(`pluginsPanel.source.${source.type}`)}
                        </span>
                      )}
                    </div>
                  </div>
                  {outdated && pkg && (
                    <button
                      type="button"
                      onClick={() => void handleUpdate(pkg.target)}
                      disabled={updating !== null}
                      className="shrink-0 px-2 py-1 text-[length:var(--fs-xs)] text-warning-100 hover:bg-warning-100/10 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
                      title={t('pluginsPanel.outdatedTitle')}
                    >
                      {updatingThis || pkg.updating === true ? <SpinnerIcon size={10} className="animate-spin" /> : null}
                      {t('pluginsPanel.update')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
