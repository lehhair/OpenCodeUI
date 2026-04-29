import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayoutStore } from './layoutStore'

const STORAGE_KEY_PANEL_LAYOUT = 'opencode-panel-layout'

describe('LayoutStore panel and terminal layout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('persists global panel layout without persisting terminal tabs', () => {
    const store = new LayoutStore()

    store.addMcpTab('bottom')
    store.addTerminalTab({ id: 'term-1', title: 'Terminal 1', status: 'connected' }, true, 'right')
    store.openRightPanel('changes')

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY_PANEL_LAYOUT) ?? 'null')

    expect(persisted).toMatchObject({
      version: 1,
      rightPanelOpen: true,
      bottomPanelOpen: true,
    })
    expect(persisted.panelTabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'files', type: 'files', position: 'right' }),
        expect.objectContaining({ id: 'changes', type: 'changes', position: 'right' }),
        expect.objectContaining({ id: 'mcp', type: 'mcp', position: 'bottom' }),
      ]),
    )
    expect(persisted.panelTabs.some((tab: { id: string }) => tab.id === 'term-1')).toBe(false)

    const restored = new LayoutStore().getState()
    expect(restored.rightPanelOpen).toBe(true)
    expect(restored.bottomPanelOpen).toBe(true)
    expect(restored.panelTabs.some(tab => tab.id === 'mcp' && tab.position === 'bottom')).toBe(true)
    expect(restored.panelTabs.some(tab => tab.id === 'term-1')).toBe(false)
  })

  it('keeps bottom and right panels open when syncing a directory with no terminal sessions', () => {
    const store = new LayoutStore()

    store.openBottomPanel()
    store.openRightPanel('files')
    store.syncTerminalSessions('dir-a', [])

    expect(store.getState().bottomPanelOpen).toBe(true)
    expect(store.getState().rightPanelOpen).toBe(true)
    expect(store.getTerminalTabs('bottom')).toEqual([])
    expect(store.getTerminalTabs('right')).toEqual([])
  })

  it('restores terminal positions for each directory when switching between projects', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [
      { id: 'term-a1', title: 'A1', status: 'connected' },
      { id: 'term-a2', title: 'A2', status: 'connected' },
    ])
    store.moveTab('term-a2', 'right')

    store.syncTerminalSessions('dir-b', [{ id: 'term-b1', title: 'B1', status: 'connected' }])
    store.syncTerminalSessions('dir-a', [
      { id: 'term-a1', title: 'A1', status: 'connected' },
      { id: 'term-a2', title: 'A2', status: 'connected' },
    ])

    expect(store.getTerminalTabs('bottom').map(tab => tab.id)).toEqual(['term-a1'])
    expect(store.getTerminalTabs('right').map(tab => tab.id)).toEqual(['term-a2'])
  })

  it('removes project terminal tabs when syncing global terminal sessions', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.syncTerminalSessions(undefined, [])

    expect(store.getTerminalTabs('bottom')).toEqual([])
    expect(store.getState().panelTabs.some(tab => tab.id === 'term-a1')).toBe(false)
  })

  it('does not notify when a terminal snapshot is unchanged', () => {
    const store = new LayoutStore()
    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    const snapshot = { buffer: 'pwd\r\n/workspace\r\n', scrollY: 2, cursor: 18, rows: 24, cols: 80 }

    store.updateTerminalSnapshot('term-a1', snapshot)
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    store.updateTerminalSnapshot('term-a1', snapshot)

    unsubscribe()
    expect(notifications).toBe(0)
  })

  it('falls back to a valid right tab when a stale terminal active id disappears after sync', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.moveTab('term-a1', 'right')
    store.setActiveTab('right', 'term-a1')

    store.syncTerminalSessions('dir-b', [])

    expect(store.getState().activeTabId.right).toBe('files')
  })

  it('persists terminal snapshots and restores them on the next sync', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.updateTerminalSnapshot('term-a1', {
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })

    const persisted = JSON.parse(localStorage.getItem('opencode-terminal-layout') ?? 'null')
    expect(persisted.directories['dir-a'].sessions['term-a1']).toMatchObject({
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })

    const restored = new LayoutStore()
    restored.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])

    expect(restored.getState().panelTabs.find(tab => tab.id === 'term-a1')).toMatchObject({
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })
  })
})
