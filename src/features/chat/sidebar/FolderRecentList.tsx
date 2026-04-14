import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiSession } from '../../../api'
import {
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GripVerticalIcon,
  SpinnerIcon,
  CheckIcon,
  ChevronDownIcon,
} from '../../../components/Icons'
import { ExpandableSection } from '../../../components/ui'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useDelayedRender, useSessions, useVcsInfo } from '../../../hooks'
import { useInputCapabilities } from '../../../hooks/useInputCapabilities'
import { useInView } from '../../../hooks/useInView'
import { getDirectoryName, isSameDirectory, normalizeToForwardSlash } from '../../../utils'
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
  memberDirectories?: string[]
  sectionKind?: 'project' | 'workspace'
}

interface FolderRecentListProps {
  projects: FolderRecentProject[]
  currentDirectory?: string
  selectedSessionId: string | null
  expandedProjectIds: string[]
  onExpandedProjectIdsChange: React.Dispatch<React.SetStateAction<string[]>>
  onSelectProject: (project: FolderRecentProject) => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onDeleteSession: (session: ApiSession) => Promise<void>
  onReorderProject: (draggedPath: string, targetPath: string) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  workspaceDirectoriesByProjectId?: Map<string, string[]>
  // ---- 编辑模式 ----
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  selectedProjectIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
  onToggleProjectSelection?: (projectId: string, options?: { shiftKey?: boolean }) => void
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

function matchesAnyDirectory(directory: string | undefined, candidates: string[]) {
  if (!directory) return false
  return candidates.some(candidate => isSameDirectory(candidate, directory))
}

function buildFolderStatus(
  directories: string[],
  busySessions: ReturnType<typeof useBusySessions>,
  notifications: ReturnType<typeof useNotifications>,
  t: ReturnType<typeof useTranslation>['t'],
): FolderStatus | null {
  const dirSessions = busySessions.filter(entry => matchesAnyDirectory(entry.directory, directories))

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
      return {
        dot: 'bg-warning-100',
        label: t('chat:activeSession.awaitingPermission'),
        pulse: false,
        count,
      }
    }
    if (hasQuestion) {
      return {
        dot: 'bg-info-100',
        label: t('chat:activeSession.awaitingAnswer'),
        pulse: false,
        count,
      }
    }
    if (hasRetry) {
      return {
        dot: 'bg-warning-100',
        label: t('chat:activeSession.retrying'),
        pulse: false,
        count,
      }
    }

    return {
      dot: 'bg-success-100',
      label: t('chat:activeSession.working'),
      pulse: true,
      count,
    }
  }

  const hasUnreadCompleted = notifications.some(
    notification =>
      notification.type === 'completed' &&
      !notification.read &&
      matchesAnyDirectory(notification.directory, directories),
  )

  if (hasUnreadCompleted) {
    return {
      dot: 'bg-accent-main-100',
      label: t('chat:notification.completed'),
      pulse: false,
    }
  }

  return null
}

function getInitialExpandedProjectIds(projects: FolderRecentProject[], currentDirectory?: string): string[] {
  if (projects.length === 0) return []

  const currentProject = currentDirectory
    ? projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    : undefined

  return [currentProject?.id || projects[0].id]
}

function areProjectIdListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function getCurrentProjectId(projects: FolderRecentProject[], currentDirectory?: string) {
  return currentDirectory
    ? projects.find(project => isSameDirectory(project.worktree, currentDirectory))?.id
    : undefined
}

function reconcileExpandedProjectIds(prev: string[], projects: FolderRecentProject[], currentDirectory?: string) {
  const next = prev.filter(id => projects.some(project => project.id === id))
  const fallback = next.length > 0 ? next : getInitialExpandedProjectIds(projects, currentDirectory)
  return areProjectIdListsEqual(fallback, prev) ? prev : fallback
}

function expandProjectId(prev: string[], projectId?: string) {
  if (!projectId || prev.includes(projectId)) return prev
  return [projectId, ...prev]
}

function toggleProjectId(prev: string[], projectId: string) {
  return prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId]
}

function createDirectoryProject(directory: string, sectionKind: FolderRecentProject['sectionKind'] = 'project') {
  return {
    id: directory,
    worktree: directory,
    name: getDirectoryName(directory) || directory,
    sectionKind,
  } satisfies FolderRecentProject
}

