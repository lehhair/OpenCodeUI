import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { THEME_SWITCH_DISABLE_MS } from '../constants'
import { themeStore, type ColorMode } from '../store/themeStore'

// 保持向后兼容的类型别名
export type ThemeMode = ColorMode

export function useTheme() {
  // 订阅 themeStore 变化
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  
  const skipNextTransitionRef = useRef(false)
  
  // 解析实际生效的亮/暗模式
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => themeStore.getResolvedMode())
  
  // 同步 resolvedTheme
  useEffect(() => {
    setResolvedTheme(themeStore.getResolvedMode())
  }, [state])
  
  // 监听系统主题变化（仅 system 模式下需要）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (state.colorMode === 'system') {
        setResolvedTheme(mediaQuery.matches ? 'dark' : 'light')
      }
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [state.colorMode])

  // ---- Color Mode (日夜模式) ----
  
  const setTheme = useCallback((newMode: ThemeMode) => {
    skipNextTransitionRef.current = true
    themeStore.setColorMode(newMode)
  }, [])

  const toggleTheme = useCallback(() => {
    skipNextTransitionRef.current = true
    const current = themeStore.colorMode
    if (current === 'system') themeStore.setColorMode('dark')
    else if (current === 'dark') themeStore.setColorMode('light')
    else themeStore.setColorMode('system')
  }, [])

  const setThemeWithAnimation = useCallback((newMode: ThemeMode, event?: React.MouseEvent) => {
    // @ts-ignore - View Transitions API
    if (!document.startViewTransition || !event) {
      skipNextTransitionRef.current = true
      themeStore.setColorMode(newMode)
      return
    }

    const x = event.clientX
    const y = event.clientY
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    const root = document.documentElement
    root.setAttribute('data-theme-transition', 'off')

    // @ts-ignore
    const transition = document.startViewTransition(() => {
      skipNextTransitionRef.current = true
      flushSync(() => {
        themeStore.setColorMode(newMode)
      })
    })

    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 380,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    }).finally(() => {
      setTimeout(() => {
        root.removeAttribute('data-theme-transition')
      }, THEME_SWITCH_DISABLE_MS)
    })
  }, [])
  
  // ---- Theme Preset (主题风格) ----
  
  const setPreset = useCallback((presetId: string) => {
    themeStore.setPreset(presetId)
  }, [])
  
  const setPresetWithAnimation = useCallback((presetId: string, event?: React.MouseEvent) => {
    // @ts-ignore
    if (!document.startViewTransition || !event) {
      themeStore.setPreset(presetId)
      return
    }

    const x = event.clientX
    const y = event.clientY
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    const root = document.documentElement
    root.setAttribute('data-theme-transition', 'off')

    // @ts-ignore
    const transition = document.startViewTransition(() => {
      flushSync(() => {
        themeStore.setPreset(presetId)
      })
    })

    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 380,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    }).finally(() => {
      setTimeout(() => {
        root.removeAttribute('data-theme-transition')
      }, THEME_SWITCH_DISABLE_MS)
    })
  }, [])

  // ---- Custom CSS ----
  
  const setCustomCSS = useCallback((css: string) => {
    themeStore.setCustomCSS(css)
  }, [])

  // ---- Font Size ----
  
  const setFontSize = useCallback((size: number) => {
    themeStore.setFontSize(size)
  }, [])

  // ---- Collapse User Messages ----
  
  const setCollapseUserMessages = useCallback((enabled: boolean) => {
    themeStore.setCollapseUserMessages(enabled)
  }, [])

  const setMobileInputAutoDock = useCallback((enabled: boolean) => {
    themeStore.setMobileInputAutoDock(enabled)
  }, [])

  const setShowMessageUsageStats = useCallback((enabled: boolean) => {
    themeStore.setShowMessageUsageStats(enabled)
  }, [])

  return {
    // 日夜模式（向后兼容）
    mode: state.colorMode,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    setTheme,
    toggleTheme,
    setThemeWithAnimation,
    setThemeImmediate: setTheme,
    
    // 主题风格
    presetId: state.presetId,
    setPreset,
    setPresetWithAnimation,
    availablePresets: themeStore.getAvailablePresets(),
    
    // 自定义 CSS
    customCSS: state.customCSS,
    setCustomCSS,
    
    // 字体大小
    fontSize: state.fontSize,
    setFontSize,
    
    // 折叠长用户消息
    collapseUserMessages: state.collapseUserMessages,
    setCollapseUserMessages,

    // 移动端输入框收纳
    mobileInputAutoDock: state.mobileInputAutoDock,
    setMobileInputAutoDock,

    // 消息 token/cache 统计显示
    showMessageUsageStats: state.showMessageUsageStats,
    setShowMessageUsageStats,
  }
}
