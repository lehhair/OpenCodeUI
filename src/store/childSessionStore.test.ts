import { afterEach, describe, expect, it } from 'vitest'
import type { ApiSession } from '../api/types'
import { childSessionStore } from './childSessionStore'

function makeSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'child-1',
    parentID: 'parent-1',
    title: 'Child Session',
    directory: '/workspace/demo',
    time: { created: 123 },
    ...overrides,
  } as ApiSession
}

describe('childSessionStore', () => {
  afterEach(() => {
    childSessionStore.clearAll()
  })

  it('stores directory metadata from registered child sessions', () => {
    childSessionStore.registerChildSession(makeSession())

    expect(childSessionStore.getSessionInfo('child-1')).toMatchObject({
      id: 'child-1',
      parentID: 'parent-1',
      title: 'Child Session',
      directory: '/workspace/demo',
      status: 'running',
      createdAt: 123,
    })
  })
})
