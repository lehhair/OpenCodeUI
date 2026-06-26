import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentProject } from '../api'
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

function normalizeProjectWorkspaces(rootDirectory: string, sandboxes?: string[]) {
  const seen = new Set([rootDirectory.toLowerCase()])
  const workspaces = [rootDirectory]

  for (const sandbox of sandboxes ?? []) {
    const normalized = normalizeToForwardSlash(sandbox)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    workspaces.push(normalized)
  }

  return workspaces
}

function mergeProjectWorkspaces(current: string[] | undefined, next: string[]) {
  if (!current) return next

  const seen = new Set(current.map(directory => directory.toLowerCase()))
  const merged = [...current]
  for (const directory of next) {
    const key = directory.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(directory)
  }
  return merged
}

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

      const directoryToRoot = new Map<string, string>()
      const rootToWorkspaces = new Map<string, string[]>()
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
            directoryToRoot.set(directory, previousMeta.rootDirectory)
            rootToWorkspaces.set(previousMeta.rootDirectory, previousMeta.workspaces)
          }
          continue
        }

        const { project } = result.value

        if (project.vcs === 'git' && project.worktree) {
          const rootDirectory = normalizeToForwardSlash(project.worktree)
          directoryToRoot.set(directory, rootDirectory)
          rootToWorkspaces.set(
            rootDirectory,
            mergeProjectWorkspaces(rootToWorkspaces.get(rootDirectory), normalizeProjectWorkspaces(rootDirectory, project.sandboxes)),
          )
        } else {
          nextCatalog.set(directory, {
            isGit: false,
            rootDirectory: directory,
            workspaces: [directory],
          })
        }
      }

      if (!mountedRef.current || version !== versionRef.current) return

      for (const [directory, rootDirectory] of directoryToRoot) {
        nextCatalog.set(directory, {
          isGit: true,
          rootDirectory,
          workspaces: rootToWorkspaces.get(rootDirectory) ?? previousWorkspacesByRoot.get(rootDirectory) ?? [rootDirectory],
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
