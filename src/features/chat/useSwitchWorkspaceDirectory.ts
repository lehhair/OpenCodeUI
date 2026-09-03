import { useCallback } from 'react'
import { useDirectory, useRouter } from '../../hooks'
import { paneLayoutStore } from '../../store'
import { normalizeToForwardSlash } from '../../utils'

export function useSwitchWorkspaceDirectory() {
  const { addDirectory, setCurrentDirectory } = useDirectory()
  const { setDirectory } = useRouter()

  return useCallback(
    (directory: string) => {
      const normalized = normalizeToForwardSlash(directory)
      addDirectory(normalized)
      setCurrentDirectory(normalized)

      const paneId = paneLayoutStore.getFocusedPaneId()
      if (paneId) {
        paneLayoutStore.focusPane(paneId)
        paneLayoutStore.setPaneSession(paneId, null)
      }

      setDirectory(normalized)
    },
    [addDirectory, setCurrentDirectory, setDirectory],
  )
}