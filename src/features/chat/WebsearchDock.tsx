// ============================================
// WebsearchDock — websearch.provider 表单的专用交互
//
// 对齐官方 session/requests/session-websearch-dock.tsx + websearch.ts：
//
//   表单有两种形态（metadata.kind === 'websearch.provider'）：
//   - 非 specific（无 provider 字段）：选项 = 「任意」+ websearch.providers 列表；
//     「不使用搜索」→ answer {choice:'disable'}；
//     选「任意」启用 → {choice:'allow'}；
//     选具体 provider → 两段式：先 {choice:'choose'}，服务端再发一张 specific 表单，
//     到齐后自动回 {provider: 选中值}（官方 replyWebSearch L92-153 同款链路）。
//   - specific（带 provider string 字段 + options）：直接回 {provider: 选中值}。
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SpinnerIcon } from '../../components/Icons'
import { getWebsearchProviders } from '../../api/client'
import type { ApiFormInfo, FormAnswer } from '../../api'
import type { FormStringField } from '@opencode/client/promise'

interface WebsearchDockProps {
  form: ApiFormInfo
  /** 会话所在目录（providers 按 location 拉取） */
  directory?: string
  onReply: (form: ApiFormInfo, answer: FormAnswer) => Promise<boolean>
}

/** 官方 webSearchProviderField：specific 表单判定 */
function providerField(form: ApiFormInfo): FormStringField | undefined {
  return form.fields.find(
    (field): field is FormStringField => field.type === 'string' && field.key === 'provider' && !!field.options,
  )
}

/**
 * 两段式链路的跨挂载状态（sessionID → 选中的 provider）。
 *
 * 回 {choice:'choose'} 后第一张表单消失、dock 卸载，specific 表单到达时
 * dock 重新挂载——ref 会丢，所以按 sessionID 存模块级（官方用 events 监听
 * 保持 model 存活，效果等价）。
 */
const pendingChooseProvider = new Map<string, string>()

export function WebsearchDock({ form, directory, onReply }: WebsearchDockProps) {
  const { t } = useTranslation(['chat', 'common'])
  const specific = useMemo(() => providerField(form), [form])
  const [selected, setSelected] = useState<string>('random')
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  const loadProviders = useCallback(() => {
    if (specific) {
      setOptions(specific.options ?? [])
      return
    }
    const requestForm = form
    setLoading(true)
    setLoadFailed(false)
    getWebsearchProviders(directory || undefined)
      .then(list => {
        setOptions(list)
        // 官方 selected 逻辑：specific 落到第一个选项；非 specific 默认 random
        setSelected(prev => (list.some(o => o.value === prev) ? prev : 'random'))
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
    return requestForm
  }, [form, specific, directory])

  useEffect(() => {
    if (specific) {
      setOptions(specific.options ?? [])
      setSelected(prev => (specific.options?.some(o => o.value === prev) ? prev : (specific.options?.[0]?.value ?? '')))
      return
    }
    loadProviders()
    // 换表单时重置（官方 createEffect on request().id）
    setFailed(false)
  }, [form.id, specific, loadProviders])

  const reply = useCallback(
    async (answer: FormAnswer) => {
      setSending(true)
      setFailed(false)
      try {
        const ok = await onReply(form, answer)
        if (!ok) setFailed(true)
      } catch {
        setFailed(true)
      } finally {
        setSending(false)
      }
    },
    [form, onReply],
  )

  // 两段式第二步：specific 表单到达且有待回 provider → 自动回复
  useEffect(() => {
    const pending = pendingChooseProvider.get(form.sessionID)
    if (!pending || !specific) return
    if (!specific.options?.some(o => o.value === pending)) return
    pendingChooseProvider.delete(form.sessionID)
    void reply({ provider: pending })
  }, [form.sessionID, specific, reply])

  const handleEnable = () => {
    if (sending) return
    if (specific) {
      if (selected) void reply({ provider: selected })
      return
    }
    if (selected === 'random') {
      void reply({ choice: 'allow' })
      return
    }
    // 两段式：先 choose，等 specific 表单
    pendingChooseProvider.set(form.sessionID, selected)
    void reply({ choice: 'choose' })
  }

  const handleDisable = () => {
    if (sending || specific) return
    void reply({ choice: 'disable' })
  }

  const allOptions = useMemo(
    () => [...(specific ? [] : [{ value: 'random', label: t('chat:websearch.any') }]), ...options],
    [specific, options, t],
  )
  const unavailable = loading || loadFailed || options.length === 0

  return (
    <section
      data-component="session-websearch-dock"
      aria-label={t('chat:websearch.title')}
      aria-busy={sending}
      className="pointer-events-auto glass border border-border-200/60 rounded-xl shadow-lg p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[length:var(--fs-sm)] font-medium text-text-100">{t('chat:websearch.title')}</div>
          <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5">{t('chat:websearch.description')}</div>
        </div>
        <select
          aria-label={t('chat:websearch.provider')}
          value={selected}
          onChange={e => setSelected(e.target.value)}
          disabled={sending || unavailable}
          className="shrink-0 bg-bg-000 border border-border-200 rounded-md px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 focus:outline-none focus:border-accent-main-100/50 disabled:opacity-50 max-w-[180px]"
        >
          {allOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2 mt-2.5">
        <div className="text-[length:var(--fs-xs)] text-text-400" aria-live="polite">
          {loading && (
            <span className="inline-flex items-center gap-1.5">
              <SpinnerIcon size={10} className="animate-spin" />
              {t('common:loading')}
            </span>
          )}
          {!loading && failed && <span className="text-danger-100">{t('chat:websearch.failed')}</span>}
          {!loading && !failed && loadFailed && (
            <span className="inline-flex items-center gap-2">
              <span className="text-danger-100">{t('chat:websearch.loadFailed')}</span>
              <button type="button" onClick={loadProviders} className="text-accent-main-100 hover:underline">
                {t('chat:websearch.retry')}
              </button>
            </span>
          )}
          {!loading && !failed && !loadFailed && options.length === 0 && <span>{t('chat:websearch.empty')}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!specific && (
            <button
              type="button"
              onClick={handleDisable}
              disabled={sending}
              className="px-2.5 py-1 text-[length:var(--fs-xs)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 rounded-md transition-colors disabled:opacity-50"
            >
              {t('chat:websearch.disable')}
            </button>
          )}
          <button
            type="button"
            onClick={handleEnable}
            disabled={sending || unavailable || !selected}
            className="px-2.5 py-1 text-[length:var(--fs-xs)] bg-accent-main-100 hover:bg-accent-main-200 text-oncolor-100 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {sending && <SpinnerIcon size={10} className="animate-spin" />}
            {t('chat:websearch.enable')}
          </button>
        </div>
      </div>
    </section>
  )
}
