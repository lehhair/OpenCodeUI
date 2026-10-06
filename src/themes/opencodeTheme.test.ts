import { describe, expect, it } from 'vitest'
import { parseOpenCodeTheme } from './opencodeTheme'
import { registerCustomTheme, unregisterCustomTheme, getThemePreset, listCustomThemes } from './index'
// 官方主题 fixture（v2.0.14 官方仓库 packages/ui/src/theme/themes/dracula.json 原样拷贝）
import draculaJson from './__fixtures__/opencode-theme-dracula.json'

describe('parseOpenCodeTheme（官方 desktop-theme JSON → ThemePreset）', () => {
  it('解析官方 dracula.json：id/name 与两套变体', () => {
    const raw = draculaJson as unknown
    const preset = parseOpenCodeTheme(raw)
    expect(preset).not.toBeNull()
    expect(preset!.id).toBe('oc-dracula')
    expect(preset!.name).toBe('Dracula')
    expect(preset!.light.background.bg000).toBeTruthy()
    expect(preset!.dark.background.bg000).toBeTruthy()
  })

  it('dark 变体：bg000=neutral（深底），text100=ink（亮字）', () => {
    const raw = draculaJson as unknown
    const preset = parseOpenCodeTheme(raw)!
    // dracula dark: neutral=#1d1e28 → hsl 约 (234, 16%, 14%)，ink=#f8f8f2 → 亮
    expect(preset.dark.background.bg000).toMatch(/^234\./)
    expect(preset.dark.text.text100).toMatch(/9[0-9](\.\d+)?%$/) // 高亮度
    // 语义色来自 palette（dracula dark error=#ff5555 → hsl 0° 附近）
    expect(preset.dark.semantic.danger100).toMatch(/^0(\.0)? /)
  })

  it('light 变体：语义底是高亮度（bg≈94%）', () => {
    const raw = draculaJson as unknown
    const preset = parseOpenCodeTheme(raw)!
    expect(preset.light.semantic.dangerBg).toMatch(/94(\.0)?%$/)
    expect(preset.dark.semantic.dangerBg).toMatch(/16(\.0)?%$/)
  })

  it('非法输入返回 null', () => {
    expect(parseOpenCodeTheme(null)).toBeNull()
    expect(parseOpenCodeTheme({})).toBeNull()
    expect(parseOpenCodeTheme({ light: { palette: { neutral: '#fff' } } })).toBeNull()
    // palette 缺颜色字段
    expect(
      parseOpenCodeTheme({
        light: { palette: { neutral: '#fff', ink: '#000' } },
        dark: { palette: { neutral: '#000', ink: '#fff' } },
      }),
    ).toBeNull()
    // 非法 hex
    expect(
      parseOpenCodeTheme({
        light: { palette: { neutral: 'red', ink: '#000', primary: '#00f', accent: '#0f0', success: '#0a0', warning: '#fa0', error: '#f00', info: '#0af' } },
        dark: { palette: { neutral: '#000', ink: '#fff', primary: '#00f', accent: '#0f0', success: '#0a0', warning: '#fa0', error: '#f00', info: '#0af' } },
      }),
    ).toBeNull()
  })
})

describe('自定义主题注册表', () => {
  it('register 后 getThemePreset 命中，unregister 后消失', () => {
    const raw = draculaJson as unknown
    const preset = parseOpenCodeTheme(raw)!
    registerCustomTheme(preset)
    expect(getThemePreset('oc-dracula')).toBe(preset)
    expect(listCustomThemes().map(t => t.id)).toContain('oc-dracula')
    unregisterCustomTheme('oc-dracula')
    expect(getThemePreset('oc-dracula')).toBeUndefined()
  })
})
