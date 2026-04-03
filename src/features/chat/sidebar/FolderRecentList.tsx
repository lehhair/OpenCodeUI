import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiSession } from '../../../api'
import { FolderIcon, FolderOpenIcon, SpinnerIcon } from '../../../components/Icons'
import { ExpandableSection } from '../../../components/ui'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useDelayedRender, useSessions } from '../../../hooks'
import { useInputCapabilities } from '../../../hooks/useInputCapabilities'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { useInView } from '../../../hooks/useInView'
import { getDirectoryName, isSameDirectory } from '../../../utils'
import { useLayoutStore } from '../../../store'
import { useBusySessions } from '../../../store/activeSessionStore'
import { useNotifications } from '../../../store/notificationStore'
import { SessionListItem } from '../../sessions'
import { SessionChildrenSlot } from './SessionChildrenSlot'

const DIRECTORY_PAGE_SIZE = 5

export interface FolderRecentProject {
  id: string
  name: string
  worktree: string
  canReorder?: boolean
}

interface FolderRecentListProps {
  projects: FolderRecentProject[]
  currentDirectory?: string
  selectedSessionId: string | null
  expandedProjectIds: string[]
  onExpandedProjectIdsChange: React.Dispatch<React.SetStateAction<string[]>>
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onDeleteSession: (session: ApiSession) => Promise<void>
  onReorderProject: (draggedPath: string, targetPath: string) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
}

interface PendingDeleteSession {
  session: ApiSession
  removeLocal: () => void
}

interface FolderStatus {
  dot: string
  label: string
  pulse: boolean
  count?: number
}

// 拖拽指示位置：上方 or 下方
type DropPosition = 'above' | 'below' | null

function getInitialExpandedProjectIds(projects: FolderRecentProject[], currentDirectory?: string): string[] {
  if (projects.length === 0) return []

  const currentProject = currentDirectory
    ? projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    : undefined

  return [currentProject?.id || projects[0].id]
}

