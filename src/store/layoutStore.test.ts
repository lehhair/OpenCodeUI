import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { layoutStore } from './layoutStore'

function resetLayoutStore() {
  const state = layoutStore.getState()
  state.panelTabs.splice(
    0,
    state.panelTabs.length,
    {
      id: 'files',
      type: 'files',
      position: 'right',
      previewFile: null,
      previewFiles: [],
    },
    {
      id: 'changes',
      type: 'changes',
      position: 'right',
    },
  )
  state.activeTabId.bottom = null
  state.activeTabId.right = 'files'
  state.bottomPanelOpen = false
  state.rightPanelOpen = false
  state.bottomPanelHeight = 250
  state.rightPanelWidth = 450
}

describe('layoutStore web preview tabs', () => {
  beforeEach(() => {
    resetLayoutStore()
  })

  afterEach(() => {
    resetLayoutStore()
  })

  it('creates a web preview tab and activates it', () => {
    const tabId = layoutStore.addWebPreviewTab('right')
    const createdTab = layoutStore.getState().panelTabs.find(tab => tab.id === tabId)

    expect(createdTab).toMatchObject({
      id: tabId,
      type: 'web-preview',
      position: 'right',
      url: '',
    })
    expect(layoutStore.getActiveTab('right')?.id).toBe(tabId)
    expect(layoutStore.getState().rightPanelOpen).toBe(true)
  })

  it('updates the url only for web preview tabs', () => {
    const tabId = layoutStore.addWebPreviewTab('bottom')

    layoutStore.updateWebPreviewUrl(tabId, 'https://example.com/')
    layoutStore.updateWebPreviewUrl('files', 'https://ignored.example/')

    expect(layoutStore.getState().panelTabs.find(tab => tab.id === tabId)?.url).toBe('https://example.com/')
    expect(layoutStore.getState().panelTabs.find(tab => tab.id === 'files')?.url).toBeUndefined()
  })
})
