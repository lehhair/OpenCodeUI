import { useMemo } from 'react'
import { useGitWorkspaceCatalog, useVcsInfo } from '../../hooks'
import { getDirectoryName, isSameDirectory, normalizeToForwardSlash } from '../../utils'
import type { SessionHeaderLocation } from './SessionHeaderLocation'

export function useSessionHeaderContext(directory?: string): SessionHeaderLocation | null {
  const normalizedDirectory = directory ? normalizeToForwardSlash(directory) : undefined
  const catalogDirectories = useMemo(
    () => (normalizedDirectory ? [normalizedDirectory] : []),
    [normalizedDirectory],
  )
  const { catalog } = useGitWorkspaceCatalog(catalogDirectories)
  const { vcsInfo, isLoading: isBranchLoading } = useVcsInfo(normalizedDirectory)

  return useMemo(() => {
    if (!normalizedDirectory) return null

    const meta = catalog.get(normalizedDirectory)
    const workspaceName = meta?.isGit
      ? isSameDirectory(meta.rootDirectory, normalizedDirectory)
        ? getDirectoryName(meta.rootDirectory) || meta.rootDirectory
        : getDirectoryName(normalizedDirectory) || normalizedDirectory
      : getDirectoryName(normalizedDirectory) || normalizedDirectory

    const branchName = meta?.isGit ? (vcsInfo?.branch ?? (isBranchLoading ? '...' : undefined)) : undefined

    if (!workspaceName && !branchName) return null

    return { workspaceName, branchName }
  }, [catalog, normalizedDirectory, vcsInfo?.branch, isBranchLoading])
}