/**
 * 主题状态管理 Store
 *
 * 管理：
 * - 主题风格选择（claude / breeze / custom）
 * - 日夜模式（system / light / dark）
 * - 自定义 CSS（可用于覆盖字体等）
 * - CSS 变量注入
 */

import { getThemePreset, themeColorsToCSSVars, builtinThemes, DEFAULT_THEME_ID } from '../themes'
import type { ThemePreset, ThemeColors } from '../themes'
import { syncableSetItem, onSyncRemoteChange } from '../utils/syncableStorage'

// ============================================
// Color Conversion Utility
// ============================================

/**
 * 将浏览器 getComputedStyle 返回的任意格式颜色字符串转为 #RRGGBB 十六进制
 *
 * 现代 Chromium WebView 可能返回多种格式：
 * - rgb(29, 36, 50)   — 逗号分隔
 * - rgb(29 36 50)     — 空格分隔 (CSS Color Level 4)
 * - color(srgb 0.11 0.14 0.20) — sRGB 函数
 * - oklch(...)        — OKLab 色彩空间
 *
 * 利用 Canvas 2D 做万能转换，让浏览器自己解析任何合法 CSS 颜色
 */
function computedColorToHex(cssColor: string): string | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = cssColor
    // ctx.fillStyle 会被浏览器标准化为 #rrggbb 或 rgba(...) 格式
    const normalized = ctx.fillStyle
    if (normalized.startsWith('#')) return normalized
    // 如果返回 rgba/rgb 格式，提取数值转 hex
    const match = normalized.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (match) {
      const r = parseInt(match[1], 10)
      const g = parseInt(match[2], 10)
      const b = parseInt(match[3], 10)
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
    }
    return null
  } catch {
    return null
  }
}

// ============================================
// Types
// ============================================

export type ColorMode = 'system' | 'light' | 'dark'

/** step-finish 信息栏各项显示开关 */
export interface StepFinishDisplay {
  tokens: boolean
  cache: boolean
  cost: boolean
  duration: boolean
  turnDuration: boolean
}

export type ReasoningDisplayMode = 'capsule' | 'italic' | 'markdown'

/** Diff 行标记风格：markers = 传统 +/- 符号, changeBars = 行号左侧彩色竖条 */
export type DiffStyle = 'markers' | 'changeBars'

const DEFAULT_STEP_FINISH_DISPLAY: StepFinishDisplay = {
  tokens: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
}

const DEFAULT_REASONING_DISPLAY_MODE: ReasoningDisplayMode = 'capsule'
const DEFAULT_DIFF_STYLE: DiffStyle = 'markers'
const DEFAULT_DESCRIPTIVE_TOOL_STEPS = false
const DEFAULT_INLINE_TOOL_REQUESTS = false
const DEFAULT_CODE_WORD_WRAP = false

/** 工具输出渲染风格：classic = 经典（input+output 分离），compact = 精简（只展示 output，header 更矮） */
export type ToolCardStyle = 'classic' | 'compact'
const DEFAULT_TOOL_CARD_STYLE: ToolCardStyle = 'classic'
const DEFAULT_IMMERSIVE_MODE = false
const DEFAULT_COMPACT_INLINE_PERMISSION = false

export interface ThemeState {
  /** 当前选中的主题风格 ID */
  presetId: string
  /** 日夜模式 */
  colorMode: ColorMode
  /** 用户自定义 CSS（覆盖 CSS 变量） */
  customCSS: string
  /** 是否自动折叠长用户消息 */
  collapseUserMessages: boolean
  /** step-finish 信息栏显示开关 */
  stepFinishDisplay: StepFinishDisplay
  /** 思考内容展示样式 */
  reasoningDisplayMode: ReasoningDisplayMode
  /** 宽模式 */
  wideMode: boolean
  /** Diff 行标记风格 */
  diffStyle: DiffStyle
  /** 是否启用带工具描述的 steps 摘要 */
  descriptiveToolSteps: boolean
  /** 是否在工具下方内嵌权限/提问请求 */
  inlineToolRequests: boolean
  /** 代码块/diff 自动换行 */
  codeWordWrap: boolean
  /** 工具输出渲染风格 */
  toolCardStyle: ToolCardStyle
  /** 沉浸模式 */
  immersiveMode: boolean
  /** 内嵌权限精简模式：ToolBody 有内容时只显示操作按钮 */
  compactInlinePermission: boolean
}

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_PRESET = 'theme-preset'
const STORAGE_KEY_COLOR_MODE = 'theme-mode'
const STORAGE_KEY_CUSTOM_CSS = 'theme-custom-css'
const STORAGE_KEY_COLLAPSE_USER_MESSAGES = 'collapse-user-messages'
const STORAGE_KEY_STEP_FINISH_DISPLAY = 'step-finish-display'
const STORAGE_KEY_REASONING_DISPLAY_MODE = 'reasoning-display-mode'
const STORAGE_KEY_WIDE_MODE = 'chat-wide-mode'
const STORAGE_KEY_DIFF_STYLE = 'diff-style'
const STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS = 'descriptive-tool-steps'
const STORAGE_KEY_INLINE_TOOL_REQUESTS = 'inline-tool-requests'
const STORAGE_KEY_CODE_WORD_WRAP = 'code-word-wrap'
const STORAGE_KEY_TOOL_CARD_STYLE = 'tool-card-style'
const STORAGE_KEY_IMMERSIVE_MODE = 'immersive-mode'
const STORAGE_KEY_COMPACT_INLINE_PERMISSION = 'compact-inline-permission'

