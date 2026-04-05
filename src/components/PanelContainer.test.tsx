import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelContainer } from './PanelContainer'
import { layoutStore } from '../store/layoutStore'

function resetLayoutStore() {
  const state = layoutStore.getState()
  state.panelTabs.splice(0, state.panelTabs.length, {
    id: 'files',
    type: 'files',
    position: 'right',
    previewFile: null,
    previewFiles: [],
  })
  state.activeTabId.bottom = null
  state.activeTabId.right = 'files'
  state.bottomPanelOpen = false
  state.rightPanelOpen = true
  state.bottomPanelHeight = 250
  state.rightPanelWidth = 450
}

describe('PanelContainer', () => {
  beforeEach(() => {
    resetLayoutStore()
  })

  afterEach(() => {
    cleanup()
    resetLayoutStore()
    vi.restoreAllMocks()
  })

  it('adds a web preview tab from the add menu', () => {
    render(
      <PanelContainer position="right" onNewTerminal={vi.fn()}>
        {activeTab => <div>{activeTab?.id}</div>}
      </PanelContainer>,
    )

    fireEvent.click(screen.getByTitle(/Add Tab|添加标签/))
    fireEvent.click(screen.getByText(/Web Preview|网页预览/))

    expect(layoutStore.getState().panelTabs.some(tab => tab.type === 'web-preview')).toBe(true)
    expect(layoutStore.getActiveTab('right')?.type).toBe('web-preview')
  })
})
