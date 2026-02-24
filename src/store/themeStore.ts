/**
 * 主题状态管理 Store
 * 
 * 管理：
 * - 主题风格选择（claude / breeze / custom）
 * - 日夜模式（system / light / dark）
 * - 自定义 CSS
 * - CSS 变量注入
 */

import { getThemePreset, themeColorsToCSSVars, builtinThemes, DEFAULT_THEME_ID } from '../themes'
import type { ThemePreset, ThemeColors } from '../themes'

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

/** 字体大小，单位 px，范围 12-24 */
export type FontSize = number

const DEFAULT_FONT_SIZE = 16
const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 24

function clampFontSize(v: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(v)))
}

/** step-finish 信息栏各项显示开关 */
export interface StepFinishDisplay {
  tokens: boolean
  cache: boolean
  cost: boolean
  duration: boolean
  turnDuration: boolean
}

export type ReasoningDisplayMode = 'capsule' | 'italic'

const DEFAULT_STEP_FINISH_DISPLAY: StepFinishDisplay = {
  tokens: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
}

const DEFAULT_REASONING_DISPLAY_MODE: ReasoningDisplayMode = 'capsule'

export interface ThemeState {
  /** 当前选中的主题风格 ID */
  presetId: string
  /** 日夜模式 */
  colorMode: ColorMode
  /** 用户自定义 CSS（覆盖 CSS 变量） */
  customCSS: string
  /** 全局字体大小 (px) */
  fontSize: FontSize
  /** 是否自动折叠长用户消息 */
  collapseUserMessages: boolean
  /** step-finish 信息栏显示开关 */
  stepFinishDisplay: StepFinishDisplay
  /** 思考内容展示样式 */
  reasoningDisplayMode: ReasoningDisplayMode
}

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_PRESET = 'theme-preset'
const STORAGE_KEY_COLOR_MODE = 'theme-mode'
const STORAGE_KEY_CUSTOM_CSS = 'theme-custom-css'
const STORAGE_KEY_FONT_SIZE = 'theme-font-size'
const STORAGE_KEY_COLLAPSE_USER_MESSAGES = 'collapse-user-messages'
const STORAGE_KEY_STEP_FINISH_DISPLAY = 'step-finish-display'
const STORAGE_KEY_REASONING_DISPLAY_MODE = 'reasoning-display-mode'

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
    const savedMode = localStorage.getItem(STORAGE_KEY_COLOR_MODE) as ColorMode || 'system'
    const savedCSS = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS) || ''
    const savedFontSize = clampFontSize(Number(localStorage.getItem(STORAGE_KEY_FONT_SIZE)) || DEFAULT_FONT_SIZE)
    const savedCollapse = localStorage.getItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES)
    const collapseUserMessages = savedCollapse === null ? true : savedCollapse === 'true'
    const savedReasoningDisplay = localStorage.getItem(STORAGE_KEY_REASONING_DISPLAY_MODE)
    const reasoningDisplayMode: ReasoningDisplayMode = savedReasoningDisplay === 'italic' ? 'italic' : DEFAULT_REASONING_DISPLAY_MODE
    
    let stepFinishDisplay = DEFAULT_STEP_FINISH_DISPLAY
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STEP_FINISH_DISPLAY)
      if (saved) stepFinishDisplay = { ...DEFAULT_STEP_FINISH_DISPLAY, ...JSON.parse(saved) }
    } catch { /* ignore */ }
    
    this.state = {
      presetId: savedPreset,
      colorMode: savedMode,
      customCSS: savedCSS,
      fontSize: savedFontSize,
      collapseUserMessages,
      stepFinishDisplay,
      reasoningDisplayMode,
    }
  }
  
  // ---- Getters ----
  
  getState(): ThemeState {
    return this.state
  }
  
  get presetId() { return this.state.presetId }
  get colorMode() { return this.state.colorMode }
  get customCSS() { return this.state.customCSS }
  get fontSize() { return this.state.fontSize }
  get collapseUserMessages() { return this.state.collapseUserMessages }
  get stepFinishDisplay() { return this.state.stepFinishDisplay }
  get reasoningDisplayMode() { return this.state.reasoningDisplayMode }
  
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
    localStorage.setItem(STORAGE_KEY_PRESET, id)
    this.applyTheme()
    this.emit()
  }
  
  setColorMode(mode: ColorMode) {
    if (this.state.colorMode === mode) return
    this.state = { ...this.state, colorMode: mode }
    localStorage.setItem(STORAGE_KEY_COLOR_MODE, mode)
    this.applyTheme()
    this.emit()
  }
  
  setCustomCSS(css: string) {
    this.state = { ...this.state, customCSS: css }
    localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, css)
    this.applyCustomCSS()
    this.emit()
  }
  
  setFontSize(size: FontSize) {
    const clamped = clampFontSize(size)
    if (this.state.fontSize === clamped) return
    this.state = { ...this.state, fontSize: clamped }
    localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(clamped))
    this.applyFontSize()
    this.emit()
  }
  
  setCollapseUserMessages(enabled: boolean) {
    if (this.state.collapseUserMessages === enabled) return
    this.state = { ...this.state, collapseUserMessages: enabled }
    localStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(enabled))
    this.emit()
  }
  
  setStepFinishDisplay(display: Partial<StepFinishDisplay>) {
    const next = { ...this.state.stepFinishDisplay, ...display }
    this.state = { ...this.state, stepFinishDisplay: next }
    localStorage.setItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(next))
    this.emit()
  }

  setReasoningDisplayMode(mode: ReasoningDisplayMode) {
    if (this.state.reasoningDisplayMode === mode) return
    this.state = { ...this.state, reasoningDisplayMode: mode }
    localStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, mode)
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
    
    // 4. 应用字体大小
    this.applyFontSize()
    
    // 5. 更新 meta theme-color
    requestAnimationFrame(() => {
      const bg = getComputedStyle(root).getPropertyValue('--color-bg-100').trim()
      if (!bg) return

      // 将计算后的颜色统一转为 HEX 格式，避免不同浏览器/WebView 返回
      // 不同格式（rgb, oklch, color(srgb ...)）导致 Android 原生端解析失败或色差
      const hex = computedColorToHex(bg)
      if (!hex) return

      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', hex)

      const androidBridge = (window as unknown as { __opencode_android?: { setSystemBars?: (mode: string, bg: string) => void } }).__opencode_android
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
  
  private applyFontSize() {
    document.documentElement.style.fontSize = `${this.state.fontSize}px`
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
