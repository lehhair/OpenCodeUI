import type { ActiveSessionEntry } from '../../../store/activeSessionStore'

export type ActiveSessionTreeEntry =
  | (ActiveSessionEntry & { activitySource: 'self' })
  | {
      sessionId: string
      activitySource: 'descendant'
      title?: string
      directory?: string
    }

export interface ActiveSessionTree {
  rootEntries: ActiveSessionTreeEntry[]
  childrenByParent: Map<string, ActiveSessionTreeEntry[]>
}

export function buildActiveSessionTree(
  busySessions: ActiveSessionEntry[],
  findParentId: (sessionId: string) => string | undefined,
  resolveEntry: (sessionId: string) => { title?: string; directory?: string } | undefined,
): ActiveSessionTree {
  const displayEntries = new Map<string, ActiveSessionTreeEntry>()
  const rootEntryIds: string[] = []
  const childrenByParentIds = new Map<string, string[]>()
  const rootEntryIdSet = new Set<string>()
  const childEntryIdsByParent = new Map<string, Set<string>>()

  const upsertEntry = (entry: ActiveSessionTreeEntry): ActiveSessionTreeEntry => {
    const existing = displayEntries.get(entry.sessionId)

    if (!existing) {
      displayEntries.set(entry.sessionId, entry)
      return entry
    }

    if (existing.activitySource === 'self') {
      return existing
    }

    if (entry.activitySource === 'self') {
      displayEntries.set(entry.sessionId, entry)
      return entry
    }

    const mergedEntry: ActiveSessionTreeEntry = {
      sessionId: existing.sessionId,
      activitySource: 'descendant',
      title: existing.title ?? entry.title,
      directory: existing.directory ?? entry.directory,
    }

    displayEntries.set(entry.sessionId, mergedEntry)
    return mergedEntry
  }

  const appendRoot = (entryId: string) => {
    if (rootEntryIdSet.has(entryId)) {
      return
    }

    rootEntryIdSet.add(entryId)
    rootEntryIds.push(entryId)
  }

  const appendChild = (parentId: string, childId: string) => {
    let childIds = childEntryIdsByParent.get(parentId)
    if (!childIds) {
      childIds = new Set<string>()
      childEntryIdsByParent.set(parentId, childIds)
    }

    if (childIds.has(childId)) {
      return
    }

    childIds.add(childId)
    const siblings = childrenByParentIds.get(parentId)
    if (siblings) {
      siblings.push(childId)
    } else {
      childrenByParentIds.set(parentId, [childId])
    }
  }

  for (const entry of busySessions) {
    const selfEntry = upsertEntry({
      ...entry,
      activitySource: 'self',
    })
    const visitedIds = new Set<string>([entry.sessionId])
    const chain: ActiveSessionTreeEntry[] = [selfEntry]

    let currentId = entry.sessionId
    let cycleDetected = false

    while (true) {
      const parentId = findParentId(currentId)

      if (!parentId) {
        break
      }

      if (visitedIds.has(parentId)) {
        cycleDetected = true
        break
      }

      visitedIds.add(parentId)

      const parentEntry = displayEntries.get(parentId)
      const resolvedMeta = resolveEntry(parentId)
      const ancestorEntry = upsertEntry(
        parentEntry ?? {
          sessionId: parentId,
          activitySource: 'descendant',
          title: resolvedMeta?.title,
          directory: resolvedMeta?.directory,
        },
      )

      chain.unshift(ancestorEntry)
      currentId = parentId
    }

    if (cycleDetected) {
      appendRoot(selfEntry.sessionId)
      continue
    }

    appendRoot(chain[0].sessionId)

    for (let index = 1; index < chain.length; index += 1) {
      appendChild(chain[index - 1].sessionId, chain[index].sessionId)
    }
  }

  const rootEntries = rootEntryIds
    .map(sessionId => displayEntries.get(sessionId))
    .filter((entry): entry is ActiveSessionTreeEntry => entry !== undefined)

  const childrenByParent = new Map<string, ActiveSessionTreeEntry[]>()

  for (const [parentId, childIds] of childrenByParentIds.entries()) {
    const children = childIds
      .map(sessionId => displayEntries.get(sessionId))
      .filter((entry): entry is ActiveSessionTreeEntry => entry !== undefined)

    if (children.length > 0) {
      childrenByParent.set(parentId, children)
    }
  }

  return { rootEntries, childrenByParent }
}
