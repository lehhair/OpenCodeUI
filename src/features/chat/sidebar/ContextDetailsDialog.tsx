import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui'
import { CodeBlock } from '../../../components/CodeBlock'
import { ChevronDownIcon, ChevronUpIcon, CpuIcon, DollarSignIcon } from '../../../components/Icons'
import { useMessageStore } from '../../../store'
import { useSessionStats, formatTokens, formatCost } from '../../../hooks'
import type { Message, TokenUsage } from '../../../types/message'

interface ContextDetailsDialogProps {
  isOpen: boolean
  onClose: () => void
  contextLimit: number
}

function tokenTotal(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) return '—'
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[length:var(--fs-xs)] font-medium text-text-400">{label}</div>
      <div className="text-[length:var(--fs-base)] text-text-200 font-mono truncate" title={value}>
        {value}
      </div>
    </div>
  )
}

export function ContextDetailsDialog({ isOpen, onClose, contextLimit }: ContextDetailsDialogProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { sessionId, messages } = useMessageStore()
  const stats = useSessionStats(contextLimit)

  const [expandedId, setExpandedId] = useState<string | null>(null)

  const lastAssistantWithTokens = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info.role !== 'assistant') continue
      const total = tokenTotal(msg.info.tokens)
      if (total <= 0) continue
      return { msg, total }
    }
    return undefined
  }, [messages])

  const counts = useMemo(() => {
    let user = 0
    let assistant = 0
    for (const m of messages) {
      if (m.info.role === 'user') user++
      else assistant++
    }
    return { all: messages.length, user, assistant }
  }, [messages])

  const contextUsagePercent = useMemo(() => {
    const total = lastAssistantWithTokens?.total
    if (!total || contextLimit <= 0) return null
    return Math.round((total / contextLimit) * 100)
  }, [lastAssistantWithTokens, contextLimit])

  const contextMsg = lastAssistantWithTokens?.msg
  const contextTokens = contextMsg?.info.role === 'assistant' ? contextMsg.info.tokens : undefined
  const contextTotal = lastAssistantWithTokens?.total

  const handleToggleMessage = useCallback((msg: Message) => {
    const id = msg.info.id
    setExpandedId(prev => (prev === id ? null : id))
  }, [])

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('contextDetails.context')} width={900} className="w-full">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Stat label={t('contextDetails.session')} value={sessionId || '—'} />
          <Stat
            label={t('contextDetails.messages')}
            value={`${counts.all} (user ${counts.user}, assistant ${counts.assistant})`}
          />
          <Stat
            label={t('contextDetails.provider')}
            value={contextMsg?.info.role === 'assistant' ? contextMsg.info.providerID : '—'}
          />
          <Stat
            label={t('contextDetails.model')}
            value={contextMsg?.info.role === 'assistant' ? contextMsg.info.modelID : '—'}
          />
          <Stat label={t('contextDetails.contextLimit')} value={formatTokens(contextLimit)} />
          <Stat label={t('contextDetails.totalTokens')} value={contextTotal ? formatTokens(contextTotal) : '—'} />
          <Stat
            label={t('contextDetails.usage')}
            value={contextUsagePercent === null ? '—' : `${contextUsagePercent}%`}
          />
          <Stat label={t('contextDetails.totalCost')} value={formatCost(stats.totalCost)} />
        </div>

        {contextTokens && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-border-200/50 bg-bg-200/20">
            <Stat label={t('contextDetails.inputTokens')} value={formatTokens(contextTokens.input)} />
            <Stat label={t('contextDetails.outputTokens')} value={formatTokens(contextTokens.output)} />
            <Stat label={t('contextDetails.reasoning')} value={formatTokens(contextTokens.reasoning)} />
            <Stat
              label={t('contextDetails.cacheRW')}
              value={`${formatTokens(contextTokens.cache.read)} / ${formatTokens(contextTokens.cache.write)}`}
            />
          </div>
        )}

        {contextMsg && (
          <div className="flex items-center justify-between text-[length:var(--fs-xs)] text-text-400">
            <div className="flex items-center gap-2">
              <CpuIcon size={14} className="opacity-60" />
              <span className="font-mono">last: {contextMsg.info.id}</span>
            </div>
            <span className="tabular-nums">{formatTimestamp(contextMsg.info.time?.created)}</span>
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="text-[length:var(--fs-xs)] font-medium text-text-400 mb-2">{t('contextDetails.rawMessages')}</div>
        <div className="space-y-1">
          {messages.map(msg => {
            const isExpanded = expandedId === msg.info.id

            const headerLabel = `${msg.info.role} • ${msg.info.id}`
            const time = formatTimestamp(msg.info.time?.created)

            const assistantTokens = msg.info.role === 'assistant' ? tokenTotal(msg.info.tokens) : null
            const assistantCost = msg.info.role === 'assistant' ? msg.info.cost : null

            return (
              <div key={msg.info.id} className="rounded-lg border border-border-200/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleToggleMessage(msg)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left bg-bg-100 hover:bg-bg-200/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-[length:var(--fs-sm)] text-text-200 font-mono truncate" title={headerLabel}>
                      {headerLabel}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[length:var(--fs-xxs)] text-text-500 font-mono">
                      <span className="tabular-nums">{time}</span>
                      {assistantTokens !== null && (
                        <>
                          <span className="opacity-30">·</span>
                          <span className="flex items-center gap-1">
                            <CpuIcon size={10} className="opacity-60" />
                            {formatTokens(assistantTokens)}
                          </span>
                        </>
                      )}
                      {assistantCost !== null && assistantCost > 0 && (
                        <>
                          <span className="opacity-30">·</span>
                          <span className="flex items-center gap-1">
                            <DollarSignIcon size={10} className="opacity-60" />
                            {formatCost(assistantCost)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2 text-text-400">
                    {isExpanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="p-3 bg-bg-000 border-t border-border-200/50">
                    <CodeBlock
                      code={JSON.stringify({ message: msg.info, parts: msg.parts }, null, 2)}
                      language="json"
                      maxHeight={420}
                      className="select-text"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
