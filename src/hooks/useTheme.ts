import { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { STORAGE_KEY_THEME_MODE, THEME_SWITCH_DISABLE_MS } from '../constants'

export type ThemeMode = 'system' | 'light' | 'dark'

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_THEME_MODE)
    return (saved as ThemeMode) || 'system'
  })
  
  const skipNextTransitionRef = useRef(false)

  // 获取系统偏好
  const getSystemPreference = useCallback(() => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }, [])

  // 实际应用的主题
  const resolvedTheme = mode === 'system' ? getSystemPreference() : mode

  // 应用主题到 DOM
  useEffect(() => {
    const root = document.documentElement
    if (skipNextTransitionRef.current) {
      skipNextTransitionRef.current = false
    }
    
    if (mode === 'system') {
      root.removeAttribute('data-mode')
    } else {
      root.setAttribute('data-mode', mode)
    }


    localStorage.setItem(STORAGE_KEY_THEME_MODE, mode)
  }, [mode])

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = () => {
      // 仅在 system 模式下需要触发重渲染
      if (mode === 'system') {
        // 强制重渲染
        skipNextTransitionRef.current = true
        setMode('system')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [mode])

  const setTheme = useCallback((newMode: ThemeMode) => {
    skipNextTransitionRef.current = true
    setMode(newMode)
  }, [])

  const toggleTheme = useCallback(() => {
    skipNextTransitionRef.current = true
    setMode(prev => {
      if (prev === 'system') return 'dark'
      if (prev === 'dark') return 'light'
      return 'system'
    })
  }, [])

  const setThemeWithAnimation = useCallback((newMode: ThemeMode, event?: React.MouseEvent) => {
    const shouldDisableAnimation = false

    // @ts-ignore - View Transitions API types might not be available
    if (shouldDisableAnimation || !document.startViewTransition || !event) {
      skipNextTransitionRef.current = true
      setMode(newMode)
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
        setMode(newMode)
      })
    })

     transition.ready.then(() => {
        // 使用 GPU 加速的动画配置
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 380, // 缩短动画时长，更干脆
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)', // Material Design 标准 easing，更流畅
            pseudoElement: '::view-transition-new(root)',
          }
        )
      }).finally(() => {
      setTimeout(() => {
        root.removeAttribute('data-theme-transition')
      }, THEME_SWITCH_DISABLE_MS)
    })
  }, [])

  return {
    mode,
    resolvedTheme,
    setTheme,
    toggleTheme,
    setThemeWithAnimation,
    setThemeImmediate: setTheme,
    isDark: resolvedTheme === 'dark',
  }
}
