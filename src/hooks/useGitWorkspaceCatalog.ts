import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentProject, listWorktrees } from '../api'
import { subscribeToEvents } from '../api/events'
import { serverStore } from '../store/serverStore'
import { normalizeToForwardSlash } from '../utils'

export interface GitWorkspaceMeta {
  isGit: boolean
  rootDirectory: string
  // root workspace 放第一位，后面才是 sandbox worktree
  workspaces: string[]
}

export type GitWorkspaceCatalog = Map<string, GitWorkspaceMeta>

type RefreshListener = () => void

const refreshListeners = new Set<RefreshListener>()

export function requestGitWorkspaceCatalogRefresh() {
  refreshListeners.forEach(listener => listener())
}

export function useGitWorkspaceCatalog(directories: string[]) {
  const [catalog, setCatalog] = useState<GitWorkspaceCatalog>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(true)
  const versionRef = useRef(0)
  const catalogRef = useRef<GitWorkspaceCatalog>(new Map())

  const setCatalogState = useCallback((nextCatalog: GitWorkspaceCatalog) => {
    catalogRef.current = nextCatalog
    setCatalog(nextCatalog)
  }, [])

  const refresh = useCallback(async () => {
    const version = ++versionRef.current
    const normalizedDirectorySet = new Set(
      directories.filter(Boolean).map(directory => normalizeToForwardSlash(directory)),
    )
    const normalizedDirectories = Array.from(normalizedDirectorySet)

    if (normalizedDirectories.length === 0) {
      setIsLoading(false)
      setCatalogState(new Map())
      return
    }

    setIsLoading(true)
    const previousCatalog = catalogRef.current

    try {
      const projectResults = await Promise.allSettled(
        normalizedDirectories.map(async directory => ({
          directory,
          project: await getCurrentProject(directory),
        })),
      )

      if (!mountedRef.current || version !== versionRef.current) return

      const rootDirectories = new Set<string>()
      const directoryToRoot = new Map<string, string>()
      const nextCatalog: GitWorkspaceCatalog = new Map()
      const previousWorkspacesByRoot = new Map<string, string[]>()

      for (const [directory, meta] of previousCatalog) {
        if (meta.isGit) {
          previousWorkspacesByRoot.set(meta.rootDirectory, meta.workspaces)
        }

        if (normalizedDirectorySet.has(directory)) {
          nextCatalog.set(directory, meta)
        }
      }

      for (let index = 0; index < projectResults.length; index++) {
        const result = projectResults[index]
        const directory = normalizedDirectories[index]

        if (result.status !== 'fulfilled') {
          const previousMeta = previousCatalog.get(directory)
          if (previousMeta?.isGit) {
            rootDirectories.add(previousMeta.rootDirectory)
            directoryToRoot.set(directory, previousMeta.rootDirectory)
          }
          continue
        }

        const { project } = result.value

        if (project.vcs === 'git' && project.worktree) {
          const rootDirectory = normalizeToForwardSlash(project.worktree)
          rootDirectories.add(rootDirectory)
          directoryToRoot.set(directory, rootDirectory)
        } else {
          nextCatalog.set(directory, {
            isGit: false,
            rootDirectory: directory,
            workspaces: [directory],
          })
        }
      }

      const rootDirectoryList = Array.from(rootDirectories)

      const workspaceResults = await Promise.allSettled(
        rootDirectoryList.map(async rootDirectory => ({
          rootDirectory,
          worktrees: await listWorktrees(rootDirectory),
        })),
      )

      if (!mountedRef.current || version !== versionRef.current) return

      const rootToWorkspaces = new Map<string, string[]>()

      for (let index = 0; index < workspaceResults.length; index++) {
        const result = workspaceResults[index]
        const rootDirectory = rootDirectoryList[index]

        if (result.status !== 'fulfilled') {
          rootToWorkspaces.set(rootDirectory, previousWorkspacesByRoot.get(rootDirectory) ?? [rootDirectory])
          continue
        }

        const { worktrees } = result.value
        const normalizedWorktrees = Array.from(new Set(worktrees.map(worktree => normalizeToForwardSlash(worktree))))
        const sandboxes = normalizedWorktrees.filter(worktree => worktree.toLowerCase() !== rootDirectory.toLowerCase())
        rootToWorkspaces.set(rootDirectory, [rootDirectory, ...sandboxes])
      }

      for (const [directory, rootDirectory] of directoryToRoot) {
        nextCatalog.set(directory, {
          isGit: true,
          rootDirectory,
          workspaces: rootToWorkspaces.get(rootDirectory) ?? [rootDirectory],
        })
      }

      setCatalogState(nextCatalog)
    } finally {
      if (mountedRef.current && version === versionRef.current) {
        setIsLoading(false)
      }
    }
  }, [directories, setCatalogState])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    return () => {
      mountedRef.current = false
    }
  }, [refresh])

  useEffect(() => {
    return subscribeToEvents({
      onWorktreeReady: () => void refresh(),
      onWorktreeFailed: () => void refresh(),
      onReconnected: reason => {
        if (reason !== 'server-switch') void refresh()
      },
    })
  }, [refresh])

  useEffect(() => {
    const listener = () => void refresh()
    refreshListeners.add(listener)
    return () => {
      refreshListeners.delete(listener)
    }
  }, [refresh])

  useEffect(() => {
    return serverStore.onServerChange(() => void refresh())
  }, [refresh])

  return {
    catalog,
    isLoading,
    refresh,
  }
}
