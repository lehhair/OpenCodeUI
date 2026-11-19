import { useState, useEffect, useMemo, useRef, useId, useSyncExternalStore, useCallback } from 'react'
import type { ShikiThemeInput } from '../lib/shikiTheme'
import { getShikiTheme, useIsDarkMode } from '../lib/shikiTheme'
import { disposeShikiWorkerKey, highlightHtmlInWorker, highlightTokensInWorker, splitTokensIntoLines } from '../lib/shikiWorkerClient'
import type { HighlightTokens } from '../lib/highlightTypes'
import {
  applyHighlightChunk,
  createHighlightAccumulator,
  type HighlightAccumulator,
} from '../lib/highlightAccumulator'
import { normalizeLanguage } from '../utils/languageUtils'
import { BoundedCache } from '../utils/boundedCache'
import { finishPerf, startPerf } from '../utils/perfTrace'
import { THEME_SWITCH_DISABLE_MS } from '../constants'
import { themeStore } from '../store/themeStore'
import { reportRenderFailure } from '../utils/renderDiagnostics'
import { isHighlightLanguageCoolingDown, markHighlightLanguageFailed } from '../lib/highlightCooldown'

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
// 缓存层 - 避免重复高亮相同代码
// ============================================

const htmlCache = new BoundedCache<string, string>({
  maxEntries: 120,
  maxCost: 4 * 1024 * 1024,
  costOf: html => html.length,
})
const tokensCache = new BoundedCache<string, HighlightTokens>({
  maxEntries: 80,
  maxCost: 8 * 1024 * 1024,
  costOf: tokens => {
    // 字符量 + 每个 token 的对象开销，粗略但足够决定回收顺序
    let cost = 0
    for (const line of tokens) for (const token of line) cost += token.content.length + 24
    return cost
  },
})

/**
 * 超过这个长度就关掉语法高亮：token 数组是「每个 token 一个对象」，
 * 几 MB 的文本进来直接是几十万对象 + 几十万个 Decoration。
 * VS Code 也是大文件降级（关着色、关换行），这里取一个更保守的门槛。
 */
