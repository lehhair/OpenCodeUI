import { useState, useEffect, useMemo, useRef, useId, useSyncExternalStore } from 'react'
import type { ShikiThemeInput } from '../lib/shikiTheme'
import { getShikiTheme, useIsDarkMode } from '../lib/shikiTheme'
import { disposeShikiWorkerKey, highlightHtmlInWorker, highlightTokensInWorker } from '../lib/shikiWorkerClient'
import type { HighlightTokens } from '../lib/highlightTypes'
import { normalizeLanguage } from '../utils/languageUtils'
import { THEME_SWITCH_DISABLE_MS } from '../constants'
import { themeStore } from '../store/themeStore'

export type { HighlightTokens } from '../lib/highlightTypes'
export type { ShikiThemeInput } from '../lib/shikiTheme'

// ============================================
// 代码块主题订阅（仅在 codeBlockThemeLight/Dark 变化时触发 re-render）
// ============================================

function codeBlockThemeKey(): string {
  const s = themeStore.getState()
  return s.codeBlockThemeLight + '|' + s.codeBlockThemeDark
}

function useCodeBlockThemes(): { light: string; dark: string } {
  // 订阅派生字符串，避免其它 appearance 字段变化时让所有代码块重渲染
  useSyncExternalStore(themeStore.subscribe, codeBlockThemeKey)
  const s = themeStore.getState()
  return { light: s.codeBlockThemeLight, dark: s.codeBlockThemeDark }
}

type IdleWindowApi = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (id: number) => void
}

type HighlightTask = () => Promise<void>

// ============================================
// LRU 缓存层 - 避免重复高亮相同代码
// ============================================

interface CacheEntry<T> {
  value: T
  /** 估算成本（字符量 / token 数），用于按总量回收 */
  cost: number
}

/**
 * 带成本预算的 LRU。
 *
 * 原来的实现只按条数回收：80 条 token 数组，赶上几个大文件就是几百 MB。
 * 现在同时受条数和总量限制，读命中也会移到队尾（真正的 LRU）。
 */
class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private totalCost = 0
  private readonly maxSize: number
  private readonly maxCost: number
  private readonly costOf: (value: T) => number

  constructor(maxSize: number, maxCost = Number.POSITIVE_INFINITY, costOf: (value: T) => number = () => 1) {
    this.maxSize = maxSize
    this.maxCost = maxCost
    this.costOf = costOf
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    const cost = this.costOf(value)
    const existing = this.cache.get(key)
    if (existing) {
      this.totalCost -= existing.cost
      existing.value = value
      existing.cost = cost
      this.cache.delete(key)
      this.cache.set(key, existing)
    } else {
      this.cache.set(key, { value, cost })
    }
    this.totalCost += cost
    this.trim()
  }

  private trim(): void {
    while (this.cache.size > this.maxSize || this.totalCost > this.maxCost) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.totalCost -= this.cache.get(oldest)?.cost ?? 0
      this.cache.delete(oldest)
    }
  }

  clear(): void {
    this.cache.clear()
    this.totalCost = 0
  }

  get size(): number {
    return this.cache.size
  }
}

const htmlCache = new LRUCache<string>(120, 4 * 1024 * 1024, html => html.length)
const tokensCache = new LRUCache<HighlightTokens>(80, 8 * 1024 * 1024, tokens => {
  // 字符量 + 每个 token 的对象开销，粗略但足够决定回收顺序
  let cost = 0
  for (const line of tokens) for (const token of line) cost += token.content.length + 24
  return cost
})

/**
 * 超过这个长度就关掉语法高亮：token 数组是「每个 token 一个对象」，
 * 几 MB 的文本进来直接是几十万对象 + 几十万个 Decoration。
 * VS Code 也是大文件降级（关着色、关换行），这里取一个更保守的门槛。
 */
const MAX_HIGHLIGHT_CHARS = 160 * 1024
/** 超过这个长度的结果不进缓存：一两条大文件就能把 LRU 撑成几百 MB */
const MAX_CACHED_HIGHLIGHT_CHARS = 64 * 1024

const highlightQueue: HighlightTask[] = []
let highlightQueueRunning = false
let highlightRequestId = 0

function scheduleQueuedHighlight(task: HighlightTask): () => void {
  let cancelled = false
  highlightQueue.push(async () => {
    if (!cancelled) await task()
  })
  void runHighlightQueue()

  return () => {
    cancelled = true
  }
}