// ============================================
// DOM Style Element IDs
// ============================================

const STYLE_ID_THEME = 'opencode-theme-vars'
const STYLE_ID_CUSTOM = 'opencode-custom-css'

// ============================================
// Store Implementation
// ============================================

class ThemeStore {
  private state: ThemeState
  private listeners = new Set<() => void>()

  constructor() {
    const savedPreset = localStorage.getItem(STORAGE_KEY_PRESET) || DEFAULT_THEME_ID
    const savedMode = (localStorage.getItem(STORAGE_KEY_COLOR_MODE) as ColorMode) || 'system'
    const savedCSS = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS) || ''
    const savedCollapse = localStorage.getItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES)
    const collapseUserMessages = savedCollapse === null ? true : savedCollapse === 'true'
    const savedReasoningDisplay = localStorage.getItem(STORAGE_KEY_REASONING_DISPLAY_MODE)
    const reasoningDisplayMode: ReasoningDisplayMode =
      savedReasoningDisplay === 'italic' || savedReasoningDisplay === 'markdown'
        ? savedReasoningDisplay
        : DEFAULT_REASONING_DISPLAY_MODE

    let stepFinishDisplay = DEFAULT_STEP_FINISH_DISPLAY
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STEP_FINISH_DISPLAY)
      if (saved) stepFinishDisplay = { ...DEFAULT_STEP_FINISH_DISPLAY, ...JSON.parse(saved) }
    } catch {
      /* ignore */
    }

    const savedWideMode = localStorage.getItem(STORAGE_KEY_WIDE_MODE) === 'true'
    const savedDiffStyle = localStorage.getItem(STORAGE_KEY_DIFF_STYLE) as DiffStyle | null
    const diffStyle: DiffStyle = savedDiffStyle === 'changeBars' ? 'changeBars' : DEFAULT_DIFF_STYLE

    const savedDescriptiveToolSteps = localStorage.getItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS)
    const descriptiveToolSteps =
      savedDescriptiveToolSteps === null ? DEFAULT_DESCRIPTIVE_TOOL_STEPS : savedDescriptiveToolSteps === 'true'

    const savedInlineToolRequests = localStorage.getItem(STORAGE_KEY_INLINE_TOOL_REQUESTS)
    const inlineToolRequests =
      savedInlineToolRequests === null ? DEFAULT_INLINE_TOOL_REQUESTS : savedInlineToolRequests === 'true'

    const savedCodeWordWrap = localStorage.getItem(STORAGE_KEY_CODE_WORD_WRAP)
    const codeWordWrap = savedCodeWordWrap === 'true' ? true : DEFAULT_CODE_WORD_WRAP

    const savedToolCardStyle = localStorage.getItem(STORAGE_KEY_TOOL_CARD_STYLE) as ToolCardStyle | null
    const toolCardStyle: ToolCardStyle =
      savedToolCardStyle === 'classic' || savedToolCardStyle === 'compact'
        ? savedToolCardStyle
        : DEFAULT_TOOL_CARD_STYLE

    const savedImmersiveMode = localStorage.getItem(STORAGE_KEY_IMMERSIVE_MODE)
    const immersiveMode = savedImmersiveMode === 'true' ? true : DEFAULT_IMMERSIVE_MODE

    const savedCompactInlinePermission = localStorage.getItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION)
    const compactInlinePermission =
      savedCompactInlinePermission === null
        ? DEFAULT_COMPACT_INLINE_PERMISSION
        : savedCompactInlinePermission === 'true'

    this.state = {
      presetId: savedPreset,
      colorMode: savedMode,
      customCSS: savedCSS,
      collapseUserMessages,
      stepFinishDisplay,
      reasoningDisplayMode,
      wideMode: savedWideMode,
      diffStyle,
      descriptiveToolSteps,
      inlineToolRequests,
      codeWordWrap,
      toolCardStyle,
      immersiveMode,
      compactInlinePermission,
    }
  }

  // ---- Getters ----

  getState(): ThemeState {
    return this.state
  }

  get presetId() {
    return this.state.presetId
  }
  get colorMode() {
    return this.state.colorMode
  }
  get customCSS() {
    return this.state.customCSS
  }
  get collapseUserMessages() {
    return this.state.collapseUserMessages
  }
  get stepFinishDisplay() {
    return this.state.stepFinishDisplay
  }
  get reasoningDisplayMode() {
    return this.state.reasoningDisplayMode
  }
  get wideMode() {
    return this.state.wideMode
  }
  get diffStyle() {
    return this.state.diffStyle
  }
  get descriptiveToolSteps() {
    return this.state.descriptiveToolSteps
  }
  get inlineToolRequests() {
    return this.state.inlineToolRequests
  }
  get codeWordWrap() {
    return this.state.codeWordWrap
  }
  get toolCardStyle() {
    return this.state.toolCardStyle
  }
  get immersiveMode() {
    return this.state.immersiveMode
  }
  get compactInlinePermission() {
    return this.state.compactInlinePermission
  }

  /** 获取当前主题预设（内置主题返回对象，自定义返回 undefined） */
  getPreset(): ThemePreset | undefined {
    return getThemePreset(this.state.presetId)
  }

  /** 获取所有可用主题列表 */
  getAvailablePresets(): { id: string; name: string; description: string }[] {
    const presets = builtinThemes.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
    }))
    presets.push({
      id: 'custom',
      name: 'Custom',
      description: 'Your own CSS theme',
    })
    return presets
  }

  /** 解析实际生效的暗/亮模式 */
  getResolvedMode(): 'light' | 'dark' {
    if (this.state.colorMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return this.state.colorMode
  }

  get isDark(): boolean {
    return this.getResolvedMode() === 'dark'
  }

  // ---- Mutations ----

  setPreset(id: string) {
    if (this.state.presetId === id) return
    this.state = { ...this.state, presetId: id }
    syncableSetItem(STORAGE_KEY_PRESET, id)
    this.applyTheme()
    this.emit()
  }

  setColorMode(mode: ColorMode) {
    if (this.state.colorMode === mode) return
    this.state = { ...this.state, colorMode: mode }
    syncableSetItem(STORAGE_KEY_COLOR_MODE, mode)
    this.applyTheme()
    this.emit()
  }

  setCustomCSS(css: string) {
    this.state = { ...this.state, customCSS: css }
    syncableSetItem(STORAGE_KEY_CUSTOM_CSS, css)
    this.applyCustomCSS()
    this.emit()
  }

  setCollapseUserMessages(enabled: boolean) {
    if (this.state.collapseUserMessages === enabled) return
    this.state = { ...this.state, collapseUserMessages: enabled }
    syncableSetItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(enabled))
    this.emit()
  }

  setStepFinishDisplay(display: Partial<StepFinishDisplay>) {
    const next = { ...this.state.stepFinishDisplay, ...display }
    this.state = { ...this.state, stepFinishDisplay: next }
    syncableSetItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(next))
    this.emit()
  }

  setReasoningDisplayMode(mode: ReasoningDisplayMode) {
    if (this.state.reasoningDisplayMode === mode) return
    this.state = { ...this.state, reasoningDisplayMode: mode }
    syncableSetItem(STORAGE_KEY_REASONING_DISPLAY_MODE, mode)
    this.emit()
  }

  setWideMode(enabled: boolean) {
    if (this.state.wideMode === enabled) return
    this.state = { ...this.state, wideMode: enabled }
    syncableSetItem(STORAGE_KEY_WIDE_MODE, String(enabled))
    this.emit()
  }

  toggleWideMode() {
    this.setWideMode(!this.state.wideMode)
  }

  setDiffStyle(style: DiffStyle) {
    if (this.state.diffStyle === style) return
    this.state = { ...this.state, diffStyle: style }
    syncableSetItem(STORAGE_KEY_DIFF_STYLE, style)
    this.emit()
  }

  setDescriptiveToolSteps(enabled: boolean) {
    if (this.state.descriptiveToolSteps === enabled) return
    this.state = { ...this.state, descriptiveToolSteps: enabled }
    syncableSetItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    this.emit()
  }

  setInlineToolRequests(enabled: boolean) {
    if (this.state.inlineToolRequests === enabled) return
    this.state = { ...this.state, inlineToolRequests: enabled }
    syncableSetItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    this.emit()
  }

  setCodeWordWrap(enabled: boolean) {
    if (this.state.codeWordWrap === enabled) return
    this.state = { ...this.state, codeWordWrap: enabled }
    syncableSetItem(STORAGE_KEY_CODE_WORD_WRAP, String(enabled))
    this.emit()
  }

  setToolCardStyle(style: ToolCardStyle) {
    if (this.state.toolCardStyle === style) return
    this.state = { ...this.state, toolCardStyle: style }
    syncableSetItem(STORAGE_KEY_TOOL_CARD_STYLE, style)
    this.emit()
  }

  setImmersiveMode(enabled: boolean) {
    if (this.state.immersiveMode === enabled) return
    this.state = {
      ...this.state,
      immersiveMode: enabled,
      // 联动四个子功能
      inlineToolRequests: enabled,
      descriptiveToolSteps: enabled,
      toolCardStyle: enabled ? 'compact' : 'classic',
      compactInlinePermission: enabled,
    }
    syncableSetItem(STORAGE_KEY_IMMERSIVE_MODE, String(enabled))
    syncableSetItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    syncableSetItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    syncableSetItem(STORAGE_KEY_TOOL_CARD_STYLE, enabled ? 'compact' : 'classic')
    syncableSetItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  }

  setCompactInlinePermission(enabled: boolean) {
    if (this.state.compactInlinePermission === enabled) return
    this.state = { ...this.state, compactInlinePermission: enabled }
    syncableSetItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  }

  // ---- Theme Application ----

  /** 初始化：应用当前主题到 DOM */
  init() {
    this.applyTheme()

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', () => {
      if (this.state.colorMode === 'system') {
        this.applyTheme()
        this.emit()
      }
    })
  }

  /** 将主题 CSS 变量注入到 DOM */
  applyTheme() {
    const root = document.documentElement
    const resolvedMode = this.getResolvedMode()

    // 1. 设置 data-mode（驱动 CSS 中日/夜模式相关的非颜色规则，以及 Terminal、Shiki 等联动）
    if (this.state.colorMode === 'system') {
      root.removeAttribute('data-mode')
    } else {
      root.setAttribute('data-mode', this.state.colorMode)
    }

    // 2. 注入主题颜色变量
    const preset = this.getPreset()
    if (preset) {
      const colors: ThemeColors = resolvedMode === 'dark' ? preset.dark : preset.light
      this.injectThemeStyle(colors)
    } else if (this.state.presetId === 'custom') {
      // Custom 主题：用默认主题颜色作为底色，用户 CSS 在上面覆盖
      const fallback = getThemePreset(DEFAULT_THEME_ID)
      if (fallback) {
        const colors: ThemeColors = resolvedMode === 'dark' ? fallback.dark : fallback.light
        this.injectThemeStyle(colors)
      }
    }

    // 3. 应用自定义 CSS
    this.applyCustomCSS()

    // 4. 更新 meta theme-color
    requestAnimationFrame(() => {
      const bg = getComputedStyle(root).getPropertyValue('--color-bg-100').trim()
      if (!bg) return

      // 将计算后的颜色统一转为 HEX 格式，避免不同浏览器/WebView 返回
      // 不同格式（rgb, oklch, color(srgb ...)）导致 Android 原生端解析失败或色差
      const hex = computedColorToHex(bg)
      if (!hex) return

      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', hex)

      const androidBridge = (
        window as unknown as { __opencode_android?: { setSystemBars?: (mode: string, bg: string) => void } }
      ).__opencode_android
      if (androidBridge?.setSystemBars) {
        androidBridge.setSystemBars(resolvedMode, hex)
      }
    })
  }

  private injectThemeStyle(colors: ThemeColors) {
    let el = document.getElementById(STYLE_ID_THEME) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_THEME
      document.head.appendChild(el)
    }

    // 用高优先级选择器覆盖 :root 中的默认值
    // 使用 :root:root 提升特异性，确保覆盖 index.css 中的所有定义
    el.textContent = `:root:root {\n  ${themeColorsToCSSVars(colors)}\n}`
  }

  private applyCustomCSS() {
    const css = this.state.customCSS.trim()
    let el = document.getElementById(STYLE_ID_CUSTOM) as HTMLStyleElement | null

    if (!css) {
      if (el) el.remove()
      return
    }

    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_CUSTOM
      document.head.appendChild(el)
    }
    el.textContent = css
  }

  // ---- Subscription (useSyncExternalStore compatible) ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ThemeState => {
    return this.state
  }

  private emit() {
    this.listeners.forEach(fn => fn())
  }
}

// Singleton
export const themeStore = new ThemeStore()
