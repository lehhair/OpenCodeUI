import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBox } from './InputBox'

let selectedFiles: File[] = []

vi.mock('../attachment', () => ({
  AttachmentPreview: ({ attachments }: { attachments: Array<{ id: string }> }) => (
    <div data-testid="attachment-count">{attachments.length}</div>
  ),
}))

vi.mock('./chatViewport', () => ({
  useChatViewport: () => ({
    presentation: { surfaceVariant: 'desktop', isCompact: false },
    interaction: {
      mode: 'pointer',
      touchCapable: false,
      sidebarBehavior: 'docked',
      rightPanelBehavior: 'docked',
      bottomPanelBehavior: 'docked',
      outlineInteraction: 'pointer',
      enableCollapsedInputDock: false,
    },
  }),
}))

vi.mock('../mention', () => ({
  MentionMenu: () => null,
  detectMentionTrigger: () => null,
  normalizePath: (value: string) => value,
  toFileUrl: (value: string) => value,
}))

vi.mock('../slash-command', () => ({
  SlashCommandMenu: () => null,
}))

vi.mock('./input/InputToolbar', () => ({
  InputToolbar: ({ onFilesSelected }: { onFilesSelected: (files: File[]) => void }) => (
    <button type="button" onClick={() => onFilesSelected(selectedFiles)}>
      attach file
    </button>
  ),
}))

vi.mock('./input/InputFooter', () => ({
  InputFooter: () => null,
}))

vi.mock('./input/UndoStatus', () => ({
  UndoStatus: () => null,
}))

vi.mock('../../hooks', () => ({
  useIsMobile: () => false,
  usePresence: (show: boolean) => ({ shouldRender: show, ref: { current: null } }),
}))

vi.mock('../../store/messageStoreHooks', () => ({
  useMessages: () => [],
}))

vi.mock('../../store/keybindingStore', () => ({
  keybindingStore: {
    getKey: () => null,
  },
  matchesKeybinding: () => false,
}))

describe('InputBox attachment handling', () => {
  beforeEach(() => {
    selectedFiles = []
  })

  it('accepts files whose mime is inferred from the filename extension', async () => {
    selectedFiles = [new File(['image'], 'photo.png')]

    render(
      <InputBox
        paneId="pane-test"
        onSend={vi.fn()}
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-count')).toHaveTextContent('1')
    })
  })
})
