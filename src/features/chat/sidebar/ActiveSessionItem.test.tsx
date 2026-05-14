import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../../../api'
import type { ActiveSessionTreeEntry } from './activeSessionTree'
import { ActiveSessionItem } from './ActiveSessionItem'

function createResolvedSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    title: 'Active session title',
    directory: '/workspace/project',
    ...overrides,
  } as ApiSession
}

function renderItem(entry: ActiveSessionTreeEntry, resolvedSession?: ApiSession) {
  const onSelect = vi.fn()
  const view = render(
    <ActiveSessionItem
      entry={entry}
      resolvedSession={resolvedSession ?? createResolvedSession()}
      isSelected={false}
      onSelect={onSelect}
    />,
  )

  return {
    ...view,
    onSelect,
  }
}

describe('ActiveSessionItem', () => {
  it('shows a neutral descendant-only label without self-active status labels or pulse animation', () => {
    const descendantOnlyEntry = {
      sessionId: 'session-descendant',
      title: 'Ancestor row',
      directory: '/workspace/project',
      activitySource: 'descendant',
    } satisfies ActiveSessionTreeEntry

    const { container } = renderItem(descendantOnlyEntry, createResolvedSession({ id: 'session-descendant', title: 'Ancestor row' }))

    expect(screen.getByText('Ancestor row')).toBeInTheDocument()
    expect(screen.getByText('Child session active')).toBeInTheDocument()
    expect(screen.queryByText('Working')).not.toBeInTheDocument()
    expect(screen.queryByText('Retrying')).not.toBeInTheDocument()
    expect(screen.queryByText('Awaiting Permission')).not.toBeInTheDocument()
    expect(screen.queryByText('Awaiting Answer')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-ping')).not.toBeInTheDocument()
  })

  it('keeps the working label and pulse animation for self-active busy entries', () => {
    const busyEntry = {
      sessionId: 'session-working',
      activitySource: 'self',
      status: { type: 'busy' },
      title: 'Working session',
      directory: '/workspace/project',
    } satisfies ActiveSessionTreeEntry

    const { container } = renderItem(busyEntry, createResolvedSession({ id: 'session-working', title: 'Working session' }))

    expect(screen.getByText('Working session')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(container.querySelector('.animate-ping')).toBeInTheDocument()
  })

  it('allows descendant-only rows to be selected without a resolved session when entry metadata is sufficient', () => {
    const descendantOnlyEntry = {
      sessionId: 'session-descendant',
      title: 'Ancestor row',
      directory: '/workspace/project',
      activitySource: 'descendant',
    } satisfies ActiveSessionTreeEntry

    const onSelect = vi.fn()
    render(<ActiveSessionItem entry={descendantOnlyEntry} isSelected={false} onSelect={onSelect} />)

    const button = screen.getByRole('button', { name: /ancestor row/i })
    expect(button).toBeEnabled()

    fireEvent.click(button)

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session-descendant',
        title: 'Ancestor row',
        directory: '/workspace/project',
      }),
    )
  })

  it('keeps the pending permission label for self-active entries waiting on user input', () => {
    const pendingEntry = {
      sessionId: 'session-permission',
      activitySource: 'self',
      status: { type: 'busy' },
      title: 'Permission session',
      directory: '/workspace/project',
      pendingAction: {
        type: 'permission',
        description: 'write /workspace/project/file.ts',
      },
    } satisfies ActiveSessionTreeEntry

    renderItem(pendingEntry, createResolvedSession({ id: 'session-permission', title: 'Permission session' }))

    expect(screen.getByText('Awaiting Permission')).toBeInTheDocument()
    expect(screen.getByText('write /workspace/project/file.ts')).toBeInTheDocument()
  })

  it('keeps the retry label and attempt count for self-active retry entries', () => {
    const retryEntry = {
      sessionId: 'session-retry',
      activitySource: 'self',
      status: { type: 'retry', attempt: 3, next: Date.now() + 1000, message: 'Temporary failure' },
      title: 'Retry session',
      directory: '/workspace/project',
    } satisfies ActiveSessionTreeEntry

    renderItem(retryEntry, createResolvedSession({ id: 'session-retry', title: 'Retry session' }))

    expect(screen.getByText('Retrying')).toBeInTheDocument()
    expect(screen.getByText('attempt 3')).toBeInTheDocument()
  })
})
