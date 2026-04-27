import { useCallback, useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SessionList } from '../../sessions'
import { FolderRecentList } from './FolderRecentList'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { ActiveSessionItem } from './ActiveSessionItem'
import { NotificationItem } from './NotificationItem'
import { SidebarFooter } from './SidebarFooter'
import { buildActiveSessionTree } from './activeSessionTree'
import { getParentPath } from './sidebarUtils'
import {
  SidebarIcon,
  FolderIcon,
  GlobeIcon,
  PlusIcon,
  TrashIcon,
  SearchIcon,
  ChevronDownIcon,
  PencilIcon,
  CheckIcon,
  CloseIcon,
  SpinnerIcon,
} from '../../../components/Icons'
import { useDirectory, useSessionStats, useKeybindingLabel, useGitWorkspaceCatalog, useVcsInfo } from '../../../hooks'
import { useSessionContext } from '../../../contexts/useSessionContext'
import { useLayoutStore, useMessageStore, childSessionStore } from '../../../store'
import { useBusySessions, useBusyCount } from '../../../store/activeSessionStore'
import { notificationStore, useNotifications, useUnreadNotificationCount } from '../../../store/notificationStore'
import type { NotificationEntry } from '../../../store/notificationStore'
import {
  updateSession,
  deleteSession as apiDeleteSession,
  getSession,
  subscribeToConnectionState,
  type ApiSession,
  type ConnectionInfo,
} from '../../../api'
import { getDirectoryName, isSameDirectory, normalizeToForwardSlash } from '../../../utils'
import { uiErrorHandler } from '../../../utils'

// 侧边栏设计模式：
// - 按钮结构统一，不因 expanded/collapsed 改变 DOM
// - 按钮内容使用 -translate-x-2 让图标在收起时居中
// - 文字用 opacity 过渡，不改变布局
// - 收起宽度 49px，展开宽度 288px

interface SidePanelProps {
  onNewSession: () => void
  onSelectSession: (session: ApiSession) => void
  onCloseMobile?: () => void
  selectedSessionId: string | null
  onAddProject: () => void
  isMobile?: boolean
  isExpanded?: boolean
  onToggleSidebar: () => void
  contextLimit?: number
  onOpenSettings?: () => void
}

interface ProjectItem {
  id: string
  worktree: string
  name: string
  canReorder?: boolean
  memberDirectories?: string[]
  reorderPath?: string
  workspaceDirectories?: string[]
  sectionKind?: 'project' | 'workspace'
}

function getSelectionRange(visibleIds: string[], anchorId: string, targetId: string) {
  const startIndex = visibleIds.indexOf(anchorId)
  const endIndex = visibleIds.indexOf(targetId)

  if (startIndex === -1 || endIndex === -1) return null

  const from = Math.min(startIndex, endIndex)
  const to = Math.max(startIndex, endIndex)
  return visibleIds.slice(from, to + 1)
}

function findProjectGroupForDirectory(projects: ProjectItem[], directory: string) {
  return projects.find(project => {
    if (isSameDirectory(project.id, directory) || isSameDirectory(project.worktree, directory)) {
      return true
    }

    if (project.workspaceDirectories?.some(workspace => isSameDirectory(workspace, directory))) {
      return true
    }

    if (project.memberDirectories?.some(memberDirectory => isSameDirectory(memberDirectory, directory))) {
      return true
    }

    return false
  })
}

