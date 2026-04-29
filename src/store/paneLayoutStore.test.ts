import { describe, expect, it } from 'vitest'
import { paneLayoutStore } from './paneLayoutStore'

describe('paneLayoutStore', () => {
  it('focuses the sibling subtree when closing the focused pane', () => {
    paneLayoutStore.reset()

    paneLayoutStore.setFocusedSession('session-a')
    const paneB = paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')
    expect(paneB).toBe('pane-2')

    const paneC = paneLayoutStore.splitPane('pane-2', 'vertical', 'session-c')
    expect(paneC).toBe('pane-3')

    paneLayoutStore.focusPane('pane-3')
    paneLayoutStore.closePane('pane-3')

    expect(paneLayoutStore.getFocusedPaneId()).toBe('pane-2')
    expect(paneLayoutStore.getFocusedSessionId()).toBe('session-b')
  })
})
