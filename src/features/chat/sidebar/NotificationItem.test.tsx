import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../../../api'
import type { NotificationEntry } from '../../../store/notificationStore'
import { NotificationItem } from './NotificationItem'

const { markReadMock, dismissMock } = vi.hoisted(() => ({
  markReadMock: vi.fn(),
  dismissMock: vi.fn(),
}))

vi.mock('../../../store/notificationStore', () => ({
  notificationStore: {
    markRead: markReadMock,
    dismiss: dismissMock,
  },
}))

vi.mock('../../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false }),
}))

describe('NotificationItem', () => {
  const entry: NotificationEntry = {
    id: 'notif-1',
    type: 'completed',
    title: 'Build finished',
    body: 'All tests passed',
    sessionId: 'session-1',
    timestamp: Date.now(),
    read: false,
  }
  const resolvedSession: ApiSession = {
    id: 'session-1',
    title: 'Build finished',
    directory: '/workspace',
  } as ApiSession

  beforeEach(() => {
    markReadMock.mockReset()
    dismissMock.mockReset()
  })

  it('renders a selectable row button and a separate dismiss action', () => {
    const onSelect = vi.fn()
    render(<NotificationItem entry={entry} resolvedSession={resolvedSession} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /Build finished/i }))

    expect(markReadMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(dismissMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('keeps the full notification row clickable outside the inner button', () => {
    const onSelect = vi.fn()
    render(<NotificationItem entry={entry} resolvedSession={resolvedSession} onSelect={onSelect} />)

    const rowButton = screen.getByRole('button', { name: /Build finished/i })
    const row = rowButton.parentElement

    expect(row).not.toBeNull()

    fireEvent.click(row!)

    expect(markReadMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }))
  })
})
