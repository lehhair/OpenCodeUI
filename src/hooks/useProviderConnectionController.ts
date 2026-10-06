// ============================================
// useProviderConnectionController — provider 连接状态机
//
// 逐行移植官方 packages/app/src/providers/connect/controller.ts：
//   integration.get → methods(key/oauth) → select
//     → 有可见表单先填表（auth.form → auth.answer）
//     → key：connect.key → finish
//     → oauth：oauth.connect → 拉起浏览器 → 1s 轮询 oauth.status
//       → complete → finish；failed/expired → auth.error
//   finish：失效并重拉 integration/provider/model → onComplete
//   对话框关闭/重选时 cancel 进行中的授权尝试（cancelAttempt）
// ============================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormAnswer, IntegrationMethod } from '@opencode/client/promise'
import {
  cancelIntegrationOauth,
  completeIntegrationOauth,
  connectIntegrationKey,
  connectIntegrationOauth,
  getIntegration,
  getIntegrationOauthStatus,
  type Authorization,
  type IntegrationInfo,
} from '../api'
import { refreshModels } from './useModels'
import { openExternalUrl } from '../utils/externalUrl'

export type ProviderConnectMethod = Extract<IntegrationMethod, { type: 'key' | 'oauth' }>

type AuthState = 'pending' | 'complete' | 'error' | 'form' | undefined

/** 官方 hiddenDefaults 同款：hidden 且有 default 的字段自动并入答案 */
function hiddenDefaults(method: ProviderConnectMethod | undefined): FormAnswer {
  return Object.fromEntries(
    (method?.form ?? []).flatMap(field =>
      field.type !== 'external' && field.hidden && field.default !== undefined ? [[field.key, field.default]] : [],
    ),
  ) as FormAnswer
}

export interface ProviderConnectionControllerOptions {
  /** 连接的 provider（Console 系已由调用方映射到 `opencode`） */
  provider: string
  /** API key 落到不同的 integration 时（官方 keyProvider） */
  keyProvider?: string
  directory?: string
  serverId?: string
  onComplete: () => void
  pollInterval?: number
}

export interface ProviderConnectionController {
  loading: boolean
  integration: IntegrationInfo | undefined
  methods: ProviderConnectMethod[]
  methodIndex: number | undefined
  currentMethod: ProviderConnectMethod | undefined
  authorization: Authorization | undefined
  state: AuthState
  error: string | undefined
  busy: boolean
  select: (index: number, answer?: FormAnswer) => Promise<void>
  reset: () => void
  retry: () => void
  open: () => void
  connectKey: (key: string) => Promise<void>
  completeCode: (code: string) => Promise<string | undefined>
}

