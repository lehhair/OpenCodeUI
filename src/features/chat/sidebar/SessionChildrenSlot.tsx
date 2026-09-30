// SessionChildrenSlot — 子 session 渲染
// fetchAll=true → /children 拉全量，children 有值 → 直接渲染
// 删除/重命名自己管自己的状态，和主列表行为完全一致

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getSessionChildren, updateSession, deleteSession as apiDeleteSession, type ApiSession } from '../../../api'
import { splitSessionKey } from '../../../utils/sessionKey'
import { SpinnerIcon } from '../../../components/Icons'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useInputCapabilities } from '../../../hooks/useInputCapabilities'
import { pinnedSessionsStore } from '../../../store/pinnedSessionsStore'
import { uiErrorHandler } from '../../../utils'
import { SessionListItem } from '../../sessions'

interface SessionChildrenSlotProps {
  parentSession: ApiSession
  /** 父 session 所属服务器（多服务器模式；缺省用活动服务器） */
  serverId?: string
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
  serverId,
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

    getSessionChildren(parentSession.id, parentSession.directory, serverId)
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
  }, [fetchAll, parentSession.id, parentSession.directory, serverId])

  const handleRename = useCallback(
    async (childId: string, newTitle: string) => {
      try {
        await updateSession(childId, { title: newTitle }, parentSession.directory, serverId)
        pinnedSessionsStore.update(childId, { title: newTitle })
        setFetched(prev => prev.map(s => (s.id === childId ? { ...s, title: newTitle } : s)))
      } catch (e) {
        uiErrorHandler('rename session', e)
      }
    },
    [parentSession.directory, serverId],
  )

  const handleDeleteConfirmed = useCallback(async () => {
    const id = deleteConfirm.sessionId
    if (!id) return
    setDeleteConfirm({ isOpen: false, sessionId: null })
    try {
      await apiDeleteSession(id, parentSession.directory, serverId)
      pinnedSessionsStore.unpin(id)
      setFetched(prev => prev.filter(s => s.id !== id))
      if (selectedSessionId && (selectedSessionId === id || splitSessionKey(selectedSessionId).sessionId === id)) {
        onDeleteSelected?.()
      }
    } catch (e) {
      uiErrorHandler('delete session', e)
    }
  }, [deleteConfirm.sessionId, selectedSessionId, onDeleteSelected, parentSession.directory, serverId])

  const list = fetchAll ? fetched : givenChildren

  if (!list?.length && !loading) return null

  return (
    <div className="ml-3">
      {loading ? (
        <div className="flex items-center py-1.5 px-2">
          <SpinnerIcon size={10} className="animate-spin text-text-500" />
        </div>
      ) : (
        list!.map((child, index) => {
          const isChecked = selectedSessionIds?.has(child.id) ?? false
          const prevChecked = isEditMode && index > 0 && (selectedSessionIds?.has(list![index - 1].id) ?? false)
          const nextChecked =
            isEditMode && index < list!.length - 1 && (selectedSessionIds?.has(list![index + 1].id) ?? false)
          return (
            <SessionListItem
              key={child.id}
              session={child}
              isSelected={!!selectedSessionId && child.id === splitSessionKey(selectedSessionId).sessionId}
              onSelect={() => onSelect({ ...child, serverId } as ApiSession & { serverId?: string })}
              onRename={newTitle => handleRename(child.id, newTitle)}
              onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: child.id })}
              preferTouchUi={preferTouchUi}
              density="minimal"
              showStats={false}
              showDirectory={false}
              isEditMode={isEditMode}
              isChecked={isChecked}
              checkedPrev={prevChecked}
              checkedNext={nextChecked}
              onToggleCheck={
                onToggleSessionSelection ? options => onToggleSessionSelection(child.id, options) : undefined
              }
            />
          )
        })
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
