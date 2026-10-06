// ============================================
// OpenCode 官方桌面主题 JSON 导入器
//
// 官方格式（packages/ui/src/theme/themes/*.json，desktop-theme.schema.json）：
//   { name, id, light: Variant, dark: Variant }
//   Variant = { palette: { neutral, ink, primary, accent, success, warning,
//                          error, info, diffAdd, diffDelete }, overrides?: {...} }
//
// 我们的 ThemeColors 是 HSL 层级（bg000-400 / text000-600 / accent 阶梯 /
// 语义色带 bg 变体）。导入时从扁平 palette 派生：
//   - light：neutral=亮底、ink=深字；bg 阶梯向 ink 方向递进变深，
//     text 阶梯向 neutral 方向递进变浅；语义 bg = 同色高亮度底
//   - dark：方向相反（neutral=深底、ink=亮字）
// 语法高亮 overrides（syntax-*）不映射——我们的代码高亮由 shiki 主题承担。
// ============================================

import type { ThemeColors, ThemePreset } from './index'

// ---- 官方 JSON 形状 ----
interface OpenCodeThemePalette {
  neutral: string
  ink: string
  primary: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  diffAdd?: string
  diffDelete?: string
}

interface OpenCodeThemeVariant {
  palette: OpenCodeThemePalette
}

export interface OpenCodeThemeJson {
  name?: string
  id?: string
  light?: OpenCodeThemeVariant
  dark?: OpenCodeThemeVariant
}

// ---- hex → HSL ----

interface Hsl {
  h: number
  s: number
  l: number
}

function hexToHsl(hex: string): Hsl | null {
  if (typeof hex !== 'string') return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s: s * 100, l: l * 100 }
}

function hslString(hsl: Hsl): string {
  const h = ((hsl.h % 360) + 360) % 360
  return `${h.toFixed(1)} ${clamp(hsl.s).toFixed(1)}% ${clamp(hsl.l).toFixed(1)}%`
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value))
}

/** HSL 空间线性混合（t=0 取 a，t=1 取 b） */
function mixHsl(a: Hsl, b: Hsl, t: number): Hsl {
  // 色相走最短弧
  let dh = b.h - a.h
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return {
    h: a.h + dh * t,
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  }
}

/** 语义色底：同色相、低饱和、按明暗模式定亮度（对齐内置主题的手工做法） */
function semanticBg(color: Hsl, dark: boolean): string {
  return hslString({ h: color.h, s: clamp(color.s * 0.55), l: dark ? 16 : 94 })
}

function deriveVariant(palette: OpenCodeThemePalette, dark: boolean): ThemeColors | null {
  const neutral = hexToHsl(palette.neutral)
  const ink = hexToHsl(palette.ink)
  const primary = hexToHsl(palette.primary)
  const accent = hexToHsl(palette.accent)
  const success = hexToHsl(palette.success)
  const warning = hexToHsl(palette.warning)
  const error = hexToHsl(palette.error)
  const info = hexToHsl(palette.info)
  if (!neutral || !ink || !primary || !accent || !success || !warning || !error || !info) return null

  // light：底向 ink（深）递进；dark：底向 ink（亮）递进——方向天然一致
  const bgStep = dark ? [4, 8, 13, 19] : [3, 6, 10, 15]
  const textStep = dark ? [32, 46, 58, 68, 76] : [28, 44, 58, 68, 76]
  const borderStep = dark ? [10, 16, 24] : [8, 13, 20]

  return {
    background: {
      bg000: hslString(neutral),
      bg100: hslString(mixHsl(neutral, ink, bgStep[0] / 100)),
      bg200: hslString(mixHsl(neutral, ink, bgStep[1] / 100)),
      bg300: hslString(mixHsl(neutral, ink, bgStep[2] / 100)),
      bg400: hslString(mixHsl(neutral, ink, bgStep[3] / 100)),
    },
    text: {
      text000: '0 0% 100%',
      text100: hslString(ink),
      text200: hslString(mixHsl(ink, neutral, textStep[0] / 100)),
      text300: hslString(mixHsl(ink, neutral, textStep[1] / 100)),
      text400: hslString(mixHsl(ink, neutral, textStep[2] / 100)),
      text500: hslString(mixHsl(ink, neutral, textStep[3] / 100)),
      text600: hslString(mixHsl(ink, neutral, textStep[4] / 100)),
    },
    accent: {
      brand: hslString(primary),
      main000: hslString(mixHsl(primary, ink, dark ? -12 / 100 : 14 / 100)),
      main100: hslString(primary),
      main200: hslString(mixHsl(primary, neutral, dark ? 10 / 100 : -8 / 100)),
      secondary100: hslString(accent),
    },
    semantic: {
      success100: hslString(success),
      success200: hslString(mixHsl(success, ink, dark ? -15 / 100 : 18 / 100)),
      successBg: semanticBg(success, dark),
      warning100: hslString(warning),
      warning200: hslString(mixHsl(warning, ink, dark ? -15 / 100 : 18 / 100)),
      warningBg: semanticBg(warning, dark),
      danger000: hslString(mixHsl(error, ink, dark ? -25 / 100 : 30 / 100)),
      danger100: hslString(error),
      danger200: hslString(mixHsl(error, neutral, dark ? 12 / 100 : -10 / 100)),
      dangerBg: semanticBg(error, dark),
      danger900: hslString(mixHsl(error, ink, dark ? -55 / 100 : 55 / 100)),
      info100: hslString(info),
      info200: hslString(mixHsl(info, ink, dark ? -15 / 100 : 18 / 100)),
      infoBg: semanticBg(info, dark),
    },
    border: {
      border100: hslString(mixHsl(neutral, ink, borderStep[0] / 100)),
      border200: hslString(mixHsl(neutral, ink, borderStep[1] / 100)),
      border300: hslString(mixHsl(neutral, ink, borderStep[2] / 100)),
    },
    special: {
      alwaysBlack: '0 0% 0%',
      alwaysWhite: '0 0% 100%',
      oncolor100: hslString(neutral),
    },
  }
}

/**
 * 解析官方桌面主题 JSON 为我们的 ThemePreset。
 * 非法/缺字段返回 null（调用方给错误提示）。
 */
export function parseOpenCodeTheme(raw: unknown): ThemePreset | null {
  if (!raw || typeof raw !== 'object') return null
  const json = raw as OpenCodeThemeJson
  if (!json.light?.palette || !json.dark?.palette) return null
  const light = deriveVariant(json.light.palette, false)
  const dark = deriveVariant(json.dark.palette, true)
  if (!light || !dark) return null
  const id = typeof json.id === 'string' && json.id.trim() ? `oc-${json.id.trim()}` : `oc-${crypto.randomUUID().slice(0, 8)}`
  const name = typeof json.name === 'string' && json.name.trim() ? json.name.trim() : id
  return {
    id,
    name,
    description: 'OpenCode 主题包导入',
    light,
    dark,
  }
}
