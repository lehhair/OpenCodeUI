import { useCallback, useRef, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { THEME_SWITCH_DISABLE_MS } from '../constants'
import { themeStore, type ColorMode } from '../store/themeStore'
import type { StepFinishDisplay } from '../store/themeStore'
import type { ReasoningDisplayMode, DiffStyle, ToolCardStyle } from '../store/themeStore'

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

  // ---- Diff Style ----

  const setDiffStyle = useCallback((style: DiffStyle) => {
    themeStore.setDiffStyle(style)
  }, [])

  // ---- Descriptive Tool Steps ----

  const setDescriptiveToolSteps = useCallback((enabled: boolean) => {
    themeStore.setDescriptiveToolSteps(enabled)
  }, [])

  // ---- Inline Tool Requests ----

  const setInlineToolRequests = useCallback((enabled: boolean) => {
    themeStore.setInlineToolRequests(enabled)
  }, [])

  // ---- Code Word Wrap ----

  const setCodeWordWrap = useCallback((enabled: boolean) => {
    themeStore.setCodeWordWrap(enabled)
  }, [])

  // ---- Font Scale ----

  const setUIFontScale = useCallback((scale: number) => {
    themeStore.setUIFontScale(scale)
  }, [])

  const setCodeFontScale = useCallback((scale: number) => {
    themeStore.setCodeFontScale(scale)
  }, [])

  // ---- Tool Card Style ----

  const setToolCardStyle = useCallback((style: ToolCardStyle) => {
    themeStore.setToolCardStyle(style)
  }, [])

  // ---- Immersive Mode ----

  const setImmersiveMode = useCallback((enabled: boolean) => {
    themeStore.setImmersiveMode(enabled)
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

    // Diff 行标记风格
    diffStyle: state.diffStyle,
    setDiffStyle,

    // 带工具描述的 steps 摘要
    descriptiveToolSteps: state.descriptiveToolSteps,
    setDescriptiveToolSteps,

    // 工具内嵌权限/提问
    inlineToolRequests: state.inlineToolRequests,
    setInlineToolRequests,

    // 代码块 / diff 自动换行
    codeWordWrap: state.codeWordWrap,
    setCodeWordWrap,

    // 界面字号偏移
    uiFontScale: state.uiFontScale,
    setUIFontScale,

    // 代码 / diff / 终端字号偏移
    codeFontScale: state.codeFontScale,
    setCodeFontScale,

    // 工具输出渲染风格
    toolCardStyle: state.toolCardStyle,
    setToolCardStyle,

    // 沉浸模式
    immersiveMode: state.immersiveMode,
    setImmersiveMode,

    // 内嵌权限精简模式
    compactInlinePermission: state.compactInlinePermission,
    setCompactInlinePermission: useCallback((enabled: boolean) => {
      themeStore.setCompactInlinePermission(enabled)
    }, []),

    // 毛玻璃效果
    glassEffect: state.glassEffect,
    setGlassEffect: useCallback((enabled: boolean) => {
      themeStore.setGlassEffect(enabled)
    }, []),
  }
}
