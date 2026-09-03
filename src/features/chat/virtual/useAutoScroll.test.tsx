import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { useAutoScroll } from './useAutoScroll'

/**
 * 集成测试 —— 验证 input-event-driven 状态机的核心转换。
 *
 * jsdom 限制：scrollTop/scrollHeight/clientHeight 默认都是 0 且只读，
 * 需要用 Object.defineProperty 注入 getter。getComputedStyle 默认返回空字符串，
 * 需要在测试里 spy。
 */

interface ElDims {
  scrollHeight?: number
  clientHeight?: number
  scrollTop?: number
}

function mountScrollEl(dims: ElDims = {}) {
  const state = {
    scrollHeight: dims.scrollHeight ?? 1000,
    clientHeight: dims.clientHeight ?? 500,
    scrollTop: dims.scrollTop ?? 500, // 默认在底部
  }
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => state.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => state.clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (v: number) => {
      state.scrollTop = v
    },
  })
  Object.defineProperty(el, 'style', { configurable: true, value: {} })
  document.body.innerHTML = ''
  document.body.appendChild(el)
  return { el, state }
}

function setDims(state: { scrollHeight: number; clientHeight: number; scrollTop: number }, patch: ElDims) {
  if (patch.scrollHeight !== undefined) state.scrollHeight = patch.scrollHeight
  if (patch.clientHeight !== undefined) state.clientHeight = patch.clientHeight
  if (patch.scrollTop !== undefined) state.scrollTop = patch.scrollTop
}

function fireWheel(target: Element, deltaY: number) {
  target.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
}

function fireKey(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

function makeTouch(y: number): Touch {
  return { clientY: y } as unknown as Touch
}

function fireTouchStart(target: Element, y = 500) {
  const e = new TouchEvent('touchstart', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [makeTouch(y)], configurable: true })
  target.dispatchEvent(e)
}

function fireTouchMove(target: Element, y: number) {
  const e = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [makeTouch(y)], configurable: true })
  target.dispatchEvent(e)
}

function fireTouchEnd(target: Element) {
  const e = new TouchEvent('touchend', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [], configurable: true })
  target.dispatchEvent(e)
}

/**
 * TestComponent 模拟 ChatArea：在 useLayoutEffect 里调 setScrollRef，
 * 确保 ref 在 useAutoScroll 的 useEffect 运行前就绑定好（生产时 ref callback
 * 在 commit 阶段调用，先于 useEffect）。
 */
let capturedAuto: ReturnType<typeof useAutoScroll> | null = null
function Harness({ targetEl }: { targetEl: HTMLElement | null }) {
  const auto = useAutoScroll(10)
  // eslint-disable-next-line react-hooks/globals -- test-only side effect to expose latest hook value
  capturedAuto = auto
  useLayoutEffect(() => {
    if (targetEl) auto.setScrollRef(targetEl)
  }, [targetEl])
  return null
}

function setup(el: HTMLElement | null) {
  const utils = render(<Harness targetEl={el} />)
  return {
    /**
     * 读最新 hook 返回值。注意：不要解构！
     * `const { getResult } = setup()` 会把 getter 求值成一次性快照，
     * 后续 setState re-render 后 capturedAuto 更新了也读不到。
     */
    getResult: () => capturedAuto!,
    rerender: (nextEl: HTMLElement | null) => utils.rerender(<Harness targetEl={nextEl} />),
    unmount: utils.unmount,
  }
}

