import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../../../api'
import { SessionChildrenSlot } from './SessionChildrenSlot'

const { getSessionChildrenMock, layoutState, busySessionsState } = vi.hoisted(() => ({
  getSessionChildrenMock: vi.fn(),
  layoutState: { sidebarSubSessionSortOrder: 'activeAsc' as 'activeAsc' | 'activeDesc' },
  busySessionsState: [] as Array<{ sessionId: string }>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../../api', () => ({
  getSessionChildren: getSessionChildrenMock,
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}))

vi.mock('../../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false }),
}))

vi.mock('../../../store', () => ({
  useLayoutStore: () => layoutState,
  useBusySessions: () => busySessionsState,
}))

vi.mock('../../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('../../sessions', () => ({
  SessionListItem: ({ session }: { session: ApiSession }) => <div data-testid="child-session-row">{session.title}</div>,
}))

function createSession(id: string, title: string, created: number, updated?: number): ApiSession {
  return {
    id,
    title,
    directory: '/workspace/project',
    time: {
      created,
      ...(updated === undefined ? {} : { updated }),
    },
  } as ApiSession
}

function createParentSession(): ApiSession {
  return createSession('parent-1', 'Parent session', 50)
}

function getRenderedTitles() {
  return screen.getAllByTestId('child-session-row').map(node => node.textContent)
}

describe('SessionChildrenSlot', () => {
  beforeEach(() => {
    layoutState.sidebarSubSessionSortOrder = 'activeAsc'
    busySessionsState.length = 0
    getSessionChildrenMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sorts provided child sessions by active time ascending without mutating the input array', () => {
    const providedChildren = [
      createSession('child-3', 'Third active', 30, 300),
      createSession('child-1', 'First active', 10, 100),
      createSession('child-2', 'Second active', 20, 200),
    ]
    const originalTitles = providedChildren.map(session => session.title)

    render(
      <SessionChildrenSlot
        parentSession={createParentSession()}
        selectedSessionId={null}
        onSelect={vi.fn()}
      >
        {providedChildren}
      </SessionChildrenSlot>,
    )

    expect(getRenderedTitles()).toEqual(['First active', 'Second active', 'Third active'])
    expect(providedChildren.map(session => session.title)).toEqual(originalTitles)
  })

  it('sorts fetched child sessions by active time descending', async () => {
    layoutState.sidebarSubSessionSortOrder = 'activeDesc'
    getSessionChildrenMock.mockResolvedValue([
      createSession('child-1', 'First active', 10, 100),
      createSession('child-3', 'Third active', 30, 300),
      createSession('child-2', 'Second active', 20, 200),
    ])

    render(
      <SessionChildrenSlot
        parentSession={createParentSession()}
        selectedSessionId={null}
        fetchAll
        onSelect={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(getRenderedTitles()).toEqual(['Third active', 'Second active', 'First active'])
    })
  })

  it('preserves deterministic relative order when active times fall into the just-now bucket', () => {
    const now = Date.now()
    const providedChildren = [
      createSession('child-a', 'Alpha', 20, now - 10_000),
      createSession('child-b', 'Bravo', 20, now - 20_000),
      createSession('child-c', 'Charlie', 20, now - 30_000),
    ]
    const originalTitles = providedChildren.map(session => session.title)

    render(
      <SessionChildrenSlot
        parentSession={createParentSession()}
        selectedSessionId={null}
        onSelect={vi.fn()}
      >
        {providedChildren}
      </SessionChildrenSlot>,
    )

    expect(getRenderedTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(providedChildren.map(session => session.title)).toEqual(originalTitles)
  })

  it('ranks busy just-now sessions ahead of non-busy just-now sessions', () => {
    const now = Date.now()
    const providedChildren = [
      createSession('child-a', 'Inactive now', 20, now - 10_000),
      createSession('child-b', 'Busy now', 20, now - 20_000),
      createSession('child-c', 'Inactive now 2', 20, now - 30_000),
    ]

    busySessionsState.push({ sessionId: 'child-b' })

    render(
      <SessionChildrenSlot
        parentSession={createParentSession()}
        selectedSessionId={null}
        onSelect={vi.fn()}
      >
        {providedChildren}
      </SessionChildrenSlot>,
    )

    expect(getRenderedTitles()).toEqual(['Busy now', 'Inactive now', 'Inactive now 2'])
  })

  it('does not mutate the fetched child array while sorting by active time', async () => {
    layoutState.sidebarSubSessionSortOrder = 'activeDesc'
    const fetchedChildren = [
      createSession('child-1', 'First active', 10, 100),
      createSession('child-3', 'Third active', 30, 300),
      createSession('child-2', 'Second active', 20, 200),
    ]
    const originalTitles = fetchedChildren.map(session => session.title)
    getSessionChildrenMock.mockResolvedValue(fetchedChildren)

    render(
      <SessionChildrenSlot
        parentSession={createParentSession()}
        selectedSessionId={null}
        fetchAll
        onSelect={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(getRenderedTitles()).toEqual(['Third active', 'Second active', 'First active'])
    })

    expect(fetchedChildren.map(session => session.title)).toEqual(originalTitles)
  })

  it('re-sorts by active time after sessions age out of the just-now bucket', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T00:00:00.000Z'))

    const providedChildren = [
      createSession('child-a', 'Alpha', 20, Date.now() - 10_000),
      createSession('child-b', 'Bravo', 20, Date.now() - 30_000),
      createSession('child-c', 'Charlie', 20, Date.now() - 20_000),
    ]

    render(
      <SessionChildrenSlot
        parentSession={createParentSession()}
        selectedSessionId={null}
        onSelect={vi.fn()}
      >
        {providedChildren}
      </SessionChildrenSlot>,
    )

    expect(getRenderedTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])

    act(() => {
      vi.advanceTimersByTime(61_000)
    })

    expect(getRenderedTitles()).toEqual(['Bravo', 'Charlie', 'Alpha'])
  })
})
