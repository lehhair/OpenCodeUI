// ============================================
// ProviderConnectDialog — provider 连接对话框（OAuth 登录 / API key）
//
// 交互结构逐行对齐官方 packages/app/src/providers/connect/dialog.tsx：
//   Picker（provider 列表 + 过滤）→ ProviderConnection：
//     方法选择 → 表单（auth.form）→ API key 输入 / OAuth 浏览器授权
//     （auto=轮询等待，code=手输授权码）→ 完成 toast / 失败重试
// Console 特例（官方同款）：opencode / opencode-go 优先自动选中 OAuth
// 方法并保留底部「使用 API key」逃生口。
// ============================================

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormAnswer } from '@opencode/client/promise'
import { Dialog, Button } from '../../../components/ui'
import { SpinnerIcon, ChevronLeftIcon, AlertCircleIcon, ExternalLinkIcon } from '../../../components/Icons'
import {
  CONSOLE_PROVIDERS,
  consoleIntegration,
  getIntegrations,
  type IntegrationInfo,
} from '../../../api'
import { removeCredential } from '../../../api/credential'
import { refreshModels } from '../../../hooks/useModels'
import {
  useProviderConnectionController,
  type ProviderConnectMethod,
} from '../../../hooks/useProviderConnectionController'
import { notificationStore } from '../../../store/notificationStore'
import { openExternalUrl } from '../../../utils/externalUrl'

interface ProviderConnectDialogProps {
  isOpen: boolean
  onClose: () => void
  directory?: string
  serverId?: string
  /** 预选 provider（跳过 picker 直接进连接流程） */
  initialProvider?: string
}

/** 官方 ProviderPicker 的 featured 顺序同款 */
const FEATURED = ['opencode-go', 'opencode', 'anthropic', 'openai', 'google', 'openrouter', 'vercel']

export function ProviderConnectDialog({ isOpen, onClose, directory, serverId, initialProvider }: ProviderConnectDialogProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [selected, setSelected] = useState<string | undefined>(initialProvider)

  useEffect(() => {
    if (isOpen) setSelected(initialProvider)
  }, [isOpen, initialProvider])

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      width={560}
      title={
        selected ? (
          <button
            type="button"
            onClick={() => setSelected(undefined)}
            className="flex items-center gap-1 text-text-300 hover:text-text-100 transition-colors"
            aria-label={t('common:back')}
          >
            <ChevronLeftIcon size={14} />
          </button>
        ) : (
          t('settings:providerConnect.title')
        )
      }
      rawContent={Boolean(selected)}
    >
      {selected ? (
        <ProviderConnection
          provider={selected}
          directory={directory}
          serverId={serverId}
          onDone={() => {
            notificationStore.push('completed', t('settings:providerConnect.toast.connected'), '', '')
            onClose()
          }}
        />
      ) : (
        <ProviderPicker directory={directory} serverId={serverId} onSelect={setSelected} />
      )}
    </Dialog>
  )
}

// ============================================
// Picker：列出带 key/oauth 连接方法的 provider
// ============================================

