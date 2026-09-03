import { useMemo } from 'react'
import { useDirectory, useGitWorkspaceCatalog } from '../../hooks'
import { isSameDirectory, normalizeToForwardSlash } from '../../utils'
import { collectRecentWorkspaceDirectories } from './sidebar/recentWorkspaceDirectories'

export function useRecentWorkspaceDirectories(currentDirectory?: string) {
  const { savedDirectories } = useDirectory()
  const catalogDirectories = useMemo(
    () =>
      Array.from(
        new Set(
          savedDirectories
            .map(directory => normalizeToForwardSlash(directory.path))
            .concat(currentDirectory ? [normalizeToForwardSlash(currentDirectory)] : []),
        ),
      ),
    [savedDirectories, currentDirectory],
  )
  const { catalog } = useGitWorkspaceCatalog(catalogDirectories)

  return useMemo(() => {
    const directories = collectRecentWorkspaceDirectories(savedDirectories, catalog)
    if (currentDirectory) {
      const normalizedCurrent = normalizeToForwardSlash(currentDirectory)
      if (!directories.some(directory => isSameDirectory(directory, normalizedCurrent))) {
        return [normalizedCurrent, ...directories]
      }
    }
    return directories
  }, [savedDirectories, catalog, currentDirectory])
}