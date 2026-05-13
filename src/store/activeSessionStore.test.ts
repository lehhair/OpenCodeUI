import { beforeEach, describe, expect, it } from 'vitest'
import { activeSessionStore } from './activeSessionStore'

describe('activeSessionStore scoped refresh handling', () => {
  beforeEach(() => {
    activeSessionStore.initialize({})
    activeSessionStore.initializePendingRequests([], [])
  })

  it('preserves existing busy child sessions when merging scoped status refreshes', () => {
    activeSessionStore.initialize({
      root: { type: 'busy' },
      child: { type: 'busy' },
    })

    activeSessionStore.mergeStatusRefresh({
      root: { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['root', 'child'])
  })

  it('drops missing sessions on full status replacement refreshes', () => {
    activeSessionStore.initialize({
      root: { type: 'busy' },
      child: { type: 'busy' },
    })

    activeSessionStore.initialize({
      root: { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['root'])
  })

  it('keeps existing pending child requests during scoped pending refresh merges', () => {
    activeSessionStore.addPendingRequest('req-child', 'child', 'question', 'Need approval')

    activeSessionStore.mergePendingRequests([], [])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['child'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'Need approval',
    })
  })
})
