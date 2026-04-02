import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebPreviewPanel } from './WebPreviewPanel'
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
}

describe('WebPreviewPanel', () => {
  beforeEach(() => {
    resetLayoutStore()
  })

  afterEach(() => {
    cleanup()
    resetLayoutStore()
  })

  it('commits local development urls with http when submitted', () => {
    const tabId = layoutStore.addTab({
      id: 'web-preview-1',
      type: 'web-preview',
      position: 'right',
      url: '',
    })

    render(<WebPreviewPanel tabId={tabId} />)

    fireEvent.change(screen.getByPlaceholderText(/Enter a URL and press Enter|输入网址后按回车/), {
      target: { value: 'localhost:5173' },
    })
    fireEvent.submit(screen.getByRole('form', { name: /Web preview address bar|网页预览地址栏/ }))

    expect(screen.getByTitle(/Web Preview|网页预览/)).toHaveAttribute('src', 'http://localhost:5173/')
    expect(screen.getByTitle(/Web Preview|网页预览/)).toHaveAttribute(
      'sandbox',
      'allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts',
    )
    expect(layoutStore.getState().panelTabs.find(tab => tab.id === tabId)?.url).toBe('http://localhost:5173/')
  })

  it('shows an error and does not update iframe for invalid urls', () => {
    const tabId = layoutStore.addTab({
      id: 'web-preview-2',
      type: 'web-preview',
      position: 'right',
      url: '',
    })

    render(<WebPreviewPanel tabId={tabId} />)

    fireEvent.change(screen.getByPlaceholderText(/Enter a URL and press Enter|输入网址后按回车/), {
      target: { value: 'javascript:alert(1)' },
    })
    fireEvent.submit(screen.getByRole('form', { name: /Web preview address bar|网页预览地址栏/ }))

    expect(screen.getByText(/Enter a valid http or https URL|请输入有效的 http 或 https 地址/)).toBeInTheDocument()
    expect(screen.queryByTitle(/Web Preview|网页预览/)).not.toBeInTheDocument()
    expect(layoutStore.getState().panelTabs.find(tab => tab.id === tabId)?.url).toBe('')
  })

  it('supports back, forward and refresh controls', () => {
    const tabId = layoutStore.addTab({
      id: 'web-preview-3',
      type: 'web-preview',
      position: 'right',
      url: '',
    })

    render(<WebPreviewPanel tabId={tabId} />)

    const input = screen.getByPlaceholderText(/Enter a URL and press Enter|输入网址后按回车/)

    fireEvent.change(input, { target: { value: 'localhost:5173' } })
    fireEvent.submit(screen.getByRole('form', { name: /Web preview address bar|网页预览地址栏/ }))
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:4173' } })
    fireEvent.submit(screen.getByRole('form', { name: /Web preview address bar|网页预览地址栏/ }))

    expect(screen.getByTitle(/Web Preview|网页预览/)).toHaveAttribute('src', 'http://127.0.0.1:4173/')

    fireEvent.click(screen.getByRole('button', { name: /Back|后退/ }))
    expect(screen.getByTitle(/Web Preview|网页预览/)).toHaveAttribute('src', 'http://localhost:5173/')

    fireEvent.click(screen.getByRole('button', { name: /Forward|前进/ }))
    expect(screen.getByTitle(/Web Preview|网页预览/)).toHaveAttribute('src', 'http://127.0.0.1:4173/')

    const iframeBeforeRefresh = screen.getByTitle(/Web Preview|网页预览/)
    fireEvent.click(screen.getByRole('button', { name: /Refresh|刷新/ }))
    const iframeAfterRefresh = screen.getByTitle(/Web Preview|网页预览/)

    expect(iframeAfterRefresh).not.toBe(iframeBeforeRefresh)
  })
})
