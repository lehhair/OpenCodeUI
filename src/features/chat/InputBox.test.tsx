import { forwardRef, useImperativeHandle, type ForwardedRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBox } from './InputBox'
import type { Command } from '../../api/command'

let slashCommands: Command[] = []

vi.mock('../attachment', () => ({
  AttachmentPreview: () => null,
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
  SlashCommandMenu: forwardRef(
    (
      { isOpen, onSelect }: { isOpen: boolean; onSelect: (command: Command) => void },
      ref: ForwardedRef<{ moveUp: () => void; moveDown: () => void; selectCurrent: () => void }>,
    ) => {
      useImperativeHandle(
        ref,
        () => ({
          moveUp: () => {},
          moveDown: () => {},
          selectCurrent: () => {
            const command = slashCommands[0]
            if (command) onSelect(command)
          },
        }),
        [onSelect],
      )

      return isOpen ? (
        <div>
          {slashCommands.map(command => (
            <button key={command.name} type="button" onClick={() => onSelect(command)}>
              {command.name}
            </button>
          ))}
        </div>
      ) : null
    },
  ),
}))

vi.mock('./input/InputToolbar', () => ({
  InputToolbar: ({ onSend, canSend }: { onSend: () => void; canSend: boolean }) => (
    <button type="button" onClick={onSend} disabled={!canSend}>
      send
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

describe('InputBox slash command selection', () => {
  beforeEach(() => {
    slashCommands = []
  })

  it('executes frontend commands immediately on selection', async () => {
    slashCommands = [{ name: 'compact', description: 'Compact session', source: 'frontend' }]
    const onCommand = vi.fn()

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'compact' }))

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith('/compact')
      expect(textarea.value).toBe('')
    })
  })

  it('keeps api commands on attachment insertion path', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    const onCommand = vi.fn()

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'review' }))

    await waitFor(() => {
      expect(onCommand).not.toHaveBeenCalled()
      expect(textarea.value).toBe('/review ')
    })
  })

  it('keeps the draft when sending fails', async () => {
    const onSend = vi.fn().mockResolvedValue(false)

    render(<InputBox paneId="pane-test" onSend={onSend} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello world', [], { agent: undefined, variant: undefined })
    })

    expect(textarea.value).toBe('hello world')
  })

  it('waits for send acknowledgement before clearing the draft', async () => {
    let resolveSend: ((value: boolean) => void) | null = null
    const onSend = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveSend = resolve
        }),
    )

    render(<InputBox paneId="pane-test" onSend={onSend} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'pending send' } })
    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    expect(textarea.value).toBe('pending send')

    await act(async () => {
      resolveSend?.(true)
    })

    await waitFor(() => {
      expect(textarea.value).toBe('')
    })
  })

  it('clears api slash command drafts immediately after keyboard submission', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    let resolveCommand: ((value: boolean) => void) | null = null
    const onCommand = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveCommand = resolve
        }),
    )

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    expect(onCommand).toHaveBeenCalledWith('/review')
    expect(textarea.value).toBe('')
    expect(textarea).not.toBeDisabled()

    fireEvent.change(textarea, { target: { value: 'next prompt' } })
    expect(textarea.value).toBe('next prompt')

    await act(async () => {
      resolveCommand?.(true)
    })
  })

  it('restores api slash command drafts when command submission fails', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    let resolveCommand: ((value: boolean) => void) | null = null
    const onCommand = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveCommand = resolve
        }),
    )

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'review' }))

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))
    expect(textarea.value).toBe('')

    await act(async () => {
      resolveCommand?.(false)
    })

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })
  })

  it('restores api slash command drafts when command submission fails synchronously', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    const onCommand = vi.fn().mockReturnValue(false)

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'review' }))

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })
  })
})