export function useProviderConnectionController(options: ProviderConnectionControllerOptions): ProviderConnectionController {
  const { t } = useTranslation(['settings', 'common'])
  const [integration, setIntegration] = useState<IntegrationInfo | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [methodIndex, setMethodIndex] = useState<number | undefined>(undefined)
  const [authorization, setAuthorization] = useState<Authorization | undefined>(undefined)
  const [formAnswer, setFormAnswer] = useState<FormAnswer | undefined>(undefined)
  const [state, setState] = useState<AuthState>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  // 轮询代际与进行中的尝试（官方 polling 结构同款）：
  // 代际失配的旧轮询必须丢弃；对话框关闭时取消服务器端仍开着的 attempt
  const pollingRef = useRef({
    generation: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    disposed: false,
    attempt: undefined as Authorization | undefined,
  })

  const providerRef = useRef(options.provider)
  providerRef.current = options.provider
  const directoryRef = useRef(options.directory)
  directoryRef.current = options.directory
  const serverIdRef = useRef(options.serverId)
  serverIdRef.current = options.serverId

  // integration.get（provider/directory 变化时重拉；官方 createEffect(on(...)) 同款）
  useEffect(() => {
    setLoading(true)
    setIntegration(undefined)
    let stale = false
    getIntegration(options.provider, options.directory, options.serverId)
      .catch(() => undefined)
      .then(latest => {
        if (stale || pollingRef.current.disposed) return
        setIntegration(latest)
        setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [options.provider, options.directory, options.serverId])

  // methods：key/oauth 过滤；一个都没有时退化为单个「API key」方法（官方同款）
  const methods = useMemo<ProviderConnectMethod[]>(() => {
    const values = integration?.methods.filter(
      (method): method is ProviderConnectMethod => method.type === 'key' || method.type === 'oauth',
    )
    if (values?.length) return [...values]
    return [{ type: 'key', label: t('settings:providerConnect.method.apiKey') }]
  }, [integration, t])

  const currentMethod = useMemo(
    () => (methodIndex === undefined ? undefined : methods.at(methodIndex)),
    [methods, methodIndex],
  )

  const cancelAttempt = useCallback(() => {
    const attempt = pollingRef.current.attempt
    pollingRef.current.attempt = undefined
    if (!attempt) return
    void cancelIntegrationOauth(providerRef.current, attempt.attemptID, directoryRef.current, serverIdRef.current).catch(
      () => undefined,
    )
  }, [])

  const cancelPolling = useCallback(() => {
    pollingRef.current.generation++
    if (pollingRef.current.timer === undefined) return
    clearTimeout(pollingRef.current.timer)
    pollingRef.current.timer = undefined
  }, [])

  const finish = useCallback(async () => {
    cancelPolling()
    pollingRef.current.attempt = undefined
    // 官方 finish：失效并重拉 integration/provider/model——我们的 models/providers
    // 缓存统一走 refreshModels（同一数据面）
    await refreshModels(serverIdRef.current).catch(() => undefined)
    if (pollingRef.current.disposed) return
    options.onComplete()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelPolling])

  const poll = useCallback(
    async (authorization: Authorization, generation: number) => {
      const status = await getIntegrationOauthStatus(
        providerRef.current,
        authorization.attemptID,
        directoryRef.current,
        serverIdRef.current,
      ).then(
        value => ({ ok: true as const, status: value }),
        (err: unknown) => ({ ok: false as const, error: err }),
      )
      if (pollingRef.current.disposed || generation !== pollingRef.current.generation) return
      if (!status.ok) {
        pollingRef.current.attempt = undefined
        setState('error')
        setError(status.error instanceof Error ? status.error.message : String(status.error))
        return
      }
      if (status.status.status === 'complete') {
        void finish()
        return
      }
      if (status.status.status === 'failed') {
        pollingRef.current.attempt = undefined
        setState('error')
        setError(status.status.message)
        return
      }
      if (status.status.status === 'expired') {
        pollingRef.current.attempt = undefined
        setState('error')
        setError(t('settings:providerConnect.oauth.expired'))
        return
      }
      pollingRef.current.timer = setTimeout(
        () => void poll(authorization, generation),
        options.pollInterval ?? 1_000,
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finish, t, options.pollInterval],
  )

  const select = useCallback(
    async (index: number, answer?: FormAnswer) => {
      cancelPolling()
      cancelAttempt()
      const generation = pollingRef.current.generation
      const selected = methods[index]
      if (!selected) return
      setMethodIndex(index)
      setAuthorization(undefined)
      setFormAnswer(undefined)
      setState(undefined)
      setError(undefined)

      const visible = (selected.form ?? []).some(field => field.type === 'external' || !field.hidden)
      if (visible && !answer) {
        setState('form')
        return
      }
      const merged = { ...hiddenDefaults(selected), ...answer }
      if (selected.type === 'key') {
        setFormAnswer(Object.keys(merged).length ? merged : undefined)
        return
      }
      if (selected.type !== 'oauth') return
      if (selected.form?.some(field => field.type !== 'string')) {
        setState('error')
        setError(t('settings:providerConnect.unsupportedForm'))
        return
      }
      setState('pending')
      const result = await connectIntegrationOauth(
        providerRef.current,
        selected.id,
        Object.keys(merged).length ? merged : undefined,
        directoryRef.current,
        serverIdRef.current,
      ).then(
        value => ({ ok: true as const, authorization: value }),
        (err: unknown) => ({ ok: false as const, error: err }),
      )
      if (pollingRef.current.disposed || generation !== pollingRef.current.generation) {
        if (result.ok)
          void cancelIntegrationOauth(
            providerRef.current,
            result.authorization.attemptID,
            directoryRef.current,
            serverIdRef.current,
          ).catch(() => undefined)
        return
      }
      if (!result.ok) {
        setState('error')
        setError(result.error instanceof Error ? result.error.message : String(result.error))
        return
      }
      pollingRef.current.attempt = result.authorization
      setAuthorization(result.authorization)
      setState('complete')
      // 与 `opencode auth login` 同款：直接拉起浏览器，而不是让用户点链接再手输
      void openExternalUrl(result.authorization.url)
      if (result.authorization.mode === 'auto') void poll(result.authorization, generation)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [methods, cancelPolling, cancelAttempt, poll, t],
  )

  // 只有一个方法时自动选中（官方 autoIndex 同款）
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (loading || autoStartedRef.current || methods.length !== 1) return
    autoStartedRef.current = true
    void select(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, methods, select])

  const reset = useCallback(() => {
    cancelPolling()
    cancelAttempt()
    setMethodIndex(undefined)
    setAuthorization(undefined)
    setFormAnswer(undefined)
    setState(undefined)
    setError(undefined)
  }, [cancelPolling, cancelAttempt])

  const retry = useCallback(() => {
    if (methodIndex === undefined) return
    void select(methodIndex, formAnswer)
  }, [methodIndex, formAnswer, select])

  const open = useCallback(() => {
    const url = authorization?.url
    if (url) void openExternalUrl(url)
  }, [authorization])

  const connectKey = useCallback(
    async (key: string) => {
      await connectIntegrationKey(
        options.keyProvider ?? providerRef.current,
        key,
        formAnswer,
        directoryRef.current,
        serverIdRef.current,
      )
      await finish()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formAnswer, finish, options.keyProvider],
  )

  const completeCode = useCallback(
    async (code: string): Promise<string | undefined> => {
      if (!authorization) return t('settings:providerConnect.oauth.codeInvalid')
      try {
        await completeIntegrationOauth(
          providerRef.current,
          authorization.attemptID,
          code,
          directoryRef.current,
          serverIdRef.current,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return message || t('settings:providerConnect.oauth.codeInvalid')
      }
      await finish()
      return undefined
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authorization, finish, t],
  )

  // 卸载清理（官方 onCleanup 同款）。
  // 注意 StrictMode 开发期会双调用 effect（mount→cleanup→mount）：cleanup
  // 会把 disposed 置 true 且 ref 在重挂载后保留，所以 setup 时必须重置回
  // false，否则第二次挂载后所有异步续接（加载完成、轮询、finish）都被永久
  // 短路，控制器永远卡在 busy。
  useEffect(() => {
    const polling = pollingRef.current
    polling.disposed = false
    return () => {
      polling.disposed = true
      polling.generation++
      if (polling.timer !== undefined) clearTimeout(polling.timer)
      const attempt = polling.attempt
      polling.attempt = undefined
      if (attempt) {
        void cancelIntegrationOauth(providerRef.current, attempt.attemptID, directoryRef.current, serverIdRef.current).catch(
          () => undefined,
        )
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = loading || state === 'pending'

  return {
    loading,
    integration,
    methods,
    methodIndex,
    currentMethod,
    authorization,
    state,
    error,
    busy,
    select,
    reset,
    retry,
    open,
    connectKey,
    completeCode,
  }
}
