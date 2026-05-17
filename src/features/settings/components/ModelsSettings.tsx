import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon, SearchIcon } from '../../../components/Icons'
import { useModels } from '../../../hooks'
import { modelVisibilityStore, useHiddenModelKeys } from '../../../store'
import { groupModelsByProvider, getModelKey } from '../../../utils/modelUtils'
import { SettingsSection, Toggle } from './SettingsUI'

function formatContext(limit: number): string {
  if (!limit) return ''
  const k = Math.round(limit / 1000)
  if (k >= 1000) return `${(k / 1000).toFixed(0)}M`
  return `${k}k`
}

export function ModelsSettings() {
  const { t } = useTranslation('settings')
  const { models, isLoading } = useModels()
  const hiddenModelKeys = useHiddenModelKeys()
  const [query, setQuery] = useState('')
  const hiddenModelKeySet = useMemo(() => new Set(hiddenModelKeys), [hiddenModelKeys])

  const visibleCount = useMemo(
    () => models.reduce((count, model) => (hiddenModelKeySet.has(getModelKey(model)) ? count : count + 1), 0),
    [models, hiddenModelKeySet],
  )

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return models

    const normalize = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '')
    return models.filter(
      model =>
        normalize(model.name).includes(normalizedQuery) ||
        normalize(model.id).includes(normalizedQuery) ||
        normalize(model.family).includes(normalizedQuery) ||
        normalize(model.providerName).includes(normalizedQuery),
    )
  }, [models, query])

  const groups = useMemo(() => groupModelsByProvider(filteredModels), [filteredModels])

  return (
    <div>
      <SettingsSection title={t('models.visibility')}>
        <p className="text-[length:var(--fs-sm)] text-text-400 leading-relaxed">{t('models.visibilityDesc')}</p>

        <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border-200/50 bg-bg-100/50 transition-colors focus-within:border-border-200">
          <SearchIcon className="w-3.5 h-3.5 text-text-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('models.searchPlaceholder')}
            spellCheck={false}
            autoCorrect="off"
            autoComplete="off"
            autoCapitalize="off"
            className="flex-1 bg-transparent border-none outline-none text-[length:var(--fs-base)] text-text-100 placeholder:text-text-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/60 transition-colors"
              aria-label={t('models.clearSearch')}
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>

        <p className="text-[length:var(--fs-xs)] text-text-400">{t('models.keepOneEnabled')}</p>

        <div className="space-y-5">
          {isLoading ? (
            <div className="py-8 text-[length:var(--fs-sm)] text-text-400">{t('models.loading')}</div>
          ) : groups.length === 0 ? (
            <div className="py-8 text-[length:var(--fs-sm)] text-text-400">
              {query ? t('models.noResults') : t('models.empty')}
            </div>
          ) : (
            groups.map(group => {
              const providerModels = models.filter(model => model.providerName === group.providerName)
              const providerVisibleCount = providerModels.filter(
                model => !hiddenModelKeySet.has(getModelKey(model)),
              ).length
              const providerVisible = providerVisibleCount > 0

              return (
                <div
                  key={group.providerName}
                  className="rounded-xl border border-border-200/55 bg-bg-050/55 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border-200/50 bg-bg-100/35">
                    <div className="min-w-0">
                      <div className="text-[length:var(--fs-md)] font-semibold text-text-100 truncate">
                        {group.providerName}
                      </div>
                      <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5">
                        {t('models.providerCount', { count: providerModels.length })}
                      </div>
                    </div>
                    <Toggle
                      enabled={providerVisible}
                      ariaLabel={`${t('models.visibility')}: ${group.providerName}`}
                      onChange={() => {
                        const nextVisible = !providerVisible
                        if (!nextVisible && providerVisibleCount >= visibleCount) return
                        modelVisibilityStore.setManyVisible(providerModels, nextVisible)
                      }}
                    />
                  </div>

                  <div className="divide-y divide-border-200/40">
                    {group.models.map(model => {
                      const key = getModelKey(model)
                      const enabled = !hiddenModelKeySet.has(key)
                      const context = formatContext(model.contextLimit)

                      return (
                        <div
                          key={key}
                          onClick={() => {
                            if (enabled && visibleCount <= 1) return
                            modelVisibilityStore.setVisible(model, !enabled)
                          }}
                          className="w-full flex items-center justify-between gap-4 px-4 py-3 hover:bg-bg-100/35 transition-colors"
                        >
                          <button
                            type="button"
                            aria-pressed={enabled}
                            onClick={e => {
                              e.stopPropagation()
                              if (enabled && visibleCount <= 1) return
                              modelVisibilityStore.setVisible(model, !enabled)
                            }}
                            className="min-w-0 flex-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-main-100 rounded-md"
                          >
                            <div className="text-[length:var(--fs-md)] font-medium text-text-100 truncate">
                              {model.name}
                            </div>
                            <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5 truncate">
                              {model.id}
                              {context ? ` · ${context}` : ''}
                            </div>
                          </button>
                          <div className="shrink-0">
                            <Toggle
                              enabled={enabled}
                              ariaLabel={`${t('models.visibility')}: ${model.name}`}
                              onChange={() => {
                                if (enabled && visibleCount <= 1) return
                                modelVisibilityStore.setVisible(model, !enabled)
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </SettingsSection>
    </div>
  )
}
