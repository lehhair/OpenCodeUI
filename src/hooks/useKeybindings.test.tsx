import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalKeybindings } from './useKeybindings'
import { keybindingStore } from '../store/keybindingStore'

describe('useGlobalKeybindings', () => {
  beforeEach(() => {
    keybindingStore.resetAll()
  })

  it('opens settings from a document-level keydown target without crashing', () => {
    const openSettings = vi.fn()

    renderHook(() =>
      useGlobalKeybindings({
        openSettings,
      }),
    )

    expect(() => {
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: ',',
            altKey: true,
            bubbles: true,
          }),
        )
      })
    }).not.toThrow()

    expect(openSettings).toHaveBeenCalledTimes(1)
  })
})
