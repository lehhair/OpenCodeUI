import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttachmentItem } from './AttachmentItem'
import type { Attachment } from './types'
import { FullscreenProvider } from '../../contexts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const imgAttachment: Attachment = {
  id: 'a1',
  type: 'file',
  displayName: 'test.png',
  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  mime: 'image/png',
  category: 'user',
}

const txtAttachment: Attachment = {
  id: 'a2',
  type: 'file',
  displayName: 'notes.txt',
  url: 'data:text/plain;charset=utf-8,hello%20world',
  mime: 'text/plain',
  category: 'user',
}

const noUrlAttachment: Attachment = {
  id: 'a3',
  type: 'file',
  displayName: 'notes.txt',
  mime: 'text/plain',
  category: 'user',
}

describe('AttachmentItem defaultExpanded', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 0),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders image body immediately when defaultExpanded is true', () => {
    render(
      <FullscreenProvider>
        <AttachmentItem attachment={imgAttachment} expandable defaultExpanded />
      </FullscreenProvider>,
    )
    act(() => {
      vi.runAllTimers()
    })
    expect(screen.getByAltText('test.png')).toBeTruthy()
  })

  it('does not render image body when collapsed', () => {
    render(
      <FullscreenProvider>
        <AttachmentItem attachment={imgAttachment} expandable />
      </FullscreenProvider>,
    )
    act(() => {
      vi.runAllTimers()
    })
    expect(screen.queryByAltText('test.png')).toBeNull()
  })

  it('shows a download button in the header when the file has a url', () => {
    render(
      <FullscreenProvider>
        <AttachmentItem attachment={txtAttachment} />
      </FullscreenProvider>,
    )
    expect(screen.getByTitle('attachment.saveToFile')).toBeTruthy()
  })

  it('does not show a download button when there is no url or content', () => {
    render(
      <FullscreenProvider>
        <AttachmentItem attachment={noUrlAttachment} />
      </FullscreenProvider>,
    )
    expect(screen.queryByTitle('attachment.saveToFile')).toBeNull()
  })
})
