// ============================================
// BtwDialog — /btw 侧问对话框（官方 session/btw 同款）
//
// 就当前会话提一个一次性问题：session.generate 直接作答，
// 不调工具、不落转写。同一会话重复提问时中止上一个请求。
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Button } from './ui'
import { SpinnerIcon, AlertCircleIcon } from './Icons'
import { MarkdownRenderer } from './MarkdownRenderer'
import { generateSessionAnswer } from '../api'

const INSTRUCTIONS = [
  'The user is asking a quick side question about the conversation so far.',
  'Answer directly and concisely in markdown from what you already know.',
  'Do not call any tools and do not take any actions.',
].join(' ')

interface BtwDialogProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string | null
  serverId?: string
  /** 打开时预填的问题（/btw <question> 带参数时直接提问） */
  initialQuestion?: string
  /** nonce 变化才触发自动提问，允许同一问题重复问 */
  askNonce?: number
}

export function BtwDialog({ isOpen, onClose, sessionId, serverId, initialQuestion, askNonce }: BtwDialogProps) {
  const { t } = useTranslation('chat')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const askedNonceRef = useRef<number | undefined>(undefined)

  const ask = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed || !sessionId) return
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setQuestion(trimmed)
      setAnswer('')
      setError(false)
      setPending(true)
      try {
        const text = await generateSessionAnswer(sessionId, [INSTRUCTIONS, trimmed].join('\n\n'), serverId, controller.signal)
        if (controller.signal.aborted) return
        setAnswer(text.trim())
        setPending(false)
      } catch {
        if (controller.signal.aborted) return
        setError(true)
        setPending(false)
      }
    },
    [sessionId, serverId],
  )

  // 带参数打开时自动提问（nonce 触发，同一问题可重复问）
  useEffect(() => {
    if (!isOpen || askNonce === undefined || askedNonceRef.current === askNonce) return
    askedNonceRef.current = askNonce
    if (initialQuestion?.trim()) void ask(initialQuestion)
  }, [isOpen, askNonce, initialQuestion, ask])

  // 关闭/卸载时中止进行中的请求（官方 onCleanup abort 同款）
  useEffect(() => {
    if (!isOpen) {
      controllerRef.current?.abort()
      controllerRef.current = null
      setPending(false)
    }
  }, [isOpen])
  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    [],
  )

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('btw.title')} width={560}>
      <div className="flex flex-col gap-3">
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('btw.description')}</p>

        <form
          className="flex items-start gap-2"
          onSubmit={event => {
            event.preventDefault()
            void ask(question)
          }}
        >
          <input
            type="text"
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder={t('btw.placeholder')}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-border-200 bg-bg-100 px-3 py-2 text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-border-100"
          />
          <Button type="submit" variant="primary" disabled={pending || !question.trim()}>
            {pending ? t('common:processing') : t('btw.ask')}
          </Button>
        </form>

        {pending && (
          <div role="status" className="flex items-center gap-2 text-[length:var(--fs-sm)] text-text-400">
            <SpinnerIcon size={13} className="animate-spin" />
            <span>{t('btw.asking')}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-[length:var(--fs-sm)] text-danger-100">
            <AlertCircleIcon size={13} />
            <span>{t('btw.failed')}</span>
          </div>
        )}

        {answer && (
          <div className="rounded-lg border border-border-200/60 bg-bg-200/40 px-3 py-2.5">
            <MarkdownRenderer content={answer} />
          </div>
        )}
      </div>
    </Dialog>
  )
}
