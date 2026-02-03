import { useState, useEffect } from 'react'
import { codeToHtml, codeToTokens, type BundledTheme } from 'shiki'
import { normalizeLanguage } from '../utils/languageUtils'

// ============================================
// LRU 缓存层 - 避免重复高亮相同代码
// ============================================

interface CacheEntry<T> {
  value: T
  timestamp: number
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize: number
  
  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }
  
  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      // 更新时间戳（LRU）
      entry.timestamp = Date.now()
      return entry.value
    }
    return undefined
  }
  
  set(key: string, value: T): void {
    // 如果已存在，更新
    if (this.cache.has(key)) {
      this.cache.get(key)!.value = value
      this.cache.get(key)!.timestamp = Date.now()
      return
    }
    
    // 如果满了，删除最老的
    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [k, v] of this.cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp
          oldestKey = k
        }
      }
      if (oldestKey) this.cache.delete(oldestKey)
    }
    
    this.cache.set(key, { value, timestamp: Date.now() })
  }
  
  clear(): void {
    this.cache.clear()
  }
  
  get size(): number {
    return this.cache.size
  }
}

// 全局缓存实例 - HTML 和 Tokens 分开缓存
// 增加缓存大小以支持长对话
const htmlCache = new LRUCache<string>(500)
const tokensCache = new LRUCache<any[][]>(200)

// 代码长度限制 - 超过此长度跳过高亮
const MAX_CODE_LENGTH = 50000 // 50KB
const MAX_LINES_FOR_HIGHLIGHT = 1000

// 生成缓存 key
function getCacheKey(code: string, lang: string, theme: string): string {
  // 使用简单 hash 减少 key 长度
  const codeHash = simpleHash(code)
  return `${codeHash}:${lang}:${theme}`
}

// 简单的字符串 hash
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash
}

// 检查代码是否应该跳过高亮
function shouldSkipHighlight(code: string): boolean {
  if (code.length > MAX_CODE_LENGTH) return true
  const lineCount = code.split('\n').length
  if (lineCount > MAX_LINES_FOR_HIGHLIGHT) return true
  return false
}

// 带缓存的高亮函数
async function highlightWithCache(
  code: string,
  lang: string,
  theme: BundledTheme,
  mode: 'html' | 'tokens'
): Promise<string | any[][] | null> {
  // 检查是否应该跳过
  if (shouldSkipHighlight(code)) {
    if (import.meta.env.DEV) {
      console.debug('[Syntax] Skipping highlight for large code block:', code.length, 'chars')
    }
    return null
  }
  
  const cacheKey = getCacheKey(code, lang, theme)
  
  if (mode === 'html') {
    const cached = htmlCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    
    const html = await codeToHtml(code, { lang: lang as any, theme })
    htmlCache.set(cacheKey, html)
    return html
  } else {
    const cached = tokensCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    
    const result = await codeToTokens(code, { lang: lang as any, theme })
    tokensCache.set(cacheKey, result.tokens)
    return result.tokens
  }
}

// 导出缓存统计（调试用）
export function getHighlightCacheStats() {
  return {
    htmlCacheSize: htmlCache.size,
    tokensCacheSize: tokensCache.size
  }
}

// 清除缓存（主题切换时可能需要）
export function clearHighlightCache() {
  htmlCache.clear()
  tokensCache.clear()
}

// ============================================

// 根据主题模式选择 shiki 主题
export function getShikiTheme(isDark: boolean): BundledTheme {
  return isDark ? 'github-dark' : 'github-light'
}

// ============================================
// 全局主题状态单例 - 避免每个 CodeBlock 都创建监听器
// ============================================

class ThemeStateManager {
  private isDark: boolean
  private subscribers = new Set<(isDark: boolean) => void>()
  private observer: MutationObserver | null = null
  private mediaQuery: MediaQueryList | null = null
  
  constructor() {
    this.isDark = this.detectTheme()
    this.setupListeners()
  }
  
  private detectTheme(): boolean {
    if (typeof window === 'undefined') return true
    const mode = document.documentElement.getAttribute('data-mode')
    if (mode === 'light') return false
    if (mode === 'dark') return true
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  
  private setupListeners() {
    if (typeof window === 'undefined') return
    
    // 监听 data-mode 属性变化
    this.observer = new MutationObserver(() => {
      const newIsDark = this.detectTheme()
      if (newIsDark !== this.isDark) {
        this.isDark = newIsDark
        this.notify()
      }
    })
    
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode']
    })
    
    // 监听系统主题变化
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const mode = document.documentElement.getAttribute('data-mode')
      if (!mode || mode === 'system') {
        const newIsDark = this.mediaQuery!.matches
        if (newIsDark !== this.isDark) {
          this.isDark = newIsDark
          this.notify()
        }
      }
    }
    this.mediaQuery.addEventListener('change', handleChange)
  }
  
  private notify() {
    this.subscribers.forEach(fn => fn(this.isDark))
  }
  
  getIsDark(): boolean {
    return this.isDark
  }
  
  subscribe(fn: (isDark: boolean) => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }
}

// 全局单例
let themeStateManager: ThemeStateManager | null = null

function getThemeStateManager(): ThemeStateManager {
  if (!themeStateManager) {
    themeStateManager = new ThemeStateManager()
  }
  return themeStateManager
}

// 使用全局单例的 hook
function useIsDarkMode(): boolean {
  const manager = getThemeStateManager()
  const [isDark, setIsDark] = useState(() => manager.getIsDark())
  
  useEffect(() => {
    return manager.subscribe(setIsDark)
  }, [])
  
  return isDark
}

export interface HighlightOptions {
  lang?: string
  theme?: BundledTheme
  enabled?: boolean
}

// Overload for HTML mode (default)
export function useSyntaxHighlight(code: string, options?: HighlightOptions & { mode?: 'html' }): { output: string | null; isLoading: boolean }
// Overload for Tokens mode
export function useSyntaxHighlight(code: string, options: HighlightOptions & { mode: 'tokens' }): { output: any[][] | null; isLoading: boolean }

export function useSyntaxHighlight(code: string, options: HighlightOptions & { mode?: 'html' | 'tokens' } = {}) {
  const { lang = 'text', theme, mode = 'html', enabled = true } = options
  const normalizedLang = normalizeLanguage(lang)
  
  // 自动检测当前主题模式
  const isDark = useIsDarkMode()
  
  // 如果没有指定主题，则根据 isDark 自动选择
  const selectedTheme = theme || getShikiTheme(isDark)
  
  const [output, setOutput] = useState<string | any[][] | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    
    // 先检查缓存 - 同步返回避免闪烁
    const cacheKey = getCacheKey(code, normalizedLang, selectedTheme)
    const cachedResult = mode === 'html' 
      ? htmlCache.get(cacheKey) 
      : tokensCache.get(cacheKey)
    
    if (cachedResult !== undefined) {
      setOutput(cachedResult)
      setIsLoading(false)
      return
    }
    
    // 没有缓存，异步高亮
    setOutput(null)
    setIsLoading(true)

    async function highlight() {
      try {
        const result = await highlightWithCache(code, normalizedLang, selectedTheme, mode)
        if (!cancelled) setOutput(result)
      } catch (err) {
        // Syntax highlighting error - silently fallback
        if (import.meta.env.DEV) {
          console.warn('[Syntax] Shiki error:', err)
        }
        if (!cancelled) setOutput(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    highlight()

    return () => { cancelled = true }
  }, [code, normalizedLang, selectedTheme, mode, enabled])

  return { output, isLoading }
}