function ProviderPicker({
  directory,
  serverId,
  onSelect,
}: {
  directory?: string
  serverId?: string
  onSelect: (provider: string) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [integrations, setIntegrations] = useState<IntegrationInfo[] | undefined>(undefined)
  const [filter, setFilter] = useState('')
  const [disconnecting, setDisconnecting] = useState<string | undefined>(undefined)

  const load = useMemo(
    () => () => {
      getIntegrations(directory, serverId)
        .catch(() => [] as IntegrationInfo[])
        .then(list => setIntegrations(list))
    },
    [directory, serverId],
  )

  useEffect(() => {
    let stale = false
    getIntegrations(directory, serverId)
      .catch(() => [] as IntegrationInfo[])
      .then(list => {
        if (!stale) setIntegrations(list)
      })
    return () => {
      stale = true
    }
  }, [directory, serverId, load])

  /** 断开连接（官方设置页 disconnect 同款：遍历 credential connections 逐个 remove） */
  const disconnect = async (entry: IntegrationInfo) => {
    const credentials = entry.connections.filter(connection => connection.type === 'credential')
    if (credentials.length === 0) return
    setDisconnecting(entry.id)
    try {
      for (const credential of credentials) {
        await removeCredential(credential.id, serverId)
      }
      notificationStore.push('completed', t('settings:providerConnect.toast.disconnected', { provider: entry.name }), '', '')
      await refreshModels(serverId).catch(() => undefined)
      load()
    } catch (err) {
      notificationStore.push('error', t('common:failed'), err instanceof Error ? err.message : String(err), '')
    } finally {
      setDisconnecting(undefined)
    }
  }

  const providers = useMemo(() => {
    const withMethods = (integrations ?? []).filter(entry =>
      entry.methods.some(method => method.type === 'key' || method.type === 'oauth'),
    )
    const featured = FEATURED.flatMap(id => {
      const hit = withMethods.find(entry => entry.id === id)
      return hit ? [hit] : []
    })
    const rest = withMethods
      .filter(entry => !FEATURED.includes(entry.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    return [...featured, ...rest]
  }, [integrations])

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return providers
    return providers.filter(entry => entry.id.includes(query) || entry.name.toLowerCase().includes(query))
  }, [providers, filter])

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={filter}
        onChange={event => setFilter(event.target.value)}
        placeholder={t('settings:providerConnect.searchPlaceholder')}
        className="w-full rounded-md border border-border-200 bg-bg-100 px-3 py-2 text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-border-100"
      />
      <div className="flex max-h-80 flex-col overflow-y-auto">
        {integrations === undefined && (
          <div className="flex items-center gap-2 px-3 py-2 text-text-400">
            <SpinnerIcon size={14} className="animate-spin" />
            <span>{t('common:loading')}</span>
          </div>
        )}
        {integrations !== undefined && visible.length === 0 && (
          <div className="px-3 py-2 text-text-400">{t('settings:providerConnect.empty')}</div>
        )}
        {visible.map(entry => {
          const connected = entry.connections.some(connection => connection.type === 'credential')
          return (
            <div
              key={entry.id}
              className="group flex items-center gap-2 rounded-md px-3 py-2 text-left text-text-200 hover:bg-bg-200/60 transition-colors"
            >
              <button type="button" onClick={() => onSelect(entry.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="font-medium">{entry.name}</span>
                <span className="text-[length:var(--fs-sm)] text-text-500">{entry.id}</span>
              </button>
              {connected &&
                (disconnecting === entry.id ? (
                  <SpinnerIcon size={12} className="animate-spin shrink-0 text-text-400" />
                ) : (
                  <button
                    type="button"
                    onClick={() => void disconnect(entry)}
                    className="shrink-0 rounded-md px-2 py-0.5 text-[length:var(--fs-sm)] text-text-400 hover:bg-danger-bg hover:text-danger-100 transition-colors"
                  >
                    {t('settings:providerConnect.disconnect')}
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================
// ProviderConnection：连接状态机视图（官方 dialog.tsx 的 Switch 同款）
// ============================================

function ProviderConnection({
  provider,
  directory,
  serverId,
  onDone,
}: {
  provider: string
  directory?: string
  serverId?: string
  onDone: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const isConsole = CONSOLE_PROVIDERS.has(provider)
  const controller = useProviderConnectionController({
    provider: consoleIntegration(provider),
    // Console 的 API key 仍落在原 provider 的 integration（官方 keyProvider 同款）
    keyProvider: provider,
    directory,
    serverId,
    onComplete: onDone,
  })

  // Console 系自动选中 OAuth 方法（官方 autoSelect 同款）
  const autoOauthRef = useState(false)
  useEffect(() => {
    if (!isConsole || autoOauthRef[0] || controller.loading || controller.methodIndex !== undefined) return
    const index = controller.methods.findIndex(method => method.type === 'oauth')
    if (index === -1) return
    autoOauthRef[1](true)
    void controller.select(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConsole, controller.loading, controller.methods, controller.methodIndex])

  const providerName = controller.integration?.name ?? provider

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="text-[length:var(--fs-md)] font-medium text-text-100">
        {t('settings:providerConnect.connectTitle', { provider: providerName })}
      </div>

      {isConsole && controller.currentMethod?.type !== 'key' && controller.state !== 'error' ? (
        <ConsoleSignInView controller={controller} providerName={providerName} />
      ) : controller.busy ? (
        <StatusRow>{t('settings:providerConnect.status.inProgress')}</StatusRow>
      ) : controller.methodIndex === undefined ? (
        <MethodSelection controller={controller} providerName={providerName} />
      ) : controller.state === 'form' ? (
        <AuthFormView controller={controller} />
      ) : controller.state === 'error' ? (
        <ErrorRow controller={controller} />
      ) : controller.currentMethod?.type === 'key' ? (
        <ApiAuthView controller={controller} providerName={providerName} isConsole={isConsole} />
      ) : controller.authorization?.mode === 'code' ? (
        <OAuthCodeView controller={controller} providerName={providerName} />
      ) : controller.authorization?.mode === 'auto' ? (
        <OAuthAutoView controller={controller} providerName={providerName} />
      ) : null}

      {isConsole && !controller.loading && controller.currentMethod?.type !== 'key' && <ConsoleApiKeySwitch controller={controller} />}
    </div>
  )
}

type Controller = ReturnType<typeof useProviderConnectionController>

function StatusRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-text-400">
      <SpinnerIcon size={14} className="animate-spin shrink-0" />
      <span>{children}</span>
    </div>
  )
}

/** 官方 methodDetails 同款：label 尾部 (browser|headless) 拆成提示 */
function methodDetails(method: ProviderConnectMethod | undefined, apiKeyLabel: string) {
  if (!method) return { label: '', hint: undefined as string | undefined }
  const raw = method.type === 'key' ? apiKeyLabel : (method.label ?? '')
  const suffix = raw.match(/\s+\((browser|headless)\)$/i)
  const hint = suffix?.[1]?.toLowerCase()
  return {
    label: suffix ? raw.slice(0, -suffix[0].length) : raw,
    hint,
  }
}

function MethodSelection({ controller, providerName }: { controller: Controller; providerName: string }) {
  const { t } = useTranslation(['settings'])
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[length:var(--fs-sm)] text-text-400">
        {t('settings:providerConnect.selectMethod', { provider: providerName })}
      </div>
      <div className="flex flex-col">
        {controller.methods.map((method, index) => {
          const details = methodDetails(method, t('settings:providerConnect.method.apiKey'))
          return (
            <button
              key={index}
              type="button"
              onClick={() => void controller.select(index)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-text-200 hover:bg-bg-200/60 transition-colors"
            >
              <span className="font-medium">{details.label}</span>
              {details.hint && (
                <span className="text-[length:var(--fs-sm)] text-text-500">
                  {t(`settings:providerConnect.method.${details.hint}`)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ErrorRow({ controller }: { controller: Controller }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-start gap-2 text-text-200">
        <AlertCircleIcon size={14} className="mt-0.5 shrink-0 text-red-400" />
        <span role="alert">{t('settings:providerConnect.status.failed', { error: controller.error ?? '' })}</span>
      </div>
      <Button variant="secondary" onClick={() => controller.retry()}>
        {t('common:retry')}
      </Button>
    </div>
  )
}

/** 表单视图（官方 AuthFormView 同款）：string 字段逐个推进，options 字段列表选择 */
function AuthFormView({ controller }: { controller: Controller }) {
  const { t } = useTranslation(['settings', 'common'])
  const [value, setValue] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)

  const fields = useMemo(
    () =>
      (controller.currentMethod?.form ?? []).flatMap(field =>
        field.type === 'string' && !field.hidden ? [field] : [],
      ),
    [controller.currentMethod],
  )

  const matches = (field: (typeof fields)[number], answer: Record<string, string>) =>
    (field.when ?? []).every(condition => {
      const actual = answer[condition.key]
      if (actual === undefined) return false
      return condition.op === 'eq' ? actual === condition.value : actual !== condition.value
    })

  const current = useMemo(() => {
    const found = fields.findIndex((field, i) => i >= index && matches(field, value))
    return found === -1 ? undefined : { index: found, field: fields[found] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, index, value])

  const next = async (fieldIndex: number, answer: Record<string, string>) => {
    const selected = controller.methodIndex
    if (selected === undefined) return
    const following = fields.findIndex((field, i) => i > fieldIndex && matches(field, answer))
    if (following !== -1) {
      setIndex(following)
      return
    }
    await controller.select(selected, answer as FormAnswer)
  }

  const valid = current ? (current.field.required ? (value[current.field.key] ?? '').trim().length > 0 : true) : false

  if (!current) return null
  const field = current.field

  if (field.options) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-[length:var(--fs-base)] text-text-200">{field.title}</div>
        <div className="flex flex-col">
          {field.options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                const nextValue = { ...value, [field.key]: option.value }
                setValue(nextValue)
                void next(current.index, nextValue)
              }}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-bg-200/60 transition-colors"
            >
              <span className="text-text-100">{option.label}</span>
              <span className="text-[length:var(--fs-sm)] text-text-500">{option.description}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col items-start gap-4"
      onSubmit={event => {
        event.preventDefault()
        if (valid) void next(current.index, value)
      }}
    >
      <label className="flex w-full flex-col gap-1 text-text-200">
        {field.title}
        <input
          type="text"
          value={value[field.key] ?? ''}
          placeholder={field.placeholder}
          onChange={event => setValue(prev => ({ ...prev, [field.key]: event.target.value }))}
          className="w-full rounded-md border border-border-200 bg-bg-100 px-3 py-2 text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-border-100"
        />
      </label>
      <Button type="submit" variant="primary" disabled={!valid}>
        {t('common:continue')}
      </Button>
    </form>
  )
}

/** API key 输入（官方 ApiAuthView 同款） */
function ApiAuthView({
  controller,
  providerName,
  isConsole,
}: {
  controller: Controller
  providerName: string
  isConsole: boolean
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const key = value.trim()
    if (!key) {
      setError(t('settings:providerConnect.apiKey.required'))
      return
    }
    setError(undefined)
    setSubmitting(true)
    try {
      await controller.connectKey(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 text-[length:var(--fs-sm)] text-text-400">
      <div>
        {isConsole ? (
          <>
            {t('settings:providerConnect.console.apiKey.description')}{' '}
            <button
              type="button"
              className="text-text-200 underline underline-offset-2 hover:text-text-100"
              onClick={() => void openExternalUrl('https://opencode.ai/console')}
            >
              {t('settings:providerConnect.console.apiKey.link')}
            </button>
          </>
        ) : (
          t('settings:providerConnect.apiKey.description', { provider: providerName })
        )}
      </div>
      <form onSubmit={submit} className="flex flex-col items-start gap-4 self-stretch">
        <label className="flex w-full flex-col gap-1 text-text-200">
          {t('settings:providerConnect.apiKey.label', { provider: providerName })}
          <input
            type="password"
            name="apiKey"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={t('settings:providerConnect.apiKey.placeholder')}
            onChange={event => setValue(event.target.value)}
            className={`w-full rounded-md border bg-bg-100 px-3 py-2 text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none ${
              error ? 'border-red-400' : 'border-border-200 focus:border-border-100'
            }`}
          />
        </label>
        {error && (
          <div role="alert" className="-mt-3 text-[length:var(--fs-sm)] text-red-400">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? t('common:sending') : t('common:continue')}
        </Button>
      </form>
    </div>
  )
}

/** OAuth 手动授权码（官方 OAuthCodeView 同款） */
function OAuthCodeView({ controller, providerName }: { controller: Controller; providerName: string }) {
  const { t } = useTranslation(['settings', 'common'])
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const code = value.trim()
    if (!code) {
      setError(t('settings:providerConnect.oauth.code.required'))
      return
    }
    setError(undefined)
    setSubmitting(true)
    setError(await controller.completeCode(code))
    setSubmitting(false)
  }

  return (
    <div className="flex flex-col gap-5 text-[length:var(--fs-sm)] text-text-400">
      <div>{t('settings:providerConnect.oauth.code.description', { provider: providerName })}</div>
      <Button variant="secondary" onClick={() => controller.open()}>
        <ExternalLinkIcon size={13} />
        {t('settings:providerConnect.oauth.openBrowser')}
      </Button>
      <form onSubmit={submit} className="flex flex-col items-start gap-4 self-stretch">
        <label className="flex w-full flex-col gap-1 text-text-200">
          {t('settings:providerConnect.oauth.code.label')}
          <input
            type="text"
            name="code"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={t('settings:providerConnect.oauth.code.placeholder')}
            onChange={event => setValue(event.target.value)}
            className={`w-full rounded-md border bg-bg-100 px-3 py-2 text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none ${
              error ? 'border-red-400' : 'border-border-200 focus:border-border-100'
            }`}
          />
        </label>
        {error && (
          <div role="alert" className="-mt-3 text-[length:var(--fs-sm)] text-red-400">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? t('common:sending') : t('common:continue')}
        </Button>
      </form>
    </div>
  )
}

/** OAuth 自动轮询等待（官方 OAuthAutoView 同款；带确认码展示） */
function OAuthAutoView({ controller, providerName }: { controller: Controller; providerName: string }) {
  const { t } = useTranslation(['settings'])
  const instructions = controller.authorization?.instructions
  const code = instructions?.includes(':') ? instructions.split(':').pop()?.trim() : instructions
  return (
    <div className="flex flex-col gap-5 text-[length:var(--fs-sm)] text-text-400">
      <div>{t('settings:providerConnect.oauth.auto.description', { provider: providerName })}</div>
      <StatusRow>{t('settings:providerConnect.status.waiting')}</StatusRow>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => controller.open()}>
          <ExternalLinkIcon size={13} />
          {t('settings:providerConnect.oauth.openBrowser')}
        </Button>
      </div>
      {code && (
        <label className="flex flex-col gap-1 text-text-200">
          {t('settings:providerConnect.oauth.auto.confirmationCode')}
          <input
            type="text"
            readOnly
            value={code}
            onFocus={event => event.currentTarget.select()}
            className="w-full rounded-md border border-border-200 bg-bg-100 px-3 py-2 font-mono text-[length:var(--fs-base)] text-text-100 focus:outline-none"
          />
        </label>
      )}
    </div>
  )
}

/** Console 登录视图（官方 ConsoleSignInView 同款） */
function ConsoleSignInView({ controller, providerName }: { controller: Controller; providerName: string }) {
  const { t } = useTranslation(['settings'])
  const ready = controller.authorization?.url !== undefined
  const instructions = controller.authorization?.instructions
  const code = instructions?.includes(':') ? instructions.split(':').pop()?.trim() : instructions
  return (
    <div className="flex flex-col gap-5 text-[length:var(--fs-sm)] text-text-400">
      <div>{t('settings:providerConnect.console.description', { provider: providerName })}</div>
      <StatusRow>
        {t(ready ? 'settings:providerConnect.status.waiting' : 'settings:providerConnect.console.opening')}
      </StatusRow>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={!ready} onClick={() => controller.open()}>
          <ExternalLinkIcon size={13} />
          {t('settings:providerConnect.oauth.openBrowser')}
        </Button>
      </div>
      {code && (
        <label className="flex flex-col gap-1 text-text-200">
          {t('settings:providerConnect.oauth.auto.confirmationCode')}
          <input
            type="text"
            readOnly
            value={code}
            onFocus={event => event.currentTarget.select()}
            className="w-full rounded-md border border-border-200 bg-bg-100 px-3 py-2 font-mono text-[length:var(--fs-base)] text-text-100 focus:outline-none"
          />
        </label>
      )}
    </div>
  )
}

/** Console 的 API key 逃生口（官方 ConsoleApiKeySwitch 同款，刻意低调） */
function ConsoleApiKeySwitch({ controller }: { controller: Controller }) {
  const { t } = useTranslation(['settings'])
  const keyIndex = controller.methods.findIndex(method => method.type === 'key')
  if (keyIndex === -1) return null
  return (
    <div className="mt-auto flex justify-end px-1 pt-2 text-[length:var(--fs-xs)] text-text-500">
      <button
        type="button"
        className="rounded-sm px-1 underline decoration-border-200 underline-offset-2 hover:text-text-200"
        onClick={() => void controller.select(keyIndex)}
      >
        {t('settings:providerConnect.console.apiKey.switch')}
      </button>
    </div>
  )
}