describe('useAutoScroll', () => {
  afterEach(() => {
    capturedAuto = null
  })

  it('initial state: not scrolled (following)', () => {
    const { el } = mountScrollEl()
    const { getResult } = setup(el)
    expect(getResult().userScrolled).toBe(false)
    expect(getResult().userScrolledRef.current).toBe(false)
  })

  describe('wheel events', () => {
    it('wheel-up (deltaY<0) stops following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)
      expect(getResult().userScrolled).toBe(false)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)
    })

    it('wheel-down (deltaY>0) at bottom recovers when scroll handles the gesture', () => {
      const { el, state } = mountScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 495 })
      const { getResult } = setup(el)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 495 })
      act(() => fireWheel(el, 100))
      act(() => getResult().handleScroll())
      expect(getResult().userScrolled).toBe(false)
    })

    it('wheel-down NOT at bottom does NOT recover', () => {
      const { el, state } = mountScrollEl({ scrollHeight: 1000, clientHeight: 500, scrollTop: 200 })
      const { getResult } = setup(el)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 200 })
      act(() => fireWheel(el, 100))
      expect(getResult().userScrolled).toBe(true)
    })

    it('wheel inside nested scrollable only stops when the nested block reaches a boundary', () => {
      const outer = document.createElement('div')
      const inner = document.createElement('div')
      let innerScrollTop = 300
      Object.defineProperty(outer, 'scrollHeight', { configurable: true, get: () => 1000 })
      Object.defineProperty(outer, 'clientHeight', { configurable: true, get: () => 500 })
      Object.defineProperty(outer, 'scrollTop', { configurable: true, get: () => 500, set: () => {} })
      Object.defineProperty(outer, 'style', { configurable: true, value: {} })
      Object.defineProperty(inner, 'scrollHeight', { configurable: true, get: () => 1000 })
      Object.defineProperty(inner, 'clientHeight', { configurable: true, get: () => 200 })
      Object.defineProperty(inner, 'scrollTop', { configurable: true, get: () => innerScrollTop })
      inner.dataset.scrollable = ''
      document.body.innerHTML = ''
      document.body.appendChild(outer)
      outer.appendChild(inner)

      const { getResult } = setup(outer)

      // 嵌套块内部仍有空间时，wheel 只滚动嵌套块，不影响 chat 跟随。
      act(() => fireWheel(inner, 100))
      expect(getResult().userScrolled).toBe(false)

      // 到顶部后继续向上，边界溢出意图传给 chat。
      innerScrollTop = 0
      act(() => fireWheel(inner, -100))
      expect(getResult().userScrolled).toBe(true)

      // 已经停止后，在嵌套块底部继续向下，边界意图打开恢复窗口；
      // 外层 scroll 到底时完成恢复。
      innerScrollTop = 800
      act(() => fireWheel(inner, 100))
      act(() => getResult().handleScroll())
      expect(getResult().userScrolled).toBe(false)
    })

    it('wheel on editable element does not affect state', () => {
      const { el } = mountScrollEl()
      const input = document.createElement('input')
      el.appendChild(input)
      const { getResult } = setup(el)

      act(() => fireWheel(input, -100))
      expect(getResult().userScrolled).toBe(false)
    })
  })

  describe('keyboard events', () => {
    it('PageUp stops following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => fireKey(el, 'PageUp'))
      expect(getResult().userScrolled).toBe(true)
    })

    it('ArrowDown at bottom recovers', () => {
      const { el } = mountScrollEl({ scrollTop: 495 })
      const { getResult } = setup(el)

      act(() => fireKey(el, 'PageUp'))
      expect(getResult().userScrolled).toBe(true)

      act(() => fireKey(el, 'ArrowDown'))
      expect(getResult().userScrolled).toBe(false)
    })

    it('keyboard on editable element does not affect state', () => {
      const { el } = mountScrollEl()
      const textarea = document.createElement('textarea')
      el.appendChild(textarea)
      const { getResult } = setup(el)

      act(() => fireKey(textarea, 'PageUp'))
      expect(getResult().userScrolled).toBe(false)
    })
  })

  describe('touch events', () => {
    it('tap (touchstart + touchend, no movement) does NOT stop following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => fireTouchStart(el, 500))
      act(() => fireTouchEnd(el))
      expect(getResult().userScrolled).toBe(false)
    })

    it('touchmove upward (finger down >10px) stops following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => fireTouchStart(el, 500))
      act(() => fireTouchMove(el, 520)) // finger down 20px = scroll up
      expect(getResult().userScrolled).toBe(true)
    })

    it('small touchmove (<10px) does NOT stop following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => fireTouchStart(el, 500))
      act(() => fireTouchMove(el, 508)) // finger down 8px = below threshold
      expect(getResult().userScrolled).toBe(false)
    })

    it('touchend (plain release, no downward drag) does NOT recover', () => {
      const { el, state } = mountScrollEl({ scrollTop: 495 })
      const { getResult } = setup(el)

      // 用 wheel-up 预设 userScrolled（touchstart 不再自动设置）
      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 495 })
      act(() => fireTouchStart(el, 500))
      act(() => fireTouchEnd(el))
      expect(getResult().userScrolled).toBe(true)
    })

    it('touchend recovers only after a genuine downward drag to bottom', () => {
      const { el, state } = mountScrollEl({ scrollTop: 200 })
      const { getResult } = setup(el)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      // 手指上移 400px → 内容向下滚 400px，已到底部
      setDims(state, { scrollTop: 495 })
      act(() => fireTouchStart(el, 500))
      act(() => fireTouchMove(el, 100))
      act(() => fireTouchEnd(el))
      expect(getResult().userScrolled).toBe(false)
    })

    it('touchend after an upward drag does NOT recover', () => {
      const { el, state } = mountScrollEl({ scrollTop: 495 })
      const { getResult } = setup(el)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      // 手指下移（内容向上滚）→ 不是向下滚
      setDims(state, { scrollTop: 480 })
      act(() => fireTouchStart(el, 100))
      act(() => fireTouchMove(el, 500))
      act(() => fireTouchEnd(el))
      expect(getResult().userScrolled).toBe(true)
    })
  })

  describe('imperative API', () => {
    it('pause() stops following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => getResult().pause())
      expect(getResult().userScrolled).toBe(true)
    })

    it('pause() is no-op when content fits in viewport', () => {
      const { el } = mountScrollEl({ scrollHeight: 100, clientHeight: 500 })
      const { getResult } = setup(el)

      act(() => getResult().pause())
      expect(getResult().userScrolled).toBe(false)
    })

    it('forceScrollToBottom() recovers even if user had stopped', () => {
      const { el, state } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      act(() => getResult().forceScrollToBottom())
      expect(getResult().userScrolled).toBe(false)
      expect(state.scrollTop).toBe(500) // max = 1000 - 500
    })

    it('scrollToBottom(non-force) does nothing when user stopped', () => {
      const { el, state } = mountScrollEl({ scrollTop: 100 })
      const { getResult } = setup(el)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      const before = state.scrollTop
      act(() => getResult().scrollToBottom())
      expect(getResult().userScrolled).toBe(true)
      expect(state.scrollTop).toBe(before)
    })
  })

  describe('handleScroll', () => {
    it('does NOT clear userScrolled when at bottom (key invariant)', () => {
      const { el, state } = mountScrollEl({ scrollTop: 495 })
      const { getResult } = setup(el)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 495 })
      act(() => getResult().handleScroll())
      expect(getResult().userScrolled).toBe(true)
    })

    it('schedules recoverPin when following but drifted off bottom', async () => {
      const { el, state } = mountScrollEl({ scrollTop: 100 })
      const { getResult } = setup(el)

      const pinFn = vi.fn()
      act(() => getResult().setPinToBottom(pinFn))

      setDims(state, { scrollTop: 100 })
      act(() => getResult().handleScroll())

      await act(async () => {
        await new Promise(r => requestAnimationFrame(r))
      })
      expect(pinFn).toHaveBeenCalled()
    })

    it('does NOT schedule recoverPin when user stopped', async () => {
      const { el } = mountScrollEl({ scrollTop: 100 })
      const { getResult } = setup(el)

      const pinFn = vi.fn()
      act(() => getResult().setPinToBottom(pinFn))

      act(() => fireWheel(el, -100))
      act(() => getResult().handleScroll())

      await act(async () => {
        await new Promise(r => requestAnimationFrame(r))
      })
      expect(pinFn).not.toHaveBeenCalled()
    })

    it('does NOT schedule recoverPin when at bottom (no drift)', async () => {
      const { el, state } = mountScrollEl({ scrollTop: 495 })
      const { getResult } = setup(el)

      const pinFn = vi.fn()
      act(() => getResult().setPinToBottom(pinFn))

      setDims(state, { scrollTop: 495 })
      act(() => getResult().handleScroll())

      await act(async () => {
        await new Promise(r => requestAnimationFrame(r))
      })
      expect(pinFn).not.toHaveBeenCalled()
    })
  })

  describe('selection', () => {
    it('does not crash when selectionchange fires with empty selection', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => {
        document.dispatchEvent(new Event('selectionchange'))
      })
      expect(getResult().userScrolled).toBe(false)
    })

    it('selection during streaming stops following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => getResult().setStreaming(true))

      // 模拟开始选中文字
      const sel = {
        toString: () => 'selected',
        anchorNode: el,
      } as unknown as Selection
      vi.spyOn(window, 'getSelection').mockReturnValue(sel)

      act(() => {
        document.dispatchEvent(new Event('selectionchange'))
      })
      expect(getResult().userScrolled).toBe(true)
    })

    it('selection during idle (non-streaming) does NOT stop following', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      // 不 setStreaming —— 默认 false
      const sel = {
        toString: () => 'selected',
        anchorNode: el,
      } as unknown as Selection
      vi.spyOn(window, 'getSelection').mockReturnValue(sel)

      act(() => {
        document.dispatchEvent(new Event('selectionchange'))
      })
      expect(getResult().userScrolled).toBe(false)
    })
  })

  describe('recovery window', () => {
    it('tryRecover NOT at bottom opens a recovery window; subsequent scroll to bottom recovers', () => {
      const { el, state } = mountScrollEl({ scrollTop: 200 })
      const { getResult } = setup(el)

      // 用户停止
      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      // wheel-down 但还没到底：打开恢复窗口，不立刻恢复
      setDims(state, { scrollTop: 300 })
      act(() => fireWheel(el, 100))
      expect(getResult().userScrolled).toBe(true)

      // momentum 把 scrollTop 带到底部 → handleScroll 在窗口内恢复
      setDims(state, { scrollTop: 495 })
      act(() => getResult().handleScroll())
      expect(getResult().userScrolled).toBe(false)
    })

    it('recovery window closes when user stopFollow again', () => {
      const { el, state } = mountScrollEl({ scrollTop: 200 })
      const { getResult } = setup(el)

      // 用户先停止
      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      // wheel-down 但还没到底：打开恢复窗口，不立刻恢复
      setDims(state, { scrollTop: 300 })
      act(() => fireWheel(el, 100))
      expect(getResult().userScrolled).toBe(true)

      // 用户又向上滚 → stopFollow 关掉窗口
      setDims(state, { scrollTop: 290 })
      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      // 即使后续到达底部，没有窗口也不会被 scroll 事件清掉
      setDims(state, { scrollTop: 495 })
      act(() => getResult().handleScroll())
      expect(getResult().userScrolled).toBe(true)
    })
  })

  describe('OS_DRAG events (overlayScrollbar)', () => {
    it('OS_DRAG_START stops following, OS_DRAG_END at bottom recovers', () => {
      const { el, state } = mountScrollEl({ scrollTop: 495 })
      const { getResult } = setup(el)

      act(() => el.dispatchEvent(new CustomEvent('os-scroll-dragstart', { bubbles: true })))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 495 })
      act(() => el.dispatchEvent(new CustomEvent('os-scroll-dragend', { bubbles: true })))
      expect(getResult().userScrolled).toBe(false)
    })

    it('OS_DRAG_END not at bottom does NOT recover', () => {
      const { el, state } = mountScrollEl({ scrollTop: 100 })
      const { getResult } = setup(el)

      act(() => el.dispatchEvent(new CustomEvent('os-scroll-dragstart', { bubbles: true })))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 100 })
      act(() => el.dispatchEvent(new CustomEvent('os-scroll-dragend', { bubbles: true })))
      expect(getResult().userScrolled).toBe(true)
    })
  })

  describe('rapid / multiple events', () => {
    it('100 rapid wheel-up events do not crash and end with userScrolled=true', () => {
      const { el } = mountScrollEl()
      const { getResult } = setup(el)

      act(() => {
        for (let i = 0; i < 100; i++) fireWheel(el, -100)
      })
      expect(getResult().userScrolled).toBe(true)
    })

    it('alternating wheel-up / wheel-down sequence ends with the last direction', () => {
      const { el, state } = mountScrollEl({ scrollTop: 495 })
      const { getResult } = setup(el)

      // up, down, up, down
      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 495 })
      act(() => fireWheel(el, 100))
      act(() => getResult().handleScroll())
      expect(getResult().userScrolled).toBe(false)

      act(() => fireWheel(el, -100))
      expect(getResult().userScrolled).toBe(true)

      setDims(state, { scrollTop: 495 })
      act(() => fireWheel(el, 100))
      act(() => getResult().handleScroll())
      expect(getResult().userScrolled).toBe(false)
    })
  })

  describe('nested scrollable + keyboard', () => {
    it('PageUp inside a nested scrollable still stops (nested affects wheel only, not keyboard)', () => {
      const outer = document.createElement('div')
      const inner = document.createElement('div')
      Object.defineProperty(outer, 'scrollHeight', { configurable: true, get: () => 1000 })
      Object.defineProperty(outer, 'clientHeight', { configurable: true, get: () => 500 })
      Object.defineProperty(outer, 'scrollTop', { configurable: true, get: () => 500, set: () => {} })
      Object.defineProperty(outer, 'style', { configurable: true, value: {} })
      document.body.innerHTML = ''
      document.body.appendChild(outer)
      outer.appendChild(inner)

      inner.dataset.scrollable = ''

      const { getResult } = setup(outer)
      act(() => fireKey(inner, 'PageUp'))
      expect(getResult().userScrolled).toBe(true)
    })
  })
})
