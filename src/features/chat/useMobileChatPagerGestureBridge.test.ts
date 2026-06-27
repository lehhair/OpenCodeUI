import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useMobileChatPagerGestureBridge } from './useMobileChatPagerGestureBridge'

describe('useMobileChatPagerGestureBridge', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('drives pager scrollLeft on horizontal swipe from chat scroll root', () => {
    const pager = document.createElement('div')
    pager.className = 'mobile-chat-pager'
    Object.defineProperty(pager, 'scrollWidth', { value: 1200, configurable: true })
    Object.defineProperty(pager, 'clientWidth', { value: 400, configurable: true })
    pager.scrollLeft = 280

    const scrollRoot = document.createElement('div')
    scrollRoot.setAttribute('data-chat-scroll-root', 'true')
    Object.defineProperty(scrollRoot, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(scrollRoot, 'clientHeight', { value: 400, configurable: true })

    pager.appendChild(scrollRoot)
    document.body.appendChild(pager)

    renderHook(() => {
      const innerRef = useRef<HTMLElement | null>(scrollRoot)
      useMobileChatPagerGestureBridge(innerRef, true, scrollRoot)
    })

    fireEvent.touchStart(scrollRoot, {
      touches: [{ clientX: 100, clientY: 200 }],
    })
    fireEvent.touchMove(scrollRoot, {
      touches: [{ clientX: 40, clientY: 202 }],
    })

    expect(pager.scrollLeft).toBeGreaterThan(280)
  })

  it('does not attach when disabled', () => {
    const pager = document.createElement('div')
    pager.className = 'mobile-chat-pager'
    const scrollRoot = document.createElement('div')
    pager.appendChild(scrollRoot)
    document.body.appendChild(pager)

    const addSpy = vi.spyOn(scrollRoot, 'addEventListener')

    renderHook(() => {
      const innerRef = useRef<HTMLElement | null>(scrollRoot)
      useMobileChatPagerGestureBridge(innerRef, false, scrollRoot)
    })

    expect(addSpy).not.toHaveBeenCalled()
    addSpy.mockRestore()
  })
})