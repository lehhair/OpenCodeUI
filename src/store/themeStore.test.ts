import { beforeEach, describe, expect, it } from 'vitest'
import { themeStore } from './themeStore'

describe('themeStore · 流式输出设置', () => {
  it('默认开启逐字节奏与尾部淡入', () => {
    expect(themeStore.streamPacingEnabled).toBe(true)
    expect(themeStore.streamFadeEnabled).toBe(true)
  })

  it('开关会持久化，便于还原为无淡入的原版观感', () => {
    themeStore.setStreamFadeEnabled(false)
    expect(themeStore.streamFadeEnabled).toBe(false)
    expect(localStorage.getItem('stream-fade-enabled')).toBe('false')

    themeStore.setStreamPacingEnabled(false)
    expect(themeStore.streamPacingEnabled).toBe(false)
    expect(localStorage.getItem('stream-pacing-enabled')).toBe('false')

    themeStore.setStreamPacingEnabled(true)
    themeStore.setStreamFadeEnabled(true)
    expect(localStorage.getItem('stream-pacing-enabled')).toBe('true')
    expect(localStorage.getItem('stream-fade-enabled')).toBe('true')
  })
})

describe('themeStore · 对话列/输入框自定义宽度（chatContentWidth / chatInputWidth）', () => {
  beforeEach(() => {
    localStorage.clear()
    themeStore.setChatContentWidth(null)
    themeStore.setChatInputWidth(null)
  })

  it('setChatContentWidth 持久化 px，null 清除', () => {
    themeStore.setChatContentWidth(900)
    expect(themeStore.chatContentWidth).toBe(900)
    expect(localStorage.getItem('chat-content-width')).toBe('900')

    themeStore.setChatContentWidth(null)
    expect(themeStore.chatContentWidth).toBeNull()
    expect(localStorage.getItem('chat-content-width')).toBeNull()
  })

  it('setChatInputWidth 持久化 px，null 清除', () => {
    themeStore.setChatInputWidth(820)
    expect(themeStore.chatInputWidth).toBe(820)
    expect(localStorage.getItem('chat-input-width')).toBe('820')

    themeStore.setChatInputWidth(null)
    expect(themeStore.chatInputWidth).toBeNull()
    expect(localStorage.getItem('chat-input-width')).toBeNull()
  })

  it('非法值（0/负数/NaN）一律归一为 null', () => {
    themeStore.setChatContentWidth(0)
    expect(themeStore.chatContentWidth).toBeNull()
    themeStore.setChatInputWidth(-100)
    expect(themeStore.chatInputWidth).toBeNull()
    themeStore.setChatContentWidth(Number.NaN)
    expect(themeStore.chatContentWidth).toBeNull()
  })

  it('两个宽度互不影响（独立调整）', () => {
    themeStore.setChatContentWidth(900)
    themeStore.setChatInputWidth(820)
    expect(themeStore.chatContentWidth).toBe(900)
    expect(themeStore.chatInputWidth).toBe(820)

    themeStore.setChatContentWidth(null)
    expect(themeStore.chatContentWidth).toBeNull()
    expect(themeStore.chatInputWidth).toBe(820)
  })

  it('切换宽屏模式（开或关）会把两个自定义宽度一起重置', () => {
    const originalWide = themeStore.wideMode

    themeStore.setChatContentWidth(900)
    themeStore.setChatInputWidth(820)
    themeStore.setWideMode(!originalWide) // 切到另一档
    expect(themeStore.chatContentWidth).toBeNull()
    expect(themeStore.chatInputWidth).toBeNull()
    expect(localStorage.getItem('chat-content-width')).toBeNull()
    expect(localStorage.getItem('chat-input-width')).toBeNull()

    themeStore.setChatContentWidth(1000)
    themeStore.setChatInputWidth(860)
    themeStore.setWideMode(originalWide) // 再切回来
    expect(themeStore.chatContentWidth).toBeNull()
    expect(themeStore.chatInputWidth).toBeNull()

    // 同值 setWideMode 是 no-op，不应误清
    themeStore.setChatContentWidth(1000)
    themeStore.setWideMode(originalWide)
    expect(themeStore.chatContentWidth).toBe(1000)
    themeStore.setChatContentWidth(null)
  })
})
