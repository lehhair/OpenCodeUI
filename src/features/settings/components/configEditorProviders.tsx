import { useState } from 'react'
import { ChevronRightIcon, PlusIcon } from '../../../components/Icons'
import { DrillChild, DrillRow } from './configEditorDrill'
import { useDrillContainer, useDrillState } from './configEditorDrillState'
import { BoolField, fieldClass, KeyValueField, NumberField, NumberOrFalseField, PositiveIntegerField, Select, StringListField, StringMapField, TextField } from './configEditorControls'
import { DrillFields, DuplicateIdField, EmptyHint, FieldRow, GroupedFields, GroupHeader, SectionShell, type FieldDef } from './configEditorFields'
import { MODALITIES, MODEL_STATUS } from './configEditorMeta'
import { enumChoices, type SectionProps } from './configEditorSectionTypes'
import type { JsonRecord, Lang } from './configEditorTypes'
import { asStringArray, clone, getObject, hasOwn, isRecord, previewValue, setNested, tx } from './configEditorUtils'

export function ProvidersSection({ config, setConfig, lang, providerCatalog }: SectionProps) {
  return (
    <SectionShell id="providers" lang={lang}>
      <ProvidersHome config={config} setConfig={setConfig} lang={lang} providerCatalog={providerCatalog} />
    </SectionShell>
  )
}

type ProviderViewProps = Pick<SectionProps, 'config' | 'setConfig' | 'lang' | 'providerCatalog'>

