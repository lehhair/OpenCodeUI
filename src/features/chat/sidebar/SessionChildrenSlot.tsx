// SessionChildrenSlot — 子 session 渲染
// fetchAll=true → /children 拉全量，children 有值 → 直接渲染
// 删除/重命名自己管自己的状态，和主列表行为完全一致

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getSessionChildren, updateSession, deleteSession as apiDeleteSession, type ApiSession } from '../../../api'
import { SpinnerIcon } from '../../../components/Icons'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useInputCapabilities } from '../../../hooks/useInputCapabilities'
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
}

export function SessionChildrenSlot({
  parentSession,
  selectedSessionId,
  fetchAll,
  children: givenChildren,
  onSelect,
  onDeleteSelected,
}: SessionChildrenSlotProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { preferTouchUi } = useInputCapabilities()
  const [fetched, setFetched] = useState<ApiSession[]>([])
  const [loading, setLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; sessionId: string | null }>({
    isOpen: false,
    sessionId: null,
  })

  useEffect(() => {
    if (!fetchAll) {
      return
    }
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true)
      }
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

  const list = fetchAll ? fetched : givenChildren
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
