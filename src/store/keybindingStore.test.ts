import { describe, expect, it } from 'vitest'
import { keybindingStore } from './keybindingStore'

function keyboardEvent(key: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, ...init })
}

describe('keybindingStore scoped keybindings', () => {
  it('keeps terminal shortcuts in the terminal scope', () => {
    expect(keybindingStore.findMatchingAction(keyboardEvent('c', { ctrlKey: true }), 'terminal')).toBe(
      'terminal.copySelection',
    )
    expect(keybindingStore.findMatchingAction(keyboardEvent('v', { ctrlKey: true }), 'terminal')).toBe('terminal.paste')
    expect(keybindingStore.findMatchingAction(keyboardEvent('c', { ctrlKey: true }), 'global')).toBeNull()
  })

  it('checks conflicts only within the requested scope', () => {
    expect(keybindingStore.isKeyUsed('Ctrl+C', undefined, 'terminal')).toBe(true)
    expect(keybindingStore.isKeyUsed('Ctrl+C', undefined, 'global')).toBe(false)
  })
})
