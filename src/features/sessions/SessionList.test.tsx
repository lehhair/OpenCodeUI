import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../../api'
import { SessionListItem } from './SessionList'

const { useSessionActiveEntryMock, useHasUnreadCompletedNotificationMock, markSessionNotificationsReadMock } = vi.hoisted(() => ({
  useSessionActiveEntryMock: vi.fn(),
  useHasUnreadCompletedNotificationMock: vi.fn(),
  markSessionNotificationsReadMock: vi.fn(),
}))

vi.mock('../../store/activeSessionStore', () => ({
  useSessionActiveEntry: (...args: unknown[]) => useSessionActiveEntryMock(...args),
}))

vi.mock('../../store/notificationStore', () => ({
  notificationStore: {
    markSessionNotificationsRead: markSessionNotificationsReadMock,
  },
  useHasUnreadCompletedNotification: (...args: unknown[]) => useHasUnreadCompletedNotificationMock(...args),
}))

vi.mock('../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('../chat/sidebar/SessionChildrenSlot', () => ({
  SessionChildrenSlot: () => null,
}))

describe('SessionListItem', () => {
  const session: ApiSession = {
    id: 'session-1',
    title: 'Session One',
    directory: '/workspace/demo',
    time: { updated: 1 },
  } as ApiSession

  beforeEach(() => {
    useSessionActiveEntryMock.mockReturnValue(null)
    useHasUnreadCompletedNotificationMock.mockReturnValue(false)
    markSessionNotificationsReadMock.mockReset()
  })

  it('renders the session row as a semantic button and selects it', () => {
    const onSelect = vi.fn()

    render(
      <SessionListItem
        session={session}
        isSelected={false}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        preferTouchUi={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Session One/i }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(markSessionNotificationsReadMock).toHaveBeenCalledWith('session-1', 'completed')
  })

  it('keeps the full session row clickable outside the inner content button', () => {
    const onSelect = vi.fn()

    render(
      <SessionListItem
        session={session}
        isSelected={false}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        preferTouchUi={false}
      />,
    )

    const sessionButton = screen.getByRole('button', { name: /Session One/i })
    const sessionRow = sessionButton.parentElement

    expect(sessionRow).not.toBeNull()

    fireEvent.click(sessionRow!)

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not leave the row button focused after mouse selection', () => {
    const onSelect = vi.fn()

    render(
      <SessionListItem
        session={session}
        isSelected={false}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        preferTouchUi={false}
      />,
    )

    const sessionButton = screen.getByRole('button', { name: /Session One/i })

    fireEvent.click(sessionButton)

    expect(sessionButton).not.toHaveFocus()
  })
})
