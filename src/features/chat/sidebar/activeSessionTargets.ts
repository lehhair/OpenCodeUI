import type { ActiveSessionTree, ActiveSessionTreeEntry } from './activeSessionTree'

export interface ActiveSessionFetchTarget {
  sessionId: string
  directory: string
}

export function buildActiveTreeSessionTargets(activeSessionTree: ActiveSessionTree): ActiveSessionFetchTarget[] {
  const targets = new Map<string, string>()

  const visit = (entry: ActiveSessionTreeEntry): string | undefined => {
    const children = activeSessionTree.childrenByParent.get(entry.sessionId) ?? []

    let inheritedDirectory = entry.directory

    for (const child of children) {
      const childDirectory = visit(child)
      if (!inheritedDirectory && childDirectory) {
        inheritedDirectory = childDirectory
      }
    }

    if (inheritedDirectory) {
      targets.set(entry.sessionId, inheritedDirectory)
    }

    return inheritedDirectory
  }

  for (const rootEntry of activeSessionTree.rootEntries) {
    visit(rootEntry)
  }

  return Array.from(targets, ([sessionId, directory]) => ({ sessionId, directory }))
}