async function runHighlightQueue() {
  if (highlightQueueRunning) return
  highlightQueueRunning = true

  try {
    while (highlightQueue.length > 0) {
      const task = highlightQueue.shift()
      if (task) await task()
      await yieldToMainThread()
    }
  } finally {
    highlightQueueRunning = false
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, 0)
  })
}

function getCacheKey(code: string, lang: string, theme: string): string {
  const codeHash = simpleHash(code)
  return `${codeHash}:${lang}:${theme}`
}

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return hash
}

async function highlightWithCache(
  code: string,
  lang: string,
  theme: ShikiThemeInput,
  themeKey: string,
  mode: 'html' | 'tokens',
): Promise<string | HighlightTokens | null> {
  const cacheKey = getCacheKey(code, lang, themeKey)
  const cacheable = code.length <= MAX_CACHED_HIGHLIGHT_CHARS

  if (mode === 'html') {
    const cached = htmlCache.get(cacheKey)
    if (cached !== undefined) return cached

    try {
      const { html } = await highlightHtmlInWorker({
        key: `html:${cacheKey}:${highlightRequestId++}`,
        text: code,
        language: lang,
        theme,
      })
      if (cacheable) htmlCache.set(cacheKey, html)
      return html
    } catch {
      return null
    }
  } else {
    const cached = tokensCache.get(cacheKey)
    if (cached !== undefined) return cached

    try {
      const { tokens } = await highlightTokensInWorker({
        key: `tokens:${cacheKey}:${highlightRequestId++}`,
        text: code,
        language: lang,
        theme,
        complete: true,
      })
      if (cacheable) tokensCache.set(cacheKey, tokens)
      return tokens
    } catch {
      return null
    }
  }
}

export function getHighlightCacheStats() {
  return {
    htmlCacheSize: htmlCache.size,
    tokensCacheSize: tokensCache.size,
  }
}

export function clearHighlightCache() {
  htmlCache.clear()
  tokensCache.clear()
}

export { getShikiTheme }

// ============================================
// Hooks
// ============================================

export interface HighlightOptions {
  lang?: string
  theme?: ShikiThemeInput
  enabled?: boolean
  delayMs?: number
}

/**
 * 流式语法高亮 —— 用于流式输出的代码块。
 * worker 侧已按 key latest-only；主线程再 rAF 合并 code，避免每 token 都 postMessage / setState。
 * 无缓存（流式内容每次都不同）；落后结果用 plain suffix 垫着（CodeBlock）。
 */
