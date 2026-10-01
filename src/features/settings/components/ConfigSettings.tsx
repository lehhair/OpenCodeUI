import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircleIcon,
  CheckIcon,
  CloseIcon,
  SettingsIcon,
  UndoIcon,
  GlobeIcon,
  CpuIcon,
  AgentIcon,
  KeyboardIcon,
  LayersIcon,
  PlugIcon,
  SunIcon,
  QuestionIcon,
  CogIcon,
} from '../../../components/Icons'
import { Dialog } from '../../../components/ui/Dialog'
import { SettingsSearch } from '../SettingsSearch'
import {
  getConfig,
  getGlobalConfig,
  getActiveModels,
  listAvailableShells,
  writeConfigDocument,
} from '../../../api'
import type { Config } from '../../../types/api/config'
import { useCurrentDirectory, useIsMobile } from '../../../hooks'
import { SettingsSection } from './SettingsUI'
import { validateConfig, validationDrillTargetForError, type ValidationDrillTarget, type ValidationError } from './configEditorValidation'
import { ValidationDrillTargetContext } from './configEditorDrillState'
import { DraftErrorContext, DraftNavigationContext, JsonDraftErrorContext } from './configEditorJsonDraft'
import { SECTION_IDS, SECTION_META } from './configEditorMeta'
import { buildConfigEditorSearchItems, type ConfigEditorSearchItem } from './configEditorSearch'
import { SectionRouter } from './configEditorSections'
import type { Choice, JsonRecord, SectionID } from './configEditorTypes'
import { clone, getObject, sameValue, tx } from './configEditorUtils'

const CONFIG_TAB_ICONS: Record<SectionID, React.ReactNode> = {
  general: <CogIcon size={15} />,
  server: <GlobeIcon size={15} />,
  providers: <CpuIcon size={15} />,
  agents: <AgentIcon size={15} />,
  commands: <KeyboardIcon size={15} />,
  skills: <LayersIcon size={15} />,
  plugins: <PlugIcon size={15} />,
  mcp: <PlugIcon size={15} />,
  permissions: <LayersIcon size={15} />,
  formatters: <CogIcon size={15} />,
  lsp: <GlobeIcon size={15} />,
  attachments: <LayersIcon size={15} />,
  runtime: <CpuIcon size={15} />,
  experimental: <SunIcon size={15} />,
  compatibility: <QuestionIcon size={15} />,
  advanced: <CogIcon size={15} />,
}

const CONFIG_SECTION_GROUPS: { en: string; zh: string; sections: SectionID[] }[] = [
  { en: 'Core', zh: '核心', sections: ['general', 'server'] },
  { en: 'Extensions', zh: '扩展', sections: ['commands', 'skills', 'plugins', 'providers', 'agents', 'mcp'] },
  { en: 'Tools', zh: '工具', sections: ['permissions', 'formatters', 'lsp'] },
  { en: 'Advanced', zh: '高级', sections: ['attachments', 'runtime', 'experimental', 'compatibility', 'advanced'] },
]

function ConfigEditorDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation('settings')
  const lang = i18n.language
  const directory = useCurrentDirectory()
  const isMobile = useIsMobile()
  const [section, setSection] = useState<SectionID>('general')
  const [config, setConfig] = useState<Config>({} as Config)
  const [original, setOriginal] = useState<Config>({} as Config)
  const [effective, setEffective] = useState<Config>({} as Config)
  const [shells, setShells] = useState<Choice[]>([])
  const [models, setModels] = useState<Choice[]>([])
  const [providerCatalog, setProviderCatalog] = useState<JsonRecord>({})
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [validationDrillTarget, setValidationDrillTarget] = useState<ValidationDrillTarget | null>(null)
  const [jsonDraftErrors, setJsonDraftErrors] = useState<Set<string>>(() => new Set())
  const [draftErrors, setDraftErrors] = useState<Set<string>>(() => new Set())
  const loadRequestRef = useRef(0)
  const saveRequestRef = useRef(0)
  const scrollRef = useRef<HTMLElement>(null)
  const searchHighlightFrameRef = useRef<number | null>(null)
  const searchHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = !sameValue(config, original)
  const busy = loading || validating || saving
  const deferredConfig = useDeferredValue(config)
  const searchItems = useMemo(() => buildConfigEditorSearchItems(deferredConfig as JsonRecord, lang), [deferredConfig, lang])

  const reportJsonDraftError = useCallback((id: string, invalid: boolean) => {
    setJsonDraftErrors(prev => {
      const next = new Set(prev)
      if (invalid) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const reportDraftError = useCallback((id: string, invalid: boolean) => {
    setDraftErrors(prev => {
      const next = new Set(prev)
      if (invalid) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const updateConfig = useCallback((next: Config) => {
    setConfig(next)
    setValidationErrors([])
  }, [])

  const canNavigate = useCallback(() => {
    if (jsonDraftErrors.size === 0 && draftErrors.size === 0) return true
    setError(tx('Fix the current invalid or unfinished editor before leaving it.', '离开当前页面前，请先修复无效或未完成的编辑框。', lang))
    return false
  }, [draftErrors, jsonDraftErrors, lang])

  const switchSection = (next: SectionID) => {
    if (!canNavigate()) return false
    setSection(next)
    setValidationDrillTarget(null)
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
    return true
  }

  const handleSectionKeyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    const index = SECTION_IDS.indexOf(section)
    const next = SECTION_IDS[(index + direction + SECTION_IDS.length) % SECTION_IDS.length]
    if (switchSection(next)) requestAnimationFrame(() => document.getElementById(`config-tab-${next}`)?.focus())
  }
  const activePanelId = `config-panel-${section}`

  useEffect(() => {
    if (!isOpen) return
    const frameId = requestAnimationFrame(() => {
      document.getElementById(`config-tab-${section}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(frameId)
  }, [isOpen, section])

  const requestClose = () => {
    if (saving || validating) return
    if (dirty && !window.confirm(t('config.discardChangesConfirm'))) return
    onClose()
  }

  const load = useCallback(async () => {
    if (!isOpen) return
    const request = ++loadRequestRef.current
    saveRequestRef.current += 1
    setLoading(true)
    setValidating(false)
    setSaving(false)
    setConfig({} as Config)
    setOriginal({} as Config)
    setEffective({} as Config)
    setError(null)
    setSchemaWarning(null)
    setValidationErrors([])
    setValidationDrillTarget(null)
    try {
      const [global, nextEffective, shellList, providerModels] = await Promise.all([
        getGlobalConfig(),
        getConfig(directory),
        listAvailableShells(directory).catch(() => []),
        // v2 删除了 config.providers()，模型清单改由 model.list() 提供
        getActiveModels(directory).catch(() => []),
      ])

      const modelChoices: Choice[] = providerModels.map(model => ({
        value: `${model.providerId}/${model.id}`,
        label: `${model.providerId}/${model.id}`,
      }))

      if (request !== loadRequestRef.current) return
      setOriginal(clone(global))
      setConfig(clone(global))
      setJsonDraftErrors(new Set())
      setDraftErrors(new Set())
      setEffective(nextEffective)
      // v2 没有 provider 目录接口，这里留空（仅供 provider 元信息展示的旧路径）
      setProviderCatalog({})
      setShells([
        { value: '', label: t('config.shellAuto') },
        ...shellList.map((shell: { path: string; name: string; acceptable: boolean }) => ({
          value: shell.name === shell.path ? shell.path : shell.name,
          label: shell.name,
          hint: shell.path,
          disabled: !shell.acceptable,
        })),
      ])
      setModels(modelChoices)
    } catch (err) {
      if (request !== loadRequestRef.current) return
      setError(err instanceof Error ? err.message : t('config.loadFailed'))
    } finally {
      if (request === loadRequestRef.current) setLoading(false)
    }
  }, [directory, isOpen, t])

  useEffect(() => {
    if (isOpen) void load()
    else {
      loadRequestRef.current += 1
      saveRequestRef.current += 1
    }
  }, [isOpen, load])

  useEffect(() => {
    if (isOpen) return
    if (searchHighlightFrameRef.current !== null) {
      cancelAnimationFrame(searchHighlightFrameRef.current)
      searchHighlightFrameRef.current = null
    }
    if (searchHighlightTimerRef.current) {
      clearTimeout(searchHighlightTimerRef.current)
      searchHighlightTimerRef.current = null
    }
    scrollRef.current?.querySelector('.settings-search-highlight')?.classList.remove('settings-search-highlight')
  }, [isOpen])

  useEffect(
    () => () => {
      if (searchHighlightFrameRef.current !== null) cancelAnimationFrame(searchHighlightFrameRef.current)
      if (searchHighlightTimerRef.current) clearTimeout(searchHighlightTimerRef.current)
    },
    [],
  )

  const save = async () => {
    const request = ++saveRequestRef.current
    setError(null)
    setValidationErrors([])
    setValidationDrillTarget(null)
    if (jsonDraftErrors.size > 0 || draftErrors.size > 0) {
      setError(tx('Fix invalid or unfinished editors before saving.', '保存前请先修复无效或未完成的编辑框。', lang))
      return
    }
    const snapshot = clone(config)
    setValidating(true)
    let officialResult: { errors: ValidationError[]; unavailable?: string }
    try {
      const { validateAgainstOfficialConfigSchema } = await import('./configOfficialValidator')
      officialResult = await validateAgainstOfficialConfigSchema(snapshot)
    } catch (error) {
      officialResult = { errors: [], unavailable: error instanceof Error ? error.message : String(error) }
    } finally {
      if (request === saveRequestRef.current) setValidating(false)
    }
    if (request !== saveRequestRef.current) return
    const schemaUnavailableMessage = officialResult.unavailable
      ? tx(
          'Official schema could not be loaded; this save relies on OpenCode server validation.',
          '无法加载官方 schema；本次保存将依赖 OpenCode 服务端校验。',
          lang,
        )
      : null
    setSchemaWarning(schemaUnavailableMessage)
    const nextValidationErrors = [...officialResult.errors, ...validateConfig(snapshot, lang, original)]
    if (nextValidationErrors.length > 0) {
      setValidationErrors(nextValidationErrors)
      return
    }
    setSaving(true)
    try {
      // v2 的 config.update 只接受 { shell }，任意字段的保存没有 API。
      // 原生做法是直接把合并结果写回配置文档文件（见 api/config 的说明）。
      const savedPath = await writeConfigDocument(snapshot, directory)
      if (request !== saveRequestRef.current) return
      const saved = await getGlobalConfig().catch(() => snapshot)
      setOriginal(clone(saved))
      setConfig(current => (sameValue(current, snapshot) ? clone(saved) : current))
      setSchemaWarning(
        tx(
          `Saved to ${savedPath}. Note: v2 has no field-level config API, so the file is rewritten as plain JSON — comments and original formatting are lost.`,
          `已保存到 ${savedPath}。注意：v2 没有字段级配置接口，此操作会以纯 JSON 重写文件，注释与原始排版会丢失。`,
          lang,
        ),
      )
      try {
        const nextEffective = await getConfig(directory)
        if (request !== saveRequestRef.current) return
        setEffective(nextEffective)
      } catch (refreshError) {
        if (request !== saveRequestRef.current) return
        setError(tx('Config was saved, but the effective config could not be refreshed.', '配置已保存，但无法刷新生效配置。', lang))
        console.warn('[ConfigSettings] Failed to refresh effective config after save:', refreshError)
      }
    } catch (err) {
      if (request !== saveRequestRef.current) return
      setError(err instanceof Error ? err.message : t('config.saveFailed'))
    } finally {
      if (request === saveRequestRef.current) setSaving(false)
    }
  }

  const agents = useMemo(() => {
    const names = new Set([
      'build',
      'plan',
      'general',
      'explore',
      ...Object.keys(getObject(config, 'agent')),
      ...Object.keys(getObject(effective, 'agent')),
    ])
    return Array.from(names)
      .sort()
      .map(value => ({ value, label: value }))
  }, [config, effective])

  const openValidationError = (error: ValidationError) => {
    if (!canNavigate()) return
    const target = validationDrillTargetForError(error)
    setSection(target.section)
    setValidationDrillTarget({ ...target, key: `${error.path}:${Date.now()}` })
  }

  const openSearchItem = (item: ConfigEditorSearchItem) => {
    if (!canNavigate()) return false
    setSection(item.section)
    setValidationDrillTarget({
      section: item.section,
      stack: item.stack,
      key: `search:${item.id}:${Date.now()}`,
    })
    if (searchHighlightFrameRef.current !== null) cancelAnimationFrame(searchHighlightFrameRef.current)
    if (searchHighlightTimerRef.current) clearTimeout(searchHighlightTimerRef.current)

    searchHighlightFrameRef.current = requestAnimationFrame(() => {
      searchHighlightFrameRef.current = requestAnimationFrame(() => {
        searchHighlightFrameRef.current = null
        const fieldTargets = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-config-field]') ?? [])
        const matchingFields = item.fieldKey
          ? fieldTargets.filter(candidate => candidate.dataset.configField === item.fieldKey)
          : []
        const fieldTarget = matchingFields[matchingFields.length - 1]
        const target = fieldTarget ?? scrollRef.current?.querySelector<HTMLElement>(`[data-config-section="${item.section}"]`)
        if (!target) return

        scrollRef.current?.querySelector('.settings-search-highlight')?.classList.remove('settings-search-highlight')
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        target.classList.add('settings-search-highlight')
        if (fieldTarget) {
          const focusTarget = Array.from(
            fieldTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([type="hidden"]):not([tabindex="-1"]), select:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled):not([tabindex="-1"])',
            ),
          ).find(candidate => !candidate.closest('[hidden], .hidden, [aria-hidden="true"]'))
          if (focusTarget) focusTarget.focus({ preventScroll: true })
        }
        if (!fieldTarget || !target.contains(document.activeElement)) {
          target.tabIndex = -1
          target.focus({ preventScroll: true })
          target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
        }
        searchHighlightTimerRef.current = setTimeout(() => {
          target.classList.remove('settings-search-highlight')
          searchHighlightTimerRef.current = null
        }, 1800)
      })
    })
    return true
  }

  const configSearch = (
    <SettingsSearch
      items={searchItems}
      placeholder={t('config.searchPlaceholder')}
      clearLabel={t('config.clearSearch')}
      noResultsLabel={t('config.noResults')}
      onSelect={openSearchItem}
    />
  )

  const statusBanner = (
    <>
      {error && (
        <div className="mb-3 break-words rounded-lg bg-error-100/10 px-3 py-2 text-[length:var(--fs-xs)] text-error-100">{error}</div>
      )}
      {schemaWarning && (
        <div className="mb-3 break-words rounded-lg bg-warning-100/10 px-3 py-2 text-[length:var(--fs-xs)] text-warning-100">
          {schemaWarning}
        </div>
      )}
      {validationErrors.length > 0 && (
        <div className="mb-3 max-h-32 overflow-y-auto rounded-lg bg-error-100/10 px-3 py-2 text-[length:var(--fs-xs)] text-error-100 custom-scrollbar">
          <div className="mb-1 font-medium">{t('config.validationFailed', { defaultValue: 'Config validation failed' })}</div>
          <div className="space-y-1">
            {validationErrors.slice(0, 12).map(item => (
              <button
                key={`${item.path}:${item.message}`}
                type="button"
                onClick={() => openValidationError(item)}
                className="block min-w-0 break-words text-left hover:underline"
              >
                <span className="break-all font-mono">{item.path}</span>: {item.message}
              </button>
            ))}
            {validationErrors.length > 12 && (
              <div>{tx(`${validationErrors.length - 12} more issue(s)…`, `还有 ${validationErrors.length - 12} 个问题…`, lang)}</div>
            )}
          </div>
        </div>
      )}
      {loading && (
        <div className="mb-3 rounded-lg bg-bg-100/50 px-3 py-2 text-[length:var(--fs-xs)] text-text-400">{t('config.loading')}</div>
      )}
    </>
  )

  const actionButtons = (
    <div className="flex items-center gap-1.5">
      {dirty && <span className="mr-1 hidden text-[length:var(--fs-xs)] text-warning-100 sm:inline">{t('config.unsaved')}</span>}
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => updateConfig(clone(original))}
        className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-[length:var(--fs-xs)] text-text-300 transition-colors hover:bg-bg-200/70 hover:text-text-100 disabled:opacity-40"
      >
        <UndoIcon size={13} />
        {t('config.reset')}
      </button>
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={save}
        className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-accent-main-100 px-2.5 text-[length:var(--fs-xs)] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <CheckIcon size={13} />
        {saving ? t('config.saving') : validating ? tx('Validating…', '校验中…', lang) : t('config.saveAll')}
      </button>
    </div>
  )

  if (isMobile) {
    return (
      <Dialog
        isOpen={isOpen}
        onClose={requestClose}
        rawContent
        width="100%"
        className="h-full"
        showCloseButton={false}
        ariaLabel={t('config.editorTitle')}
      >
         <JsonDraftErrorContext.Provider value={reportJsonDraftError}>
          <DraftErrorContext.Provider value={reportDraftError}>
            <DraftNavigationContext.Provider value={canNavigate}>
              <ValidationDrillTargetContext.Provider value={validationDrillTarget}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 pt-2">
                <div className="px-3 pb-2">{configSearch}</div>
                <div
                  role="tablist"
                  aria-label={t('config.editorTitle')}
                  onKeyDown={handleSectionKeyDown}
                  className="flex items-center gap-1 overflow-x-auto px-3 pb-2 scrollbar-none"
                >
                  {SECTION_IDS.map(id => {
                    const active = section === id
                    return (
                      <button
                        key={id}
                        id={`config-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`config-panel-${id}`}
                        tabIndex={active ? 0 : -1}
                        onClick={() => switchSection(id)}
                        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[length:var(--fs-md)] font-medium transition-colors ${
                          active ? 'bg-bg-100/80 text-text-100' : 'text-text-400 active:bg-bg-100/40'
                        }`}
                      >
                        {CONFIG_TAB_ICONS[id]}
                        {tx(SECTION_META[id].en, SECTION_META[id].zh, lang)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <main ref={scrollRef} id={activePanelId} role="tabpanel" aria-labelledby={`config-tab-${section}`} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3 custom-scrollbar overscroll-contain">
                {statusBanner}
                {!loading && <div inert={busy} aria-busy={busy}>
                  <SectionRouter
                    section={section}
                    config={config}
                    setConfig={updateConfig}
                    lang={lang}
                    shells={shells}
                    models={models}
                    agents={agents}
                    providerCatalog={providerCatalog}
                  />
                </div>}
              </main>

              <div className="shrink-0 px-4 py-3">
                <div className="flex min-w-0 gap-2">
                  <button
                    type="button"
                    disabled={!dirty || busy}
                    onClick={() => updateConfig(clone(original))}
                    className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[length:var(--fs-sm)] font-medium text-text-300 transition-colors hover:bg-bg-100/70 hover:text-text-100 disabled:opacity-40"
                  >
                    <UndoIcon size={14} />
                    {t('config.reset')}
                  </button>
                  <button
                    type="button"
                    disabled={!dirty || busy}
                    onClick={save}
                    className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent-main-100 px-3 py-2 text-[length:var(--fs-sm)] font-medium text-white transition-opacity disabled:opacity-40"
                  >
                    <CheckIcon size={14} />
                    {saving ? t('config.saving') : validating ? tx('Validating…', '校验中…', lang) : t('config.saveAll')}
                  </button>
                </div>
              </div>
            </div>
              </ValidationDrillTargetContext.Provider>
            </DraftNavigationContext.Provider>
          </DraftErrorContext.Provider>
        </JsonDraftErrorContext.Provider>
      </Dialog>
    )
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={requestClose}
      rawContent
      width="min(97vw, 1040px)"
      showCloseButton={false}
      ariaLabel={t('config.editorTitle')}
    >
       <JsonDraftErrorContext.Provider value={reportJsonDraftError}>
        <DraftErrorContext.Provider value={reportDraftError}>
          <DraftNavigationContext.Provider value={canNavigate}>
            <ValidationDrillTargetContext.Provider value={validationDrillTarget}>
          <div className="relative flex h-[min(90vh,820px)]">
            <button
              type="button"
              onClick={requestClose}
              className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md text-text-400/60 transition-colors hover:bg-bg-200/70 hover:text-text-200"
              aria-label={t('closeSettings')}
              title={t('closeSettings')}
            >
              <CloseIcon size={16} />
            </button>

            <nav
              aria-label={t('config.editorTitle')}
              className="flex min-h-0 w-[204px] shrink-0 flex-col pb-3 pl-6 pr-3 pt-10 xl:w-[228px] xl:pl-7"
            >
              <div className="mb-3 shrink-0">{configSearch}</div>
              <div
                role="tablist"
                aria-orientation="vertical"
                aria-label={t('config.editorTitle')}
                onKeyDown={handleSectionKeyDown}
                className="min-h-0 flex-1 space-y-3.5 overflow-y-auto pb-2 scrollbar-none"
              >
                {CONFIG_SECTION_GROUPS.map(group => (
                  <div key={group.en}>
                    <div className="mb-1.5 px-2.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-400/75">
                      {tx(group.en, group.zh, lang)}
                    </div>
                    <div className="space-y-0.5">
                      {group.sections.map(id => {
                        const active = section === id
                        return (
                          <button
                            key={id}
                            id={`config-tab-${id}`}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            aria-controls={`config-panel-${id}`}
                            tabIndex={active ? 0 : -1}
                            onClick={() => switchSection(id)}
                            className={`flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[length:var(--fs-md)] font-medium transition-colors ${
                              active ? 'bg-bg-200/70 text-text-100' : 'text-text-300 hover:bg-bg-200/40 hover:text-text-100'
                            }`}
                          >
                            <span className={active ? 'text-accent-main-100' : 'text-text-400'}>{CONFIG_TAB_ICONS[id]}</span>
                            <span className="truncate">{tx(SECTION_META[id].en, SECTION_META[id].zh, lang)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </nav>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <main ref={scrollRef} id={activePanelId} role="tabpanel" aria-labelledby={`config-tab-${section}`} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-7 pb-8 pt-10 custom-scrollbar xl:px-8">
                {statusBanner}
                {!loading && <div inert={busy} aria-busy={busy}>
                  <SectionRouter
                    section={section}
                    config={config}
                    setConfig={updateConfig}
                    lang={lang}
                    shells={shells}
                    models={models}
                    agents={agents}
                    providerCatalog={providerCatalog}
                  />
                </div>}
              </main>
              <div className="flex shrink-0 justify-end px-7 py-3 xl:px-8">
                {actionButtons}
              </div>
            </div>
          </div>
            </ValidationDrillTargetContext.Provider>
          </DraftNavigationContext.Provider>
        </DraftErrorContext.Provider>
      </JsonDraftErrorContext.Provider>
    </Dialog>
  )
}

export function ConfigSettings() {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  return (
    <div>
      <SettingsSection
        title={t('config.sourceTitle')}
        description={t('config.sourceDesc')}
        actions={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[length:var(--fs-sm)] font-medium text-accent-main-100 transition-colors hover:bg-accent-main-100/10"
          >
            <SettingsIcon size={14} />
            {t('config.openEditor')}
          </button>
        }
      >
        <div className="flex items-start gap-2.5 rounded-lg border border-warning-100/20 bg-warning-bg/40 px-3.5 py-3 text-[length:var(--fs-sm)] leading-relaxed text-text-300">
          <AlertCircleIcon size={14} className="mt-0.5 shrink-0 text-warning-100" />
          <span>{t('config.sdkOnlyWarning')}</span>
        </div>
      </SettingsSection>
      <ConfigEditorDialog isOpen={open} onClose={() => setOpen(false)} />
    </div>
  )
}