function ProvidersHome({ config, setConfig, lang, providerCatalog }: ProviderViewProps) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const providerMap = getObject(config, 'providers')
  const configured = Object.keys(providerMap).sort()
  const available = Object.keys(providerCatalog).filter(id => !hasOwn(providerMap, id)).sort()
  const [newProvider, setNewProvider] = useState('')
  const [availQuery, setAvailQuery] = useState('')

  const openProvider = (id: string) => enter({ id: `provider:${id}`, title: id })

  const addProvider = (id: string) => {
    if (!id || hasOwn(providerMap, id)) return
    setConfig(setNested(config, ['providers', id], { id }))
    openProvider(id)
  }

  if (activeChildId?.startsWith('provider:')) {
    const id = activeChildId.slice('provider:'.length)
    return (
      <DrillChild depth={depth}>
        <ProviderDetail config={config} setConfig={setConfig} lang={lang} providerCatalog={providerCatalog} providerId={id} />
      </DrillChild>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <GroupHeader text={tx('Configured', '已配置', lang)} count={configured.length} accent />
        {configured.length === 0 ? (
          <EmptyHint text={tx('No custom providers. Add one below or pick from Available.', '没有自定义渠道。可在下方添加，或从可配置里选。', lang)} />
        ) : (
          <div className="divide-y divide-border-200/35">
            {configured.map(id => {
              const pv = getObject(providerMap, id)
              const modelCount = Object.keys(getObject(pv, 'models')).length
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => openProvider(id)}
                  className="group grid w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 py-3 text-left"
                >
                  <span className="min-w-0 truncate text-[length:var(--fs-sm)] font-medium text-text-100">{id}</span>
                  <span className="shrink-0 truncate text-[length:var(--fs-xs)] text-text-400">
                    {modelCount > 0
                      ? tx(`${modelCount} model override(s)`, `${modelCount} 个模型覆盖`, lang)
                      : tx('provider config', '渠道配置', lang)}
                  </span>
                  <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-3 flex min-w-0 items-center gap-2">
          <input
            value={newProvider}
            onChange={event => setNewProvider(event.target.value)}
            placeholder={tx('custom provider id', '自定义渠道 id', lang)}
            onKeyDown={event => {
              if (event.key === 'Enter' && newProvider.trim() && !hasOwn(providerMap, newProvider.trim())) {
                addProvider(newProvider.trim())
                setNewProvider('')
              }
            }}
            className={`${fieldClass} min-w-0 flex-1 font-mono`}
          />
          <button
            type="button"
            disabled={!newProvider.trim() || hasOwn(providerMap, newProvider.trim())}
            onClick={() => {
              addProvider(newProvider.trim())
              setNewProvider('')
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border-200 px-2.5 text-[length:var(--fs-sm)] font-medium text-text-100 transition-colors hover:border-border-300 disabled:opacity-40"
          >
            <PlusIcon size={14} />
            {tx('Add', '添加', lang)}
          </button>
        </div>
        <div className="mt-2 text-[length:var(--fs-xs)] leading-relaxed text-text-400">
          {tx(
            'Provider keys cannot be reliably deleted through the official merge API. Use enabled_providers/disabled_providers when you need to control availability.',
            '官方 merge API 不能可靠删除已保存的 provider key。需要控制可用性时请使用 enabled_providers/disabled_providers。',
            lang,
          )}
        </div>
      </section>

      <section>
        <GroupHeader text={tx('Available', '可配置', lang)} count={available.length} />
        <input
          value={availQuery}
          onChange={event => setAvailQuery(event.target.value)}
          placeholder={tx('search providers…', '搜索渠道…', lang)}
          className={`${fieldClass} mb-2`}
        />
        <div className="max-h-72 divide-y divide-border-200/25 overflow-y-auto custom-scrollbar">
          {available
            .filter(id => !availQuery || id.toLowerCase().includes(availQuery.toLowerCase()))
            .slice(0, 80)
            .map(id => (
              <button
                key={id}
                type="button"
                onClick={() => addProvider(id)}
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="min-w-0 truncate text-[length:var(--fs-sm)] text-text-200">{id}</span>
                <PlusIcon size={14} className="shrink-0 text-text-300" />
              </button>
            ))}
        </div>
      </section>
    </div>
  )
}

function ProviderDetail({
  config,
  setConfig,
  lang,
  providerCatalog,
  providerId,
}: ProviderViewProps & { providerId: string }) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const drill = useDrillState()
  const providerMap = getObject(config, 'providers')
  const providerValue = getObject(providerMap, providerId)
  const catalog = getObject(providerCatalog, providerId)
  const configuredModels = getObject(providerValue, 'models')
  const catalogModelCount = Object.keys(getObject(catalog, 'models')).length
  const setProvider = (next: JsonRecord) => setConfig(setNested(config, ['providers', providerId], next))

  const fields: FieldDef[] = [
    { key: 'name', label: 'name', desc: tx('Display name for this provider.', '此渠道的显示名称。', lang), control: <TextField value={providerValue.name} onChange={v => setProvider({ ...providerValue, name: v })} /> },
    { key: 'npm', label: 'npm', desc: tx('npm package implementing the AI SDK provider.', '实现该 AI SDK provider 的 npm 包。', lang), control: <TextField value={providerValue.npm} onChange={v => setProvider({ ...providerValue, npm: v })} mono /> },
    { key: 'api', label: 'api', desc: tx('API base identifier for this provider.', '该渠道的 API 标识。', lang), control: <TextField value={providerValue.api} onChange={v => setProvider({ ...providerValue, api: v })} mono /> },
    { key: 'id', label: 'id', desc: tx('Provider id override.', '渠道 id 覆盖。', lang), control: <TextField value={providerValue.id} onChange={v => setProvider({ ...providerValue, id: v })} mono /> },
    { key: 'env', label: 'env', desc: tx('Environment variables that hold the API key.', '存放 API key 的环境变量名。', lang), control: <StringListField value={providerValue.env} onChange={v => setProvider({ ...providerValue, env: v })} mono /> },
    { key: 'whitelist', label: 'whitelist', desc: tx('Only expose these models from this provider.', '只暴露该渠道的这些模型。', lang), control: <StringListField value={providerValue.whitelist} onChange={v => setProvider({ ...providerValue, whitelist: v })} mono /> },
    { key: 'blacklist', label: 'blacklist', desc: tx('Hide these models from this provider.', '隐藏该渠道的这些模型。', lang), control: <StringListField value={providerValue.blacklist} onChange={v => setProvider({ ...providerValue, blacklist: v })} mono /> },
    { key: 'options', label: 'options', desc: tx('Connection options (API key, base URL, timeouts, headers).', '连接选项（API key、base URL、超时、请求头）。', lang), drill: { title: 'options', preview: previewValue(providerValue.options, lang), render: () => <ProviderOptionsEditor value={providerValue.options} onChange={v => setProvider({ ...providerValue, options: v })} lang={lang} /> } },
  ]

  if (activeChildId === 'models') {
    return (
      <DrillChild depth={depth}>
        <ProviderModels config={config} setConfig={setConfig} lang={lang} providerCatalog={providerCatalog} providerId={providerId} />
      </DrillChild>
    )
  }
  if (activeChildId) {
    const active = fields.find(field => field.drill && field.key === activeChildId)
    if (active?.drill) return <DrillChild depth={depth}>{active.drill.render()}</DrillChild>
  }

  return (
    <div className="space-y-6">
      <DuplicateIdField
        sourceId={providerId}
        existing={{ ...providerCatalog, ...providerMap }}
        lang={lang}
        onCopy={targetId => {
          setConfig(setNested(config, ['providers', targetId], { ...clone(providerValue), id: providerValue.id ?? providerId }))
          drill.replace(0, { id: `provider:${targetId}`, title: targetId })
        }}
      />

      <button
        type="button"
        onClick={() => enter({ id: 'models', title: tx('models', '模型', lang) })}
        className="group grid w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-3 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="text-[length:var(--fs-sm)] font-medium text-text-100">models</div>
          <div className="mt-0.5 text-[length:var(--fs-xs)] text-text-300">
            {tx(
              `${Object.keys(configuredModels).length} configured / ${catalogModelCount} available`,
              `已配置 ${Object.keys(configuredModels).length} 个 / 可选 ${catalogModelCount} 个`,
              lang,
            )}
          </div>
        </div>
        <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
      </button>

      <GroupedFields
        fields={fields}
        isConfigured={key => key in providerValue}
        lang={lang}
        onEnter={field => field.drill && enter({ id: field.key, title: field.drill.title })}
      />
    </div>
  )
}

function ProviderModels({
  config,
  setConfig,
  lang,
  providerCatalog,
  providerId,
}: ProviderViewProps & { providerId: string }) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const drill = useDrillState()
  const providerMap = getObject(config, 'providers')
  const providerValue = getObject(providerMap, providerId)
  const catalog = getObject(providerCatalog, providerId)
  const configuredModels = getObject(providerValue, 'models')
  const catalogModels = getObject(catalog, 'models')
  const modelIDs = Array.from(new Set([...Object.keys(configuredModels), ...Object.keys(catalogModels)])).sort()
  const [newModel, setNewModel] = useState('')
  const [query, setQuery] = useState('')

  const openModel = (id: string) => enter({ id: `model:${id}`, title: id })

  const addModel = (id: string) => {
    if (!id || hasOwn(configuredModels, id)) return
    setConfig(setNested(config, ['providers', providerId, 'models', id], { id }))
    openModel(id)
  }

  if (activeChildId?.startsWith('model:')) {
    const id = activeChildId.slice('model:'.length)
    const modelValue = isRecord(configuredModels[id]) ? (configuredModels[id] as JsonRecord) : {}
    const existingModels = Object.fromEntries(modelIDs.map(modelId => [modelId, true]))
    return (
      <DrillChild depth={depth}>
        <div className="space-y-6">
          {drill.stack.length === depth + 1 && (
            <DuplicateIdField
              sourceId={id}
              existing={existingModels}
              lang={lang}
              onCopy={targetId => {
                setConfig(setNested(config, ['providers', providerId, 'models', targetId], { ...clone(modelValue), id: modelValue.id ?? id }))
                drill.replace(depth, { id: `model:${targetId}`, title: targetId })
              }}
            />
          )}
          <ModelEditor
            value={modelValue}
            onChange={next => setConfig(setNested(config, ['providers', providerId, 'models', id], next))}
            lang={lang}
          />
        </div>
      </DrillChild>
    )
  }

  const filtered = modelIDs.filter(id => !query || id.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="space-y-3">
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder={tx('search models…', '搜索模型…', lang)} className={fieldClass} />
      <div className="max-h-[440px] divide-y divide-border-200/35 overflow-y-auto custom-scrollbar">
        {filtered.length === 0 && <EmptyHint text={tx('No models. Add one below.', '没有模型，可在下方添加。', lang)} />}
        {filtered.map(id => {
          const isConfigured = hasOwn(configuredModels, id)
          return (
            <button
              key={id}
              type="button"
              onClick={() => openModel(id)}
              className="group grid w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 py-3 text-left"
            >
              <span className="min-w-0 truncate text-[length:var(--fs-sm)] font-medium text-text-100">{id}</span>
              <span className={`shrink-0 text-[length:var(--fs-xs)] ${isConfigured ? 'text-text-300' : 'text-text-400'}`}>
                {isConfigured ? tx('configured', '已配置', lang) : tx('available', '可配置', lang)}
              </span>
              <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
            </button>
          )
        })}
      </div>
      <div className="flex min-w-0 gap-2">
        <input
          value={newModel}
          onChange={event => setNewModel(event.target.value)}
          placeholder={tx('new model id', '新模型 id', lang)}
          onKeyDown={event => {
            if (event.key === 'Enter' && newModel.trim() && !hasOwn(configuredModels, newModel.trim())) {
              addModel(newModel.trim())
              setNewModel('')
            }
          }}
          className={`${fieldClass} min-w-0 flex-1 font-mono`}
        />
        <button
          type="button"
          disabled={!newModel.trim() || hasOwn(configuredModels, newModel.trim())}
          onClick={() => {
            addModel(newModel.trim())
            setNewModel('')
          }}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[length:var(--fs-sm)] font-medium text-accent-main-100 transition-colors hover:bg-accent-main-100/10 disabled:opacity-40"
        >
          <PlusIcon size={14} />
          {tx('Add', '添加', lang)}
        </button>
      </div>
      <div className="text-[length:var(--fs-xs)] leading-relaxed text-text-400">
        {tx('Model override keys cannot be reliably deleted through the official merge API. Edit fields instead, or Reset before saving newly added model ids.', '官方 merge API 不能可靠删除已保存的模型覆盖 key。请改字段，刚新增的模型 id 可在保存前 Reset。', lang)}
      </div>
    </div>
  )
}

function ProviderOptionsEditor({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const rec = isRecord(value) ? value : {}
  const known = ['apiKey', 'baseURL', 'enterpriseUrl', 'setCacheKey', 'timeout', 'headerTimeout', 'chunkTimeout', 'headers']
  const fields: FieldDef[] = [
    { key: 'apiKey', label: 'apiKey', desc: tx('API key for this provider.', '该渠道的 API key。', lang), control: <TextField value={rec.apiKey} onChange={v => onChange({ ...rec, apiKey: v })} mono /> },
    { key: 'baseURL', label: 'baseURL', desc: tx('Custom API base URL.', '自定义 API base URL。', lang), control: <TextField value={rec.baseURL} onChange={v => onChange({ ...rec, baseURL: v })} mono /> },
    { key: 'enterpriseUrl', label: 'enterpriseUrl', desc: tx('GitHub Enterprise URL for copilot auth.', '用于 copilot 认证的 GitHub Enterprise URL。', lang), control: <TextField value={rec.enterpriseUrl} onChange={v => onChange({ ...rec, enterpriseUrl: v })} mono /> },
    { key: 'setCacheKey', label: 'setCacheKey', desc: tx('Enable promptCacheKey for this provider (default false).', '为该渠道启用 promptCacheKey（默认 false）。', lang), control: <BoolField value={rec.setCacheKey} onChange={v => onChange({ ...rec, setCacheKey: v })} /> },
    { key: 'timeout', label: 'timeout', desc: tx('Request timeout in ms. Set false to disable timeout.', '整个请求的超时（毫秒）。设为 false 可禁用超时。', lang), control: <NumberOrFalseField value={rec.timeout} onChange={v => onChange({ ...rec, timeout: v })} /> },
    { key: 'headerTimeout', label: 'headerTimeout', desc: tx('Timeout in ms waiting for response headers. Set false to disable timeout.', '等待响应头的超时（毫秒）。设为 false 可禁用超时。', lang), control: <NumberOrFalseField value={rec.headerTimeout} onChange={v => onChange({ ...rec, headerTimeout: v })} /> },
    { key: 'chunkTimeout', label: 'chunkTimeout', desc: tx('Timeout in ms between streamed SSE chunks.', 'SSE 流式分块之间的超时（毫秒）。', lang), control: <PositiveIntegerField value={rec.chunkTimeout} onChange={v => onChange({ ...rec, chunkTimeout: v })} /> },
    { key: 'headers', label: 'headers', desc: tx('Extra HTTP headers sent to the provider.', '发送给渠道的额外 HTTP 请求头。', lang), drill: { title: 'headers', preview: previewValue(rec.headers, lang), render: () => <StringMapField value={rec.headers} onChange={v => onChange({ ...rec, headers: v })} /> } },
  ]
  const extra = Object.keys(rec).filter(key => !known.includes(key))
  const knownPart = Object.fromEntries(Object.entries(rec).filter(([key]) => known.includes(key)))
  return (
    <div className="space-y-3">
      <DrillFields fields={fields} isConfigured={key => key in rec} lang={lang} />
      {extra.length > 0 && (
        <FieldRow
          label={tx('other options', '其他选项', lang)}
          block
          control={<KeyValueField value={Object.fromEntries(extra.map(k => [k, rec[k]]))} onChange={next => onChange({ ...knownPart, ...next })} />}
        />
      )}
    </div>
  )
}

function ModelEditor({ value, onChange, lang }: { value: JsonRecord; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const cost = getObject(value, 'cost')
  const contextOver200k = getObject(cost, 'context_over_200k')
  const limit = getObject(value, 'limit')
  const modalities = getObject(value, 'modalities')
  const costMissing = ['input', 'output'].filter(key => cost[key] === undefined)
  const contextOverMissing = Object.keys(contextOver200k).length > 0 ? ['input', 'output'].filter(key => contextOver200k[key] === undefined) : []
  const limitMissing = ['context', 'output'].filter(key => limit[key] === undefined)
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v })
  const fields: FieldDef[] = [
    { key: 'id', label: 'id', desc: tx('Provider-native model id override.', '渠道原生模型 id 覆盖。', lang), control: <TextField value={value.id} onChange={v => set('id', v)} mono /> },
    { key: 'name', label: 'name', desc: tx('Display name for the model.', '模型显示名。', lang), control: <TextField value={value.name} onChange={v => set('name', v)} /> },
    { key: 'family', label: 'family', desc: tx('Model family/series.', '模型系列。', lang), control: <TextField value={value.family} onChange={v => set('family', v)} /> },
    { key: 'release_date', label: 'release_date', desc: tx('Release date (YYYY-MM-DD).', '发布日期（YYYY-MM-DD）。', lang), control: <TextField value={value.release_date} onChange={v => set('release_date', v)} placeholder="2025-01-01" /> },
    { key: 'attachment', label: 'attachment', desc: tx('Model supports file attachments.', '模型支持文件附件。', lang), control: <BoolField value={value.attachment} onChange={v => set('attachment', v)} /> },
    { key: 'reasoning', label: 'reasoning', desc: tx('Model supports reasoning / thinking.', '模型支持推理/思考。', lang), control: <BoolField value={value.reasoning} onChange={v => set('reasoning', v)} /> },
    { key: 'temperature', label: 'temperature', desc: tx('Model supports a temperature parameter.', '模型支持 temperature 参数。', lang), control: <BoolField value={value.temperature} onChange={v => set('temperature', v)} /> },
    { key: 'tool_call', label: 'tool_call', desc: tx('Model supports tool/function calling.', '模型支持工具/函数调用。', lang), control: <BoolField value={value.tool_call} onChange={v => set('tool_call', v)} /> },
    { key: 'experimental', label: 'experimental', desc: tx('Mark this model as experimental.', '标记为实验性模型。', lang), control: <BoolField value={value.experimental} onChange={v => set('experimental', v)} /> },
    { key: 'status', label: 'status', desc: tx('Lifecycle status.', '生命周期状态。', lang), control: <Select value={value.status} options={enumChoices(MODEL_STATUS)} onChange={v => set('status', v)} /> },
    {
      key: 'cost',
      label: 'cost',
      block: true,
      desc: tx('Token costs (per 1M tokens).', 'token 费用（每百万 token）。', lang),
      control: (
        <div className="space-y-3">
          {costMissing.length > 0 && (
            <div className="rounded-lg border border-warning-100/30 bg-warning-100/10 px-3 py-2 text-[length:var(--fs-xs)] text-warning-100">
              {tx(`Required: ${costMissing.join(', ')}`, `必填：${costMissing.join(', ')}`, lang)}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(['input', 'output', 'cache_read', 'cache_write'] as const).map(k => (
            <label key={k} className="text-[length:var(--fs-xs)] text-text-500">
              {k}
              <NumberField value={cost[k]} onChange={v => onChange({ ...value, cost: { ...cost, [k]: v } })} />
            </label>
          ))}
          </div>
          <div className="rounded-lg border border-border-200/40 p-2">
            <div className="mb-2 text-[length:var(--fs-xs)] font-medium text-text-400">context_over_200k</div>
            {contextOverMissing.length > 0 && (
              <div className="mb-2 rounded-lg border border-warning-100/30 bg-warning-100/10 px-3 py-2 text-[length:var(--fs-xs)] text-warning-100">
                {tx(`Required when used: ${contextOverMissing.join(', ')}`, `使用时必填：${contextOverMissing.join(', ')}`, lang)}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(['input', 'output', 'cache_read', 'cache_write'] as const).map(k => (
                <label key={k} className="text-[length:var(--fs-xs)] text-text-500">
                  {k}
                  <NumberField value={contextOver200k[k]} onChange={v => onChange({ ...value, cost: { ...cost, context_over_200k: { ...contextOver200k, [k]: v } } })} />
                </label>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'limit',
      label: 'limit',
      block: true,
      desc: tx('Context / input / output token limits.', '上下文/输入/输出 token 限制。', lang),
      control: (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {limitMissing.length > 0 && (
            <div className="sm:col-span-3 rounded-lg border border-warning-100/30 bg-warning-100/10 px-3 py-2 text-[length:var(--fs-xs)] text-warning-100">
              {tx(`Required: ${limitMissing.join(', ')}`, `必填：${limitMissing.join(', ')}`, lang)}
            </div>
          )}
          {(['context', 'input', 'output'] as const).map(k => (
            <label key={k} className="text-[length:var(--fs-xs)] text-text-500">
              {k}
              <NumberField value={limit[k]} onChange={v => onChange({ ...value, limit: { ...limit, [k]: v } })} />
            </label>
          ))}
        </div>
      ),
    },
    {
      key: 'modalities',
      label: 'modalities',
      block: true,
      desc: tx('Supported input/output modalities.', '支持的输入/输出模态。', lang),
      control: (
        <div className="space-y-2">
          <div className="text-[length:var(--fs-xs)] text-text-500">input</div>
          <MultiToggle options={MODALITIES} value={asStringArray(modalities.input)} onChange={v => onChange({ ...value, modalities: { ...modalities, input: v } })} />
          <div className="text-[length:var(--fs-xs)] text-text-500">output</div>
          <MultiToggle options={MODALITIES} value={asStringArray(modalities.output)} onChange={v => onChange({ ...value, modalities: { ...modalities, output: v } })} />
        </div>
      ),
    },
    {
      key: 'interleaved',
      label: 'interleaved',
      desc: tx('Interleaved reasoning: true, or pick a reasoning field.', '交错推理：true，或选择 reasoning 字段。', lang),
      control: (
        <Select
          value={value.interleaved === true ? 'true' : isRecord(value.interleaved) ? String((value.interleaved as JsonRecord).field) : ''}
          options={[
            { value: 'true', label: 'true' },
            { value: 'reasoning', label: 'field: reasoning' },
            { value: 'reasoning_content', label: 'field: reasoning_content' },
            { value: 'reasoning_details', label: 'field: reasoning_details' },
          ]}
          onChange={v => set('interleaved', v === 'true' ? true : { field: v })}
        />
      ),
    },
    { key: 'provider', label: 'provider', desc: tx('Provider implementation override for this model (npm/api).', '该模型的渠道实现覆盖（npm/api）。', lang), drill: { title: 'provider', preview: previewValue(value.provider, lang), render: () => <ModelProviderOverride value={value.provider} onChange={v => set('provider', v)} lang={lang} /> } },
    { key: 'headers', label: 'headers', desc: tx('Per-model HTTP headers.', '该模型的 HTTP 请求头。', lang), drill: { title: 'headers', preview: previewValue(value.headers, lang), render: () => <StringMapField value={value.headers} onChange={v => set('headers', v)} /> } },
    { key: 'options', label: 'options', desc: tx('Provider-specific model options.', '渠道相关的模型选项。', lang), drill: { title: 'options', preview: previewValue(value.options, lang), render: () => <KeyValueField value={value.options} onChange={v => set('options', v)} /> } },
    { key: 'variants', label: 'variants', desc: tx('Variant-specific configuration (for example disabled=true).', '模型 variant 级别配置（例如 disabled=true）。', lang), drill: { title: 'variants', preview: previewValue(value.variants, lang), render: () => <ModelVariantsEditor value={value.variants} onChange={v => set('variants', v)} lang={lang} /> } },
  ]
  return <DrillFields fields={fields} isConfigured={key => key in value} lang={lang} />
}

function ModelProviderOverride({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const rec = isRecord(value) ? value : {}
  const fields: FieldDef[] = [
    { key: 'npm', label: 'npm', desc: tx('Provider npm package override.', '渠道 npm 包覆盖。', lang), control: <TextField value={rec.npm} onChange={v => onChange({ ...rec, npm: v })} mono /> },
    { key: 'api', label: 'api', desc: tx('Provider API name override.', '渠道 API 名称覆盖。', lang), control: <TextField value={rec.api} onChange={v => onChange({ ...rec, api: v })} mono /> },
  ]
  return <DrillFields fields={fields} isConfigured={key => key in rec} lang={lang} />
}

function ModelVariantsEditor({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const drill = useDrillState()
  const rec = isRecord(value) ? value : {}
  const [newName, setNewName] = useState('')
  if (activeChildId?.startsWith('variant:')) {
    const name = activeChildId.slice('variant:'.length)
    const variant = getObject(rec, name)
    const fields: FieldDef[] = [
      { key: 'disabled', label: 'disabled', desc: tx('Disable this variant for the model.', '禁用该模型的这个 variant。', lang), control: <BoolField value={variant.disabled} onChange={v => onChange({ ...rec, [name]: { ...variant, disabled: v } })} /> },
    ]
    return (
      <DrillChild depth={depth}>
        <div className="space-y-6">
          <DuplicateIdField
            sourceId={name}
            existing={rec}
            lang={lang}
            onCopy={targetId => {
              onChange({ ...rec, [targetId]: clone(variant) })
              drill.replace(depth, { id: `variant:${targetId}`, title: targetId })
            }}
          />
          <DrillFields fields={fields} isConfigured={key => key in variant} lang={lang} />
        </div>
      </DrillChild>
    )
  }
  return (
    <div className="space-y-3">
      {Object.keys(rec).length === 0 ? <EmptyHint text={tx('No variants configured.', '还没有配置 variant。', lang)} /> : (
        <div className="space-y-0.5">
          {Object.keys(rec).sort().map(name => (
            <DrillRow key={name} label={name} preview={previewValue(rec[name], lang)} onClick={() => enter({ id: `variant:${name}`, title: name })} />
          ))}
        </div>
      )}
      <div className="flex min-w-0 gap-2">
        <input value={newName} onChange={event => setNewName(event.target.value)} placeholder={tx('variant name', 'variant 名称', lang)} className={`${fieldClass} min-w-0 flex-1 font-mono`} />
        <button type="button" disabled={!newName.trim() || hasOwn(rec, newName.trim())} onClick={() => { onChange({ ...rec, [newName.trim()]: { disabled: false } }); setNewName('') }} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-200/60 px-3 py-2 text-[length:var(--fs-xs)] text-text-300 hover:bg-bg-100 disabled:opacity-40">
          <PlusIcon size={13} />
          {tx('Add', '添加', lang)}
        </button>
      </div>
    </div>
  )
}

function MultiToggle({ options, value, onChange }: { options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {options.map(option => {
        const active = value.includes(option)
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(active ? value.filter(v => v !== option) : [...value, option])}
            className={`rounded-md border px-2.5 py-1 text-[length:var(--fs-xs)] transition-all duration-150 ${
              active
                ? 'border-accent-main-100/20 bg-accent-main-100/10 text-accent-main-100 font-medium'
                : 'border-border-200/60 text-text-400 hover:bg-bg-100/50 hover:text-text-200'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