function useCollapseExpandedIdsOnDrag(
  expandedIds: string[],
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>,
) {
  const savedExpandedRef = useRef<string[] | null>(null)

  const handleDragActivated = useCallback(() => {
    savedExpandedRef.current = expandedIds
    setExpandedIds([])
  }, [expandedIds, setExpandedIds])

  const handleDragFinished = useCallback(() => {
    if (!savedExpandedRef.current) return
    setExpandedIds(savedExpandedRef.current)
    savedExpandedRef.current = null
  }, [setExpandedIds])

  return { handleDragActivated, handleDragFinished }
}

interface ReorderState {
  draggedId: string
  currentOrder: string[]
}

interface UseReorderableListOptions {
  ids: string[]
  canDrag: (id: string) => boolean
  onCommit: (draggedId: string, targetId: string) => void
  onDragActivated?: () => void
  onDragFinished?: () => void
}

function useReorderableList({ ids, canDrag, onCommit, onDragActivated, onDragFinished }: UseReorderableListOptions) {
  const refs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [dragState, setDragState] = useState<ReorderState | null>(null)
  const dragStartY = useRef(0)
  const dragActive = useRef(false)
  const latestOrderRef = useRef<string[]>([])
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMovedRef = useRef(false)
  const touchStartYRef = useRef(0)
  const touchDragIdRef = useRef<string | null>(null)

  const displayOrder = dragState?.currentOrder ?? ids
  const draggedId = dragState?.draggedId ?? null

  const calcNewOrder = useCallback((dragId: string, pointerY: number, baseOrder: string[]) => {
    const items: { id: string; centerY: number }[] = []

    for (const id of baseOrder) {
      if (id === dragId) continue
      const element = refs.current.get(id)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      items.push({ id, centerY: rect.top + rect.height / 2 })
    }

    let insertIndex = items.length
    for (let i = 0; i < items.length; i++) {
      if (pointerY < items[i].centerY) {
        insertIndex = i
        break
      }
    }

    const withoutDragged = items.map(item => item.id)
    withoutDragged.splice(insertIndex, 0, dragId)
    return withoutDragged
  }, [])

  const finishDrag = useCallback(
    (draggedId: string, originalOrder: string[]) => {
      const finalOrder = latestOrderRef.current
      const originalIdx = originalOrder.indexOf(draggedId)
      const newIdx = finalOrder.indexOf(draggedId)

      if (originalIdx !== -1 && newIdx !== -1 && originalIdx !== newIdx) {
        const targetId = originalOrder[newIdx]
        if (targetId) onCommit(draggedId, targetId)
      }

      setDragState(null)
      dragActive.current = false
      latestOrderRef.current = []
      onDragFinished?.()
    },
    [onCommit, onDragFinished],
  )

  const handlePointerStart = useCallback(
    (id: string, event: React.PointerEvent) => {
      if (!canDrag(id)) return

      event.preventDefault()
      event.stopPropagation()
      dragStartY.current = event.clientY
      dragActive.current = false

      const currentOrder = [...ids]

      const onMove = (moveEvent: PointerEvent) => {
        const dy = Math.abs(moveEvent.clientY - dragStartY.current)

        if (!dragActive.current) {
          if (dy < 4) return
          dragActive.current = true
          onDragActivated?.()
          document.body.style.cursor = 'grabbing'
          document.body.style.userSelect = 'none'
          setDragState({ draggedId: id, currentOrder })
        }

        const newOrder = calcNewOrder(id, moveEvent.clientY, currentOrder)
        latestOrderRef.current = newOrder
        setDragState(prev => (prev ? { ...prev, currentOrder: newOrder } : null))
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        if (dragActive.current) finishDrag(id, currentOrder)

        dragActive.current = false
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
    },
    [calcNewOrder, canDrag, finishDrag, ids, onDragActivated],
  )

  const handleTouchStart = useCallback(
    (id: string, event: React.TouchEvent) => {
      if (!canDrag(id)) return

      touchMovedRef.current = false
      touchStartYRef.current = event.touches[0].clientY
      touchDragIdRef.current = null

      longPressTimer.current = setTimeout(() => {
        if (!touchMovedRef.current) {
          touchDragIdRef.current = id
          dragActive.current = true
          onDragActivated?.()
          const currentOrder = [...ids]
          latestOrderRef.current = currentOrder
          setDragState({ draggedId: id, currentOrder })
        }
      }, 400)
    },
    [canDrag, ids, onDragActivated],
  )

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const dy = Math.abs(event.touches[0].clientY - touchStartYRef.current)
      if (dy > 8) touchMovedRef.current = true

      if (longPressTimer.current && touchMovedRef.current && !touchDragIdRef.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }

      if (!touchDragIdRef.current) return

      event.stopPropagation()
      const touchY = event.touches[0].clientY
      const currentOrder = [...ids]
      const newOrder = calcNewOrder(touchDragIdRef.current, touchY, currentOrder)
      latestOrderRef.current = newOrder
      setDragState(prev => (prev ? { ...prev, currentOrder: newOrder } : null))
    },
    [calcNewOrder, ids],
  )

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    const dragId = touchDragIdRef.current
    if (dragId) {
      finishDrag(dragId, [...ids])
    }

    touchDragIdRef.current = null
  }, [finishDrag, ids])

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  return {
    draggedId,
    isDragging: !!dragState,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef: (id: string, element: HTMLDivElement | null) => {
      if (element) refs.current.set(id, element)
      else refs.current.delete(id)
    },
  }
}

