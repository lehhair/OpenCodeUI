import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendStreamingTextWithFade,
  createStreamFadeState,
  resetStreamFade,
  STREAM_FADE_DURATION_MS,
} from './streamFade'

const originalAnimate = Element.prototype.animate

describe('streamFade', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ cancel: vi.fn() })),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalAnimate) {
      Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: originalAnimate,
      })
    } else {
      // @ts-expect-error jsdom 默认没有 WAAPI
      delete Element.prototype.animate
    }
  })

  it('新追加的一段先包成 span，动画结束后并回文本', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>hello</p>'
    const paragraph = root.querySelector('p')!
    const state = createStreamFadeState()

    expect(appendStreamingTextWithFade(root, ' world', state)).toBe(true)
    const span = paragraph.querySelector('span')
    expect(span).toHaveTextContent('world')
    expect(Element.prototype.animate).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(STREAM_FADE_DURATION_MS + 50)
    expect(paragraph.querySelector('span')).toBeNull()
    expect(paragraph).toHaveTextContent('hello world')
  })

  it('连续追加的 span 会按顺序合并成一个文本节点', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>a</p>'
    const paragraph = root.querySelector('p')!
    const state = createStreamFadeState()

    appendStreamingTextWithFade(root, 'b', state)
    appendStreamingTextWithFade(root, 'c', state)
    vi.advanceTimersByTime(STREAM_FADE_DURATION_MS + 50)

    expect(paragraph.querySelector('span')).toBeNull()
    expect(paragraph.textContent).toBe('abc')
    expect(paragraph.childNodes).toHaveLength(1)
  })

  it('reset 会清掉待处理定时器', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>a</p>'
    const state = createStreamFadeState()

    appendStreamingTextWithFade(root, 'b', state)
    expect(state.timers.size).toBe(1)
    resetStreamFade(state)
    expect(state.timers.size).toBe(0)

    vi.advanceTimersByTime(STREAM_FADE_DURATION_MS + 50)
    expect(root.querySelector('span')).not.toBeNull()
  })
})
