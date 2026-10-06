import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  SearchIcon,
} from '../../../components/Icons'
import { useModels } from '../../../hooks'
import { modelVisibilityStore, useHiddenModelKeys } from '../../../store'
import { groupModelsByProvider, getModelKey, providerDisplayName } from '../../../utils/modelUtils'
import type { Model } from '../../../api'
import { Button } from '../../../components/ui'
import { ProviderConnectDialog } from './ProviderConnectDialog'
import { SettingsSection } from './SettingsUI'

function formatContext(limit: number): string {
  if (!limit) return ''
  const k = Math.round(limit / 1000)
  if (k >= 1000) return `${(k / 1000).toFixed(0)}M`
  return `${k}k`
}

function isModClick(e: React.MouseEvent | React.KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey
}

function ModelVisibilityButton({
  enabled,
  disabled,
  ariaLabel,
  onChange,
  revealOnHover = false,
}: {
  enabled: boolean
  disabled?: boolean
  ariaLabel: string
  onChange: () => void
  revealOnHover?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={e => {
        e.stopPropagation()
        if (!disabled) onChange()
      }}
      className={`h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md transition-all
        hover:bg-bg-200/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-main-100 focus-visible:outline-offset-1
        ${
          enabled
            ? `text-text-300 opacity-60 hover:opacity-100 ${
                revealOnHover ? 'sm:opacity-0 sm:group-hover:opacity-60 sm:focus-visible:opacity-100' : ''
              }`
            : 'text-text-500 opacity-70 hover:opacity-100'
        }
        ${disabled ? '!opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {enabled ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
    </button>
  )
}

export function ModelsSettings() {
  const { t } = useTranslation('settings')
  const { models, providers, isLoading } = useModels()
  const hiddenModelKeys = useHiddenModelKeys()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [connectOpen, setConnectOpen] = useState(false)
  // 范围选择锚点：上一次单击的模型 key
  const anchorKeyRef = useRef<string | null>(null)
  const hiddenModelKeySet = useMemo(() => new Set(hiddenModelKeys), [hiddenModelKeys])

  const visibleCount = useMemo(
    () => models.reduce((count, model) => (hiddenModelKeySet.has(getModelKey(model)) ? count : count + 1), 0),
    [models, hiddenModelKeySet],
  )

  const filteredModels = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    if (!normalizedQuery) return models

    const normalize = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '')
    return models.filter(
      model =>
        normalize(model.name).includes(normalizedQuery) ||
        normalize(model.id).includes(normalizedQuery) ||
        normalize(model.family).includes(normalizedQuery) ||
        normalize(providerDisplayName(providers, model.providerID)).includes(normalizedQuery),
    )
  }, [models, providers, deferredQuery])

  const groups = useMemo(() => groupModelsByProvider(filteredModels, providers), [filteredModels, providers])

  // 当前可见列表的扁平顺序（折叠的 provider 不参与 shift 范围）
  const flatVisibleModels = useMemo(() => {
    const list: Model[] = []
    for (const group of groups) {
      const isCollapsed = collapsed.has(group.providerName) && !deferredQuery
      if (isCollapsed) continue
      list.push(...group.models)
    }
    return list
  }, [groups, collapsed, deferredQuery])

  const flatKeyIndex = useMemo(() => {
    const map = new Map<string, number>()
    flatVisibleModels.forEach((model, index) => {
      map.set(getModelKey(model), index)
    })
    return map
  }, [flatVisibleModels])

  const toggleCollapse = (provider: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  /**
   * 切换模型可见性。
   * - 普通点击：切换当前项，并设为锚点
   * - Shift+点击：从锚点到当前项整段统一设为「当前项即将变成的状态」
   * - Ctrl/Cmd+点击：只切换当前项（不打断锚点，方便接着 Shift 扩选）
   */
  const handleModelActivate = useCallback(
    (model: Model, e: React.MouseEvent | React.KeyboardEvent) => {
      const key = getModelKey(model)
      const currentlyEnabled = !hiddenModelKeySet.has(key)
      const nextVisible = !currentlyEnabled

      // 至少保留一个可见
      if (currentlyEnabled && visibleCount <= 1 && !e.shiftKey) return

      const isShift = e.shiftKey && !isModClick(e)
      const isMod = isModClick(e)

      if (isShift && anchorKeyRef.current) {
        const from = flatKeyIndex.get(anchorKeyRef.current)
        const to = flatKeyIndex.get(key)
        if (from !== undefined && to !== undefined) {
          const start = Math.min(from, to)
          const end = Math.max(from, to)
          const range = flatVisibleModels.slice(start, end + 1)

          // 批量关掉时：不能把全部模型都关掉
          if (!nextVisible) {
            const rangeKeys = new Set(range.map(getModelKey))
            const remainingVisible = models.reduce((count, m) => {
              const k = getModelKey(m)
              if (rangeKeys.has(k)) return count // 范围里的都会被关
              return hiddenModelKeySet.has(k) ? count : count + 1
            }, 0)
            if (remainingVisible <= 0) {
              // 保底：只关范围里除第一个可见外的
              const keepOne = range.find(m => !hiddenModelKeySet.has(getModelKey(m)))
              const toHide = keepOne ? range.filter(m => getModelKey(m) !== getModelKey(keepOne)) : []
              if (toHide.length > 0) modelVisibilityStore.setManyVisible(toHide, false)
              return
            }
          }

          modelVisibilityStore.setManyVisible(range, nextVisible)
          return
        }
      }

      // 普通 / Ctrl·Cmd：单点切换
      if (currentlyEnabled && visibleCount <= 1) return
      modelVisibilityStore.setVisible(model, nextVisible)

      // Ctrl/Cmd 保持锚点；普通点击更新锚点
      if (!isMod) {
        anchorKeyRef.current = key
      } else if (!anchorKeyRef.current) {
        anchorKeyRef.current = key
      }
    },
    [flatKeyIndex, flatVisibleModels, hiddenModelKeySet, models, visibleCount],
  )

  return (
    <SettingsSection
      title={t('models.visibility')}
      description={t('models.visibilityDesc')}
      actions={
        <Button variant="secondary" size="sm" onClick={() => setConnectOpen(true)}>
          {t('providerConnect.title')}
        </Button>
      }
    >
      <div className="relative group">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('models.searchPlaceholder')}
          aria-label={t('models.searchPlaceholder')}
          spellCheck={false}
          autoCorrect="off"
          autoComplete="off"
          autoCapitalize="off"
          className="w-full h-9 bg-bg-200/70 hover:bg-bg-200 border border-border-200/50 rounded-lg pl-9 pr-9 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus:outline-none transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-100/80 transition-colors"
            aria-label={t('models.clearSearch')}
          >
            <CloseIcon size={14} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-[length:var(--fs-sm)] text-text-400">{t('models.loading')}</div>
      ) : groups.length === 0 ? (
        <div className="py-10 text-center text-[length:var(--fs-sm)] text-text-400">
          {query ? t('models.noResults') : t('models.empty')}
        </div>
      ) : (
        <div>
          {groups.map((group, groupIndex) => {
            const providerModels = models.filter(
              model => providerDisplayName(providers, model.providerID) === group.providerName,
            )
            const providerVisibleCount = providerModels.filter(
              model => !hiddenModelKeySet.has(getModelKey(model)),
            ).length
            const allProviderVisible = providerVisibleCount === providerModels.length
            const providerActionDisabled = allProviderVisible && providerVisibleCount >= visibleCount
            const isCollapsed = collapsed.has(group.providerName) && !deferredQuery

            return (
              <div key={group.providerName}>
                <div
                  className={`group/provider flex items-center gap-3 px-2.5 pb-1 ${
                    groupIndex === 0 ? 'pt-0.5' : 'pt-3'
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapse(group.providerName)}
                    title={group.providerName}
                    className="h-7 flex-1 min-w-0 flex items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-main-100"
                  >
                    <span className="min-w-0 text-[length:var(--fs-xxs)] font-semibold text-text-400/70 uppercase tracking-wider truncate">
                      {group.providerName}
                    </span>
                    <span className="text-[length:var(--fs-xs)] text-text-500 shrink-0 tabular-nums">
                      {providerVisibleCount}/{providerModels.length}
                    </span>
                    <span className="text-text-400 shrink-0" aria-hidden="true">
                      {isCollapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={providerActionDisabled}
                    title={providerActionDisabled ? t('models.keepOneEnabled') : undefined}
                    onClick={() => {
                      const nextVisible = !allProviderVisible
                      modelVisibilityStore.setManyVisible(providerModels, nextVisible)
                      if (providerModels[0]) anchorKeyRef.current = getModelKey(providerModels[0])
                    }}
                    className={`h-7 shrink-0 px-1.5 -mr-1.5 rounded-md text-[length:var(--fs-xs)] font-medium hover:bg-bg-200/40 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                      allProviderVisible ? 'text-text-400 hover:text-text-200' : 'text-accent-main-100'
                    }`}
                  >
                    {t(allProviderVisible ? 'models.hideAll' : 'models.showAll')}
                  </button>
                  <span className="w-7 shrink-0" aria-hidden="true" />
                </div>

                {!isCollapsed && (
                  <div className="pb-1">
                    {group.models.map(model => {
                      const key = getModelKey(model)
                      const enabled = !hiddenModelKeySet.has(key)
                      const context = formatContext(model.limit?.context ?? 0)
                      const disabled = enabled && visibleCount <= 1

                      return (
                        <div
                          key={key}
                          onClick={e => {
                            if (disabled && !e.shiftKey && !isModClick(e)) return
                            handleModelActivate(model, e)
                          }}
                          className={`group w-full flex items-start justify-between gap-3 px-2.5 py-2 rounded-lg transition-colors select-none
                            ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-bg-200/40'}`}
                        >
                          <button
                            type="button"
                            aria-pressed={enabled}
                            title={`${model.name}\n${model.id}`}
                            onClick={e => {
                              e.stopPropagation()
                              if (disabled && !e.shiftKey && !isModClick(e)) return
                              handleModelActivate(model, e)
                            }}
                            className="min-w-0 flex-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-main-100 rounded-md"
                          >
                            <div className="h-7 flex items-center min-w-0">
                              <div
                                className={`min-w-0 truncate text-[length:var(--fs-md)] font-medium leading-snug ${
                                  enabled ? 'text-text-100' : 'text-text-400'
                                }`}
                              >
                                {model.name}
                              </div>
                            </div>
                            <div
                              className={`truncate -mt-0.5 text-[length:var(--fs-xs)] font-mono leading-relaxed ${
                                enabled ? 'text-text-400' : 'text-text-500'
                              }`}
                            >
                              {model.id}
                              {context && <span className="sm:hidden"> · {context}</span>}
                            </div>
                          </button>
                          {context && (
                            <span className="hidden sm:flex h-7 items-center shrink-0 text-[length:var(--fs-xs)] text-text-500 font-mono tabular-nums">
                              {context}
                            </span>
                          )}
                          <ModelVisibilityButton
                            enabled={enabled}
                            disabled={disabled}
                            revealOnHover
                            ariaLabel={t(enabled ? 'models.hideModel' : 'models.showModel', { name: model.name })}
                            onChange={() => {
                              if (disabled) return
                              modelVisibilityStore.setVisible(model, !enabled)
                              anchorKeyRef.current = key
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[length:var(--fs-xs)] text-text-400">{t('models.keepOneEnabled')}</p>

      <ProviderConnectDialog isOpen={connectOpen} onClose={() => setConnectOpen(false)} />
    </SettingsSection>
  )
}
