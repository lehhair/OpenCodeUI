import type { GitWorkspaceCatalog } from '../../../hooks/useGitWorkspaceCatalog'
import { getProjectGroupIdentity } from './projectGrouping'
import { getDirectoryName, isSameDirectory, normalizeToForwardSlash } from '../../../utils'

interface SavedDirectory {
  path: string
  name?: string
}

export function collectRecentWorkspaceDirectories(
  savedDirectories: SavedDirectory[],
  catalog: GitWorkspaceCatalog,
): string[] {
  const groups = new Map<
    string,
    { worktree: string; memberDirectories: string[]; workspaceDirectories?: string[] }
  >()

  for (const directory of savedDirectories) {
    const normalizedDirectory = normalizeToForwardSlash(directory.path)
    const meta = catalog.get(normalizedDirectory)
    const { projectId, workspaceDirectories } = getProjectGroupIdentity(normalizedDirectory, meta)
    const existing = groups.get(projectId)

    if (existing) {
      groups.set(projectId, {
        ...existing,
        memberDirectories: [...existing.memberDirectories, directory.path],
      })
      continue
    }

    groups.set(projectId, {
      worktree: projectId,
      memberDirectories: [directory.path],
      workspaceDirectories,
    })
  }

  const ordered: string[] = []
  const seen = new Set<string>()

  const pushDirectory = (directory: string) => {
    const normalized = normalizeToForwardSlash(directory)
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    ordered.push(normalized)
  }

  for (const project of groups.values()) {
    if (project.workspaceDirectories && project.workspaceDirectories.length > 1) {
      const savedWorkspaceDirectories = project.memberDirectories
        .map(directory => normalizeToForwardSlash(directory))
        .filter(directory => project.workspaceDirectories?.some(workspace => isSameDirectory(workspace, directory)))

      const remainingWorkspaceDirectories = project.workspaceDirectories.filter(
        workspace => !savedWorkspaceDirectories.some(directory => isSameDirectory(directory, workspace)),
      )

      for (const workspace of [...savedWorkspaceDirectories, ...remainingWorkspaceDirectories]) {
        pushDirectory(workspace)
      }
      continue
    }

    pushDirectory(project.worktree)
  }

  return ordered
}

export function getWorkspaceDisplayName(directory: string, catalog: GitWorkspaceCatalog): string {
  const normalized = normalizeToForwardSlash(directory)
  const meta = catalog.get(normalized)
  if (meta?.isGit && isSameDirectory(meta.rootDirectory, normalized)) {
    return getDirectoryName(meta.rootDirectory) || meta.rootDirectory
  }
  return getDirectoryName(normalized) || normalized
}