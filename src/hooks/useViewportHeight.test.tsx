import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useViewportHeight } from './useViewportHeight'

type VisualViewportMock = EventTarget & {
  height: number
  offsetTop: number
}

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

function installVisualViewportMock({ innerHeight, viewportHeight, offsetTop = 0 }: { innerHeight: number; viewportHeight: number; offsetTop?: number }) {
  const viewport = new EventTarget() as VisualViewportMock

  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: innerHeight,
  })
  Object.defineProperty(viewport, 'height', {
    configurable: true,
    value: viewportHeight,
  })
  Object.defineProperty(viewport, 'offsetTop', {
    configurable: true,
    value: offsetTop,
  })
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  })

  return viewport
}

function restoreWindowProperty(name: 'innerHeight' | 'visualViewport', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor)
  } else {
    Reflect.deleteProperty(window, name)
  }
}

describe('useViewportHeight', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    restoreWindowProperty('innerHeight', originalInnerHeight)
    restoreWindowProperty('visualViewport', originalVisualViewport)
  })

  it('clears stale keyboard inset after an editable element blurs without a visualViewport resize', () => {
    vi.useFakeTimers()
    installVisualViewportMock({ innerHeight: 800, viewportHeight: 500 })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    renderHook(() => useViewportHeight())

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('300px')

    act(() => {
      textarea.focus()
      textarea.blur()
      vi.runAllTimers()
    })

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('0px')
  })

  it('keeps the keyboard inset when focus moves between text inputs', () => {
    vi.useFakeTimers()
    installVisualViewportMock({ innerHeight: 800, viewportHeight: 500 })
    const textarea = document.createElement('textarea')
    const input = document.createElement('input')
    document.body.append(textarea, input)

    renderHook(() => useViewportHeight())

    act(() => {
      textarea.focus()
      input.focus()
      vi.runAllTimers()
    })

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('300px')
  })
})