export function FolderRecentList({
  projects,
  currentDirectory,
  selectedSessionId,
  expandedProjectIds,
  onExpandedProjectIdsChange,
  onSelectProject,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onReorderProject,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  workspaceDirectoriesByProjectId,
  isEditMode = false,
  selectedSessionIds,
  selectedProjectIds,
  onToggleSessionSelection,
  onToggleProjectSelection,
}: FolderRecentListProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { preferTouchUi } = useInputCapabilities()
  const { sidebarFolderRecentsShowDiff } = useLayoutStore()
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteSession | null>(null)
  const allBusySessions = useBusySessions()
  const allNotifications = useNotifications()
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])
  const { handleDragActivated, handleDragFinished } = useCollapseExpandedIdsOnDrag(
    expandedProjectIds,
    onExpandedProjectIdsChange,
  )

  // 当 projects 列表变化时，过滤掉已不存在的展开项 + 确保当前目录对应的 project 展开
  useEffect(() => {
    onExpandedProjectIdsChange(prev => {
      const reconciled = reconcileExpandedProjectIds(prev, projects, currentDirectory)
      return expandProjectId(reconciled, getCurrentProjectId(projects, currentDirectory))
    })
  }, [projects, currentDirectory, onExpandedProjectIdsChange])

  const handleToggleProject = useCallback(
    (projectId: string) => onExpandedProjectIdsChange(prev => toggleProjectId(prev, projectId)),
    [onExpandedProjectIdsChange],
  )

  const {
    draggedId,
    isDragging,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  } = useReorderableList({
    ids: projects.map(project => project.id),
    canDrag: id => !!projectById.get(id)?.canReorder && !isEditMode,
    onCommit: (draggedId, targetId) => {
      const draggedProject = projectById.get(draggedId)
      const targetProject = projectById.get(targetId)
      if (!draggedProject?.canReorder || !targetProject?.canReorder) return
      onReorderProject(draggedProject.worktree, targetProject.worktree)
    },
    onDragActivated: handleDragActivated,
    onDragFinished: handleDragFinished,
  })

  const handleSelectDirectory = useCallback(
    (directory: string, sectionKind: FolderRecentProject['sectionKind'] = 'project') => {
      onSelectProject(createDirectoryProject(directory, sectionKind))
    },
    [onSelectProject],
  )

  const folderStatusByProjectId = useMemo(() => {
    const map = new Map<string, FolderStatus>()

    for (const project of projects) {
      const isProjectExpanded = !isDragging && expandedProjectIds.includes(project.id)
      if (isProjectExpanded) continue

      const statusDirectories = workspaceDirectoriesByProjectId?.get(project.id) ?? [project.worktree]
      const status = buildFolderStatus(statusDirectories, allBusySessions, allNotifications, t)
      if (status) map.set(project.id, status)
    }

    return map
  }, [projects, expandedProjectIds, isDragging, allBusySessions, allNotifications, t, workspaceDirectoriesByProjectId])

  const folderStatusByWorkspaceDirectory = useMemo(() => {
    const map = new Map<string, FolderStatus>()
    const workspaceDirectories = new Set<string>()

    workspaceDirectoriesByProjectId?.forEach(directories => {
      directories.forEach(directory => workspaceDirectories.add(directory))
    })

    for (const directory of workspaceDirectories) {
      const status = buildFolderStatus([directory], allBusySessions, allNotifications, t)
      if (status) map.set(directory, status)
    }

    return map
  }, [allBusySessions, allNotifications, t, workspaceDirectoriesByProjectId])

  return (
    <>
      <div className="h-full overflow-y-auto custom-scrollbar px-1.5 py-1 select-none">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-400 opacity-70">
            <p className="text-[length:var(--fs-sm)] font-medium text-text-300">{t('sidebar.noProjectFoldersYet')}</p>
            <p className="mt-1 text-[length:var(--fs-xs)] text-text-400/70">{t('sidebar.addProjectDesc')}</p>
          </div>
        ) : (
          <div onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            {displayOrder.map(projectId => {
              const project = projectById.get(projectId)
              if (!project) return null
              return (
                <FolderRecentSection
                  key={project.id}
                  project={project}
                  isExpanded={!isDragging && expandedProjectIds.includes(project.id)}
                  folderStatus={folderStatusByProjectId.get(project.id) ?? null}
                  preferTouchUi={preferTouchUi}
                  showSessionDiffStats={sidebarFolderRecentsShowDiff}
                  currentDirectory={currentDirectory}
                  selectedSessionId={selectedSessionId}
                  onSelectProject={() => handleSelectDirectory(project.worktree, project.sectionKind)}
                  onSelectDirectory={handleSelectDirectory}
                  onToggle={() => handleToggleProject(project.id)}
                  onSelectSession={onSelectSession}
                  onRenameSession={onRenameSession}
                  onRequestDeleteSession={setPendingDelete}
                  expandedChildSessionIds={expandedChildSessionIds}
                  inlineChildSessions={inlineChildSessions}
                  onSelectChildSession={onSelectChildSession}
                  workspaceDirectories={workspaceDirectoriesByProjectId?.get(project.id)}
                  workspaceFolderStatusByDirectory={folderStatusByWorkspaceDirectory}
                  draggableWorkspaceDirectories={project.memberDirectories}
                  onReorderWorkspace={onReorderProject}
                  sectionKind={project.sectionKind ?? 'project'}
                  // 拖拽
                  canDrag={!!project.canReorder && !isEditMode}
                  isDragged={draggedId === project.id}
                  onDragStart={e => handlePointerStart(project.id, e)}
                  onTouchDragStart={e => handleTouchStart(project.id, e)}
                  registerRef={el => registerRef(project.id, el)}
                  // 编辑模式
                  isEditMode={isEditMode}
                  isProjectChecked={selectedProjectIds?.has(project.id)}
                  onToggleProjectCheck={
                    onToggleProjectSelection ? options => onToggleProjectSelection(project.id, options) : undefined
                  }
                  selectedSessionIds={selectedSessionIds}
                  onToggleSessionSelection={onToggleSessionSelection}
                />
              )
            })}
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
  currentDirectory?: string
  selectedSessionId: string | null
  onSelectProject: () => void
  onSelectDirectory: (directory: string, sectionKind?: FolderRecentProject['sectionKind']) => void
  onToggle: () => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  workspaceDirectories?: string[]
  workspaceFolderStatusByDirectory?: Map<string, FolderStatus>
  draggableWorkspaceDirectories?: string[]
  onReorderWorkspace?: (draggedPath: string, targetPath: string) => void
  sectionKind?: 'project' | 'workspace'
  // 拖拽
  canDrag: boolean
  isDragged: boolean
  onDragStart: (e: React.PointerEvent) => void
  onTouchDragStart: (e: React.TouchEvent) => void
  registerRef: (el: HTMLDivElement | null) => void
  // ---- 编辑模式 ----
  isEditMode?: boolean
  showProjectCheckbox?: boolean
  isProjectChecked?: boolean
  onToggleProjectCheck?: (options?: { shiftKey?: boolean }) => void
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
}

