/**
 * 主题状态管理 Store
 *
 * 管理：
 * - 主题风格选择（内置预设）
 * - 日夜模式（system / light / dark）
 * - 自定义 CSS 覆盖（可用于覆盖字体等）
 * - CSS 变量注入
 */

import { getThemePreset, themeColorsToCSSVars, builtinThemes, DEFAULT_THEME_ID, registerCustomTheme, unregisterCustomTheme, listCustomThemes } from '../themes'
import type { ThemePreset, ThemeColors } from '../themes'
import { buildGlassTokens, GLASS_TOKEN_KEYS } from '../utils/glassTokens'
import { getDesktopPlatform, isTauri } from '../utils/tauri'
import {
  compressWallpaperImage,
  wallpaperIdbDelete,
  wallpaperIdbGet,
  wallpaperIdbPut,
} from '../utils/wallpaperStorage'

const STORAGE_KEY_CUSTOM_THEMES = 'opencode:custom-themes'

/** 自定义主题（OpenCode 官方主题 JSON 导入）的读盘注册 */
function loadCustomThemes(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_THEMES)
    if (!raw) return
    const list = JSON.parse(raw) as ThemePreset[]
    if (!Array.isArray(list)) return
    for (const preset of list) {
      if (preset && typeof preset.id === 'string' && preset.light && preset.dark) {
        registerCustomTheme(preset)
      }
    }
  } catch {
    // 损坏的持久化数据直接忽略
  }
}

function persistCustomThemes(): void {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM_THEMES, JSON.stringify(listCustomThemes()))
  } catch {
    // 存储满时忽略
  }
}
import {
  DEFAULT_CODE_BLOCK_THEME_DARK,
  DEFAULT_CODE_BLOCK_THEME_LIGHT,
  normalizeCodeBlockTheme,
} from '../lib/codeBlockThemes'

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

export interface CustomCSSSnippet {
  id: string
  name: string
  css: string
  createdAt: number
  updatedAt: number
}

/** step-finish 信息栏各项显示开关 */
export interface StepFinishDisplay {
  /** 仅在用户回合末尾的最新 step 显示完成信息；中间 assistant / step 不显示 */
  latestOnly: boolean
  tokens: boolean
  cache: boolean
  cost: boolean
  duration: boolean
  turnDuration: boolean
  agent: boolean
  model: boolean
  completedAt: boolean
}

export type CompletedAtFormat = 'time' | 'dateTime'

export type ReasoningDisplayMode = 'capsule' | 'italic' | 'markdown'
/** 输入框选择器样式：icons=模型/推理/Agent 各自独立图标按钮；seat=DSH 风格汇总菜单（模型 · 推理 · Agent 单入口） */
export type ComposerSelectorStyle = 'icons' | 'seat'

export type ExternalFileDropMode = 'upload-first' | 'mention'

/**
 * 字号偏移范围：-2 ~ +4（相对于基准值的 px 偏移）
 * 0 = 基准值（index.css 中定义的默认值）
 */
export const FONT_SCALE_MIN = -2
export const FONT_SCALE_MAX = 4

function clampFontScale(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, n)))
}

/** Diff 行标记风格：markers = 传统 +/- 符号, changeBars = 行号左侧彩色竖条 */
export type DiffStyle = 'markers' | 'changeBars'

const DEFAULT_STEP_FINISH_DISPLAY: StepFinishDisplay = {
  latestOnly: true,
  tokens: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
  agent: false,
  model: false,
  completedAt: false,
}

const DEFAULT_COMPLETED_AT_FORMAT: CompletedAtFormat = 'time'

const DEFAULT_REASONING_DISPLAY_MODE: ReasoningDisplayMode = 'markdown'
const DEFAULT_RENDER_USER_MARKDOWN = false
// 默认不渲染：AI 输出里的 HTML 一律按源码展示（要活预览可在设置里显式打开）。
// HTML 活渲染是个有副作用的开关（iframe / 脚本），默认开的风险大于收益。
const DEFAULT_RENDER_HTML_CONTENT = false
/** 流式文本按节奏揭示（可关闭以回到「数据到达即整段显示」） */
const DEFAULT_STREAM_PACING_ENABLED = true
/** 新出现的尾部文字做淡入 */
const DEFAULT_STREAM_FADE_ENABLED = true
const DEFAULT_DIFF_STYLE: DiffStyle = 'markers'
const DEFAULT_DESCRIPTIVE_TOOL_STEPS = true
const DEFAULT_INLINE_TOOL_REQUESTS = true
const DEFAULT_CODE_WORD_WRAP = false
const DEFAULT_UI_FONT_SCALE = 0
const DEFAULT_CODE_FONT_SCALE = 0

/** 工具输出渲染风格：classic = 经典（input+output 分离），compact = 精简（只展示 output，header 更矮） */
export type ToolCardStyle = 'classic' | 'compact'

/**
 * 外观处理：与主题配色相互独立
 * - default: 实色
 * - glass:   整窗一层半透明染色 + 一次磨砂
 */
export type AppearanceStyle = 'default' | 'glass'

/** 壁纸铺放方式 */
export type WallpaperFit = 'cover' | 'contain'

/** 窗口背景模式：系统材质 / 页面自绘 / 纯色 */
type BackdropMode = 'native' | 'page' | 'none'

/**
 * 桌面背景由谁提供。
 * - native：系统合成器（DWM / WindowServer）糊，60fps、零 CPU
 * - live：我们抓屏自己糊，能控制半径，但每帧要走 CPU 往返
 */
export type DesktopBackdrop = 'native' | 'live'

const STORAGE_KEY_DESKTOP_BACKDROP = 'desktop-backdrop'
const DEFAULT_DESKTOP_BACKDROP: DesktopBackdrop = 'native'
const STORAGE_KEY_BACKDROP_BLUR = 'backdrop-blur'
const STORAGE_KEY_BACKDROP_INTERVAL = 'backdrop-interval'
/** 抓取间隔（ms）。越小越跟手，CPU 越高；每次抓取都要等一帧合成，所以有下限。 */
const DEFAULT_BACKDROP_INTERVAL = 33
const BACKDROP_INTERVAL_MIN = 8
const BACKDROP_INTERVAL_MAX = 200
/** 页面磨砂层的半径（px），和壁纸模式共用同一个变量 */
const DEFAULT_BACKDROP_BLUR = 24

const DEFAULT_APPEARANCE_STYLE: AppearanceStyle = 'default'
/**
 * 玻璃浓度：整窗染色的不透明度。
 *
 * 默认 0.6——系统材质（acrylic/壁纸）在窗口底下，染色只是“压一层”让文字能读。
 * 之前默认 0.88，等于把材质盖掉，只剩 12% 能看见，怎么调都是块死板子。
 */
const DEFAULT_GLASS_ALPHA = 0.6
/** 0.88 是旧默认值，存档里遇到就当成没设置过 */
const LEGACY_GLASS_ALPHA = 0.88
const GLASS_ALPHA_MIN = 0.15
const GLASS_ALPHA_MAX = 1
/** 系统没有窗口模糊时的最低不透明度，避免桌面原样透上来影响阅读 */
const GLASS_NO_BLUR_ALPHA = 0.94
const DEFAULT_WALLPAPER_ENABLED = false
const DEFAULT_WALLPAPER_FIT: WallpaperFit = 'cover'
/** 对话区是否再叠一层淡图；默认关闭，保持整窗观感统一 */
const DEFAULT_WALLPAPER_IN_CHAT = false

function clampGlassAlpha(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_GLASS_ALPHA
  return Math.max(GLASS_ALPHA_MIN, Math.min(GLASS_ALPHA_MAX, n))
}

const DEFAULT_TOOL_CARD_STYLE: ToolCardStyle = 'compact'
const DEFAULT_IMMERSIVE_MODE = true
const DEFAULT_COMPACT_INLINE_PERMISSION = true
const DEFAULT_COMPACTION_AUTO_COLLAPSE = true
const DEFAULT_QUEUE_AUTO_COLLAPSE = true
const DEFAULT_GLASS_EFFECT = true
const DEFAULT_QUEUE_FOLLOWUP_MESSAGES = false
/** 输入框 busy 投递 chip（插队/排队）默认显示 */
const DEFAULT_QUEUE_DELIVERY_CHIP_VISIBLE = true
const DEFAULT_MANUAL_TERMINAL_TITLES = false
const DEFAULT_EXTERNAL_FILE_DROP_MODE: ExternalFileDropMode = 'upload-first'
const DEFAULT_OUTLINE_CURRENT_HIGHLIGHT = true
/** 连续助手消息时，仅在回合末尾显示分叉/复制按钮 */
const DEFAULT_ACTIONS_ON_LATEST_ASSISTANT_ONLY = true
/** 桌面端是否启用输入框上滚收起（移动端始终可用） */
const DEFAULT_DESKTOP_COLLAPSED_INPUT_DOCK = true
/** 过程折叠：按用户消息把中间过程收成计时折叠块 */
const DEFAULT_PROCESS_COLLAPSE_ENABLED = false
/** 时间线提示行（模型/agent 切换、移动、技能、指令更新、合成上下文）默认关闭 */
const DEFAULT_SHOW_TIMELINE_NOTICES = false
/** 回合文件变更摘要默认关闭 */
const DEFAULT_SHOW_TURN_DIFF = false
/** 压缩排队提示默认关闭 */
const DEFAULT_SHOW_QUEUED_COMPACTION = false
/** 输入框选择器默认样式：独立图标按钮 */
const DEFAULT_COMPOSER_SELECTOR_STYLE: ComposerSelectorStyle = 'icons'

