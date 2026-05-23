import { describe, expect, it } from 'vitest'
import { buildActiveTreeSessionTargets } from './activeSessionTargets'
import type { ActiveSessionTree } from './activeSessionTree'

describe('buildActiveTreeSessionTargets', () => {
  it('propagates a child directory upward so inferred ancestors become hydratable', () => {
    const tree: ActiveSessionTree = {
      rootEntries: [
        {
          sessionId: 'root-1',
          activitySource: 'descendant',
          title: 'Root',
        },
      ],
      childrenByParent: new Map([
        [
          'root-1',
          [
            {
              sessionId: 'parent-1',
              activitySource: 'descendant',
              title: 'Parent',
            },
          ],
        ],
        [
          'parent-1',
          [
            {
              sessionId: 'child-1',
              activitySource: 'self',
              status: { type: 'busy' },
              directory: '/workspace/demo',
            },
          ],
        ],
      ]),
    }

    expect(buildActiveTreeSessionTargets(tree)).toEqual([
      { sessionId: 'child-1', directory: '/workspace/demo' },
      { sessionId: 'parent-1', directory: '/workspace/demo' },
      { sessionId: 'root-1', directory: '/workspace/demo' },
    ])
  })

  it('keeps a known ancestor directory instead of overwriting it from descendants', () => {
    const tree: ActiveSessionTree = {
      rootEntries: [
        {
          sessionId: 'root-1',
          activitySource: 'descendant',
          directory: '/workspace/root',
        },
      ],
      childrenByParent: new Map([
        [
          'root-1',
          [
            {
              sessionId: 'child-1',
              activitySource: 'self',
              status: { type: 'busy' },
              directory: '/workspace/child',
            },
          ],
        ],
      ]),
    }

    expect(buildActiveTreeSessionTargets(tree)).toEqual([
      { sessionId: 'child-1', directory: '/workspace/child' },
      { sessionId: 'root-1', directory: '/workspace/root' },
    ])
  })

  it('skips targets that still have no usable directory anywhere in the branch', () => {
    const tree: ActiveSessionTree = {
      rootEntries: [
        {
          sessionId: 'root-1',
          activitySource: 'descendant',
        },
      ],
      childrenByParent: new Map([
        [
          'root-1',
          [
            {
              sessionId: 'child-1',
              activitySource: 'descendant',
            },
          ],
        ],
      ]),
    }

    expect(buildActiveTreeSessionTargets(tree)).toEqual([])
  })
})