export function FolderRecentList({
  projects,
  currentDirectory,
  selectedSessionId,
  expandedProjectIds,
  onExpandedProjectIdsChange,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onReorderProject,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
}: FolderRecentListProps) {
  const { t } = useTranslation(['chat', 'common'])
  const isMobile = useIsMobile()
  const { preferTouchUi } = useInputCapabilities()
  const { sidebarFolderRecentsShowDiff } = useLayoutStore()
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteSession | null>(null)
  const allBusySessions = useBusySessions()
  const allNotifications = useNotifications()

  // ---- 拖拽状态 ----
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition }>({ id: '', position: null })
  // ref 作为拖拽 id 的真相源，避免回调闭包 stale state
  const draggedIdRef = useRef<string | null>(null)
  // 拖拽开始前保存展开状态，结束后恢复
  const savedExpandedRef = useRef<string[] | null>(null)

  // ---- 移动端触摸拖拽 ----
  const [touchDragId, setTouchDragId] = useState<string | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMovedRef = useRef(false)
  const touchStartY = useRef(0)
  const folderRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // 当 projects 列表变化时，过滤掉已不存在的展开项
  useEffect(() => {
    onExpandedProjectIdsChange(prev => {
      const next = prev.filter(id => projects.some(project => project.id === id))
      const fallback = next.length > 0 ? next : getInitialExpandedProjectIds(projects, currentDirectory)
      if (fallback.length === prev.length && fallback.every((id, index) => id === prev[index])) {
        return prev
      }
      return fallback
    })
  }, [projects, currentDirectory, onExpandedProjectIdsChange])

  // 确保当前目录对应的 project 展开
  useEffect(() => {
    if (!currentDirectory) return
    const currentProject = projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    if (!currentProject) return

    onExpandedProjectIdsChange(prev => {
      if (prev.includes(currentProject.id)) return prev
      return [currentProject.id, ...prev]
    })
  }, [projects, currentDirectory, onExpandedProjectIdsChange])

  const handleToggleProject = useCallback(
    (projectId: string) => {
      onExpandedProjectIdsChange(prev =>
        prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId],
      )
    },
    [onExpandedProjectIdsChange],
  )

  // ============================================
  // 桌面端拖拽 (HTML5 Drag & Drop)
  // ============================================
  const startDrag = useCallback(
    (projectId: string) => {
      draggedIdRef.current = projectId
      setDraggedId(projectId)
      // 延迟一帧再收起文件夹，避免 dragstart 期间 DOM 变化导致浏览器取消拖拽
      requestAnimationFrame(() => {
        savedExpandedRef.current = expandedProjectIds
        onExpandedProjectIdsChange([])
      })
    },
    [expandedProjectIds, onExpandedProjectIdsChange],
  )

  const handleDragOver = useCallback((e: React.DragEvent, projectId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const currentDragged = draggedIdRef.current
    if (!currentDragged || projectId === currentDragged) {
      setDropTarget({ id: '', position: null })
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position: DropPosition = e.clientY < midY ? 'above' : 'below'
    setDropTarget({ id: projectId, position })
  }, [])

  const handleDragLeave = useCallback(() => {
    setDropTarget({ id: '', position: null })
  }, [])

  const finishDrag = useCallback(
    (targetProjectId: string) => {
      const currentDragged = draggedIdRef.current
      if (currentDragged && currentDragged !== targetProjectId) {
        const draggedProject = projects.find(p => p.id === currentDragged)
        const targetProject = projects.find(p => p.id === targetProjectId)
        if (draggedProject?.canReorder && targetProject?.canReorder) {
          onReorderProject(draggedProject.worktree, targetProject.worktree)
        }
      }
      // 恢复展开状态
      if (savedExpandedRef.current) {
        onExpandedProjectIdsChange(savedExpandedRef.current)
        savedExpandedRef.current = null
      }
      draggedIdRef.current = null
      setDraggedId(null)
      setDropTarget({ id: '', position: null })
    },
    [projects, onReorderProject, onExpandedProjectIdsChange],
  )

  const cancelDrag = useCallback(() => {
    if (savedExpandedRef.current) {
      onExpandedProjectIdsChange(savedExpandedRef.current)
      savedExpandedRef.current = null
    }
    draggedIdRef.current = null
    setDraggedId(null)
    setDropTarget({ id: '', position: null })
  }, [onExpandedProjectIdsChange])

  // ============================================
  // 移动端触摸拖拽
  // ============================================
  const touchDragIdRef = useRef<string | null>(null)

  const handleTouchStart = useCallback(
    (projectId: string, e: React.TouchEvent) => {
      const project = projects.find(p => p.id === projectId)
      if (!project?.canReorder) return

      touchMovedRef.current = false
      touchStartY.current = e.touches[0].clientY

      longPressTimer.current = setTimeout(() => {
        if (!touchMovedRef.current) {
          // 触发拖拽模式
          savedExpandedRef.current = expandedProjectIds
          onExpandedProjectIdsChange([])
          touchDragIdRef.current = projectId
          setTouchDragId(projectId)
        }
      }, 400)
    },
    [projects, expandedProjectIds, onExpandedProjectIdsChange],
  )

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current)
    if (dy > 8) touchMovedRef.current = true

    if (longPressTimer.current && touchMovedRef.current && !touchDragIdRef.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    if (!touchDragIdRef.current) return

    // 找到手指下方的文件夹
    const touchY = e.touches[0].clientY
    let foundTarget: { id: string; position: DropPosition } = { id: '', position: null }

    for (const [id, el] of folderRefs.current.entries()) {
      if (id === touchDragIdRef.current) continue
      const rect = el.getBoundingClientRect()
      if (touchY >= rect.top && touchY <= rect.bottom) {
        const midY = rect.top + rect.height / 2
        foundTarget = { id, position: touchY < midY ? 'above' : 'below' }
        break
      }
    }
    setDropTarget(foundTarget)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    const currentTouchDrag = touchDragIdRef.current
    if (currentTouchDrag) {
      // 读取最新的 dropTarget
      setDropTarget(prev => {
        if (prev.id && prev.id !== currentTouchDrag) {
          const draggedProject = projects.find(p => p.id === currentTouchDrag)
          const targetProject = projects.find(p => p.id === prev.id)
          if (draggedProject?.canReorder && targetProject?.canReorder) {
            onReorderProject(draggedProject.worktree, targetProject.worktree)
          }
        }
        return { id: '', position: null }
      })
    }

    // 恢复展开状态
    if (savedExpandedRef.current) {
      onExpandedProjectIdsChange(savedExpandedRef.current)
      savedExpandedRef.current = null
    }
    touchDragIdRef.current = null
    setTouchDragId(null)
  }, [projects, onReorderProject, onExpandedProjectIdsChange])

  // 清理长按定时器
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  const activeDragId = draggedId || touchDragId
  const isDragging = !!activeDragId

  const folderStatusByProjectId = useMemo(() => {
    const map = new Map<string, FolderStatus>()

    for (const project of projects) {
      const isProjectExpanded = !isDragging && expandedProjectIds.includes(project.id)
      if (isProjectExpanded) continue

      const dirSessions = allBusySessions.filter(entry => isSameDirectory(entry.directory, project.worktree))
      if (dirSessions.length > 0) {
        let hasPermission = false
        let hasQuestion = false
        let hasRetry = false

        for (const session of dirSessions) {
          if (session.pendingAction?.type === 'permission') hasPermission = true
          else if (session.pendingAction?.type === 'question') hasQuestion = true
          else if (session.status.type === 'retry') hasRetry = true
        }

        const count = dirSessions.length
        if (hasPermission) {
          map.set(project.id, {
            dot: 'bg-warning-100',
            label: t('chat:activeSession.awaitingPermission'),
            pulse: false,
            count,
          })
          continue
        }
        if (hasQuestion) {
          map.set(project.id, {
            dot: 'bg-info-100',
            label: t('chat:activeSession.awaitingAnswer'),
            pulse: false,
            count,
          })
          continue
        }
        if (hasRetry) {
          map.set(project.id, {
            dot: 'bg-warning-100',
            label: t('chat:activeSession.retrying'),
            pulse: false,
            count,
          })
          continue
        }

        map.set(project.id, {
          dot: 'bg-success-100',
          label: t('chat:activeSession.working'),
          pulse: true,
          count,
        })
        continue
      }

      const hasUnreadCompleted = allNotifications.some(
        notification =>
          notification.type === 'completed' &&
          !notification.read &&
          isSameDirectory(notification.directory, project.worktree),
      )

      if (hasUnreadCompleted) {
        map.set(project.id, {
          dot: 'bg-accent-main-100',
          label: t('chat:notification.completed'),
          pulse: false,
        })
      }
    }

    return map
  }, [projects, expandedProjectIds, isDragging, allBusySessions, allNotifications, t])

  return (
    <>
      <div className="h-full overflow-y-auto custom-scrollbar px-1.5 py-1">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-400 opacity-70">
            <p className="text-xs font-medium text-text-300">{t('sidebar.noProjectFoldersYet')}</p>
            <p className="mt-1 text-[11px] text-text-400/70">{t('sidebar.addProjectDesc')}</p>
          </div>
        ) : (
          <div onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            {projects.map(project => (
              <FolderRecentSection
                key={project.id}
                project={project}
                isExpanded={!isDragging && expandedProjectIds.includes(project.id)}
                folderStatus={folderStatusByProjectId.get(project.id) ?? null}
                preferTouchUi={preferTouchUi}
                showSessionDiffStats={sidebarFolderRecentsShowDiff}
                selectedSessionId={selectedSessionId}
                onToggle={() => handleToggleProject(project.id)}
                onSelectSession={onSelectSession}
                onRenameSession={onRenameSession}
                onRequestDeleteSession={setPendingDelete}
                expandedChildSessionIds={expandedChildSessionIds}
                inlineChildSessions={inlineChildSessions}
                onSelectChildSession={onSelectChildSession}
                // 桌面拖拽
                draggable={!!project.canReorder && !isMobile}
                isDragged={activeDragId === project.id}
                dropPosition={dropTarget.id === project.id && activeDragId !== project.id ? dropTarget.position : null}
                onDragStart={() => startDrag(project.id)}
                onDragOver={e => handleDragOver(e, project.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => finishDrag(project.id)}
                onDragEnd={cancelDrag}
                // 移动端拖拽
                isTouchDragging={touchDragId === project.id}
                onTouchDragStart={e => handleTouchStart(project.id, e)}
                registerRef={el => {
                  if (el) folderRefs.current.set(project.id, el)
                  else folderRefs.current.delete(project.id)
                }}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await onDeleteSession(pendingDelete.session)
            pendingDelete.removeLocal()
          }
          setPendingDelete(null)
        }}
        title={t('sidebar.deleteChat')}
        description={t('sidebar.deleteChatConfirm')}
        confirmText={t('common:delete')}
        variant="danger"
      />
    </>
  )
}