function FolderRecentSection({
  project,
  isExpanded,
  folderStatus,
  preferTouchUi,
  showSessionDiffStats,
  currentDirectory,
  selectedSessionId,
  onSelectProject,
  onSelectDirectory,
  onToggle,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  workspaceDirectories = [],
  workspaceFolderStatusByDirectory,
  draggableWorkspaceDirectories,
  onReorderWorkspace,
  sectionKind = 'project',
  canDrag,
  isDragged,
  onDragStart,
  onTouchDragStart,
  registerRef,
  isEditMode = false,
  showProjectCheckbox = isEditMode,
  isProjectChecked = false,
  onToggleProjectCheck,
  selectedSessionIds,
  onToggleSessionSelection,
}: FolderRecentSectionProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { ref: inViewRef, inView } = useInView({ rootMargin: '200px 0px', triggerOnce: true })
  const [hasActivated, setHasActivated] = useState(false)
  const shouldRenderBody = useDelayedRender(isExpanded)
  const hasWorkspaceTree = workspaceDirectories.length > 0
  const workspaceFallbackName = getDirectoryName(project.worktree) || project.worktree
  const { vcsInfo, isLoading: isBranchLoading } = useVcsInfo(sectionKind === 'workspace' ? project.worktree : undefined)

  useEffect(() => {
    if (isExpanded && inView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 延迟加载闸门，只从 false→true
      setHasActivated(true)
    }
  }, [isExpanded, inView])

  const { sessions, isLoading, isLoadingMore, hasMore, loadMore, patchLocalSession, removeLocalSession } = useSessions({
    directory: project.worktree,
    pageSize: DIRECTORY_PAGE_SIZE,
    enabled: hasActivated && !hasWorkspaceTree,
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

  const handleProjectCheckClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleProjectCheck?.({ shiftKey: e.shiftKey })
  }

  const projectName =
    sectionKind === 'workspace'
      ? (vcsInfo?.branch ?? (isBranchLoading ? '...' : workspaceFallbackName))
      : project.name || workspaceFallbackName
  const FolderDisplayIcon = sectionKind === 'workspace' ? GitBranchIcon : isExpanded ? FolderOpenIcon : FolderIcon

  return (
    <div ref={inViewRef}>
      <div
        ref={registerRef}
        onTouchStart={canDrag ? onTouchDragStart : undefined}
        className={`relative transition-all duration-150 group/folder ${
          isDragged
            ? 'z-10 shadow-lg shadow-black/20 ring-1 ring-inset ring-accent-main-100/30 rounded-md bg-bg-100'
            : ''
        }`}
      >
        {/* 文件夹行 */}
        <div className="relative flex w-full items-center rounded-md hover:bg-bg-200/40 transition-colors duration-150 select-none">
          {/* 选中左侧色条 */}
          {showProjectCheckbox && isProjectChecked && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent-main-100" />
          )}
          {/* 编辑模式：项目 checkbox */}
          {showProjectCheckbox && (
            <button
              type="button"
              aria-pressed={isProjectChecked}
              data-compact
              data-selection-kind="project"
              data-selection-id={project.id}
              onMouseDown={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={handleProjectCheckClick}
              className={`shrink-0 flex items-center justify-center w-3.5 h-3.5 ml-2 rounded-full cursor-pointer transition-colors ${
                isProjectChecked ? 'bg-accent-main-100' : 'border border-text-500/50 hover:border-text-400'
              }`}
            >
              {isProjectChecked && <CheckIcon size={9} className="text-white" />}
            </button>
          )}
          <button
            onClick={() => {
              if (!isEditMode) onSelectProject()
              onToggle()
            }}
            className={`flex flex-1 min-w-0 items-center gap-1.5 ${showProjectCheckbox ? 'pl-1.5' : 'pl-2'} pr-2 py-1.5 text-left cursor-default select-none`}
            title={project.worktree}
          >
            <FolderDisplayIcon size={15} className="shrink-0 text-text-400" />
            <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium text-text-300">{projectName}</span>
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
          {/* 拖拽把手 — 默认 w-0 隐藏，hover 时 w-5 展开挤压圆点 */}
          {canDrag && (
            <span
              onPointerDown={onDragStart}
              className="shrink-0 flex items-center justify-center w-0 group-hover/folder:w-5 overflow-hidden cursor-grab active:cursor-grabbing text-text-500 opacity-0 group-hover/folder:opacity-60 hover:!opacity-100 transition-all duration-150 touch-none"
              title={t('sidebar.dragToReorder', { defaultValue: 'Drag to reorder' })}
            >
              <GripVerticalIcon size={12} />
            </span>
          )}
        </div>

        {/* Session 列表 */}
        <ExpandableSection show={isExpanded}>
          {shouldRenderBody && (
            <div onTouchStart={e => e.stopPropagation()}>
              {!hasActivated || (!hasWorkspaceTree && isLoading) ? (
                <div className="flex items-center px-2 py-1 text-[length:var(--fs-xs)] text-text-400/70">
                  <SpinnerIcon size={12} className="animate-spin" />
                </div>
              ) : hasWorkspaceTree ? (
                <WorkspaceFolderList
                  workspaceDirectories={workspaceDirectories}
                  currentDirectory={currentDirectory}
                  selectedSessionId={selectedSessionId}
                  preferTouchUi={preferTouchUi}
                  showSessionDiffStats={showSessionDiffStats}
                  onSelectDirectory={onSelectDirectory}
                  onSelectSession={onSelectSession}
                  onRenameSession={onRenameSession}
                  onRequestDeleteSession={onRequestDeleteSession}
                  expandedChildSessionIds={expandedChildSessionIds}
                  inlineChildSessions={inlineChildSessions}
                  onSelectChildSession={onSelectChildSession}
                  isEditMode={isEditMode}
                  selectedSessionIds={selectedSessionIds}
                  onToggleSessionSelection={onToggleSessionSelection}
                  folderStatusByWorkspaceDirectory={workspaceFolderStatusByDirectory}
                  draggableWorkspaceDirectories={draggableWorkspaceDirectories}
                  onReorderWorkspace={onReorderWorkspace}
                />
              ) : sessions.length === 0 ? (
                <div className="px-2 py-1 text-[length:var(--fs-xs)] text-text-400/50">{t('sidebar.noChatsInFolder')}</div>
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
                        isEditMode={isEditMode}
                        isChecked={selectedSessionIds?.has(session.id)}
                        onToggleCheck={
                          onToggleSessionSelection
                            ? options => onToggleSessionSelection(session.id, options)
                            : undefined
                        }
                      />
                      {onSelectChildSession &&
                        (expandedChildSessionIds?.has(session.id) || inlineChildSessions?.has(session.id)) && (
                          <SessionChildrenSlot
                            parentSession={session}
                            selectedSessionId={selectedSessionId}
                            fetchAll={expandedChildSessionIds?.has(session.id)}
                            children={inlineChildSessions?.get(session.id)}
                            onSelect={onSelectChildSession}
                            isEditMode={isEditMode}
                            selectedSessionIds={selectedSessionIds}
                            onToggleSessionSelection={onToggleSessionSelection}
                          />
                        )}
                    </div>
                  ))}

                  {hasMore && (
                    <button
                      onClick={() => void loadMore()}
                      disabled={isLoadingMore}
                      aria-busy={isLoadingMore}
                      aria-label={isLoadingMore ? t('common:loadingMore') : t('sidebar.showMoreChats')}
                      className="group w-full rounded-md px-2 py-1.5 text-[length:var(--fs-xs)] text-text-400/85 transition-colors hover:text-text-200 disabled:cursor-default disabled:opacity-70"
                    >
                      <span className="flex items-center justify-center">
                        <span className="relative inline-flex shrink-0 items-center gap-1.5 font-medium">
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute right-full top-1/2 mr-2 h-px w-6 -translate-y-1/2 bg-text-600/35 transition-colors group-hover:bg-text-500/55"
                          />
                          <span>{t('sidebar.showMoreChats')}</span>
                          {isLoadingMore ? (
                            <SpinnerIcon size={12} className="animate-spin text-text-400" />
                          ) : (
                            <ChevronDownIcon
                              size={12}
                              className="text-text-400/90 transition-colors group-hover:text-text-200"
                            />
                          )}
                        </span>
                      </span>
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

interface WorkspaceFolderListProps {
  workspaceDirectories: string[]
  currentDirectory?: string
  selectedSessionId: string | null
  preferTouchUi: boolean
  showSessionDiffStats: boolean
  onSelectDirectory: (directory: string, sectionKind?: FolderRecentProject['sectionKind']) => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onRequestDeleteSession: (pending: PendingDeleteSession) => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
  folderStatusByWorkspaceDirectory?: Map<string, FolderStatus>
  draggableWorkspaceDirectories?: string[]
  onReorderWorkspace?: (draggedPath: string, targetPath: string) => void
}

function WorkspaceFolderList({
  workspaceDirectories,
  currentDirectory,
  selectedSessionId,
  preferTouchUi,
  showSessionDiffStats,
  onSelectDirectory,
  onSelectSession,
  onRenameSession,
  onRequestDeleteSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  isEditMode = false,
  selectedSessionIds,
  onToggleSessionSelection,
  folderStatusByWorkspaceDirectory,
  draggableWorkspaceDirectories,
  onReorderWorkspace,
}: WorkspaceFolderListProps) {
  const workspaceProjects = useMemo<FolderRecentProject[]>(() => {
    const draggableSet = new Set(
      (draggableWorkspaceDirectories ?? []).map(directory => normalizeToForwardSlash(directory)),
    )

    return workspaceDirectories.map(directory => ({
      ...createDirectoryProject(directory, 'workspace'),
      canReorder: draggableSet.has(normalizeToForwardSlash(directory)),
    }))
  }, [draggableWorkspaceDirectories, workspaceDirectories])
  const workspaceById = useMemo(
    () => new Map(workspaceProjects.map(project => [project.id, project])),
    [workspaceProjects],
  )
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<string[]>(() =>
    getInitialExpandedProjectIds(workspaceProjects, currentDirectory),
  )
  const { handleDragActivated, handleDragFinished } = useCollapseExpandedIdsOnDrag(
    expandedWorkspaceIds,
    setExpandedWorkspaceIds,
  )

  useEffect(() => {
    setExpandedWorkspaceIds(prev => {
      const reconciled = reconcileExpandedProjectIds(prev, workspaceProjects, currentDirectory)
      return expandProjectId(reconciled, getCurrentProjectId(workspaceProjects, currentDirectory))
    })
  }, [workspaceProjects, currentDirectory])

  const handleToggleWorkspace = useCallback((workspaceId: string) => {
    setExpandedWorkspaceIds(prev => toggleProjectId(prev, workspaceId))
  }, [])

  const {
    draggedId,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  } = useReorderableList({
    ids: workspaceProjects.map(project => project.id),
    canDrag: id => !!workspaceById.get(id)?.canReorder && !isEditMode,
    onCommit: (draggedId, targetId) => {
      const draggedWorkspace = workspaceById.get(draggedId)
      const targetWorkspace = workspaceById.get(targetId)
      if (!draggedWorkspace || !targetWorkspace || !onReorderWorkspace) return
      onReorderWorkspace(draggedWorkspace.worktree, targetWorkspace.worktree)
    },
    onDragActivated: handleDragActivated,
    onDragFinished: handleDragFinished,
  })

  return (
    <div className="space-y-1 pt-1" onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {displayOrder.map(workspaceId => {
        const workspaceProject = workspaceById.get(workspaceId)
        if (!workspaceProject) return null
        const isWorkspaceExpanded = draggedId === null && expandedWorkspaceIds.includes(workspaceProject.id)

        return (
          <FolderRecentSection
            key={workspaceProject.id}
            project={workspaceProject}
            isExpanded={isWorkspaceExpanded}
            folderStatus={
              draggedId === workspaceProject.id || isWorkspaceExpanded
                ? null
                : (folderStatusByWorkspaceDirectory?.get(workspaceProject.worktree) ?? null)
            }
            preferTouchUi={preferTouchUi}
            showSessionDiffStats={showSessionDiffStats}
            currentDirectory={currentDirectory}
            selectedSessionId={selectedSessionId}
            onSelectProject={() => onSelectDirectory(workspaceProject.worktree, 'workspace')}
            onSelectDirectory={onSelectDirectory}
            onToggle={() => handleToggleWorkspace(workspaceProject.id)}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onRequestDeleteSession={onRequestDeleteSession}
            expandedChildSessionIds={expandedChildSessionIds}
            inlineChildSessions={inlineChildSessions}
            onSelectChildSession={onSelectChildSession}
            workspaceDirectories={[]}
            sectionKind="workspace"
            canDrag={!!workspaceProject.canReorder && !isEditMode}
            isDragged={draggedId === workspaceProject.id}
            onDragStart={event => handlePointerStart(workspaceProject.id, event)}
            onTouchDragStart={event => handleTouchStart(workspaceProject.id, event)}
            registerRef={element => registerRef(workspaceProject.id, element)}
            isEditMode={isEditMode}
            showProjectCheckbox={false}
            selectedSessionIds={selectedSessionIds}
            onToggleSessionSelection={onToggleSessionSelection}
          />
        )
      })}
    </div>
  )
}