export interface ThemeState {
  /** 当前选中的主题风格 ID */
  presetId: string
  /** 日夜模式 */
  colorMode: ColorMode
  /** 用户自定义 CSS（覆盖 CSS 变量） */
  customCSS: string
  /** 已保存的自定义 CSS 方案 */
  customCSSSnippets: CustomCSSSnippet[]
  /** 当前选中的已保存方案 ID；仅用于切换/保存，不直接决定渲染 */
  activeCustomCSSSnippetId: string | null
  /** 是否自动折叠长用户消息 */
  collapseUserMessages: boolean
  /** 是否将用户消息渲染为 Markdown */
  renderUserMarkdown: boolean
  /** 是否渲染 AI 输出中的 HTML（关闭后 HTML 一律按源码展示） */
  renderHtmlContent: boolean
  /** 流式文本按节奏揭示 */
  streamPacingEnabled: boolean
  /** 流式文本尾部淡入 */
  streamFadeEnabled: boolean
  /** step-finish 信息栏显示开关 */
  stepFinishDisplay: StepFinishDisplay
  /** 完成时刻显示格式 */
  completedAtFormat: CompletedAtFormat
  /** 思考内容展示样式 */
  reasoningDisplayMode: ReasoningDisplayMode
  /** 宽模式 */
  wideMode: boolean
  /** 对话列自定义宽度（px，左缘拖拽设置；null = 跟随宽屏模式默认） */
  chatContentWidth: number | null
  /** 输入框自定义宽度（px，左缘拖拽设置；null = 默认 3xl=768） */
  chatInputWidth: number | null
  /** Diff 行标记风格 */
  diffStyle: DiffStyle
  /** 是否启用带工具描述的 steps 摘要 */
  descriptiveToolSteps: boolean
  /** 是否在工具下方内嵌权限/提问请求 */
  inlineToolRequests: boolean
  /** 代码块/diff 自动换行 */
  codeWordWrap: boolean
  /** UI 字号偏移 (px)，0 = 基准 */
  uiFontScale: number
  /** 代码 / diff / 终端字号偏移 (px)，0 = 基准 */
  codeFontScale: number
  /** 工具输出渲染风格 */
  toolCardStyle: ToolCardStyle
  /** 沉浸模式 */
  immersiveMode: boolean
  /** 内嵌权限精简模式：ToolBody 有内容时只显示操作按钮 */
  compactInlinePermission: boolean
  /** 压缩结果流式输出结束后自动收起（可在设置中关闭） */
  compactionAutoCollapse: boolean
  /** 队列消息默认折叠成一行摘要（可在设置中关闭，关闭则默认展开） */
  queueAutoCollapse: boolean
  /** 毛玻璃效果开关（backdrop-filter blur） */
  glassEffect: boolean
  /** 外观处理：default = 实色，glass = 玻璃 */
  appearanceStyle: AppearanceStyle
  /** 玻璃浓度 0.15–1，越高越实 */
  glassAlpha: number
  /** 是否启用壁纸 */
  wallpaperEnabled: boolean
  /** 壁纸铺放方式 */
  wallpaperFit: WallpaperFit
  /** 对话区是否再叠一层淡图 */
  wallpaperInChat: boolean
  /** 壁纸文件名（仅展示，图片本体在 IndexedDB） */
  wallpaperFileName: string | null
  /** 运行时壁纸 object URL，不持久化、不随备份导出 */
  wallpaperUrl: string | null
  /** 桌面背景是否由页面自己画（抓屏或壁纸），此时不能用系统材质 */
  liveBackdrop: boolean
  /** 桌面背景来源：系统材质 / 自己抓屏 */
  desktopBackdrop: DesktopBackdrop
  /** 页面磨砂层的半径（px） */
  backdropBlur: number
  /** 抓取间隔（ms） */
  backdropInterval: number
  /** 忙碌时后续消息是否进入队列 */
  queueFollowupMessages: boolean
  /** 输入框的 busy 投递 chip（插队/排队）是否显示 */
  queueDeliveryChipVisible: boolean
  /** 终端标签是否改为手动命名模式 */
  manualTerminalTitles: boolean
  /** 外部文件拖入输入框时的处理方式 */
  externalFileDropMode: ExternalFileDropMode
  /** 是否在对话历史导航中高亮当前对话位置 */
  outlineCurrentHighlight: boolean
  /** 连续助手消息时，仅在回合末尾显示分叉/复制按钮 */
  actionsOnLatestAssistantOnly: boolean
  /** 桌面端是否启用输入框上滚收起为胶囊 */
  desktopCollapsedInputDock: boolean
  /** 过程折叠：用户发送后显示 Working 计时，结束后收成折叠块，最终回答留在外面 */
  processCollapseEnabled: boolean
  /** 在消息流里显示会话事件提示行（模型/agent 切换、移动、技能、指令更新、合成上下文） */
  showTimelineNotices: boolean
  /** 每轮结束后显示文件变更摘要 */
  showTurnDiff: boolean
  /** 压缩已入队、尚未开始时显示提示 */
  showQueuedCompaction: boolean
  /** 输入框选择器样式：独立图标按钮 / DSH 风格汇总菜单 */
  composerSelectorStyle: ComposerSelectorStyle
  /** 代码块语法高亮主题（亮色模式），Shiki theme id */
  codeBlockThemeLight: string
  /** 代码块语法高亮主题（暗色模式），Shiki theme id */
  codeBlockThemeDark: string
}

export type ThemeBackup = ThemeState

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_PRESET = 'theme-preset'
const STORAGE_KEY_COLOR_MODE = 'theme-mode'
const STORAGE_KEY_CUSTOM_CSS = 'theme-custom-css'
const STORAGE_KEY_CUSTOM_CSS_SNIPPETS = 'theme-custom-css-snippets'
const STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID = 'theme-active-custom-css-snippet-id'
const STORAGE_KEY_COLLAPSE_USER_MESSAGES = 'collapse-user-messages'
const STORAGE_KEY_RENDER_USER_MARKDOWN = 'render-user-markdown'
const STORAGE_KEY_RENDER_HTML_CONTENT = 'render-html-content'
const STORAGE_KEY_STREAM_PACING_ENABLED = 'stream-pacing-enabled'
const STORAGE_KEY_STREAM_FADE_ENABLED = 'stream-fade-enabled'
const STORAGE_KEY_STEP_FINISH_DISPLAY = 'step-finish-display'
const STORAGE_KEY_COMPLETED_AT_FORMAT = 'completed-at-format'
const STORAGE_KEY_REASONING_DISPLAY_MODE = 'reasoning-display-mode'
const STORAGE_KEY_WIDE_MODE = 'chat-wide-mode'
const STORAGE_KEY_CHAT_CONTENT_WIDTH = 'chat-content-width'
const STORAGE_KEY_CHAT_INPUT_WIDTH = 'chat-input-width'
const STORAGE_KEY_DIFF_STYLE = 'diff-style'
const STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS = 'descriptive-tool-steps'
const STORAGE_KEY_INLINE_TOOL_REQUESTS = 'inline-tool-requests'
const STORAGE_KEY_CODE_WORD_WRAP = 'code-word-wrap'
const STORAGE_KEY_FONT_SCALE = 'font-scale'
const STORAGE_KEY_CODE_FONT_SCALE = 'code-font-scale'
const STORAGE_KEY_TOOL_CARD_STYLE = 'tool-card-style'
const STORAGE_KEY_IMMERSIVE_MODE = 'immersive-mode'
const STORAGE_KEY_COMPACT_INLINE_PERMISSION = 'compact-inline-permission'
const STORAGE_KEY_COMPACTION_AUTO_COLLAPSE = 'compaction-auto-collapse'
const STORAGE_KEY_QUEUE_AUTO_COLLAPSE = 'queue-auto-collapse'
const STORAGE_KEY_GLASS_EFFECT = 'glass-effect'
const STORAGE_KEY_APPEARANCE_STYLE = 'appearance-style'
const STORAGE_KEY_GLASS_ALPHA = 'glass-alpha'
const STORAGE_KEY_WALLPAPER_ENABLED = 'wallpaper-enabled'
const STORAGE_KEY_WALLPAPER_FIT = 'wallpaper-fit'
const STORAGE_KEY_WALLPAPER_IN_CHAT = 'wallpaper-in-chat'
const STORAGE_KEY_WALLPAPER_FILE_NAME = 'wallpaper-file-name'
const STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES = 'queue-followup-messages'
const STORAGE_KEY_QUEUE_DELIVERY_CHIP_VISIBLE = 'queue-delivery-chip-visible'
const STORAGE_KEY_MANUAL_TERMINAL_TITLES = 'manual-terminal-titles'
const STORAGE_KEY_EXTERNAL_FILE_DROP_MODE = 'external-file-drop-mode'
const STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT = 'outline-current-highlight'
const STORAGE_KEY_ACTIONS_ON_LATEST_ASSISTANT_ONLY = 'actions-on-latest-assistant-only'
const STORAGE_KEY_DESKTOP_COLLAPSED_INPUT_DOCK = 'desktop-collapsed-input-dock'
const STORAGE_KEY_PROCESS_COLLAPSE_ENABLED = 'process-collapse-enabled'
const STORAGE_KEY_SHOW_TIMELINE_NOTICES = 'show-timeline-notices'
const STORAGE_KEY_SHOW_TURN_DIFF = 'show-turn-diff'
const STORAGE_KEY_SHOW_QUEUED_COMPACTION = 'show-queued-compaction'
const STORAGE_KEY_COMPOSER_SELECTOR_STYLE = 'composer-selector-style'
const STORAGE_KEY_CODE_BLOCK_THEME_LIGHT = 'code-block-theme-light'
const STORAGE_KEY_CODE_BLOCK_THEME_DARK = 'code-block-theme-dark'

// ============================================
// DOM Style Element IDs
// ============================================

const STYLE_ID_THEME = 'opencode-theme-vars'
const STYLE_ID_FONT_SCALE = 'opencode-font-scale'
const STYLE_ID_CUSTOM = 'opencode-custom-css'

function parseCustomCSSSnippets(raw: string | null): CustomCSSSnippet[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (item): item is CustomCSSSnippet =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.css === 'string' &&
        typeof item.createdAt === 'number' &&
        typeof item.updatedAt === 'number',
    )
  } catch {
    return []
  }
}

// ============================================
// Store Implementation
// ============================================

