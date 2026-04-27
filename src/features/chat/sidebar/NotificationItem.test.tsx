import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    markReadMock.mockReset()
    dismissMock.mockReset()
  })

  it('renders a selectable row button and a separate dismiss action', () => {
    const onSelect = vi.fn()
    render(
      <NotificationItem
        entry={{
          id: 'notif-1',
          type: 'completed',
          title: 'Build finished',
          body: 'All tests passed',
          sessionId: 'session-1',
          timestamp: Date.now(),
          read: false,
        } as any}
        resolvedSession={{ id: 'session-1', title: 'Build finished', directory: '/workspace' } as any}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Build finished/i }))

    expect(markReadMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(dismissMock).toHaveBeenCalledWith('notif-1')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