const MAX_HIGHLIGHT_CHARS = 160 * 1024
/** 超过这个长度的结果不进缓存：一两条大文件就能把 LRU 撑成几百 MB */
const MAX_CACHED_HIGHLIGHT_CHARS = 64 * 1024
/** 流式高亮的合并窗口：窗口内只把最新文本送给 worker */
const STREAMING_HIGHLIGHT_INTERVAL_MS = 48

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
  if (isHighlightLanguageCoolingDown(lang)) return null

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
    } catch (err) {
      reportRenderFailure('highlight', 'degraded', err)
      if (!(err instanceof Error) || err.message !== 'superseded') markHighlightLanguageFailed(lang)
      return null
    }
  } else {
    const cached = tokensCache.get(cacheKey)
    if (cached !== undefined) return cached

    try {
      const { stable } = await highlightTokensInWorker({
        key: `tokens:${cacheKey}:${highlightRequestId++}`,
        text: code,
        language: lang,
        theme,
        complete: true,
      })
      const tokens = splitTokensIntoLines(stable)
      if (cacheable) tokensCache.set(cacheKey, tokens)
      return tokens
    } catch (err) {
      reportRenderFailure('highlight', 'degraded', err)
      if (!(err instanceof Error) || err.message !== 'superseded') markHighlightLanguageFailed(lang)
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
  /** 按 worker key 累积增量 token；换语言/主题时整体丢弃 */
  const accumulatorRef = useRef<{ key: string; acc: HighlightAccumulator } | null>(null)

  const key = `${instanceId}:${normalizedLang}:${resolvedTheme.key}`

  // 流式高亮不必跟满帧：worker 侧是 latest-only，主线程如果每帧都 postMessage，
  // 只会反复结构化拷贝整段代码。这里固定一个合并窗口，窗口内只保留最后一次。
  const latestRef = useRef({
    code,
    enabled,
    key,
    language: normalizedLang,
    theme: resolvedTheme.theme,
  })
  const timerRef = useRef<number | null>(null)
  const lastRequestAtRef = useRef(0)
  const runRequestRef = useRef<() => void>(() => {})

  const scheduleRequest = useCallback(() => {
    if (timerRef.current !== null) return
    const wait = Math.max(0, STREAMING_HIGHLIGHT_INTERVAL_MS - (performance.now() - lastRequestAtRef.current))
    timerRef.current = window.setTimeout(() => runRequestRef.current(), wait)
  }, [])

  useEffect(() => {
    latestRef.current = { code, enabled, key, language: normalizedLang, theme: resolvedTheme.theme }

    runRequestRef.current = () => {
      timerRef.current = null
      const request = latestRef.current
      if (!request.enabled || isHighlightLanguageCoolingDown(request.language)) {
        setIsLoading(false)
        return
      }

      const isCurrent = () => latestRef.current.key === request.key && latestRef.current.enabled
      const currentAccumulator = accumulatorRef.current
      if (!currentAccumulator || currentAccumulator.key !== request.key) {
        accumulatorRef.current = { key: request.key, acc: createHighlightAccumulator() }
      }

      lastRequestAtRef.current = performance.now()
      setIsLoading(true)
      const startedAt = startPerf()

      void (async () => {
        try {
          const highlight = (forceReset?: boolean) =>
            highlightTokensInWorker({
              key: request.key,
              text: request.code,
              language: request.language,
              theme: request.theme,
              forceReset,
            })

          let chunk
          try {
            chunk = await highlight()
          } catch (err) {
            // 续传的前缀对不上（worker 侧流被丢弃或重开过）：带全量文本重开一次
            if (!(err instanceof Error) || err.message !== 'stream-desync') throw err
            chunk = await highlight(true)
          }
          if (!isCurrent()) return

          let state = accumulatorRef.current
          if (!state || state.key !== request.key) return
          let applied = applyHighlightChunk(state.acc, chunk)

          // 累积状态和 worker 对不上（上一拍被合并、或流被重开）：要一次全量重排
          if (!applied.ok) {
            chunk = await highlight(true)
            if (!isCurrent()) return
            state = accumulatorRef.current
            if (!state || state.key !== request.key) return
            applied = applyHighlightChunk(state.acc, chunk)
            if (!applied.ok) return
          }

          const tokens = applied.tokens
          setOutputState(prev => (prev?.code === chunk.code ? prev : { code: chunk.code, tokens }))
        } catch (err) {
          if (import.meta.env.DEV && err instanceof Error && err.message !== 'superseded') {
            reportRenderFailure('highlight', 'degraded', err)
          }
          // 语法/词法失败按语言冷却；superseded / 续传错位不是语法问题
          if (!(err instanceof Error) || (err.message !== 'superseded' && err.message !== 'stream-desync')) {
            markHighlightLanguageFailed(request.language)
          }
        } finally {
          finishPerf('highlight.stream', startedAt, 80, `${request.code.length} chars`)
          if (isCurrent()) setIsLoading(false)
        }
      })()
    }

    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      accumulatorRef.current = null
      if (workerKeyRef.current) {
        disposeShikiWorkerKey(workerKeyRef.current)
        workerKeyRef.current = ''
      }
      return
    }

    const previousKey = workerKeyRef.current
    if (previousKey && previousKey !== key) {
      disposeShikiWorkerKey(previousKey)
      accumulatorRef.current = null
      // 换语言/主题后旧 token 的颜色和语法都不对，先清掉等新结果
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 worker 的旧输出解耦，属于外部状态同步
      setOutputState(null)
      lastRequestAtRef.current = 0
    }
    workerKeyRef.current = key
    scheduleRequest()
  }, [code, enabled, key, normalizedLang, resolvedTheme.theme, scheduleRequest])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
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
        reportRenderFailure('highlight', 'degraded', err)
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
        reportRenderFailure('highlight', 'degraded', err)
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
