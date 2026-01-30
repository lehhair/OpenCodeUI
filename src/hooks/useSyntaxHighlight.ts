import { useState, useEffect } from 'react'
import { codeToHtml, codeToTokens, type BundledTheme } from 'shiki'
import { normalizeLanguage } from '../utils/languageUtils'

// 根据主题模式选择 shiki 主题
export function getShikiTheme(isDark: boolean): BundledTheme {
  return isDark ? 'github-dark' : 'github-light'
}

// 检测当前是否为深色主题
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const mode = document.documentElement.getAttribute('data-mode')
    if (mode === 'light') return false
    if (mode === 'dark') return true
    // system 模式，检测系统偏好
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    // 监听 data-mode 属性变化
    const observer = new MutationObserver(() => {
      const mode = document.documentElement.getAttribute('data-mode')
      if (mode === 'light') {
        setIsDark(false)
      } else if (mode === 'dark') {
        setIsDark(true)
      } else {
        // system 模式
        setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode']
    })

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      const mode = document.documentElement.getAttribute('data-mode')
      if (!mode || mode === 'system') {
        setIsDark(e.matches)
      }
    }
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      observer.disconnect()
      mediaQuery.removeEventListener('change', handleChange)
    }
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
    
    // Reset immediately to prevent stale content
    setOutput(null)
    setIsLoading(true)

    async function highlight() {
      try {
        if (mode === 'html') {
          const html = await codeToHtml(code, { lang: normalizedLang as any, theme: selectedTheme })
          if (!cancelled) setOutput(html)
        } else {
          const result = await codeToTokens(code, { lang: normalizedLang as any, theme: selectedTheme })
          if (!cancelled) setOutput(result.tokens)
        }
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