// ============================================
// Folder Section
// ============================================

interface FolderRecentSectionProps {
  project: FolderRecentProject
  isExpanded: boolean
  folderStatus: FolderStatus | null
  preferTouchUi: boolean
  showSessionDiffStats: boolean
  selectedSessionId: string | null
  onToggle: () => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  // 桌面拖拽
  draggable: boolean
  isDragged: boolean
  dropPosition: DropPosition
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
  // 移动端拖拽
  isTouchDragging: boolean
  onTouchDragStart: (e: React.TouchEvent) => void
  registerRef: (el: HTMLDivElement | null) => void
}

function FolderRecentSection({
  project,
  isExpanded,
  folderStatus,
  preferTouchUi,
  showSessionDiffStats,
  selectedSessionId,
  onToggle,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  draggable,
  isDragged,
  dropPosition,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isTouchDragging,
  onTouchDragStart,
  registerRef,
}: FolderRecentSectionProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { ref: inViewRef, inView } = useInView({ rootMargin: '200px 0px', triggerOnce: true })
  const [hasActivated, setHasActivated] = useState(false)
  const shouldRenderBody = useDelayedRender(isExpanded)

  useEffect(() => {
    if (isExpanded && inView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 延迟加载闸门，只从 false→true
      setHasActivated(true)
    }
  }, [isExpanded, inView])

  const { sessions, isLoading, isLoadingMore, hasMore, loadMore, patchLocalSession, removeLocalSession } = useSessions({
    directory: project.worktree,
    pageSize: DIRECTORY_PAGE_SIZE,
    enabled: hasActivated,
  })

  const handleRename = useCallback(
    async (sessionId: string, newTitle: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      await onRenameSession(session, newTitle)
      patchLocalSession(sessionId, { title: newTitle })
    },
    [sessions, onRenameSession, patchLocalSession],
  )

  const handleDelete = useCallback(
    (sessionId: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      onRequestDeleteSession({
        session,
        removeLocal: () => removeLocalSession(sessionId),
      })
    },
    [sessions, onRequestDeleteSession, removeLocalSession],
  )

  const projectName = project.name || getDirectoryName(project.worktree) || project.worktree
  const FolderDisplayIcon = isExpanded ? FolderOpenIcon : FolderIcon
  const isBeingDragged = isDragged || isTouchDragging

  return (
    <div ref={inViewRef}>
      <div
        ref={registerRef}
        draggable={draggable}
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', project.id)
          onDragStart()
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={e => {
          e.preventDefault()
          onDrop()
        }}
        onDragEnd={onDragEnd}
        onTouchStart={onTouchDragStart}
        className={`relative transition-all duration-150 ${isBeingDragged ? 'opacity-30 scale-95' : ''}`}
      >
        {/* 拖拽指示线 — 上方 */}
        <div
          className={`absolute left-2 right-2 top-0 h-0.5 rounded-full bg-accent-main-100 transition-opacity duration-100 ${
            dropPosition === 'above' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* 文件夹行 */}
        <button
          onClick={onToggle}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-bg-200/40 ${
            draggable || project.canReorder ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
          }`}
          title={project.worktree}
        >
          <FolderDisplayIcon size={15} className="shrink-0 text-text-400" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-300">{projectName}</span>
          {folderStatus && (
            <span
              className="relative shrink-0 flex items-center justify-center w-3 h-3"
              title={folderStatus.count ? `${folderStatus.label} (${folderStatus.count})` : folderStatus.label}
            >
              <span className={`absolute w-1.5 h-1.5 rounded-full ${folderStatus.dot}`} />
              {folderStatus.pulse && (
                <span className={`absolute w-1.5 h-1.5 rounded-full ${folderStatus.dot} animate-ping opacity-50`} />
              )}
            </span>
          )}
        </button>

        {/* 拖拽指示线 — 下方 */}
        <div
          className={`absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-accent-main-100 transition-opacity duration-100 ${
            dropPosition === 'below' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Session 列表 */}
        <ExpandableSection show={isExpanded}>
          {shouldRenderBody && (
            <div onTouchStart={e => e.stopPropagation()}>
              {!hasActivated || isLoading ? (
                <div className="flex items-center px-2 py-1 text-[11px] text-text-400/70">
                  <SpinnerIcon size={12} className="animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-text-400/50">{t('sidebar.noChatsInFolder')}</div>
              ) : (
                <>
                  {sessions.map(session => (
                    <div key={session.id}>
                      <SessionListItem
                        session={session}
                        isSelected={session.id === selectedSessionId}
                        onSelect={() => onSelectSession(session)}
                        onRename={newTitle => handleRename(session.id, newTitle)}
                        onDelete={() => handleDelete(session.id)}
                        preferTouchUi={preferTouchUi}
                        density="minimal"
                        showStats={showSessionDiffStats}
                        showDirectory={false}
                      />
                      {onSelectChildSession &&
                        (expandedChildSessionIds?.has(session.id) || inlineChildSessions?.has(session.id)) && (
                          <SessionChildrenSlot
                            parentSession={session}
                            selectedSessionId={selectedSessionId}
                            fetchAll={expandedChildSessionIds?.has(session.id)}
                            children={inlineChildSessions?.get(session.id)}
                            onSelect={onSelectChildSession}
                          />
                        )}
                    </div>
                  ))}

                  {hasMore && (
                    <button
                      onClick={() => void loadMore()}
                      disabled={isLoadingMore}
                      className="w-full rounded px-2 py-1 text-left text-[11px] text-text-500 transition-colors hover:text-text-300 disabled:cursor-default"
                    >
                      {isLoadingMore ? t('common:loadingMore') : t('sidebar.showMoreChats')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </ExpandableSection>
      </div>
    </div>
  )
}
