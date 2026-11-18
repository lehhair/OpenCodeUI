/**
 * 流式文本的显示节奏。
 *
 * 网络到达是突发的：一个 chunk 可能带来几十上百个字符，直接上屏就是整段
 * 跳出来。这里把「到达速率」和「显示速率」拆开，按固定节奏推进，积压多了
 * 加速追赶，追上了回到目标速率，屏幕上始终是连续出字。
 *
 * 纯函数部分与 React 解耦，方便单独验证节奏曲线。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface StreamPacingConfig {
  /** 目标：把当前积压揭示完的时间 */
  revealWithinMs: number
  /** 最低揭示速率（字符/秒） */
  minCharsPerSecond: number
  /** 最高揭示速率（字符/秒） */
  maxCharsPerSecond: number
  /** 速率变化缓动，避免起步/追赶时速率突变 */
  easingMs: number
  /** 单次推进的最大时间片，避免后台切回时一次冲过头 */
  maxStepMs: number
  /** 积压超过这个字符数就直接补齐，不再逐字追 */
  jumpLagChars: number
}

export const DEFAULT_STREAM_PACING: StreamPacingConfig = {
  revealWithinMs: 450,
  minCharsPerSecond: 80,
  maxCharsPerSecond: 600,
  easingMs: 250,
  maxStepMs: 100,
  jumpLagChars: 2400,
}

/** 两次提交之间的最小间隔，约等于 30fps */
const MIN_COMMIT_MS = 32

export interface StreamPacingStep {
  /** 推进后的已揭示字符数（浮点，提交时再取整） */
  revealed: number
  /** 当前速率（字符/秒） */
  rate: number
  /** 是否已经追平 */
  settled: boolean
  /** 是否因为积压过大直接补齐 */
  jumped: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * 推进一个显示节拍。
 *
 * @param target 目标字符数（已经到达的文本长度）
 * @param revealed 当前已揭示字符数
 * @param rate 当前速率（字符/秒），首次推进传 0
 * @param elapsedMs 距上次推进的毫秒数
 */
export function stepStreamPacing(
  target: number,
  revealed: number,
  rate: number,
  elapsedMs: number,
  config: Partial<StreamPacingConfig> = {},
): StreamPacingStep {
  const cfg = { ...DEFAULT_STREAM_PACING, ...config }

  if (target <= revealed) {
    return { revealed: target, rate: 0, settled: true, jumped: false }
  }

  const lag = target - revealed
  if (lag > cfg.jumpLagChars) {
    return { revealed: target, rate: 0, settled: true, jumped: true }
  }

  const dt = Math.max(0, Math.min(Number.isFinite(elapsedMs) ? elapsedMs : 0, cfg.maxStepMs))
  const revealWindow = Math.max(cfg.revealWithinMs, 1) / 1000
  const desired = clamp(lag / revealWindow, cfg.minCharsPerSecond, cfg.maxCharsPerSecond)

  // 起始没有上一拍速率时直接采用目标速率；之后按时间常数缓动
  const nextRate = rate > 0 && cfg.easingMs > 0 ? rate + (desired - rate) * (1 - Math.exp(-dt / cfg.easingMs)) : desired

  const next = revealed + (nextRate * dt) / 1000
  if (next >= target) {
    return { revealed: target, rate: 0, settled: true, jumped: false }
  }
  return { revealed: next, rate: nextRate, settled: false, jumped: false }
}

/**
 * 截断位置不能落在代理对中间，否则 emoji / 生僻字会短暂显示成半个字符。
 */
export function safeRevealIndex(text: string, index: number): number {
  if (index <= 0) return 0
  if (index >= text.length) return text.length
  // CRLF 当成一个整体，避免流式中出现悬空的 \r 被解析成额外换行
  if (text.charCodeAt(index - 1) === 13 && text.charCodeAt(index) === 10) return index - 1
  const code = text.charCodeAt(index)
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = text.charCodeAt(index - 1)
    if (previous >= 0xd800 && previous <= 0xdbff) return index - 1
  }
  return index
}

/** 系统开启「减少动态效果」时不做逐字揭示 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 把目标文本按节奏揭示。`enabled` 为 false、系统要求减少动效、或内容不是
 * 上一次的前缀扩展时，直接展示全文（流结束、重新生成、编辑都走这条路）。
 */
export function usePacedStreamContent(content: string, enabled: boolean): string {
  const [displayed, setDisplayed] = useState(content)
  const displayedRef = useRef(content)
  const targetRef = useRef(content)
  const revealedRef = useRef(content.length)
  const rateRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    lastTickRef.current = 0
  }, [])

  const commit = useCallback((text: string) => {
    displayedRef.current = text
    setDisplayed(text)
  }, [])

  useEffect(() => {
    const target = content
    targetRef.current = target

    if (!enabled || prefersReducedMotion() || !target.startsWith(displayedRef.current)) {
      stop()
      rateRef.current = 0
      revealedRef.current = target.length
      // 内容被替换 / 流结束 / 关闭动效时直接对齐：这是外部数据同步，
      // 不是可以由渲染推导出来的状态
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (displayedRef.current !== target) commit(target)
      return
    }

    if (target.length <= revealedRef.current) {
      if (displayedRef.current !== target) {
        revealedRef.current = target.length
        commit(target)
      }
      return
    }

    // 已经有循环在跑时只更新目标，由循环读取最新的 targetRef
    if (rafRef.current !== null) return

    lastTickRef.current = 0
    const tick = (timestamp: number) => {
      rafRef.current = null
      const elapsed = lastTickRef.current > 0 ? timestamp - lastTickRef.current : MIN_COMMIT_MS
      if (lastTickRef.current > 0 && elapsed < MIN_COMMIT_MS) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      lastTickRef.current = timestamp

      const live = targetRef.current
      if (!enabled || !live.startsWith(displayedRef.current)) {
        rateRef.current = 0
        revealedRef.current = live.length
        commit(live)
        return
      }

      const step = stepStreamPacing(live.length, revealedRef.current, rateRef.current, elapsed)
      rateRef.current = step.rate
      revealedRef.current = step.revealed

      const cut = safeRevealIndex(live, Math.floor(step.revealed))
      const next = cut >= live.length ? live : live.slice(0, cut)
      if (next !== displayedRef.current) commit(next)

      if (step.settled) {
        rateRef.current = 0
        lastTickRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [commit, content, enabled, stop])

  useEffect(() => stop, [stop])

  return displayed
}
