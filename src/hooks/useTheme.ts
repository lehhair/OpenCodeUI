import { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { STORAGE_KEY_THEME_MODE } from '../constants'

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
    
    // 如果是 View Transition 触发的，跳过 CSS 过渡类
    if (skipNextTransitionRef.current) {
      skipNextTransitionRef.current = false
    } else {
      // 添加过渡类
      root.classList.add('theme-transitioning')
      // 移除过渡类
      setTimeout(() => {
        root.classList.remove('theme-transitioning')
      }, 300)
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
        setMode('system')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [mode])

  const setTheme = useCallback((newMode: ThemeMode) => {
    setMode(newMode)
  }, [])

  const toggleTheme = useCallback(() => {
    setMode(prev => {
      if (prev === 'system') return 'dark'
      if (prev === 'dark') return 'light'
      return 'system'
    })
  }, [])

  const setThemeWithAnimation = useCallback((newMode: ThemeMode, event?: React.MouseEvent) => {
    // @ts-ignore - View Transitions API types might not be available
    if (!document.startViewTransition || !event) {
      setMode(newMode)
      return
    }

    const x = event.clientX
    const y = event.clientY
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    // @ts-ignore
    const transition = document.startViewTransition(() => {
      skipNextTransitionRef.current = true
      flushSync(() => {
        setMode(newMode)
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
          duration: 500,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    })
  }, [])

  return {
    mode,
    resolvedTheme,
    setTheme,
    toggleTheme,
    setThemeWithAnimation,
    isDark: resolvedTheme === 'dark',
  }
}
