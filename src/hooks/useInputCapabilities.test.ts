import { describe, expect, it } from 'vitest'
import { getInputCapabilities } from './useInputCapabilities'

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) Chrome/124 Mobile Safari/537.36'
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1'

function setEnvironment(env: {
  hoverFine?: boolean
  coarse?: boolean
  touchPoints?: number
  userAgent?: string
  platform?: string
}) {
  const state = {
    hoverFine: false,
    coarse: false,
    touchPoints: 0,
    userAgent: DESKTOP_UA,
    platform: '',
    ...env,
  }

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('hover: hover') ? state.hoverFine : state.coarse,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => state.touchPoints })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => state.userAgent })
  Object.defineProperty(navigator, 'platform', { configurable: true, get: () => state.platform })
}

describe('getInputCapabilities', () => {
  it('keeps desktop controls for a mouse-only desktop', () => {
    setEnvironment({ hoverFine: true })

    expect(getInputCapabilities().preferTouchUi).toBe(false)
  })

  it('prefers touch ui on a phone that reports a hovering fine pointer', () => {
    // 带笔的机型会如实报 hover+fine，不能因此退回桌面控件
    setEnvironment({ hoverFine: true, userAgent: ANDROID_UA })

    const caps = getInputCapabilities()

    expect(caps.hasTouch).toBe(true)
    expect(caps.preferTouchUi).toBe(true)
  })

  it('keeps desktop controls on a hybrid laptop with touch screen', () => {
    setEnvironment({ hoverFine: true, coarse: true, touchPoints: 10 })

    expect(getInputCapabilities().preferTouchUi).toBe(false)
  })

  it('prefers touch ui on tablets', () => {
    setEnvironment({ coarse: true, touchPoints: 5, userAgent: IPAD_UA })

    expect(getInputCapabilities().preferTouchUi).toBe(true)
  })

  it('prefers touch ui for an ipad reporting itself as a mac', () => {
    // iPadOS 13+ 伪装成 Mac，只能靠触点数区分
    setEnvironment({ hoverFine: true, touchPoints: 5, platform: 'MacIntel' })

    expect(getInputCapabilities().preferTouchUi).toBe(true)
  })
})
