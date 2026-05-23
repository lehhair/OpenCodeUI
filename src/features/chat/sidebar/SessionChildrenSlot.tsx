// SessionChildrenSlot — 子 session 渲染
// fetchAll=true → /children 拉全量，children 有值 → 直接渲染
// 删除/重命名自己管自己的状态，和主列表行为完全一致

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MS_PER_MINUTE } from '../../../constants'
import { getSessionChildren, updateSession, deleteSession as apiDeleteSession, type ApiSession } from '../../../api'
import { SpinnerIcon } from '../../../components/Icons'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useInputCapabilities } from '../../../hooks/useInputCapabilities'
import { useNow } from '../../../hooks/useNow'
import { useBusySessions, useLayoutStore } from '../../../store'
import { uiErrorHandler } from '../../../utils'
import { SessionListItem } from '../../sessions'

interface SessionChildrenSlotProps {
  parentSession: ApiSession
  selectedSessionId: string | null
  fetchAll?: boolean
  children?: ApiSession[]
  onSelect: (session: ApiSession) => void
  /** 删除子 session 后如果它正好被选中，通知外部切走 */
  onDeleteSelected?: () => void
  // ---- 编辑模式 ----
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
}

export function SessionChildrenSlot({
  parentSession,
  selectedSessionId,
  fetchAll,
  children: givenChildren,
  onSelect,
  onDeleteSelected,
  isEditMode = false,
  selectedSessionIds,
  onToggleSessionSelection,
}: SessionChildrenSlotProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { preferTouchUi } = useInputCapabilities()
  const { sidebarSubSessionSortOrder } = useLayoutStore()
  const busySessions = useBusySessions()
  const now = useNow(MS_PER_MINUTE)
  const [fetched, setFetched] = useState<ApiSession[]>([])
  const [loading, setLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; sessionId: string | null }>({
    isOpen: false,
    sessionId: null,
  })

  useEffect(() => {
    if (!fetchAll) {
      const frameId = requestAnimationFrame(() => setLoading(false))
      return () => cancelAnimationFrame(frameId)
    }

    let cancelled = false
    const loadingFrameId = requestAnimationFrame(() => {
      if (!cancelled) setLoading(true)
    })

    getSessionChildren(parentSession.id, parentSession.directory)
      .then(data => {
        if (!cancelled) setFetched(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      cancelAnimationFrame(loadingFrameId)
    }
  }, [fetchAll, parentSession.id, parentSession.directory])

  const handleRename = useCallback(async (childId: string, newTitle: string) => {
    try {
      await updateSession(childId, { title: newTitle })
      setFetched(prev => prev.map(s => (s.id === childId ? { ...s, title: newTitle } : s)))
    } catch (e) {
      uiErrorHandler('rename session', e)
    }
  }, [])

  const handleDeleteConfirmed = useCallback(async () => {
    const id = deleteConfirm.sessionId
    if (!id) return
    setDeleteConfirm({ isOpen: false, sessionId: null })
    try {
      await apiDeleteSession(id)
      setFetched(prev => prev.filter(s => s.id !== id))
      if (selectedSessionId === id) onDeleteSelected?.()
    } catch (e) {
      uiErrorHandler('delete session', e)
    }
  }, [deleteConfirm.sessionId, selectedSessionId, onDeleteSelected])

  const list = useMemo(() => {
    const source = fetchAll ? fetched : givenChildren
    if (!source) return source
    const busySessionIds = new Set(busySessions.map(entry => entry.sessionId))

    return [...source].sort((left, right) => {
      const leftActive = left.time.updated ?? left.time.created
      const rightActive = right.time.updated ?? right.time.created
      const leftIsJustNow = now - leftActive < MS_PER_MINUTE
      const rightIsJustNow = now - rightActive < MS_PER_MINUTE
      const leftIsBusy = busySessionIds.has(left.id)
      const rightIsBusy = busySessionIds.has(right.id)

      if (leftIsJustNow && rightIsJustNow) {
        if (leftIsBusy !== rightIsBusy) {
          return leftIsBusy ? -1 : 1
        }

        return 0
      }

      if (sidebarSubSessionSortOrder === 'activeDesc') {
        return rightActive - leftActive
      }

      return leftActive - rightActive
    })
  }, [busySessions, fetchAll, fetched, givenChildren, now, sidebarSubSessionSortOrder])

  if (!list?.length && !loading) return null

  return (
    <div className="ml-3">
      {loading ? (
        <div className="flex items-center py-1.5 px-2">
          <SpinnerIcon size={10} className="animate-spin text-text-500" />
        </div>
      ) : (
        list!.map(child => (
          <SessionListItem
            key={child.id}
            session={child}
            isSelected={child.id === selectedSessionId}
            onSelect={() => onSelect(child)}
            onRename={newTitle => handleRename(child.id, newTitle)}
            onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: child.id })}
            preferTouchUi={preferTouchUi}
            density="minimal"
            showStats={false}
            showDirectory={false}
            isEditMode={isEditMode}
            isChecked={selectedSessionIds?.has(child.id)}
            onToggleCheck={
              onToggleSessionSelection ? options => onToggleSessionSelection(child.id, options) : undefined
            }
          />
        ))
      )}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, sessionId: null })}
        onConfirm={handleDeleteConfirmed}
        title={t('sidebar.deleteChat')}
        description={t('sidebar.deleteChatConfirm')}
        confirmText={t('common:delete')}
        variant="danger"
      />
    </div>
  )
}
