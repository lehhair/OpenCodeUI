import { useCallback, useRef, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { THEME_SWITCH_DISABLE_MS } from '../constants'
import { themeStore, type ColorMode } from '../store/themeStore'
import type { CustomCSSTemplate } from '../store/themeStore'
import type { StepFinishDisplay } from '../store/themeStore'
import type { ReasoningDisplayMode } from '../store/themeStore'

// 保持向后兼容的类型别名
export type ThemeMode = ColorMode

export function useTheme() {
  // 订阅 themeStore 变化
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)

  const skipNextTransitionRef = useRef(false)
  const resolvedTheme = themeStore.getResolvedMode()

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
    if (!document.startViewTransition || !event) {
      skipNextTransitionRef.current = true
      themeStore.setColorMode(newMode)
      return
    }

    const x = event.clientX
    const y = event.clientY
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

    const root = document.documentElement
    root.setAttribute('data-theme-transition', 'off')

    const transition = document.startViewTransition(() => {
      skipNextTransitionRef.current = true
      flushSync(() => {
        themeStore.setColorMode(newMode)
      })
    })

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
          },
          {
            duration: 380,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        )
      })
      .finally(() => {
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
    if (!document.startViewTransition || !event) {
      themeStore.setPreset(presetId)
      return
    }

    const x = event.clientX
    const y = event.clientY
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

    const root = document.documentElement
    root.setAttribute('data-theme-transition', 'off')

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        themeStore.setPreset(presetId)
      })
    })

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
          },
          {
            duration: 380,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        )
      })
      .finally(() => {
        setTimeout(() => {
          root.removeAttribute('data-theme-transition')
        }, THEME_SWITCH_DISABLE_MS)
      })
  }, [])

  // ---- Custom CSS ----

  const setCustomCSS = useCallback((css: string) => {
    themeStore.setCustomCSS(css)
  }, [])

  // ---- Custom CSS Templates ----

  const saveCustomCSSTemplate = useCallback((name: string, css: string) => {
    return themeStore.saveCustomCSSTemplate(name, css)
  }, [])

  const updateCustomCSSTemplate = useCallback(
    (id: string, updates: Partial<Pick<CustomCSSTemplate, 'name' | 'css'>>) => {
      themeStore.updateCustomCSSTemplate(id, updates)
    },
    [],
  )

  const deleteCustomCSSTemplate = useCallback((id: string) => {
    themeStore.deleteCustomCSSTemplate(id)
  }, [])

  const activateTemplate = useCallback((id: string | null) => {
    themeStore.activateTemplate(id)
  }, [])

  // ---- Collapse User Messages ----

  const setCollapseUserMessages = useCallback((enabled: boolean) => {
    themeStore.setCollapseUserMessages(enabled)
  }, [])

  // ---- Step Finish Display ----

  const setStepFinishDisplay = useCallback((display: Partial<StepFinishDisplay>) => {
    themeStore.setStepFinishDisplay(display)
  }, [])

  // ---- Reasoning Display Mode ----

  const setReasoningDisplayMode = useCallback((mode: ReasoningDisplayMode) => {
    themeStore.setReasoningDisplayMode(mode)
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

    // 自定义CSS模板
    customCSSTemplates: state.customCSSTemplates,
    activeTemplateId: state.activeTemplateId,
    saveCustomCSSTemplate,
    updateCustomCSSTemplate,
    deleteCustomCSSTemplate,
    activateTemplate,

    // 折叠长用户消息
    collapseUserMessages: state.collapseUserMessages,
    setCollapseUserMessages,

    // step-finish 信息栏显示
    stepFinishDisplay: state.stepFinishDisplay,
    setStepFinishDisplay,

    // 思考内容显示样式
    reasoningDisplayMode: state.reasoningDisplayMode,
    setReasoningDisplayMode,

    // 宽模式
    isWideMode: state.wideMode,
    toggleWideMode: themeStore.toggleWideMode.bind(themeStore),
  }
}
