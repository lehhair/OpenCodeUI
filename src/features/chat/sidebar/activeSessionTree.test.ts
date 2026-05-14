import { describe, expect, it } from 'vitest'
import type { ActiveSessionEntry } from '../../../store/activeSessionStore'
import { buildActiveSessionTree } from './activeSessionTree'

type DisplayEntry = {
  sessionId: string
  activitySource: 'self' | 'descendant'
}

function makeEntry(sessionId: string): ActiveSessionEntry {
  return {
    sessionId,
    status: { type: 'busy' },
  }
}

function displayEntry(sessionId: string, activitySource: 'self' | 'descendant'): DisplayEntry {
  return { sessionId, activitySource }
}

function mapTree(tree: ReturnType<typeof buildActiveSessionTree>) {
  return {
    rootEntries: tree.rootEntries.map(entry => displayEntry(entry.sessionId, entry.activitySource)),
    childrenByParent: new Map(
      Array.from(tree.childrenByParent.entries(), ([parentId, entries]) => [
        parentId,
        entries.map(entry => displayEntry(entry.sessionId, entry.activitySource)),
      ]),
    ),
  }
}

function noResolvedEntry() {
  return undefined
}

describe('buildActiveSessionTree', () => {
  it('nests an active child under an active parent with self activity sources', () => {
    const root = makeEntry('root-1')
    const child = makeEntry('parent-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [root, child],
        sessionId => {
          if (sessionId === 'parent-1') return 'root-1'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('root-1', 'self')])
    expect(tree.childrenByParent).toEqual(new Map([['root-1', [displayEntry('parent-1', 'self')]]]))
  })

  it('injects inactive ancestors to preserve a deep active chain', () => {
    const root = makeEntry('root-1')
    const leaf = makeEntry('leaf-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [root, leaf],
        sessionId => {
          if (sessionId === 'leaf-1') return 'child-1'
          if (sessionId === 'child-1') return 'parent-1'
          if (sessionId === 'parent-1') return 'root-1'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('root-1', 'self')])
    expect(tree.childrenByParent).toEqual(
      new Map([
        ['root-1', [displayEntry('parent-1', 'descendant')]],
        ['parent-1', [displayEntry('child-1', 'descendant')]],
        ['child-1', [displayEntry('leaf-1', 'self')]],
      ]),
    )
  })

  it('keeps sibling order while injecting a shared inactive ancestor once', () => {
    const root = makeEntry('root-1')
    const child = makeEntry('child-1')
    const sibling = makeEntry('sibling-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [root, child, sibling],
        sessionId => {
          if (sessionId === 'child-1' || sessionId === 'sibling-1') return 'parent-1'
          if (sessionId === 'parent-1') return 'root-1'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('root-1', 'self')])
    expect(tree.childrenByParent).toEqual(
      new Map([
        ['root-1', [displayEntry('parent-1', 'descendant')]],
        ['parent-1', [displayEntry('child-1', 'self'), displayEntry('sibling-1', 'self')]],
      ]),
    )
  })

  it('prefers a self-active parent entry over descendant-only injection', () => {
    const root = makeEntry('root-1')
    const parent = makeEntry('parent-1')
    const child = makeEntry('child-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [root, parent, child],
        sessionId => {
          if (sessionId === 'parent-1') return 'root-1'
          if (sessionId === 'child-1') return 'parent-1'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('root-1', 'self')])
    expect(tree.childrenByParent).toEqual(
      new Map([
        ['root-1', [displayEntry('parent-1', 'self')]],
        ['parent-1', [displayEntry('child-1', 'self')]],
      ]),
    )
  })

  it('replaces a descendant placeholder when a busy parent is encountered after its child', () => {
    const root = makeEntry('root-1')
    const parent = makeEntry('parent-1')
    const child = makeEntry('child-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [root, child, parent],
        sessionId => {
          if (sessionId === 'parent-1') return 'root-1'
          if (sessionId === 'child-1') return 'parent-1'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('root-1', 'self')])
    expect(tree.childrenByParent).toEqual(
      new Map([
        ['root-1', [displayEntry('parent-1', 'self')]],
        ['parent-1', [displayEntry('child-1', 'self')]],
      ]),
    )
  })

  it('keeps active children visible when an ancestor chain cannot be fully resolved', () => {
    const root = makeEntry('root-1')
    const orphanChild = makeEntry('orphan-child-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [root, orphanChild],
        sessionId => {
          if (sessionId === 'orphan-child-1') return 'missing-parent'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('root-1', 'self'), displayEntry('missing-parent', 'descendant')])
    expect(tree.childrenByParent).toEqual(
      new Map([['missing-parent', [displayEntry('orphan-child-1', 'self')]]]),
    )
  })

  it('breaks parent cycles by falling back to top-level self entries', () => {
    const child = makeEntry('child-1')
    const leaf = makeEntry('leaf-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [child, leaf],
        sessionId => {
          if (sessionId === 'child-1') return 'leaf-1'
          if (sessionId === 'leaf-1') return 'child-1'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('child-1', 'self'), displayEntry('leaf-1', 'self')])
    expect(tree.childrenByParent).toEqual(new Map())
  })

  it('does not promote an active child when its inactive parent should be preserved', () => {
    const sibling = makeEntry('sibling-1')
    const childOnly = makeEntry('child-1')

    const tree = mapTree(
      buildActiveSessionTree(
        [sibling, childOnly],
        sessionId => {
          if (sessionId === 'child-1') return 'parent-1'
          if (sessionId === 'parent-1') return 'root-1'
          return undefined
        },
        noResolvedEntry,
      ),
    )

    expect(tree.rootEntries).toEqual([displayEntry('sibling-1', 'self'), displayEntry('root-1', 'descendant')])
    expect(tree.childrenByParent).toEqual(
      new Map([
        ['root-1', [displayEntry('parent-1', 'descendant')]],
        ['parent-1', [displayEntry('child-1', 'self')]],
      ]),
    )
  })
})