class ThemeStore {
  private state: ThemeState
  private listeners = new Set<() => void>()
  /** 是否已从 IndexedDB 恢复过壁纸 */
  private wallpaperBlobLoaded = false
  /** 当前窗口背景模式（含排除标记），避免重复调用 */
  private backdropMode: string | null = null
  /** 系统是否真的提供了窗口模糊；null 表示还没问过 */
  private nativeBlurSupported: boolean | null = null

  constructor() {
    // 自定义主题（OpenCode 官方主题 JSON 导入）先于 preset 校验注册——
    // 否则上次的自定义 presetId 会被归一成默认值
    loadCustomThemes()
    const savedPreset = localStorage.getItem(STORAGE_KEY_PRESET) || DEFAULT_THEME_ID
    const normalizedPreset = getThemePreset(savedPreset) ? savedPreset : DEFAULT_THEME_ID
    const savedMode = (localStorage.getItem(STORAGE_KEY_COLOR_MODE) as ColorMode) || 'system'
    const savedCSS = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS) || ''
    const customCSSSnippets = parseCustomCSSSnippets(localStorage.getItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS))
    const savedActiveCustomCSSSnippetId = localStorage.getItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    const activeCustomCSSSnippetId = customCSSSnippets.some(item => item.id === savedActiveCustomCSSSnippetId)
      ? savedActiveCustomCSSSnippetId
      : null
    const savedCollapse = localStorage.getItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES)
    const collapseUserMessages = savedCollapse === null ? true : savedCollapse === 'true'
    const savedRenderUserMarkdown = localStorage.getItem(STORAGE_KEY_RENDER_USER_MARKDOWN)
    const renderUserMarkdown =
      savedRenderUserMarkdown === null ? DEFAULT_RENDER_USER_MARKDOWN : savedRenderUserMarkdown === 'true'

    const savedRenderHtmlContent = localStorage.getItem(STORAGE_KEY_RENDER_HTML_CONTENT)
    const renderHtmlContent =
      savedRenderHtmlContent === null ? DEFAULT_RENDER_HTML_CONTENT : savedRenderHtmlContent === 'true'
    const savedStreamPacing = localStorage.getItem(STORAGE_KEY_STREAM_PACING_ENABLED)
    const streamPacingEnabled =
      savedStreamPacing === null ? DEFAULT_STREAM_PACING_ENABLED : savedStreamPacing === 'true'
    const savedStreamFade = localStorage.getItem(STORAGE_KEY_STREAM_FADE_ENABLED)
    const streamFadeEnabled = savedStreamFade === null ? DEFAULT_STREAM_FADE_ENABLED : savedStreamFade === 'true'
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

    const savedCompletedAtFormat = localStorage.getItem(STORAGE_KEY_COMPLETED_AT_FORMAT)
    const completedAtFormat: CompletedAtFormat =
      savedCompletedAtFormat === 'dateTime' ? 'dateTime' : DEFAULT_COMPLETED_AT_FORMAT

    const savedWideMode = localStorage.getItem(STORAGE_KEY_WIDE_MODE) === 'true'
    const rawChatContentWidth = Number(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH))
    const savedChatContentWidth =
      Number.isFinite(rawChatContentWidth) && rawChatContentWidth > 0 ? rawChatContentWidth : null
    const rawChatInputWidth = Number(localStorage.getItem(STORAGE_KEY_CHAT_INPUT_WIDTH))
    const savedChatInputWidth =
      Number.isFinite(rawChatInputWidth) && rawChatInputWidth > 0 ? rawChatInputWidth : null
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

    const savedFontScale = localStorage.getItem(STORAGE_KEY_FONT_SCALE)
    const uiFontScale = savedFontScale !== null ? clampFontScale(Number(savedFontScale)) : DEFAULT_UI_FONT_SCALE

    const savedCodeFontScale = localStorage.getItem(STORAGE_KEY_CODE_FONT_SCALE)
    const codeFontScale =
      savedCodeFontScale !== null ? clampFontScale(Number(savedCodeFontScale)) : DEFAULT_CODE_FONT_SCALE

    const savedToolCardStyle = localStorage.getItem(STORAGE_KEY_TOOL_CARD_STYLE) as ToolCardStyle | null
    const toolCardStyle: ToolCardStyle =
      savedToolCardStyle === 'classic' || savedToolCardStyle === 'compact'
        ? savedToolCardStyle
        : DEFAULT_TOOL_CARD_STYLE

    const savedImmersiveMode = localStorage.getItem(STORAGE_KEY_IMMERSIVE_MODE)
    const immersiveMode = savedImmersiveMode === null ? DEFAULT_IMMERSIVE_MODE : savedImmersiveMode === 'true'

    const savedCompactInlinePermission = localStorage.getItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION)
    const compactInlinePermission =
      savedCompactInlinePermission === null
        ? DEFAULT_COMPACT_INLINE_PERMISSION
        : savedCompactInlinePermission === 'true'

    const savedCompactionAutoCollapse = localStorage.getItem(STORAGE_KEY_COMPACTION_AUTO_COLLAPSE)
    const compactionAutoCollapse =
      savedCompactionAutoCollapse === null ? DEFAULT_COMPACTION_AUTO_COLLAPSE : savedCompactionAutoCollapse === 'true'

    const savedQueueAutoCollapse = localStorage.getItem(STORAGE_KEY_QUEUE_AUTO_COLLAPSE)
    const queueAutoCollapse =
      savedQueueAutoCollapse === null ? DEFAULT_QUEUE_AUTO_COLLAPSE : savedQueueAutoCollapse === 'true'

    const savedGlassEffect = localStorage.getItem(STORAGE_KEY_GLASS_EFFECT)
    const glassEffect = savedGlassEffect === null ? DEFAULT_GLASS_EFFECT : savedGlassEffect === 'true'

    const appearanceStyle: AppearanceStyle =
      localStorage.getItem(STORAGE_KEY_APPEARANCE_STYLE) === 'glass' ? 'glass' : DEFAULT_APPEARANCE_STYLE
    const savedGlassAlpha = localStorage.getItem(STORAGE_KEY_GLASS_ALPHA)
    const glassAlpha =
      savedGlassAlpha !== null && Number(savedGlassAlpha) !== LEGACY_GLASS_ALPHA
        ? clampGlassAlpha(Number(savedGlassAlpha))
        : DEFAULT_GLASS_ALPHA
    const wallpaperEnabled = localStorage.getItem(STORAGE_KEY_WALLPAPER_ENABLED) === 'true'
    const wallpaperFit: WallpaperFit =
      localStorage.getItem(STORAGE_KEY_WALLPAPER_FIT) === 'contain' ? 'contain' : DEFAULT_WALLPAPER_FIT
    const wallpaperInChat = localStorage.getItem(STORAGE_KEY_WALLPAPER_IN_CHAT) === 'true'
    const desktopBackdrop: DesktopBackdrop =
      localStorage.getItem(STORAGE_KEY_DESKTOP_BACKDROP) === 'live' ? 'live' : DEFAULT_DESKTOP_BACKDROP
    const savedInterval = Number(localStorage.getItem(STORAGE_KEY_BACKDROP_INTERVAL))
    const backdropInterval =
      Number.isFinite(savedInterval) && savedInterval > 0
        ? Math.min(BACKDROP_INTERVAL_MAX, Math.max(BACKDROP_INTERVAL_MIN, Math.round(savedInterval)))
        : DEFAULT_BACKDROP_INTERVAL
    const savedBackdropBlur = Number(localStorage.getItem(STORAGE_KEY_BACKDROP_BLUR))
    const backdropBlur =
      Number.isFinite(savedBackdropBlur) && savedBackdropBlur > 0 ? savedBackdropBlur : DEFAULT_BACKDROP_BLUR
    const wallpaperFileName = localStorage.getItem(STORAGE_KEY_WALLPAPER_FILE_NAME)

    const savedQueueFollowupMessages = localStorage.getItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES)
    const queueFollowupMessages =
      savedQueueFollowupMessages === null ? DEFAULT_QUEUE_FOLLOWUP_MESSAGES : savedQueueFollowupMessages === 'true'

    const savedQueueDeliveryChipVisible = localStorage.getItem(STORAGE_KEY_QUEUE_DELIVERY_CHIP_VISIBLE)
    const queueDeliveryChipVisible =
      savedQueueDeliveryChipVisible === null
        ? DEFAULT_QUEUE_DELIVERY_CHIP_VISIBLE
        : savedQueueDeliveryChipVisible === 'true'

    const savedManualTerminalTitles = localStorage.getItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES)
    const manualTerminalTitles =
      savedManualTerminalTitles === null ? DEFAULT_MANUAL_TERMINAL_TITLES : savedManualTerminalTitles === 'true'

    const savedExternalFileDropMode = localStorage.getItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE)
    const externalFileDropMode: ExternalFileDropMode =
      savedExternalFileDropMode === 'mention' ? 'mention' : DEFAULT_EXTERNAL_FILE_DROP_MODE

    const savedOutlineCurrentHighlight = localStorage.getItem(STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT)
    const outlineCurrentHighlight =
      savedOutlineCurrentHighlight === null
        ? DEFAULT_OUTLINE_CURRENT_HIGHLIGHT
        : savedOutlineCurrentHighlight === 'true'

    const savedActionsOnLatestAssistantOnly = localStorage.getItem(STORAGE_KEY_ACTIONS_ON_LATEST_ASSISTANT_ONLY)
    const actionsOnLatestAssistantOnly =
      savedActionsOnLatestAssistantOnly === null
        ? DEFAULT_ACTIONS_ON_LATEST_ASSISTANT_ONLY
        : savedActionsOnLatestAssistantOnly === 'true'

    const savedDesktopCollapsedInputDock = localStorage.getItem(STORAGE_KEY_DESKTOP_COLLAPSED_INPUT_DOCK)
    const desktopCollapsedInputDock =
      savedDesktopCollapsedInputDock === null
        ? DEFAULT_DESKTOP_COLLAPSED_INPUT_DOCK
        : savedDesktopCollapsedInputDock === 'true'

    const savedProcessCollapseEnabled = localStorage.getItem(STORAGE_KEY_PROCESS_COLLAPSE_ENABLED)
    const processCollapseEnabled =
      savedProcessCollapseEnabled === null
        ? DEFAULT_PROCESS_COLLAPSE_ENABLED
        : savedProcessCollapseEnabled === 'true'

    const savedShowTimelineNotices = localStorage.getItem(STORAGE_KEY_SHOW_TIMELINE_NOTICES)
    const showTimelineNotices =
      savedShowTimelineNotices === null ? DEFAULT_SHOW_TIMELINE_NOTICES : savedShowTimelineNotices === 'true'

    const savedShowTurnDiff = localStorage.getItem(STORAGE_KEY_SHOW_TURN_DIFF)
    const showTurnDiff = savedShowTurnDiff === null ? DEFAULT_SHOW_TURN_DIFF : savedShowTurnDiff === 'true'

    const savedShowQueuedCompaction = localStorage.getItem(STORAGE_KEY_SHOW_QUEUED_COMPACTION)
    const showQueuedCompaction =
      savedShowQueuedCompaction === null ? DEFAULT_SHOW_QUEUED_COMPACTION : savedShowQueuedCompaction === 'true'

    const savedComposerSelectorStyle = localStorage.getItem(STORAGE_KEY_COMPOSER_SELECTOR_STYLE)
    const composerSelectorStyle: ComposerSelectorStyle =
      savedComposerSelectorStyle === 'seat' ? 'seat' : DEFAULT_COMPOSER_SELECTOR_STYLE

    const codeBlockThemeLight = normalizeCodeBlockTheme(
      localStorage.getItem(STORAGE_KEY_CODE_BLOCK_THEME_LIGHT) || DEFAULT_CODE_BLOCK_THEME_LIGHT,
      DEFAULT_CODE_BLOCK_THEME_LIGHT,
    )
    const codeBlockThemeDark = normalizeCodeBlockTheme(
      localStorage.getItem(STORAGE_KEY_CODE_BLOCK_THEME_DARK) || DEFAULT_CODE_BLOCK_THEME_DARK,
      DEFAULT_CODE_BLOCK_THEME_DARK,
    )

    this.state = {
      presetId: normalizedPreset,
      colorMode: savedMode,
      customCSS: savedCSS,
      customCSSSnippets,
      activeCustomCSSSnippetId,
      collapseUserMessages,
      renderUserMarkdown,
      renderHtmlContent,
      streamPacingEnabled,
      streamFadeEnabled,
      stepFinishDisplay,
      completedAtFormat,
      reasoningDisplayMode,
      wideMode: savedWideMode,
      chatContentWidth: savedChatContentWidth,
      chatInputWidth: savedChatInputWidth,
      diffStyle,
      descriptiveToolSteps,
      inlineToolRequests,
      codeWordWrap,
      uiFontScale,
      codeFontScale,
      toolCardStyle,
      immersiveMode,
      compactInlinePermission,
      compactionAutoCollapse,
      queueAutoCollapse,
      glassEffect,
      appearanceStyle,
      glassAlpha,
      wallpaperEnabled,
      wallpaperFit,
      wallpaperInChat,
      wallpaperFileName: wallpaperFileName || null,
      wallpaperUrl: null,
      liveBackdrop: false,
      desktopBackdrop,
      backdropBlur,
      backdropInterval,
      queueFollowupMessages,
      queueDeliveryChipVisible,
      manualTerminalTitles,
      externalFileDropMode,
      outlineCurrentHighlight,
      actionsOnLatestAssistantOnly,
      desktopCollapsedInputDock,
      processCollapseEnabled,
      showTimelineNotices,
      showTurnDiff,
      showQueuedCompaction,
      composerSelectorStyle,
      codeBlockThemeLight,
      codeBlockThemeDark,
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
  get customCSSSnippets() {
    return this.state.customCSSSnippets
  }
  get activeCustomCSSSnippetId() {
    return this.state.activeCustomCSSSnippetId
  }
  get collapseUserMessages() {
    return this.state.collapseUserMessages
  }
  get renderUserMarkdown() {
    return this.state.renderUserMarkdown
  }
  get renderHtmlContent() {
    return this.state.renderHtmlContent
  }
  get streamPacingEnabled() {
    return this.state.streamPacingEnabled
  }
  get streamFadeEnabled() {
    return this.state.streamFadeEnabled
  }
  get stepFinishDisplay() {
    return this.state.stepFinishDisplay
  }
  get completedAtFormat() {
    return this.state.completedAtFormat
  }
  get reasoningDisplayMode() {
    return this.state.reasoningDisplayMode
  }
  get wideMode() {
    return this.state.wideMode
  }
  get chatContentWidth() {
    return this.state.chatContentWidth
  }
  get chatInputWidth() {
    return this.state.chatInputWidth
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
  get uiFontScale() {
    return this.state.uiFontScale
  }
  get codeFontScale() {
    return this.state.codeFontScale
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
  get compactionAutoCollapse() {
    return this.state.compactionAutoCollapse
  }
  get queueAutoCollapse() {
    return this.state.queueAutoCollapse
  }
  get glassEffect() {
    return this.state.glassEffect
  }
  get appearanceStyle() {
    return this.state.appearanceStyle
  }
  get glassAlpha() {
    return this.state.glassAlpha
  }
  get wallpaperEnabled() {
    return this.state.wallpaperEnabled
  }
  get wallpaperFit() {
    return this.state.wallpaperFit
  }
  get wallpaperInChat() {
    return this.state.wallpaperInChat
  }
  get wallpaperFileName() {
    return this.state.wallpaperFileName
  }
  get wallpaperUrl() {
    return this.state.wallpaperUrl
  }
  get liveBackdrop() {
    return this.state.liveBackdrop
  }
  get desktopBackdrop() {
    return this.state.desktopBackdrop
  }
  get backdropBlur() {
    return this.state.backdropBlur
  }

  get backdropInterval() {
    return this.state.backdropInterval
  }

  setBackdropInterval(value: number) {
    const next = Math.min(BACKDROP_INTERVAL_MAX, Math.max(BACKDROP_INTERVAL_MIN, Math.round(value)))
    if (this.state.backdropInterval === next) return
    this.state = { ...this.state, backdropInterval: next }
    localStorage.setItem(STORAGE_KEY_BACKDROP_INTERVAL, String(next))
    this.emit()
  }

  setBackdropBlur(value: number) {
    const next = Math.max(0, Math.min(96, Math.round(value)))
    if (this.state.backdropBlur === next) return
    this.state = { ...this.state, backdropBlur: next }
    localStorage.setItem(STORAGE_KEY_BACKDROP_BLUR, String(next))
    document.documentElement.style.setProperty('--glass-blur', `${next}px`)
    this.emit()
  }

  setDesktopBackdrop(mode: DesktopBackdrop) {
    if (this.state.desktopBackdrop === mode) return
    this.state = { ...this.state, desktopBackdrop: mode }
    localStorage.setItem(STORAGE_KEY_DESKTOP_BACKDROP, mode)
    this.applyAppearance()
    this.emit()
  }
  get queueFollowupMessages() {
    return this.state.queueFollowupMessages
  }

  get queueDeliveryChipVisible() {
    return this.state.queueDeliveryChipVisible
  }
  get manualTerminalTitles() {
    return this.state.manualTerminalTitles
  }
  get externalFileDropMode() {
    return this.state.externalFileDropMode
  }
  get outlineCurrentHighlight() {
    return this.state.outlineCurrentHighlight
  }

  get actionsOnLatestAssistantOnly() {
    return this.state.actionsOnLatestAssistantOnly
  }

  get desktopCollapsedInputDock() {
    return this.state.desktopCollapsedInputDock
  }

  get processCollapseEnabled() {
    return this.state.processCollapseEnabled
  }

  get showTimelineNotices() {
    return this.state.showTimelineNotices
  }

  get showTurnDiff() {
    return this.state.showTurnDiff
  }

  get showQueuedCompaction() {
    return this.state.showQueuedCompaction
  }

  get composerSelectorStyle() {
    return this.state.composerSelectorStyle
  }

  get codeBlockThemeLight() {
    return this.state.codeBlockThemeLight
  }

  get codeBlockThemeDark() {
    return this.state.codeBlockThemeDark
  }

  /** 获取当前主题预设（内置主题返回对象，自定义返回 undefined） */
  getPreset(): ThemePreset | undefined {
    return getThemePreset(this.state.presetId)
  }

  /** 获取所有可用主题列表（内置 + 自定义导入） */
  getAvailablePresets(): { id: string; name: string; description: string; custom?: boolean }[] {
    return [
      ...builtinThemes.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
      })),
      ...listCustomThemes().map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        custom: true,
      })),
    ]
  }

  /**
   * 注册自定义主题（OpenCode 官方主题 JSON 导入）。
   * 导入后立即可选；返回值即注册后的 id。
   */
  addCustomTheme(preset: ThemePreset): string {
    registerCustomTheme(preset)
    persistCustomThemes()
    this.emit()
    return preset.id
  }

  /** 移除自定义主题；若当前正在使用则回落到默认主题 */
  removeCustomTheme(id: string): void {
    unregisterCustomTheme(id)
    persistCustomThemes()
    if (this.state.presetId === id) {
      this.state = { ...this.state, presetId: DEFAULT_THEME_ID }
      localStorage.setItem(STORAGE_KEY_PRESET, DEFAULT_THEME_ID)
      this.applyTheme()
    }
    this.emit()
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

  saveCustomCSSSnippet(name: string, css: string): CustomCSSSnippet {
    const now = Date.now()
    const snippet: CustomCSSSnippet = {
      id: `css-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      css,
      createdAt: now,
      updatedAt: now,
    }

    const customCSSSnippets = [...this.state.customCSSSnippets, snippet]
    this.state = { ...this.state, customCSSSnippets, activeCustomCSSSnippetId: snippet.id }
    this.persistCustomCSSSnippets(customCSSSnippets)
    localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, snippet.id)
    this.emit()
    return snippet
  }

  updateCustomCSSSnippet(id: string, updates: Partial<Pick<CustomCSSSnippet, 'name' | 'css'>>) {
    const customCSSSnippets = this.state.customCSSSnippets.map(item =>
      item.id === id ? { ...item, ...updates, updatedAt: Date.now() } : item,
    )

    this.state = { ...this.state, customCSSSnippets }
    this.persistCustomCSSSnippets(customCSSSnippets)
    this.emit()
  }

  deleteCustomCSSSnippet(id: string) {
    const customCSSSnippets = this.state.customCSSSnippets.filter(item => item.id !== id)
    const activeCustomCSSSnippetId =
      this.state.activeCustomCSSSnippetId === id ? null : this.state.activeCustomCSSSnippetId

    this.state = { ...this.state, customCSSSnippets, activeCustomCSSSnippetId }
    this.persistCustomCSSSnippets(customCSSSnippets)

    if (activeCustomCSSSnippetId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, activeCustomCSSSnippetId)
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    }

    this.emit()
  }

  applyCustomCSSSnippet(id: string) {
    const snippet = this.state.customCSSSnippets.find(item => item.id === id)
    if (!snippet) return

    this.state = {
      ...this.state,
      customCSS: snippet.css,
      activeCustomCSSSnippetId: id,
    }

    localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, snippet.css)
    localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, id)
    this.applyCustomCSS()
    this.emit()
  }

  clearActiveCustomCSSSnippet() {
    if (this.state.activeCustomCSSSnippetId === null) return
    this.state = { ...this.state, activeCustomCSSSnippetId: null }
    localStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    this.emit()
  }

  setCollapseUserMessages(enabled: boolean) {
    if (this.state.collapseUserMessages === enabled) return
    this.state = { ...this.state, collapseUserMessages: enabled }
    localStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(enabled))
    this.emit()
  }

  setRenderUserMarkdown(enabled: boolean) {
    if (this.state.renderUserMarkdown === enabled) return
    this.state = { ...this.state, renderUserMarkdown: enabled }
    localStorage.setItem(STORAGE_KEY_RENDER_USER_MARKDOWN, String(enabled))
    this.emit()
  }

  setRenderHtmlContent(enabled: boolean) {
    if (this.state.renderHtmlContent === enabled) return
    this.state = { ...this.state, renderHtmlContent: enabled }
    localStorage.setItem(STORAGE_KEY_RENDER_HTML_CONTENT, String(enabled))
    this.emit()
  }

  setStreamPacingEnabled(enabled: boolean) {
    if (this.state.streamPacingEnabled === enabled) return
    this.state = { ...this.state, streamPacingEnabled: enabled }
    localStorage.setItem(STORAGE_KEY_STREAM_PACING_ENABLED, String(enabled))
    this.emit()
  }

  setStreamFadeEnabled(enabled: boolean) {
    if (this.state.streamFadeEnabled === enabled) return
    this.state = { ...this.state, streamFadeEnabled: enabled }
    localStorage.setItem(STORAGE_KEY_STREAM_FADE_ENABLED, String(enabled))
    this.emit()
  }

  setStepFinishDisplay(display: Partial<StepFinishDisplay>) {
    const next = { ...this.state.stepFinishDisplay, ...display }
    this.state = { ...this.state, stepFinishDisplay: next }
    localStorage.setItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(next))
    this.emit()
  }

  setCompletedAtFormat(format: CompletedAtFormat) {
    if (this.state.completedAtFormat === format) return
    this.state = { ...this.state, completedAtFormat: format }
    localStorage.setItem(STORAGE_KEY_COMPLETED_AT_FORMAT, format)
    this.emit()
  }

  setReasoningDisplayMode(mode: ReasoningDisplayMode) {
    if (this.state.reasoningDisplayMode === mode) return
    this.state = { ...this.state, reasoningDisplayMode: mode }
    localStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, mode)
    this.emit()
  }

  setWideMode(enabled: boolean) {
    if (this.state.wideMode === enabled) return
    // 切换宽屏模式（开或关都算）会重置左缘拖拽的自定义宽度（对话列 + 输入框），回到所选模式的默认宽度
    this.state = { ...this.state, wideMode: enabled, chatContentWidth: null, chatInputWidth: null }
    localStorage.setItem(STORAGE_KEY_WIDE_MODE, String(enabled))
    localStorage.removeItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)
    localStorage.removeItem(STORAGE_KEY_CHAT_INPUT_WIDTH)
    this.emit()
  }

  setChatContentWidth(width: number | null) {
    const next = width !== null && Number.isFinite(width) && width > 0 ? Math.round(width) : null
    if (this.state.chatContentWidth === next) return
    this.state = { ...this.state, chatContentWidth: next }
    if (next === null) localStorage.removeItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)
    else localStorage.setItem(STORAGE_KEY_CHAT_CONTENT_WIDTH, String(next))
    this.emit()
  }

  setChatInputWidth(width: number | null) {
    const next = width !== null && Number.isFinite(width) && width > 0 ? Math.round(width) : null
    if (this.state.chatInputWidth === next) return
    this.state = { ...this.state, chatInputWidth: next }
    if (next === null) localStorage.removeItem(STORAGE_KEY_CHAT_INPUT_WIDTH)
    else localStorage.setItem(STORAGE_KEY_CHAT_INPUT_WIDTH, String(next))
    this.emit()
  }

  toggleWideMode() {
    this.setWideMode(!this.state.wideMode)
  }

  setDiffStyle(style: DiffStyle) {
    if (this.state.diffStyle === style) return
    this.state = { ...this.state, diffStyle: style }
    localStorage.setItem(STORAGE_KEY_DIFF_STYLE, style)
    this.emit()
  }

  setDescriptiveToolSteps(enabled: boolean) {
    if (this.state.descriptiveToolSteps === enabled) return
    this.state = { ...this.state, descriptiveToolSteps: enabled }
    localStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    this.emit()
  }

  setInlineToolRequests(enabled: boolean) {
    if (this.state.inlineToolRequests === enabled) return
    this.state = { ...this.state, inlineToolRequests: enabled }
    localStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    this.emit()
  }

  setCodeWordWrap(enabled: boolean) {
    if (this.state.codeWordWrap === enabled) return
    this.state = { ...this.state, codeWordWrap: enabled }
    localStorage.setItem(STORAGE_KEY_CODE_WORD_WRAP, String(enabled))
    this.emit()
  }

  setUIFontScale(scale: number) {
    const clamped = clampFontScale(scale)
    if (this.state.uiFontScale === clamped) return
    this.state = { ...this.state, uiFontScale: clamped }
    localStorage.setItem(STORAGE_KEY_FONT_SCALE, String(clamped))
    this.applyFontScale()
    this.emit()
  }

  setCodeFontScale(scale: number) {
    const clamped = clampFontScale(scale)
    if (this.state.codeFontScale === clamped) return
    this.state = { ...this.state, codeFontScale: clamped }
    localStorage.setItem(STORAGE_KEY_CODE_FONT_SCALE, String(clamped))
    this.applyFontScale()
    this.emit()
  }

  setToolCardStyle(style: ToolCardStyle) {
    if (this.state.toolCardStyle === style) return
    this.state = { ...this.state, toolCardStyle: style }
    localStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, style)
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
    localStorage.setItem(STORAGE_KEY_IMMERSIVE_MODE, String(enabled))
    localStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    localStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    localStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, enabled ? 'compact' : 'classic')
    localStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  }

  setCompactInlinePermission(enabled: boolean) {
    if (this.state.compactInlinePermission === enabled) return
    this.state = { ...this.state, compactInlinePermission: enabled }
    localStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  }

  setCompactionAutoCollapse(enabled: boolean) {
    if (this.state.compactionAutoCollapse === enabled) return
    this.state = { ...this.state, compactionAutoCollapse: enabled }
    localStorage.setItem(STORAGE_KEY_COMPACTION_AUTO_COLLAPSE, String(enabled))
    this.emit()
  }

  setQueueAutoCollapse(enabled: boolean) {
    if (this.state.queueAutoCollapse === enabled) return
    this.state = { ...this.state, queueAutoCollapse: enabled }
    localStorage.setItem(STORAGE_KEY_QUEUE_AUTO_COLLAPSE, String(enabled))
    this.emit()
  }

  setGlassEffect(enabled: boolean) {
    if (this.state.glassEffect === enabled) return
    this.state = { ...this.state, glassEffect: enabled }
    localStorage.setItem(STORAGE_KEY_GLASS_EFFECT, String(enabled))
    this.applyGlassClass()
    this.emit()
  }

  /** 切换外观处理；玻璃需要浮层模糊，顺手打开毛玻璃 */
  setAppearanceStyle(style: AppearanceStyle) {
    if (this.state.appearanceStyle === style) return
    const next: Partial<ThemeState> = { appearanceStyle: style }
    if (style === 'glass') {
      if (!this.state.glassEffect) {
        next.glassEffect = true
        localStorage.setItem(STORAGE_KEY_GLASS_EFFECT, 'true')
      }
      // 玻璃只在暗色下成立，浅色时开启就直接切到深色
      if (this.getResolvedMode() === 'light') {
        next.colorMode = 'dark'
        localStorage.setItem(STORAGE_KEY_COLOR_MODE, 'dark')
      }
    }
    this.state = { ...this.state, ...next }
    localStorage.setItem(STORAGE_KEY_APPEARANCE_STYLE, style)
    this.applyGlassClass()
    this.applyTheme()
    this.emit()
  }

  setGlassAlpha(alpha: number) {
    const clamped = clampGlassAlpha(alpha)
    if (this.state.glassAlpha === clamped) return
    this.state = { ...this.state, glassAlpha: clamped }
    localStorage.setItem(STORAGE_KEY_GLASS_ALPHA, String(clamped))
    this.applyAppearance()
    this.emit()
  }

  setWallpaperEnabled(enabled: boolean) {
    if (this.state.wallpaperEnabled === enabled) return
    this.state = { ...this.state, wallpaperEnabled: enabled }
    localStorage.setItem(STORAGE_KEY_WALLPAPER_ENABLED, String(enabled))
    this.applyAppearance()
    this.emit()
  }

  setWallpaperFit(fit: WallpaperFit) {
    if (this.state.wallpaperFit === fit) return
    this.state = { ...this.state, wallpaperFit: fit }
    localStorage.setItem(STORAGE_KEY_WALLPAPER_FIT, fit)
    this.applyAppearance()
    this.emit()
  }

  setWallpaperInChat(enabled: boolean) {
    if (this.state.wallpaperInChat === enabled) return
    this.state = { ...this.state, wallpaperInChat: enabled }
    localStorage.setItem(STORAGE_KEY_WALLPAPER_IN_CHAT, String(enabled))
    this.applyAppearance()
    this.emit()
  }

  /** 设置壁纸；传 null 清除 */
  async setWallpaperImage(file: File | Blob | null, fileName?: string | null): Promise<void> {
    if (!file) {
      await wallpaperIdbDelete().catch(() => undefined)
      this.replaceWallpaperUrl(null)
      this.state = { ...this.state, wallpaperFileName: null, wallpaperEnabled: false }
      localStorage.removeItem(STORAGE_KEY_WALLPAPER_FILE_NAME)
      localStorage.setItem(STORAGE_KEY_WALLPAPER_ENABLED, 'false')
      this.applyAppearance()
      this.emit()
      return
    }

    const compressed = await compressWallpaperImage(file)
    await wallpaperIdbPut(compressed)
    const name =
      fileName ?? (file instanceof File && file.name ? file.name : this.state.wallpaperFileName) ?? 'wallpaper'
    this.replaceWallpaperUrl(URL.createObjectURL(compressed))
    this.state = { ...this.state, wallpaperFileName: name, wallpaperEnabled: true }
    localStorage.setItem(STORAGE_KEY_WALLPAPER_FILE_NAME, name)
    localStorage.setItem(STORAGE_KEY_WALLPAPER_ENABLED, 'true')
    this.applyAppearance()
    this.emit()
  }

  setQueueFollowupMessages(enabled: boolean) {
    if (this.state.queueFollowupMessages === enabled) return
    this.state = { ...this.state, queueFollowupMessages: enabled }
    localStorage.setItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES, String(enabled))
    this.emit()
  }

  setQueueDeliveryChipVisible(enabled: boolean) {
    if (this.state.queueDeliveryChipVisible === enabled) return
    this.state = { ...this.state, queueDeliveryChipVisible: enabled }
    localStorage.setItem(STORAGE_KEY_QUEUE_DELIVERY_CHIP_VISIBLE, String(enabled))
    this.emit()
  }

  setManualTerminalTitles(enabled: boolean) {
    if (this.state.manualTerminalTitles === enabled) return
    this.state = { ...this.state, manualTerminalTitles: enabled }
    localStorage.setItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES, String(enabled))
    this.emit()
  }

  setExternalFileDropMode(mode: ExternalFileDropMode) {
    if (this.state.externalFileDropMode === mode) return
    this.state = { ...this.state, externalFileDropMode: mode }
    localStorage.setItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE, mode)
    this.emit()
  }

  setOutlineCurrentHighlight(enabled: boolean) {
    if (this.state.outlineCurrentHighlight === enabled) return
    this.state = { ...this.state, outlineCurrentHighlight: enabled }
    localStorage.setItem(STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT, String(enabled))
    this.emit()
  }

  setActionsOnLatestAssistantOnly(enabled: boolean) {
    if (this.state.actionsOnLatestAssistantOnly === enabled) return
    this.state = { ...this.state, actionsOnLatestAssistantOnly: enabled }
    localStorage.setItem(STORAGE_KEY_ACTIONS_ON_LATEST_ASSISTANT_ONLY, String(enabled))
    this.emit()
  }

  setDesktopCollapsedInputDock(enabled: boolean) {
    if (this.state.desktopCollapsedInputDock === enabled) return
    this.state = { ...this.state, desktopCollapsedInputDock: enabled }
    localStorage.setItem(STORAGE_KEY_DESKTOP_COLLAPSED_INPUT_DOCK, String(enabled))
    this.emit()
  }

  setProcessCollapseEnabled(enabled: boolean) {
    if (this.state.processCollapseEnabled === enabled) return
    this.state = { ...this.state, processCollapseEnabled: enabled }
    localStorage.setItem(STORAGE_KEY_PROCESS_COLLAPSE_ENABLED, String(enabled))
    this.emit()
  }

  setShowTimelineNotices(enabled: boolean) {
    if (this.state.showTimelineNotices === enabled) return
    this.state = { ...this.state, showTimelineNotices: enabled }
    localStorage.setItem(STORAGE_KEY_SHOW_TIMELINE_NOTICES, String(enabled))
    this.emit()
  }

  setShowTurnDiff(enabled: boolean) {
    if (this.state.showTurnDiff === enabled) return
    this.state = { ...this.state, showTurnDiff: enabled }
    localStorage.setItem(STORAGE_KEY_SHOW_TURN_DIFF, String(enabled))
    this.emit()
  }

  setShowQueuedCompaction(enabled: boolean) {
    if (this.state.showQueuedCompaction === enabled) return
    this.state = { ...this.state, showQueuedCompaction: enabled }
    localStorage.setItem(STORAGE_KEY_SHOW_QUEUED_COMPACTION, String(enabled))
    this.emit()
  }

  setComposerSelectorStyle(style: ComposerSelectorStyle) {
    if (this.state.composerSelectorStyle === style) return
    this.state = { ...this.state, composerSelectorStyle: style }
    localStorage.setItem(STORAGE_KEY_COMPOSER_SELECTOR_STYLE, style)
    this.emit()
  }

  setCodeBlockThemeLight(id: string) {
    const next = normalizeCodeBlockTheme(id, DEFAULT_CODE_BLOCK_THEME_LIGHT)
    if (this.state.codeBlockThemeLight === next) return
    this.state = { ...this.state, codeBlockThemeLight: next }
    localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_LIGHT, next)
    this.emit()
  }

  setCodeBlockThemeDark(id: string) {
    const next = normalizeCodeBlockTheme(id, DEFAULT_CODE_BLOCK_THEME_DARK)
    if (this.state.codeBlockThemeDark === next) return
    this.state = { ...this.state, codeBlockThemeDark: next }
    localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_DARK, next)
    this.emit()
  }

  // ---- Theme Application ----

  /** 初始化：应用当前主题到 DOM */
  init() {
    this.applyTheme()
    this.applyFontScale()
    this.applyGlassClass()
    this.applyAppearance()
    void this.loadWallpaperFromIDB()

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
    }

    // 3. 应用自定义 CSS
    this.applyCustomCSS()

    // 4. 明暗切换会影响玻璃浓度（亮色实色），重算一次
    this.applyAppearance()

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

  /**
   * 字号偏移覆盖。
   * 两个维度均为 0 时不注入覆盖，直接用 index.css :root 里的默认值。
   * 非零时通过 :root:root 高优先级覆盖 --fs-* 变量。
   *
   * 基准值（偏移 0）：
   *   UI:   xxs=11  xs=12  sm=13  md=13  base=14  lg=16
   *         heading-3=16  heading-2=18  heading-1=20
   *   Code: code=13  code-line-height=24  terminal=13  terminal-line-height=1.4
   */
  private applyFontScale() {
    const { uiFontScale: ui, codeFontScale: code } = this.state
    let el = document.getElementById(STYLE_ID_FONT_SCALE) as HTMLStyleElement | null

    if (ui === 0 && code === 0) {
      if (el) el.remove()
      return
    }

    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_FONT_SCALE
      document.head.appendChild(el)
    }

    const vars: string[] = []

    if (ui !== 0) {
      vars.push(
        `--fs-xxs: ${11 + ui}px`,
        `--fs-xs: ${12 + ui}px`,
        `--fs-sm: ${13 + ui}px`,
        `--fs-md: ${13 + ui}px`,
        `--fs-base: ${14 + ui}px`,
        `--fs-lg: ${16 + ui}px`,
        `--fs-heading-3: ${16 + ui}px`,
        `--fs-heading-2: ${18 + ui}px`,
        `--fs-heading-1: ${20 + ui}px`,
      )
    }

    if (code !== 0) {
      const codePx = 13 + code
      // 行高 = 基准 24 + 偏移 * 2（每 1px 字号对应 2px 行高增量）
      const lineH = 24 + code * 2
      const termPx = 13 + code
      const termLH = Math.round((1.4 + code * 0.05) * 100) / 100
      vars.push(
        `--fs-code: ${codePx}px`,
        `--fs-code-line-height: ${lineH}px`,
        `--fs-terminal: ${termPx}px`,
        `--fs-terminal-line-height: ${termLH}`,
      )
    }

    el.textContent = `:root:root {\n  ${vars.join(';\n  ')};\n}`
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

  /** 毛玻璃开关：data-glass 属性驱动 CSS */
  private applyGlassClass() {
    const root = document.documentElement
    if (this.state.glassEffect) {
      root.setAttribute('data-glass', '')
    } else {
      root.removeAttribute('data-glass')
    }
  }

  /**
   * 外观处理：把壁纸和染色浓度写到 DOM。
   * 内部面板不自己上色（--color-bg-100 在 glass.css 里置空），
   * 只由 .app-shell 那一层统一涂色，避免嵌套叠加。
   */
  private applyAppearance() {
    const root = document.documentElement
    if (this.state.appearanceStyle !== 'glass') {
      root.removeAttribute('data-appearance')
      root.removeAttribute('data-glass-wallpaper')
      root.removeAttribute('data-window-transparent')
      root.removeAttribute('data-live-backdrop')
      for (const key of GLASS_TOKEN_KEYS) root.style.removeProperty(key)
      if (this.state.liveBackdrop) this.state = { ...this.state, liveBackdrop: false }
      this.syncWindowBackdrop('none', '#101014')
      return
    }

    root.setAttribute('data-appearance', 'glass')
    const isDark = this.getResolvedMode() === 'dark'
    for (const [key, value] of Object.entries(buildGlassTokens(isDark))) {
      root.style.setProperty(key, value)
    }

    const url = this.state.wallpaperUrl
    const hasWallpaper = this.state.wallpaperEnabled && !!url
    if (hasWallpaper) {
      root.setAttribute('data-glass-wallpaper', '')
      root.style.setProperty('--glass-wallpaper', `url("${url}")`)
      root.style.setProperty('--glass-wallpaper-fit', this.state.wallpaperFit)
      root.style.setProperty('--glass-art-alpha', this.state.wallpaperInChat ? '0.24' : '0')
    } else {
      root.removeAttribute('data-glass-wallpaper')
      root.style.removeProperty('--glass-wallpaper')
      root.style.removeProperty('--glass-wallpaper-fit')
      root.style.setProperty('--glass-art-alpha', '0')
    }

    // 桌面端没设壁纸时，窗口背后就是桌面。
    //
    // Windows 上我们不再用系统材质：把桌面抓下来当页面背景，我们的材质
    // 才有东西可以糊（窗口背景透明时 Chromium 的 backdrop-filter 是死的）。
    // 其它平台留给系统材质，页面只负责染色。
    const wantsDesktop = isDark && !hasWallpaper && isTauri()
    // Windows 上只走自绘：系统材质档对应用内面板没有帮助，还和录屏互斥
    const liveBackdrop =
      wantsDesktop && (getDesktopPlatform() === 'windows' || this.state.desktopBackdrop === 'live')
    const nativeBackdrop = wantsDesktop && !liveBackdrop

    if (liveBackdrop) root.setAttribute('data-live-backdrop', '')
    else root.removeAttribute('data-live-backdrop')

    if (nativeBackdrop) root.setAttribute('data-window-transparent', '')
    else root.removeAttribute('data-window-transparent')

    if (this.state.liveBackdrop !== liveBackdrop) {
      this.state = { ...this.state, liveBackdrop }
    }

    // 拿不到系统模糊时（部分 Windows 版本、Linux 合成器），桌面会原样透上来，
    // 这里把染色抬高一档，保证文字还能读。
    const alpha = !isDark
      ? 1
      : nativeBackdrop && this.nativeBlurSupported === false
        ? Math.max(this.state.glassAlpha, GLASS_NO_BLUR_ALPHA)
        : this.state.glassAlpha
    root.style.setProperty('--glass-alpha', String(alpha))
    root.style.setProperty('--glass-blur', `${this.state.backdropBlur}px`)

    this.syncWindowBackdrop(
      liveBackdrop ? 'page' : nativeBackdrop ? 'native' : 'none',
      isDark ? '#101014' : '#f5f5f6',
    )
  }

  /**
   * 窗口背景模式：native = 系统材质，page = 页面自己画，none = 纯色。
   * 浏览器里没有窗口可调，直接跳过。
   */
  private syncWindowBackdrop(mode: BackdropMode, color: string) {
    if (!isTauri() || this.backdropMode === mode) return
    this.backdropMode = mode
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<boolean>('set_window_backdrop', { mode, color }))
      .then(applied => {
        if (mode !== 'native') return
        const supported = applied === true
        if (this.nativeBlurSupported === supported) return
        this.nativeBlurSupported = supported
        this.applyAppearance()
      })
      .catch(() => undefined)
  }

  /** 替换壁纸 object URL（先释放旧的） */
  private replaceWallpaperUrl(nextUrl: string | null) {
    const prev = this.state.wallpaperUrl
    if (prev && prev !== nextUrl) {
      URL.revokeObjectURL(prev)
    }
    this.state = { ...this.state, wallpaperUrl: nextUrl }
  }

  /** 从 IndexedDB 恢复壁纸；失败就当作没有 */
  private async loadWallpaperFromIDB() {
    if (this.wallpaperBlobLoaded) return
    this.wallpaperBlobLoaded = true
    try {
      const blob = await wallpaperIdbGet()
      if (!blob) {
        if (this.state.wallpaperEnabled || this.state.wallpaperFileName) {
          this.state = { ...this.state, wallpaperEnabled: false, wallpaperFileName: null, wallpaperUrl: null }
          localStorage.setItem(STORAGE_KEY_WALLPAPER_ENABLED, 'false')
          localStorage.removeItem(STORAGE_KEY_WALLPAPER_FILE_NAME)
          this.applyAppearance()
          this.emit()
        }
        return
      }
      this.replaceWallpaperUrl(URL.createObjectURL(blob))
      this.applyAppearance()
      this.emit()
    } catch {
      /* IndexedDB 不可用时静默跳过 */
    }
  }

  private persistCustomCSSSnippets(customCSSSnippets: CustomCSSSnippet[]) {
    localStorage.setItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS, JSON.stringify(customCSSSnippets))
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

function normalizeThemeBackup(raw: unknown): ThemeBackup {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const customCSSSnippets = parseCustomCSSSnippets(
    JSON.stringify(Array.isArray(parsed?.customCSSSnippets) ? parsed.customCSSSnippets : []),
  )
  const activeCustomCSSSnippetId =
    typeof parsed?.activeCustomCSSSnippetId === 'string' &&
    customCSSSnippets.some(item => item.id === parsed.activeCustomCSSSnippetId)
      ? parsed.activeCustomCSSSnippetId
      : null

  return {
    presetId:
      typeof parsed?.presetId === 'string' && getThemePreset(parsed.presetId) ? parsed.presetId : DEFAULT_THEME_ID,
    colorMode: parsed?.colorMode === 'light' || parsed?.colorMode === 'dark' ? parsed.colorMode : 'system',
    customCSS: typeof parsed?.customCSS === 'string' ? parsed.customCSS : '',
    customCSSSnippets,
    activeCustomCSSSnippetId,
    collapseUserMessages: typeof parsed?.collapseUserMessages === 'boolean' ? parsed.collapseUserMessages : true,
    renderUserMarkdown:
      typeof parsed?.renderUserMarkdown === 'boolean' ? parsed.renderUserMarkdown : DEFAULT_RENDER_USER_MARKDOWN,
    renderHtmlContent:
      typeof parsed?.renderHtmlContent === 'boolean' ? parsed.renderHtmlContent : DEFAULT_RENDER_HTML_CONTENT,
    streamPacingEnabled:
      typeof parsed?.streamPacingEnabled === 'boolean' ? parsed.streamPacingEnabled : DEFAULT_STREAM_PACING_ENABLED,
    streamFadeEnabled:
      typeof parsed?.streamFadeEnabled === 'boolean' ? parsed.streamFadeEnabled : DEFAULT_STREAM_FADE_ENABLED,
    stepFinishDisplay:
      parsed?.stepFinishDisplay && typeof parsed.stepFinishDisplay === 'object'
        ? { ...DEFAULT_STEP_FINISH_DISPLAY, ...(parsed.stepFinishDisplay as Partial<StepFinishDisplay>) }
        : DEFAULT_STEP_FINISH_DISPLAY,
    completedAtFormat: parsed?.completedAtFormat === 'dateTime' ? 'dateTime' : DEFAULT_COMPLETED_AT_FORMAT,
    reasoningDisplayMode:
      parsed?.reasoningDisplayMode === 'italic' || parsed?.reasoningDisplayMode === 'markdown'
        ? parsed.reasoningDisplayMode
        : DEFAULT_REASONING_DISPLAY_MODE,
    wideMode: parsed?.wideMode === true,
    chatContentWidth:
      typeof parsed?.chatContentWidth === 'number' && parsed.chatContentWidth > 0
        ? parsed.chatContentWidth
        : null,
    chatInputWidth:
      typeof parsed?.chatInputWidth === 'number' && parsed.chatInputWidth > 0 ? parsed.chatInputWidth : null,
    diffStyle: parsed?.diffStyle === 'changeBars' ? 'changeBars' : DEFAULT_DIFF_STYLE,
    descriptiveToolSteps:
      typeof parsed?.descriptiveToolSteps === 'boolean' ? parsed.descriptiveToolSteps : DEFAULT_DESCRIPTIVE_TOOL_STEPS,
    inlineToolRequests:
      typeof parsed?.inlineToolRequests === 'boolean' ? parsed.inlineToolRequests : DEFAULT_INLINE_TOOL_REQUESTS,
    codeWordWrap: typeof parsed?.codeWordWrap === 'boolean' ? parsed.codeWordWrap : DEFAULT_CODE_WORD_WRAP,
    uiFontScale: clampFontScale(typeof parsed?.uiFontScale === 'number' ? parsed.uiFontScale : DEFAULT_UI_FONT_SCALE),
    codeFontScale: clampFontScale(
      typeof parsed?.codeFontScale === 'number' ? parsed.codeFontScale : DEFAULT_CODE_FONT_SCALE,
    ),
    toolCardStyle:
      parsed?.toolCardStyle === 'classic' || parsed?.toolCardStyle === 'compact'
        ? parsed.toolCardStyle
        : DEFAULT_TOOL_CARD_STYLE,
    immersiveMode: typeof parsed?.immersiveMode === 'boolean' ? parsed.immersiveMode : DEFAULT_IMMERSIVE_MODE,
    compactInlinePermission:
      typeof parsed?.compactInlinePermission === 'boolean'
        ? parsed.compactInlinePermission
        : DEFAULT_COMPACT_INLINE_PERMISSION,
    compactionAutoCollapse:
      typeof parsed?.compactionAutoCollapse === 'boolean'
        ? parsed.compactionAutoCollapse
        : DEFAULT_COMPACTION_AUTO_COLLAPSE,
    queueAutoCollapse:
      typeof parsed?.queueAutoCollapse === 'boolean' ? parsed.queueAutoCollapse : DEFAULT_QUEUE_AUTO_COLLAPSE,
    glassEffect: typeof parsed?.glassEffect === 'boolean' ? parsed.glassEffect : DEFAULT_GLASS_EFFECT,
    appearanceStyle: parsed?.appearanceStyle === 'glass' ? 'glass' : DEFAULT_APPEARANCE_STYLE,
    glassAlpha: clampGlassAlpha(typeof parsed?.glassAlpha === 'number' ? parsed.glassAlpha : DEFAULT_GLASS_ALPHA),
    backdropBlur: typeof parsed?.backdropBlur === 'number' ? parsed.backdropBlur : DEFAULT_BACKDROP_BLUR,
    backdropInterval: DEFAULT_BACKDROP_INTERVAL,
    wallpaperEnabled:
      typeof parsed?.wallpaperEnabled === 'boolean' ? parsed.wallpaperEnabled : DEFAULT_WALLPAPER_ENABLED,
    wallpaperFit: parsed?.wallpaperFit === 'contain' ? 'contain' : DEFAULT_WALLPAPER_FIT,
    wallpaperInChat:
      typeof parsed?.wallpaperInChat === 'boolean' ? parsed.wallpaperInChat : DEFAULT_WALLPAPER_IN_CHAT,
    wallpaperFileName: typeof parsed?.wallpaperFileName === 'string' ? parsed.wallpaperFileName : null,
    wallpaperUrl: null,
    liveBackdrop: false,
    desktopBackdrop: DEFAULT_DESKTOP_BACKDROP,
    queueFollowupMessages:
      typeof parsed?.queueFollowupMessages === 'boolean'
        ? parsed.queueFollowupMessages
        : DEFAULT_QUEUE_FOLLOWUP_MESSAGES,
    queueDeliveryChipVisible:
      typeof parsed?.queueDeliveryChipVisible === 'boolean'
        ? parsed.queueDeliveryChipVisible
        : DEFAULT_QUEUE_DELIVERY_CHIP_VISIBLE,
    manualTerminalTitles:
      typeof parsed?.manualTerminalTitles === 'boolean'
        ? parsed.manualTerminalTitles
        : DEFAULT_MANUAL_TERMINAL_TITLES,
    externalFileDropMode: parsed?.externalFileDropMode === 'mention' ? 'mention' : DEFAULT_EXTERNAL_FILE_DROP_MODE,
    outlineCurrentHighlight:
      typeof parsed?.outlineCurrentHighlight === 'boolean'
        ? parsed.outlineCurrentHighlight
        : DEFAULT_OUTLINE_CURRENT_HIGHLIGHT,
    actionsOnLatestAssistantOnly:
      typeof parsed?.actionsOnLatestAssistantOnly === 'boolean'
        ? parsed.actionsOnLatestAssistantOnly
        : DEFAULT_ACTIONS_ON_LATEST_ASSISTANT_ONLY,
    desktopCollapsedInputDock:
      typeof parsed?.desktopCollapsedInputDock === 'boolean'
        ? parsed.desktopCollapsedInputDock
        : DEFAULT_DESKTOP_COLLAPSED_INPUT_DOCK,
    processCollapseEnabled:
      typeof parsed?.processCollapseEnabled === 'boolean'
        ? parsed.processCollapseEnabled
        : DEFAULT_PROCESS_COLLAPSE_ENABLED,
    showTimelineNotices:
      typeof parsed?.showTimelineNotices === 'boolean'
        ? parsed.showTimelineNotices
        : DEFAULT_SHOW_TIMELINE_NOTICES,
    showTurnDiff: typeof parsed?.showTurnDiff === 'boolean' ? parsed.showTurnDiff : DEFAULT_SHOW_TURN_DIFF,
    showQueuedCompaction:
      typeof parsed?.showQueuedCompaction === 'boolean'
        ? parsed.showQueuedCompaction
        : DEFAULT_SHOW_QUEUED_COMPACTION,
    composerSelectorStyle:
      parsed?.composerSelectorStyle === 'seat' ? 'seat' : DEFAULT_COMPOSER_SELECTOR_STYLE,
    codeBlockThemeLight: normalizeCodeBlockTheme(
      typeof parsed?.codeBlockThemeLight === 'string' ? parsed.codeBlockThemeLight : DEFAULT_CODE_BLOCK_THEME_LIGHT,
      DEFAULT_CODE_BLOCK_THEME_LIGHT,
    ),
    codeBlockThemeDark: normalizeCodeBlockTheme(
      typeof parsed?.codeBlockThemeDark === 'string' ? parsed.codeBlockThemeDark : DEFAULT_CODE_BLOCK_THEME_DARK,
      DEFAULT_CODE_BLOCK_THEME_DARK,
    ),
  }
}

export function exportThemeBackup(): ThemeBackup {
  const state = themeStore.getState()
  return {
    ...state,
    customCSSSnippets: state.customCSSSnippets.map(item => ({ ...item })),
    stepFinishDisplay: { ...state.stepFinishDisplay },
  }
}

export function importThemeBackup(raw: unknown): void {
  const backup = normalizeThemeBackup(raw)
  localStorage.setItem(STORAGE_KEY_PRESET, backup.presetId)
  localStorage.setItem(STORAGE_KEY_COLOR_MODE, backup.colorMode)
  localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, backup.customCSS)
  localStorage.setItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS, JSON.stringify(backup.customCSSSnippets))
  if (backup.activeCustomCSSSnippetId) {
    localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, backup.activeCustomCSSSnippetId)
  } else {
    localStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
  }
  localStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(backup.collapseUserMessages))
  localStorage.setItem(STORAGE_KEY_RENDER_USER_MARKDOWN, String(backup.renderUserMarkdown))
  localStorage.setItem(STORAGE_KEY_RENDER_HTML_CONTENT, String(backup.renderHtmlContent))
  localStorage.setItem(STORAGE_KEY_STREAM_PACING_ENABLED, String(backup.streamPacingEnabled))
  localStorage.setItem(STORAGE_KEY_STREAM_FADE_ENABLED, String(backup.streamFadeEnabled))
  localStorage.setItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(backup.stepFinishDisplay))
  localStorage.setItem(STORAGE_KEY_COMPLETED_AT_FORMAT, backup.completedAtFormat)
  localStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, backup.reasoningDisplayMode)
  localStorage.setItem(STORAGE_KEY_WIDE_MODE, String(backup.wideMode))
  if (backup.chatContentWidth === null) localStorage.removeItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)
  else localStorage.setItem(STORAGE_KEY_CHAT_CONTENT_WIDTH, String(backup.chatContentWidth))
  if (backup.chatInputWidth === null) localStorage.removeItem(STORAGE_KEY_CHAT_INPUT_WIDTH)
  else localStorage.setItem(STORAGE_KEY_CHAT_INPUT_WIDTH, String(backup.chatInputWidth))
  localStorage.setItem(STORAGE_KEY_DIFF_STYLE, backup.diffStyle)
  localStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(backup.descriptiveToolSteps))
  localStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(backup.inlineToolRequests))
  localStorage.setItem(STORAGE_KEY_CODE_WORD_WRAP, String(backup.codeWordWrap))
  localStorage.setItem(STORAGE_KEY_FONT_SCALE, String(backup.uiFontScale))
  localStorage.setItem(STORAGE_KEY_CODE_FONT_SCALE, String(backup.codeFontScale))
  localStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, backup.toolCardStyle)
  localStorage.setItem(STORAGE_KEY_IMMERSIVE_MODE, String(backup.immersiveMode))
  localStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(backup.compactInlinePermission))
  localStorage.setItem(STORAGE_KEY_COMPACTION_AUTO_COLLAPSE, String(backup.compactionAutoCollapse))
  localStorage.setItem(STORAGE_KEY_QUEUE_AUTO_COLLAPSE, String(backup.queueAutoCollapse))
  localStorage.setItem(STORAGE_KEY_GLASS_EFFECT, String(backup.glassEffect))
  localStorage.setItem(STORAGE_KEY_APPEARANCE_STYLE, backup.appearanceStyle)
  localStorage.setItem(STORAGE_KEY_GLASS_ALPHA, String(backup.glassAlpha))
  localStorage.setItem(STORAGE_KEY_WALLPAPER_ENABLED, String(backup.wallpaperEnabled))
  localStorage.setItem(STORAGE_KEY_WALLPAPER_FIT, backup.wallpaperFit)
  localStorage.setItem(STORAGE_KEY_WALLPAPER_IN_CHAT, String(backup.wallpaperInChat))
  if (backup.wallpaperFileName) {
    localStorage.setItem(STORAGE_KEY_WALLPAPER_FILE_NAME, backup.wallpaperFileName)
  } else {
    localStorage.removeItem(STORAGE_KEY_WALLPAPER_FILE_NAME)
  }
  localStorage.setItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES, String(backup.queueFollowupMessages))
  localStorage.setItem(STORAGE_KEY_QUEUE_DELIVERY_CHIP_VISIBLE, String(backup.queueDeliveryChipVisible))
  localStorage.setItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES, String(backup.manualTerminalTitles))
  localStorage.setItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE, backup.externalFileDropMode)
  localStorage.setItem(STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT, String(backup.outlineCurrentHighlight))
  localStorage.setItem(
    STORAGE_KEY_ACTIONS_ON_LATEST_ASSISTANT_ONLY,
    String(backup.actionsOnLatestAssistantOnly),
  )
  localStorage.setItem(STORAGE_KEY_DESKTOP_COLLAPSED_INPUT_DOCK, String(backup.desktopCollapsedInputDock))
  localStorage.setItem(STORAGE_KEY_PROCESS_COLLAPSE_ENABLED, String(backup.processCollapseEnabled))
  localStorage.setItem(STORAGE_KEY_SHOW_TIMELINE_NOTICES, String(backup.showTimelineNotices))
  localStorage.setItem(STORAGE_KEY_SHOW_TURN_DIFF, String(backup.showTurnDiff))
  localStorage.setItem(STORAGE_KEY_SHOW_QUEUED_COMPACTION, String(backup.showQueuedCompaction))
  localStorage.setItem(STORAGE_KEY_COMPOSER_SELECTOR_STYLE, backup.composerSelectorStyle)
  localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_LIGHT, backup.codeBlockThemeLight)
  localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_DARK, backup.codeBlockThemeDark)
}