export function useStreamingSyntaxHighlight(
  code: string,
  options: HighlightOptions = {},
): { output: HighlightTokens | null; highlightedCode: string; isLoading: boolean } {
  const { lang = 'text', theme } = options
  const enabled = (options.enabled ?? true) && code.length <= MAX_HIGHLIGHT_CHARS
  const normalizedLang = normalizeLanguage(lang)
  const isDark = useIsDarkMode()
  const codeBlockThemes = useCodeBlockThemes()
  const instanceId = useId()
  const resolvedTheme = useMemo(() => {
    if (theme) return { theme, key: theme }
    return getShikiTheme(isDark, codeBlockThemes.light, codeBlockThemes.dark)
  }, [theme, isDark, codeBlockThemes.light, codeBlockThemes.dark])

  const [outputState, setOutputState] = useState<{ code: string; tokens: HighlightTokens } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const workerKeyRef = useRef('')
  const codeRef = useRef(code)
  codeRef.current = code

  const key = `${instanceId}:${normalizedLang}:${resolvedTheme.key}`

  useEffect(() => {
    if (!enabled) {
      if (workerKeyRef.current) {
        disposeShikiWorkerKey(workerKeyRef.current)
        workerKeyRef.current = ''
      }
      setIsLoading(false)
      return
    }

    let cancelled = false
    const previousKey = workerKeyRef.current
    if (previousKey && previousKey !== key) disposeShikiWorkerKey(previousKey)
    workerKeyRef.current = key

    // 同帧多次 code 变更只打一次 worker（读 codeRef 拿最新文本）
    const frame = requestAnimationFrame(() => {
      if (cancelled) return
      const text = codeRef.current
      setIsLoading(true)
      void highlightTokensInWorker({ key, text, language: normalizedLang, theme: resolvedTheme.theme })
        .then(result => {
          if (cancelled) return
          setOutputState(prev => (prev?.code === result.code ? prev : { code: result.code, tokens: result.tokens }))
        })
        .catch(err => {
          if (import.meta.env.DEV && err instanceof Error && err.message !== 'superseded') {
            console.warn('[Syntax] streaming Shiki worker error:', err)
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [code, enabled, key, normalizedLang, resolvedTheme.theme])

  useEffect(() => {
    return () => {
      if (workerKeyRef.current) disposeShikiWorkerKey(workerKeyRef.current)
    }
  }, [])

  const currentOutput = enabled && outputState && code.startsWith(outputState.code) ? outputState : null
  return {
    output: currentOutput?.tokens ?? null,
    highlightedCode: currentOutput?.code ?? '',
    isLoading: enabled && isLoading,
  }
}

// Overload for HTML mode (default)
export function useSyntaxHighlight(
  code: string,
  options?: HighlightOptions & { mode?: 'html' },
): { output: string | null; isLoading: boolean }
// Overload for Tokens mode
export function useSyntaxHighlight(
  code: string,
  options: HighlightOptions & { mode: 'tokens' },
): { output: HighlightTokens | null; isLoading: boolean }

export function useSyntaxHighlight(code: string, options: HighlightOptions & { mode?: 'html' | 'tokens' } = {}) {
  const { lang = 'text', theme, mode = 'html', delayMs = 0 } = options
  const enabled = (options.enabled ?? true) && code.length <= MAX_HIGHLIGHT_CHARS
  const normalizedLang = normalizeLanguage(lang)

  const isDark = useIsDarkMode()
  const codeBlockThemes = useCodeBlockThemes()

  const resolvedTheme = useMemo(() => {
    if (theme) {
      return { theme, key: theme }
    }
    return getShikiTheme(isDark, codeBlockThemes.light, codeBlockThemes.dark)
  }, [theme, isDark, codeBlockThemes.light, codeBlockThemes.dark])

  // 关掉高亮时不要再去哈希整段文本：大代码块/大 diff 的 simpleHash 是 O(n)
  const cacheKey = useMemo(
    () => (enabled ? getCacheKey(code, normalizedLang, resolvedTheme.key) : ''),
    [code, enabled, normalizedLang, resolvedTheme.key],
  )
  const outputKey = `${mode}:${cacheKey}`
  const [outputState, setOutputState] = useState<{ key: string; value: string | HighlightTokens | null } | null>(() => {
    if (!cacheKey) return null
    const cachedResult = mode === 'html' ? htmlCache.get(cacheKey) : tokensCache.get(cacheKey)
    return cachedResult !== undefined ? { key: outputKey, value: cachedResult } : null
  })
  const [isLoading, setIsLoading] = useState(false)
  const prevKeyRef = useRef<{ code: string; lang: string; themeKey: string } | null>(null)

  useEffect(() => {
    if (!enabled) {
      setOutputState(null)
      setIsLoading(false)
      return
    }

    const cachedResult = mode === 'html' ? htmlCache.get(cacheKey) : tokensCache.get(cacheKey)
    if (cachedResult !== undefined) {
      setOutputState({ key: outputKey, value: cachedResult })
      setIsLoading(false)
      return
    }

    let cancelled = false
    const prevKey = prevKeyRef.current
    const isThemeOnlyChange =
      !!prevKey && prevKey.code === code && prevKey.lang === normalizedLang && prevKey.themeKey !== resolvedTheme.key
    prevKeyRef.current = { code, lang: normalizedLang, themeKey: resolvedTheme.key }

    const shouldDefer = isThemeOnlyChange

    setIsLoading(true)

    async function highlight() {
      try {
        const result = await highlightWithCache(code, normalizedLang, resolvedTheme.theme, resolvedTheme.key, mode)
        if (!cancelled) setOutputState({ key: outputKey, value: result })
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[Syntax] Shiki error:', err)
        }
        if (!cancelled) setOutputState({ key: outputKey, value: null })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    const schedule = () => {
      if (shouldDefer) {
        const idleWindow = window as Window & IdleWindowApi
        if (typeof idleWindow.requestIdleCallback === 'function') {
          const idleId = idleWindow.requestIdleCallback(
            () => {
              void highlight()
            },
            {
              timeout: THEME_SWITCH_DISABLE_MS * 2,
            },
          )
          return () => idleWindow.cancelIdleCallback?.(idleId)
        }
        const timeoutId = window.setTimeout(() => highlight(), THEME_SWITCH_DISABLE_MS)
        return () => clearTimeout(timeoutId)
      }
      if (delayMs > 0) {
        let cancelQueuedHighlight: (() => void) | null = null
        const timeoutId = window.setTimeout(() => {
          cancelQueuedHighlight = scheduleQueuedHighlight(highlight)
        }, delayMs)
        return () => {
          clearTimeout(timeoutId)
          cancelQueuedHighlight?.()
        }
      }
      return scheduleQueuedHighlight(highlight)
    }

    const cancelSchedule = schedule()

    return () => {
      cancelled = true
      cancelSchedule()
    }
  }, [cacheKey, code, delayMs, enabled, mode, normalizedLang, outputKey, resolvedTheme])

  return { output: outputState?.key === outputKey ? outputState.value : null, isLoading }
}

// ============================================
// Ref 版本 — tokens 不经过 React state/props
// 用于 CodePreview 等需要处理超大 token 数组的场景
// ============================================

export function useSyntaxHighlightRef(
  code: string,
  options: Omit<HighlightOptions, 'mode'> = {},
): { tokensRef: React.RefObject<HighlightTokens | null>; version: number } {
  const { lang = 'text', theme } = options
  const enabled = (options.enabled ?? true) && code.length <= MAX_HIGHLIGHT_CHARS
  const normalizedLang = normalizeLanguage(lang)

  const isDark = useIsDarkMode()
  const codeBlockThemes = useCodeBlockThemes()
  const resolvedTheme = useMemo(() => {
    if (theme) {
      return { theme, key: theme }
    }
    return getShikiTheme(isDark, codeBlockThemes.light, codeBlockThemes.dark)
  }, [theme, isDark, codeBlockThemes.light, codeBlockThemes.dark])

  const tokensRef = useRef<HighlightTokens | null>(null)
  const [version, setVersion] = useState(0)
  const prevKeyRef = useRef<{ code: string; lang: string; themeKey: string } | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    const prevKey = prevKeyRef.current
    const isThemeOnlyChange =
      !!prevKey && prevKey.code === code && prevKey.lang === normalizedLang && prevKey.themeKey !== resolvedTheme.key
    prevKeyRef.current = { code, lang: normalizedLang, themeKey: resolvedTheme.key }

    const shouldDefer = isThemeOnlyChange

    const cacheKey = getCacheKey(code, normalizedLang, resolvedTheme.key)
    const cachedResult = tokensCache.get(cacheKey)

    if (cachedResult !== undefined) {
      tokensRef.current = cachedResult
      setVersion(v => v + 1) // eslint-disable-line react-hooks/set-state-in-effect -- 缓存命中时需同步通知消费者
      return
    }

    if (!isThemeOnlyChange) {
      tokensRef.current = null
    }

    async function highlight() {
      try {
        const result = await highlightWithCache(code, normalizedLang, resolvedTheme.theme, resolvedTheme.key, 'tokens')
        if (!cancelled) {
          tokensRef.current = result as HighlightTokens | null
          setVersion(v => v + 1)
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[Syntax] Shiki error:', err)
        }
        if (!cancelled) {
          tokensRef.current = null
          setVersion(v => v + 1)
        }
      }
    }

    const schedule = () => {
      if (shouldDefer) {
        const idleWindow = window as Window & IdleWindowApi
        if (typeof idleWindow.requestIdleCallback === 'function') {
          const idleId = idleWindow.requestIdleCallback(
            () => {
              void highlight()
            },
            { timeout: THEME_SWITCH_DISABLE_MS * 2 },
          )
          return () => idleWindow.cancelIdleCallback?.(idleId)
        }
        const timeoutId = window.setTimeout(() => highlight(), THEME_SWITCH_DISABLE_MS)
        return () => clearTimeout(timeoutId)
      }
      return scheduleQueuedHighlight(highlight)
    }

    const cancelSchedule = schedule()

    return () => {
      cancelled = true
      cancelSchedule()
    }
  }, [code, normalizedLang, resolvedTheme, enabled])

  return { tokensRef, version }
}