export function SidePanel({
  onNewSession,
  onSelectSession,
  onCloseMobile,
  selectedSessionId,
  onAddProject,
  isMobile = false,
  isExpanded = true,
  onToggleSidebar,
  contextLimit = 200000,
  onOpenSettings,
}: SidePanelProps) {
  const { t } = useTranslation(['chat', 'common'])
  const {
    currentDirectory,
    savedDirectories,
    setCurrentDirectory,
    removeDirectory,
    addDirectory,
    reorderDirectories,
    recentProjects,
  } = useDirectory()
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
  const { catalog: gitWorkspaceCatalog, isLoading: isGitWorkspaceCatalogLoading } =
    useGitWorkspaceCatalog(catalogDirectories)
  const { vcsInfo: currentDirectoryVcsInfo, isLoading: isCurrentDirectoryVcsLoading } = useVcsInfo(currentDirectory)
  const { sidebarFolderRecents, sidebarShowChildSessions } = useLayoutStore()
  const normalizedCurrentDirectory = useMemo(
    () => (currentDirectory ? normalizeToForwardSlash(currentDirectory) : undefined),
    [currentDirectory],
  )
  const [connectionState, setConnectionState] = useState<ConnectionInfo | null>(null)
  const [projectDeleteConfirm, setProjectDeleteConfirm] = useState<{ isOpen: boolean; projectId: string | null }>({
    isOpen: false,
    projectId: null,
  })
  const [projectsExpanded, setProjectsExpanded] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'recents' | 'active'>('recents')
  const [expandedRecentProjectIds, setExpandedRecentProjectIds] = useState<string[]>([])

  // ---- 编辑模式状态 ----
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())
  const sessionSelectionAnchorIdRef = useRef<string | null>(null)
  const projectSelectionAnchorIdRef = useRef<string | null>(null)
  const recentsSelectionRootRef = useRef<HTMLDivElement>(null)
  // 批量删除确认弹窗
  const [batchDeleteSessionConfirm, setBatchDeleteSessionConfirm] = useState(false)
  const [batchRemoveProjectConfirm, setBatchRemoveProjectConfirm] = useState(false)
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)

  const getVisibleSelectionIds = useCallback((kind: 'session' | 'project') => {
    const root = recentsSelectionRootRef.current
    if (!root) return []

    return Array.from(root.querySelectorAll<HTMLElement>(`[data-selection-kind="${kind}"]`))
      .filter(element => element.getClientRects().length > 0)
      .map(element => element.dataset.selectionId)
      .filter((id): id is string => Boolean(id))
  }, [])

  const toggleSessionSelection = useCallback(
    (sessionId: string, options?: { shiftKey?: boolean }) => {
      const anchorId = sessionSelectionAnchorIdRef.current
      const visibleIds = getVisibleSelectionIds('session')

      setSelectedSessionIds(prev => {
        if (options?.shiftKey && anchorId) {
          const range = getSelectionRange(visibleIds, anchorId, sessionId)
          if (range) {
            const next = new Set(prev)
            for (const id of range) next.add(id)
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        return next
      })
      sessionSelectionAnchorIdRef.current = sessionId
    },
    [getVisibleSelectionIds],
  )

  const toggleProjectSelection = useCallback(
    (projectId: string, options?: { shiftKey?: boolean }) => {
      const anchorId = projectSelectionAnchorIdRef.current
      const visibleIds = getVisibleSelectionIds('project')

      setSelectedProjectIds(prev => {
        if (options?.shiftKey && anchorId) {
          const range = getSelectionRange(visibleIds, anchorId, projectId)
          if (range) {
            const next = new Set(prev)
            for (const id of range) next.add(id)
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      })
      projectSelectionAnchorIdRef.current = projectId
    },
    [getVisibleSelectionIds],
  )

  const exitEditMode = useCallback(() => {
    setIsEditMode(false)
    setSelectedSessionIds(new Set())
    setSelectedProjectIds(new Set())
    sessionSelectionAnchorIdRef.current = null
    projectSelectionAnchorIdRef.current = null
  }, [])

  const enterEditMode = useCallback(() => {
    setIsEditMode(true)
    sessionSelectionAnchorIdRef.current = null
    projectSelectionAnchorIdRef.current = null
  }, [])

  const showLabels = isExpanded || isMobile
  const newChatShortcut = useKeybindingLabel('newSession')

  // Session stats
  const { messages } = useMessageStore()
  const stats = useSessionStats(contextLimit)
  const hasMessages = messages.length > 0

  // Active sessions
  const busySessions = useBusySessions()
  const busyCount = useBusyCount()
  // Notification history
  const notifications = useNotifications()
  const unreadNotificationCount = useUnreadNotificationCount()
  const attentionCount = busyCount + unreadNotificationCount

  useEffect(() => {
    return subscribeToConnectionState(setConnectionState)
  }, [])

  const { sessions, isLoading, isLoadingMore, hasMore, search, setSearch, loadMore, deleteSession, refresh } =
    useSessionContext()

  // 缓存通过 API 拉取的 session 数据（sessions 列表中不存在的）
  const [fetchedSessions, setFetchedSessions] = useState<Record<string, ApiSession>>({})

  // 为 active sessions 构建 sessionId -> ApiSession 的查找表
  const sessionLookup = useMemo(() => {
    const map = new Map<string, ApiSession>()
    for (const s of sessions) {
      map.set(s.id, s)
    }
    // fetchedSessions 作为补充（其他项目的 session）
    for (const [id, s] of Object.entries(fetchedSessions)) {
      if (!map.has(id)) {
        map.set(id, s)
      }
    }
    return map
  }, [sessions, fetchedSessions])

  // 异步拉取不在 lookup 中的 active/notification/selected session
  useEffect(() => {
    const allNeeded = [
      ...busySessions.map(e => ({ sessionId: e.sessionId, directory: e.directory })),
      ...notifications.map(e => ({ sessionId: e.sessionId, directory: e.directory })),
    ]
    if (selectedSessionId && !sessionLookup.has(selectedSessionId)) {
      allNeeded.push({ sessionId: selectedSessionId, directory: currentDirectory || '' })
    }
    const missing = allNeeded.filter(entry => !sessionLookup.has(entry.sessionId))
    if (missing.length === 0) return

    let cancelled = false
    const fetchMissing = async () => {
      const results: Record<string, ApiSession> = {}
      await Promise.allSettled(
        missing.map(async entry => {
          try {
            const session = await getSession(entry.sessionId, entry.directory)
            if (!cancelled) results[session.id] = session
          } catch {
            /* ignore */
          }
        }),
      )
      if (!cancelled && Object.keys(results).length > 0) {
        setFetchedSessions(prev => ({ ...prev, ...results }))
      }
    }
    fetchMissing()
    return () => {
      cancelled = true
    }
  }, [busySessions, notifications, sessionLookup, selectedSessionId, currentDirectory])

  // ---- 子 session 展示数据 ----
  const rootSessionIds = useMemo(() => new Set(sessions.map(s => s.id)), [sessions])

  const findParentId = useCallback(
    (id: string) => {
      const s = sessionLookup.get(id)
      if (s?.parentID) return s.parentID
      return childSessionStore.getSessionInfo(id)?.parentID
    },
    [sessionLookup],
  )

  // 开关开 → 拉 /children 全量：选中的 root 或选中子 session 时保持其父展开
  const expandedChildSessionIds = useMemo(() => {
    if (search || !sidebarShowChildSessions || !selectedSessionId) return undefined
    if (rootSessionIds.has(selectedSessionId)) return new Set([selectedSessionId])
    const pid = findParentId(selectedSessionId)
    if (pid && rootSessionIds.has(pid)) return new Set([pid])
    return undefined
  }, [search, sidebarShowChildSessions, selectedSessionId, rootSessionIds, findParentId])

  // 开关关 → 只挂活跃的 + 选中的子 session
  const inlineChildSessions = useMemo(() => {
    if (search) return undefined
    const map = new Map<string, ApiSession[]>()
    const add = (parentId: string, session: ApiSession) => {
      if (expandedChildSessionIds?.has(parentId)) return
      let arr = map.get(parentId)
      if (!arr) {
        arr = []
        map.set(parentId, arr)
      }
      if (!arr.some(s => s.id === session.id)) arr.push(session)
    }
    for (const entry of busySessions) {
      const pid = findParentId(entry.sessionId)
      if (pid && rootSessionIds.has(pid)) {
        const s = sessionLookup.get(entry.sessionId)
        if (s) add(pid, s)
      }
    }
    if (!sidebarShowChildSessions && selectedSessionId && !rootSessionIds.has(selectedSessionId)) {
      const pid = findParentId(selectedSessionId)
      if (pid && rootSessionIds.has(pid)) {
        const s = sessionLookup.get(selectedSessionId)
        if (s) add(pid, s)
      }
    }
    return map.size > 0 ? map : undefined
  }, [
    search,
    busySessions,
    selectedSessionId,
    sidebarShowChildSessions,
    rootSessionIds,
    expandedChildSessionIds,
    sessionLookup,
    findParentId,
  ])

  const activeSessionTree = useMemo(
    () => buildActiveSessionTree(busySessions, findParentId),
    [busySessions, findParentId],
  )

  const buildProjectGroups = useCallback(
    (directories: typeof savedDirectories): ProjectItem[] => {
      const savedNameByPath = new Map(
        directories.map(directory => [normalizeToForwardSlash(directory.path), directory.name]),
      )
      const groups = new Map<string, ProjectItem>()

      for (const directory of directories) {
        const normalizedDirectory = normalizeToForwardSlash(directory.path)
        const meta = gitWorkspaceCatalog.get(normalizedDirectory)
        const projectId = meta?.isGit ? meta.rootDirectory : normalizedDirectory
        const existing = groups.get(projectId)

        if (existing) {
          groups.set(projectId, {
            ...existing,
            memberDirectories: [...(existing.memberDirectories ?? []), directory.path],
            reorderPath: existing.reorderPath ?? directory.path,
          })
          continue
        }

        groups.set(projectId, {
          id: projectId,
          worktree: projectId,
          name: savedNameByPath.get(projectId) ?? getDirectoryName(projectId),
          canReorder: true,
          memberDirectories: [directory.path],
          reorderPath: directory.path,
          workspaceDirectories: meta?.isGit ? meta.workspaces : undefined,
        })
      }

      return Array.from(groups.values()).map(project => {
        if (!project.workspaceDirectories?.length) return project

        const savedWorkspaceDirectories = (project.memberDirectories ?? [])
          .map(directory => normalizeToForwardSlash(directory))
          .filter(directory => project.workspaceDirectories?.some(workspace => isSameDirectory(workspace, directory)))

        const remainingWorkspaceDirectories = project.workspaceDirectories.filter(
          workspace => !savedWorkspaceDirectories.some(directory => isSameDirectory(directory, workspace)),
        )

        return {
          ...project,
          workspaceDirectories: [...savedWorkspaceDirectories, ...remainingWorkspaceDirectories],
        }
      })
    },
    [gitWorkspaceCatalog],
  )

  const folderProjectGroups = useMemo<ProjectItem[]>(() => {
    return buildProjectGroups(savedDirectories)
  }, [buildProjectGroups, savedDirectories])

  const selectorProjectGroups = useMemo<ProjectItem[]>(() => {
    const sortedDirectories = [...savedDirectories].sort((a, b) => {
      const aTime = recentProjects[a.path] || a.addedAt
      const bTime = recentProjects[b.path] || b.addedAt
      return bTime - aTime
    })

    return buildProjectGroups(sortedDirectories)
  }, [buildProjectGroups, recentProjects, savedDirectories])

  const globalProject = useMemo<ProjectItem>(
    () => ({
      id: 'global',
      worktree: t('sidebar.allProjects'),
      name: t('sidebar.global'),
    }),
    [t],
  )

  const projects = useMemo<ProjectItem[]>(() => {
    return [globalProject, ...selectorProjectGroups]
  }, [globalProject, selectorProjectGroups])

  const currentProject = useMemo<ProjectItem>(() => {
    if (!currentDirectory) return globalProject

    const groupedProject = findProjectGroupForDirectory(folderProjectGroups, normalizedCurrentDirectory!)
    if (groupedProject) return groupedProject

    const meta = gitWorkspaceCatalog.get(normalizedCurrentDirectory!)
    const projectId = meta?.isGit ? meta.rootDirectory : normalizedCurrentDirectory!
    const found = findProjectGroupForDirectory(folderProjectGroups, projectId)
    if (found) return found

    return {
      id: projectId,
      worktree: projectId,
      name: getDirectoryName(projectId),
      canReorder: false,
      memberDirectories: [],
      workspaceDirectories: meta?.isGit ? meta.workspaces : undefined,
    }
  }, [currentDirectory, folderProjectGroups, gitWorkspaceCatalog, globalProject, normalizedCurrentDirectory])

  const currentProjectLabel = useMemo(() => {
    const baseLabel = currentProject?.name || t('sidebar.global')
    if (!currentDirectory || currentProject?.id === 'global') return baseLabel

    const branchLabel = currentDirectoryVcsInfo?.branch ?? (isCurrentDirectoryVcsLoading ? '...' : undefined)
    return branchLabel ? `${baseLabel} · ${branchLabel}` : baseLabel
  }, [
    currentDirectory,
    currentDirectoryVcsInfo?.branch,
    currentProject?.id,
    currentProject?.name,
    isCurrentDirectoryVcsLoading,
    t,
  ])

  const folderProjects = useMemo<ProjectItem[]>(() => {
    const list = [...folderProjectGroups]

    if (currentDirectory && !list.some(project => isSameDirectory(project.worktree, currentProject.worktree))) {
      list.push({ ...currentProject, canReorder: false })
    }

    return list
  }, [folderProjectGroups, currentDirectory, currentProject])

  const workspaceDirectoriesByProjectId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const project of folderProjects) {
      if (project.workspaceDirectories && project.workspaceDirectories.length > 1) {
        map.set(project.id, project.workspaceDirectories)
      }
    }
    return map
  }, [folderProjects])

  const currentProjectWorkspaceDirectories = useMemo(
    () => currentProject.workspaceDirectories ?? [],
    [currentProject.workspaceDirectories],
  )
  const shouldRenderWorkspaceTreeOnly =
    !search && currentProjectWorkspaceDirectories.length > 1 && currentProject.id !== 'global'
  const shouldWaitForWorkspaceResolution =
    !sidebarFolderRecents &&
    !search &&
    !!currentDirectory &&
    isGitWorkspaceCatalogLoading &&
    currentProjectWorkspaceDirectories.length <= 1 &&
    !!normalizedCurrentDirectory &&
    !gitWorkspaceCatalog.has(normalizedCurrentDirectory)

  const currentProjectTreeProjects = useMemo<ProjectItem[]>(() => {
    if (!shouldRenderWorkspaceTreeOnly || currentProject.id === 'global') return []

    const draggableWorkspaceSet = new Set(
      (currentProject.memberDirectories ?? []).map(directory => normalizeToForwardSlash(directory)),
    )

    return currentProjectWorkspaceDirectories.map(workspaceDirectory => {
      const isSavedWorkspace = draggableWorkspaceSet.has(normalizeToForwardSlash(workspaceDirectory))

      return {
        id: workspaceDirectory,
        worktree: workspaceDirectory,
        name: getDirectoryName(workspaceDirectory),
        canReorder: isSavedWorkspace,
        memberDirectories: isSavedWorkspace ? [workspaceDirectory] : [],
        reorderPath: isSavedWorkspace ? workspaceDirectory : undefined,
        sectionKind: 'workspace' as const,
      }
    })
  }, [currentProject, currentProjectWorkspaceDirectories, shouldRenderWorkspaceTreeOnly])

  const allDisplayedProjects = useMemo(() => {
    return [...folderProjects, ...currentProjectTreeProjects]
  }, [folderProjects, currentProjectTreeProjects])

  const handleSelectFolderProject = useCallback(
    (project: ProjectItem) => {
      if (currentDirectory && isSameDirectory(currentDirectory, project.worktree)) return
      setCurrentDirectory(project.worktree)
    },
    [currentDirectory, setCurrentDirectory],
  )

  const getProjectDirectoriesToRemove = useCallback(
    (projectId: string) => {
      const project = allDisplayedProjects.find(item => isSameDirectory(item.id, projectId))
      return project?.memberDirectories?.length ? project.memberDirectories : [projectId]
    },
    [allDisplayedProjects],
  )

  const handleSelectProject = useCallback(
    (projectId: string) => {
      if (projectId === 'global') {
        setCurrentDirectory(undefined)
      } else {
        setCurrentDirectory(projectId)
      }
      setProjectsExpanded(false)
    },
    [setCurrentDirectory],
  )

  const handleRemoveProject = useCallback(
    (projectId: string) => {
      getProjectDirectoriesToRemove(projectId).forEach(directory => removeDirectory(directory))
    },
    [getProjectDirectoriesToRemove, removeDirectory],
  )

  const handleReorderProjectGroup = useCallback(
    (draggedPath: string, targetPath: string) => {
      const draggedProject = folderProjects.find(project => isSameDirectory(project.id, draggedPath))
      const targetProject = folderProjects.find(project => isSameDirectory(project.id, targetPath))
      const draggedReorderPath = draggedProject?.reorderPath
      const targetReorderPath = targetProject?.reorderPath
      if (!draggedReorderPath || !targetReorderPath) return
      reorderDirectories(draggedReorderPath, targetReorderPath)
    },
    [folderProjects, reorderDirectories],
  )

  const handleSelect = useCallback(
    (session: ApiSession) => {
      // Global 模式下，点击 session 自动切换到该 session 的工作目录并添加到项目列表
      if (!currentDirectory && session.directory) {
        addDirectory(session.directory)
      }
      onSelectSession(session)
      if (window.innerWidth < 768 && onCloseMobile) {
        onCloseMobile()
      }
    },
    [currentDirectory, addDirectory, onSelectSession, onCloseMobile],
  )

  // Active tab 专用：跨目录的 session 需要确保目录在项目列表中
  const handleSelectActive = useCallback(
    (session: ApiSession) => {
      if (session.directory) {
        addDirectory(session.directory)
      }
      onSelectSession(session)
      if (window.innerWidth < 768 && onCloseMobile) {
        onCloseMobile()
      }
    },
    [addDirectory, onSelectSession, onCloseMobile],
  )

  const renderActiveSessionNode = useCallback(
    function renderActiveSessionNode(entry: (typeof busySessions)[number], level = 0): ReactNode {
      const resolvedSession = sessionLookup.get(entry.sessionId)
      const childEntries = activeSessionTree.childrenByParent.get(entry.sessionId) ?? []

      return (
        <div key={entry.sessionId} style={level > 0 ? { marginLeft: level * 12 } : undefined}>
          <ActiveSessionItem
            entry={entry}
            resolvedSession={resolvedSession}
            isSelected={entry.sessionId === selectedSessionId}
            onSelect={handleSelectActive}
          />
          {childEntries.map(childEntry => renderActiveSessionNode(childEntry, level + 1))}
        </div>
      )
    },
    [activeSessionTree.childrenByParent, handleSelectActive, selectedSessionId, sessionLookup],
  )

  const handleRename = useCallback(
    async (sessionId: string, newTitle: string) => {
      try {
        await updateSession(sessionId, { title: newTitle }, currentDirectory)
        refresh()
      } catch (e) {
        uiErrorHandler('rename session', e)
      }
    },
    [currentDirectory, refresh],
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId)

      if (selectedSessionId === sessionId) {
        onNewSession()
      }
    },
    [deleteSession, onNewSession, selectedSessionId],
  )

  const handleRenameFolderSession = useCallback(
    async (session: ApiSession, newTitle: string) => {
      try {
        await updateSession(session.id, { title: newTitle }, session.directory)
        if (!currentDirectory || isSameDirectory(currentDirectory, session.directory)) {
          await refresh()
        }
      } catch (e) {
        uiErrorHandler('rename session', e)
      }
    },
    [currentDirectory, refresh],
  )

  const handleDeleteFolderSession = useCallback(
    async (session: ApiSession) => {
      await apiDeleteSession(session.id, session.directory)

      if (!currentDirectory || isSameDirectory(currentDirectory, session.directory)) {
        await refresh()
      }

      if (selectedSessionId === session.id) {
        onNewSession()
      }
    },
    [currentDirectory, onNewSession, refresh, selectedSessionId],
  )

  // ---- 批量删除 session ----
  const handleBatchDeleteSessions = useCallback(async () => {
    if (selectedSessionIds.size === 0) return
    setIsBatchDeleting(true)

    const needSwitchSession = selectedSessionId && selectedSessionIds.has(selectedSessionId)

    // 文件夹模式下可能跨目录，需要按 session 逐个调用
    // 普通模式下也用 sessionLookup 获取目录信息
    const ids = Array.from(selectedSessionIds)
    await Promise.allSettled(
      ids.map(async id => {
        try {
          const s = sessionLookup.get(id)
          if (s) {
            await apiDeleteSession(id, s.directory)
          } else {
            await apiDeleteSession(id, currentDirectory)
          }
        } catch (e) {
          uiErrorHandler('batch delete session', e)
        }
      }),
    )

    await refresh()
    setSelectedSessionIds(new Set())
    sessionSelectionAnchorIdRef.current = null
    setBatchDeleteSessionConfirm(false)
    setIsBatchDeleting(false)

    if (needSwitchSession) {
      onNewSession()
    }
  }, [selectedSessionIds, selectedSessionId, sessionLookup, currentDirectory, refresh, onNewSession])

  // ---- 批量移除项目 ----
  const handleBatchRemoveProjects = useCallback(() => {
    if (selectedProjectIds.size === 0) return
    for (const projectId of selectedProjectIds) {
      getProjectDirectoriesToRemove(projectId).forEach(directory => removeDirectory(directory))
    }
    setSelectedProjectIds(new Set())
    projectSelectionAnchorIdRef.current = null
    setBatchRemoveProjectConfirm(false)
  }, [getProjectDirectoriesToRemove, selectedProjectIds, removeDirectory])

  const commonFolderRecentListProps = {
    currentDirectory,
    selectedSessionId,
    expandedProjectIds: expandedRecentProjectIds,
    onExpandedProjectIdsChange: setExpandedRecentProjectIds,
    onSelectProject: handleSelectFolderProject,
    onSelectSession: handleSelectActive,
    onRenameSession: handleRenameFolderSession,
    onDeleteSession: handleDeleteFolderSession,
    expandedChildSessionIds,
    inlineChildSessions,
    onSelectChildSession: handleSelectActive,
    isEditMode,
    selectedSessionIds,
    selectedProjectIds,
    onToggleSessionSelection: toggleSessionSelection,
    onToggleProjectSelection: toggleProjectSelection,
  }

  useEffect(() => {
    let frameId: number | null = null

    if (!isExpanded) {
      frameId = requestAnimationFrame(() => {
        setProjectsExpanded(false)
      })
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [isExpanded])

  // 统一的结构，通过 CSS 控制显示/隐藏
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ===== Header ===== */}
      <div className="h-14 shrink-0 flex items-center">
        {/* Logo 区域 - 展开时显示 */}
        <div
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{
            width: showLabels ? 'auto' : 0,
            paddingLeft: showLabels ? 16 : 0,
            opacity: showLabels ? 1 : 0,
          }}
        >
          <a href="/" className="flex items-center whitespace-nowrap">
            <span className="text-[length:var(--fs-heading-3)] font-semibold text-text-100 tracking-tight">
              {t('header.openCode')}
            </span>
          </a>
        </div>

        {/* Toggle Button - 桌面端和移动端都显示 */}
        <div
          className="flex-1 flex items-center transition-all duration-300 ease-out"
          style={{ justifyContent: showLabels ? 'flex-end' : 'center', paddingRight: showLabels ? 8 : 0 }}
        >
          <button
            onClick={onToggleSidebar}
            aria-label={isExpanded ? t('sidebar.collapseSidebar') : t('sidebar.expandSidebar')}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-text-400 hover:text-text-100 hover:bg-bg-200 active:scale-[0.98] transition-all duration-200"
          >
            <SidebarIcon size={18} />
          </button>
        </div>
      </div>

      {/* ===== Navigation - 图标位置固定 ===== */}
      <div className="flex flex-col gap-0.5 mx-2">
        {/* New Chat - 图标始终在 padding-left: 6px 位置，收起时刚好居中 */}
        <button
          type="button"
          onClick={onNewSession}
          aria-label={t('sidebar.newChat')}
          className="h-8 flex items-center rounded-lg text-text-300 hover:text-text-100 hover:bg-bg-200 active:scale-[0.98] transition-all duration-300 group overflow-hidden"
          style={{
            width: showLabels ? '100%' : 32,
            paddingLeft: 6,
            paddingRight: 6,
          }}
          title={t('sidebar.newChat')}
        >
          <span className="size-5 flex items-center justify-center shrink-0">
            <PlusIcon size={16} />
          </span>
          <span
            className="ml-2 text-[length:var(--fs-base)] whitespace-nowrap transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            {t('sidebar.newChat')}
          </span>
          <span
            className="ml-auto text-[length:var(--fs-xxs)] text-text-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
            style={{ opacity: showLabels ? undefined : 0 }}
          >
            {newChatShortcut}
          </span>
        </button>

        {/* Project Selector - 只在展开时显示 */}
        {showLabels && (
          <button
            type="button"
            onClick={() => setProjectsExpanded(!projectsExpanded)}
            aria-expanded={projectsExpanded}
            className={`h-8 flex items-center rounded-lg active:scale-[0.98] transition-all duration-300 overflow-hidden ${
              projectsExpanded ? 'bg-bg-200 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200'
            }`}
            style={{ paddingLeft: 6, paddingRight: 6 }}
            title={currentProjectLabel}
          >
            <span className="size-5 flex items-center justify-center shrink-0">
              {currentProject?.id === 'global' ? (
                <GlobeIcon size={16} className="text-accent-main-100" />
              ) : (
                <FolderIcon size={16} />
              )}
            </span>
            <div className="ml-2 min-w-0 flex-1 text-left text-[length:var(--fs-base)]">
              <div
                className="block overflow-hidden whitespace-nowrap text-left"
                style={{
                  WebkitMaskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
                  maskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
                }}
              >
                {currentProjectLabel}
              </div>
            </div>
            <ChevronDownIcon
              size={14}
              className={`ml-auto text-text-400 transition-transform duration-200 shrink-0 ${projectsExpanded ? '' : '-rotate-90'}`}
            />
          </button>
        )}

        {/* Projects Dropdown */}
        <div
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: showLabels && projectsExpanded ? 300 : 0,
            opacity: showLabels && projectsExpanded ? 1 : 0,
            marginTop: showLabels && projectsExpanded ? 4 : 0,
            visibility: showLabels && projectsExpanded ? 'visible' : 'hidden',
            pointerEvents: showLabels && projectsExpanded ? 'auto' : 'none',
          }}
          aria-hidden={!showLabels || !projectsExpanded}
        >
          <div className="rounded-lg border border-border-200/50 bg-bg-100/80 overflow-hidden">
            <div className="max-h-48 overflow-y-auto custom-scrollbar py-1">
              {projects.map(project => {
                const isGlobal = project.id === 'global'
                const isActive = currentProject?.id === project.id
                const itemLabel =
                  isActive && !isGlobal
                    ? currentProjectLabel
                    : project.name || (isGlobal ? t('sidebar.global') : project.worktree)
                return (
                  <div
                    key={project.id}
                    className={`group w-full flex items-center gap-2 px-2 py-1.5 transition-colors ${
                      isActive ? 'bg-bg-200/60 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectProject(project.id)}
                      aria-current={isActive ? 'true' : undefined}
                      className="min-w-0 flex flex-1 items-center gap-2 text-left bg-transparent border-none p-0"
                      title={project.worktree}
                    >
                      <span className="w-5 h-5 flex items-center justify-center shrink-0">
                        {isGlobal ? <GlobeIcon size={14} className="text-accent-main-100" /> : <FolderIcon size={14} />}
                      </span>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-left text-[length:var(--fs-sm)]">
                          <div
                            className="overflow-hidden whitespace-nowrap text-left"
                            style={{
                              WebkitMaskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
                              maskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
                            }}
                          >
                            {itemLabel}
                          </div>
                        </div>
                        {!isGlobal && project.worktree && (
                          <div className="text-[length:var(--fs-xxs)] text-text-400 truncate font-mono opacity-70">
                            {getParentPath(project.worktree)}
                          </div>
                        )}
                      </div>
                    </button>
                    {!isGlobal && (
                      <button
                        type="button"
                        onClick={() => {
                          setProjectDeleteConfirm({ isOpen: true, projectId: project.id })
                        }}
                        aria-label={t('sidebar.removeProject')}
                        className="p-1 rounded text-text-400 hover:text-danger-100 hover:bg-danger-100/10 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition-all"
                        title={t('common:remove')}
                      >
                        <TrashIcon size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="border-t border-border-200/50 p-1">
              <button
                type="button"
                onClick={onAddProject}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[length:var(--fs-sm)] text-text-400 hover:text-text-100 hover:bg-bg-200/50 transition-colors"
              >
                <PlusIcon size={14} />
                {t('sidebar.addProject')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Main Content ===== */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden transition-all duration-300 ease-out"
        style={{
          opacity: showLabels ? 1 : 0,
          visibility: showLabels ? 'visible' : 'hidden',
        }}
      >
        {/* Search */}
        <div className="px-3 py-2 mt-2">
          <div className="relative group">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors" />
            <input
              type="text"
              name="sidebar-chat-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('sidebar.searchChats')}
              aria-label={t('sidebar.searchChats')}
              autoComplete="off"
              className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-1.5 pl-[30px] pr-8 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-400 hover:text-text-100 text-[length:var(--fs-base)]"
                aria-label={t('sidebar.clearSearch')}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Tab Bar: Recents / Active */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center mx-2 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSidebarTab('recents')
                if (sidebarTab !== 'recents') exitEditMode()
              }}
              className={`pl-[6px] pr-2 py-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider transition-colors duration-150 ${
                sidebarTab === 'recents' ? 'text-text-100' : 'text-text-500 hover:text-text-300'
              }`}
            >
              {t('sidebar.recents')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSidebarTab('active')
                exitEditMode()
              }}
              className={`pl-[6px] pr-2 py-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider transition-colors duration-150 flex items-center gap-1 ${
                sidebarTab === 'active' ? 'text-text-100' : 'text-text-500 hover:text-text-300'
              }`}
            >
              <span className="inline-flex h-4 items-center leading-none">{t('sidebar.active')}</span>
              {attentionCount > 0 && (
                <span
                  className={`inline-flex h-[15px] min-w-[15px] shrink-0 items-center justify-center self-center rounded-full px-1 text-[length:var(--fs-xxs)] font-medium leading-none transition-colors ${
                    attentionCount > busyCount
                      ? 'bg-accent-main-100/10 text-accent-main-100'
                      : 'bg-success-100/10 text-success-100'
                  }`}
                >
                  {attentionCount}
                </span>
              )}
            </button>
            {/* 编辑按钮 — 只在 Recents tab 显示 */}
            {sidebarTab === 'recents' && (
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={isEditMode ? exitEditMode : enterEditMode}
                aria-label={isEditMode ? t('common:done') : t('common:edit')}
                className={`ml-auto p-1 rounded-md transition-colors duration-150 ${
                  isEditMode
                    ? 'text-accent-main-100 hover:bg-accent-main-100/10'
                    : 'text-text-500 hover:text-text-300 hover:bg-bg-200/50'
                }`}
                title={isEditMode ? t('common:done') : t('common:edit')}
              >
                {isEditMode ? <CheckIcon size={14} /> : <PencilIcon size={14} />}
              </button>
            )}
          </div>

          {/* 编辑模式批量操作条 */}
          {isEditMode && sidebarTab === 'recents' && (
            <div className="shrink-0 px-3 py-1.5 flex items-center gap-1.5 border-b border-border-200/30">
              <span className="text-[length:var(--fs-xxs)] text-text-400 flex-1 min-w-0 truncate">
                {selectedSessionIds.size > 0 && t('sidebar.selectedSessions', { count: selectedSessionIds.size })}
                {selectedSessionIds.size > 0 && selectedProjectIds.size > 0 && ' / '}
                {selectedProjectIds.size > 0 && t('sidebar.selectedProjects', { count: selectedProjectIds.size })}
                {selectedSessionIds.size === 0 && selectedProjectIds.size === 0 && t('sidebar.selectItems')}
              </span>
              {selectedSessionIds.size > 0 && (
                <button
                  onClick={() => setBatchDeleteSessionConfirm(true)}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[length:var(--fs-xxs)] font-medium text-danger-100 bg-danger-100/10 hover:bg-danger-100/20 transition-colors"
                >
                  <TrashIcon size={11} />
                  {t('sidebar.deleteSessions', { count: selectedSessionIds.size })}
                </button>
              )}
              {selectedProjectIds.size > 0 && (
                <button
                  onClick={() => setBatchRemoveProjectConfirm(true)}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[length:var(--fs-xxs)] font-medium text-warning-100 bg-warning-100/10 hover:bg-warning-100/20 transition-colors"
                >
                  <CloseIcon size={11} />
                  {t('sidebar.removeProjects', { count: selectedProjectIds.size })}
                </button>
              )}
            </div>
          )}

          {/* Recents Tab */}
          {sidebarTab === 'recents' && (
            <div ref={recentsSelectionRootRef} className="flex-1 overflow-hidden">
              {sidebarFolderRecents && !search ? (
                <FolderRecentList
                  projects={folderProjects}
                  {...commonFolderRecentListProps}
                  onReorderProject={handleReorderProjectGroup}
                  workspaceDirectoriesByProjectId={workspaceDirectoriesByProjectId}
                />
              ) : shouldRenderWorkspaceTreeOnly ? (
                <FolderRecentList
                  projects={currentProjectTreeProjects}
                  {...commonFolderRecentListProps}
                  onReorderProject={reorderDirectories}
                />
              ) : shouldWaitForWorkspaceResolution ? (
                <div className="flex h-full items-center justify-center text-text-400/70">
                  <SpinnerIcon size={14} className="animate-spin" />
                </div>
              ) : (
                <SessionList
                  sessions={sessions}
                  selectedId={selectedSessionId}
                  isLoading={isLoading}
                  isLoadingMore={isLoadingMore}
                  hasMore={hasMore}
                  search={search}
                  onSearchChange={setSearch}
                  onSelect={handleSelect}
                  onDelete={handleDeleteSession}
                  onRename={handleRename}
                  onLoadMore={loadMore}
                  onNewChat={onNewSession}
                  showHeader={false}
                  grouped={false}
                  density="compact"
                  showStats
                  showDirectory={!currentDirectory}
                  expandedChildSessionIds={expandedChildSessionIds}
                  inlineChildSessions={inlineChildSessions}
                  onSelectChildSession={handleSelectActive}
                  isEditMode={isEditMode}
                  selectedSessionIds={selectedSessionIds}
                  onToggleSessionSelection={toggleSessionSelection}
                />
              )}
            </div>
          )}

          {/* Active Sessions Tab */}
          {sidebarTab === 'active' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
              {busySessions.length === 0 && notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-text-400 opacity-60">
                  <p className="text-[length:var(--fs-sm)]">{t('sidebar.noActiveSessions')}</p>
                </div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {/* Busy sessions — 子 session 挂在父下面 */}
                  {activeSessionTree.rootEntries.map(entry => renderActiveSessionNode(entry))}

                  {/* Divider + actions between busy and notifications */}
                  {notifications.length > 0 && (
                    <div
                      className={`flex items-center justify-between gap-2 ${busySessions.length > 0 ? 'mt-2 pt-2 border-t border-border-200/30' : ''}`}
                    >
                      <span className="text-[length:var(--fs-xxs)] font-medium text-text-400 uppercase tracking-wider pl-[6px]">
                        {t('sidebar.notifications')}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {notifications.some((n: NotificationEntry) => !n.read) && (
                          <button
                            className="text-[length:var(--fs-xxs)] text-text-400 hover:text-text-200 px-1.5 py-0.5 rounded-md hover:bg-bg-200 transition-all duration-150 active:scale-95"
                            onClick={() => notificationStore.markAllRead()}
                          >
                            {t('sidebar.readAll')}
                          </button>
                        )}
                        <button
                          className="text-[length:var(--fs-xxs)] text-text-400 hover:text-text-200 px-1.5 py-0.5 rounded-md hover:bg-bg-200 transition-all duration-150 active:scale-95"
                          onClick={() => notificationStore.clearAll()}
                        >
                          {t('common:clear')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Notification history */}
                  {notifications.map((entry: NotificationEntry) => {
                    const resolvedSession = sessionLookup.get(entry.sessionId)
                    return (
                      <NotificationItem
                        key={entry.id}
                        entry={entry}
                        resolvedSession={resolvedSession}
                        onSelect={handleSelectActive}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Spacer for collapsed */}
      {!showLabels && <div className="flex-1" />}

      {/* ===== Footer ===== */}
      <SidebarFooter
        showLabels={showLabels}
        connectionState={connectionState?.state || 'disconnected'}
        stats={stats}
        hasMessages={hasMessages}
        onOpenSettings={onOpenSettings}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={projectDeleteConfirm.isOpen}
        onClose={() => setProjectDeleteConfirm({ isOpen: false, projectId: null })}
        onConfirm={() => {
          if (projectDeleteConfirm.projectId) {
            handleRemoveProject(projectDeleteConfirm.projectId)
          }
          setProjectDeleteConfirm({ isOpen: false, projectId: null })
        }}
        title={t('sidebar.removeProject')}
        description={t('sidebar.removeProjectConfirm')}
        confirmText={t('common:remove')}
        variant="danger"
      />

      {/* 批量删除会话确认弹窗 */}
      <ConfirmDialog
        isOpen={batchDeleteSessionConfirm}
        onClose={() => setBatchDeleteSessionConfirm(false)}
        onConfirm={handleBatchDeleteSessions}
        title={t('sidebar.batchDeleteSessions', { count: selectedSessionIds.size })}
        description={
          <>
            {t('sidebar.batchDeleteSessionsConfirm', { count: selectedSessionIds.size })}
            {selectedSessionId && selectedSessionIds.has(selectedSessionId) && (
              <div className="mt-2 text-[length:var(--fs-sm)] text-warning-100">
                {t('sidebar.batchDeleteIncludesCurrent')}
              </div>
            )}
          </>
        }
        confirmText={t('common:delete')}
        variant="danger"
        isLoading={isBatchDeleting}
      />

      {/* 批量移除项目确认弹窗 */}
      <ConfirmDialog
        isOpen={batchRemoveProjectConfirm}
        onClose={() => setBatchRemoveProjectConfirm(false)}
        onConfirm={handleBatchRemoveProjects}
        title={t('sidebar.batchRemoveProjects', { count: selectedProjectIds.size })}
        description={t('sidebar.batchRemoveProjectsConfirm', { count: selectedProjectIds.size })}
        confirmText={t('common:remove')}
        variant="warning"
      />
    </div>
  )
}
