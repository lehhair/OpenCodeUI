import { useCallback, useMemo, useState, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SessionList } from '../../sessions'
import { FolderRecentList } from './FolderRecentList'
import { MultiServerFolderList } from './MultiServerFolderList'
import { SearchResults } from './SearchResults'
import { useMultiServerStore, multiServerStore } from '../../../store/multiServerStore'
import { useServerStore } from '../../../hooks/useServerStore'
import { getProjectGroupIdentity } from './projectGrouping'
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
  NewChatIcon,
  TrashIcon,
  SearchIcon,
  CloseIcon,
  ChevronDownIcon,
  ListFilterIcon,
  FolderMinusIcon,
  CheckIcon,
  SpinnerIcon,
} from '../../../components/Icons'
import { useDirectory, useKeybindingLabel, useGitWorkspaceCatalog, useVcsInfo } from '../../../hooks'
import { useSessionContext } from '../../../contexts/useSessionContext'
import { useLayoutStore, childSessionStore } from '../../../store'
import { useBusySessions, useBusyCount } from '../../../store/activeSessionStore'
import { notificationStore, useNotifications, useUnreadNotificationCount } from '../../../store/notificationStore'
import { pinnedSessionsStore } from '../../../store/pinnedSessionsStore'
import { serverStore } from '../../../store/serverStore'
import { readServerWorkspaces, addServerWorkspace } from '../../../utils/serverWorkspaces'
import { subscribePerServerStorageVersion, getStorageVersion } from '../../../utils/perServerStorage'
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
import { makeSessionKey, splitSessionKey } from '../../../utils/sessionKey'
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
  // 多服务器订阅模式配置
  const multiServerConfig = useMultiServerStore()
  // 多服务器模式：Git/路径信息跟随「焦点服务器」（焦点缺省 = 活动服务器）
  const { activeServer } = useServerStore()
  const catalogServerId = multiServerConfig.enabled
    ? (multiServerConfig.focusedServerId ?? activeServer?.id)
    : undefined
  const { catalog: gitWorkspaceCatalog, isLoading: isGitWorkspaceCatalogLoading } = useGitWorkspaceCatalog(
    catalogDirectories,
    catalogServerId,
  )
  const { vcsInfo: currentDirectoryVcsInfo, isLoading: isCurrentDirectoryVcsLoading } = useVcsInfo(
    currentDirectory,
    catalogServerId,
  )
  const { sidebarFolderRecents, sidebarShowChildSessions } = useLayoutStore()
  // per-server storage 版本（添加/排序工作区时刷新项目选择器；版本号递增触发重渲染）
  const storageVersionSnapshot = useSyncExternalStore(
    subscribePerServerStorageVersion,
    getStorageVersion,
    getStorageVersion,
  )
  const subscribedServerIds = useMemo(() => {
    // 白名单精确生效：只展示用户在设置里勾选的服务器
    return multiServerConfig.subscribedServerIds.filter(id => serverStore.getServers().some(s => s.id === id))
  }, [multiServerConfig.subscribedServerIds])
  // 多服务器列表按复合 key（serverId::sessionId）比较，避免跨服务器同名 session 串高亮
  const multiServerSelectedSessionKey = selectedSessionId
  const [globalFolderIndex, setGlobalFolderIndex] = useState<number>(() => {
    const saved = localStorage.getItem('opencode-sidebar-global-folder-index')
    const parsed = saved ? Number.parseInt(saved, 10) : 0
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  })
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
  const projectToggleRef = useRef<HTMLButtonElement>(null)
  const projectsDropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pendingOpenProjectsRef = useRef(false)
  const pendingFocusSearchRef = useRef(false)
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
            // 目标已选中 → 整段取消；未选中 → 整段选中
            const shouldSelect = !prev.has(sessionId)
            for (const id of range) {
              if (shouldSelect) next.add(id)
              else next.delete(id)
            }
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        return next
      })
      // Shift 范围操作后仍保留锚点，方便连续扩选/缩选
      if (!(options?.shiftKey && anchorId)) {
        sessionSelectionAnchorIdRef.current = sessionId
      }
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
            const shouldSelect = !prev.has(projectId)
            for (const id of range) {
              if (shouldSelect) next.add(id)
              else next.delete(id)
            }
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      })
      if (!(options?.shiftKey && anchorId)) {
        projectSelectionAnchorIdRef.current = projectId
      }
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

  useEffect(() => {
    if (showLabels && projectsExpanded) return
    const activeElement = document.activeElement as Node | null
    if (activeElement && projectsDropdownRef.current?.contains(activeElement)) {
      projectToggleRef.current?.focus()
    }
  }, [projectsExpanded, showLabels])

  // 收起态点项目/搜索：展开后再执行打开列表或聚焦输入
  useEffect(() => {
    if (!showLabels) return

    if (pendingOpenProjectsRef.current) {
      pendingOpenProjectsRef.current = false
      setProjectsExpanded(true)
    }

    if (pendingFocusSearchRef.current) {
      pendingFocusSearchRef.current = false
      const frameId = requestAnimationFrame(() => {
        searchInputRef.current?.focus()
      })
      return () => cancelAnimationFrame(frameId)
    }
  }, [showLabels])

  // Active sessions
  const busySessions = useBusySessions()
  const busyCount = useBusyCount()
  useSyncExternalStore(
    childSessionStore.subscribe.bind(childSessionStore),
    childSessionStore.getVersion,
    childSessionStore.getVersion,
  )
  // Notification history
  const notifications = useNotifications()
  const unreadNotificationCount = useUnreadNotificationCount()
  const attentionCount = busyCount + unreadNotificationCount

  useEffect(() => {
    return subscribeToConnectionState(setConnectionState)
  }, [])

  const { sessions, isLoading, isLoadingMore, hasMore, search, setSearch, loadMore, deleteSession, refresh } =
    useSessionContext()

  const pinnedEntries = useSyncExternalStore(
    pinnedSessionsStore.subscribe,
    pinnedSessionsStore.getSnapshot,
    pinnedSessionsStore.getSnapshot,
  )
  // 缓存通过 API 拉取的 session 数据（sessions 列表中不存在的）
  const [fetchedSessions, setFetchedSessions] = useState<Record<string, ApiSession>>({})
  // 防止 busySessions 等数组引用抖动时 cancel+重拉，导致 /session 风暴
  const inflightSessionIdsRef = useRef(new Set<string>())
  const failedSessionIdsRef = useRef(new Set<string>())

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

  const orderedSessions = useMemo(() => {
    const pinnedSet = new Set(pinnedEntries.map(e => e.sessionId))
    const pinned = pinnedEntries
      .map(entry => sessionLookup.get(entry.sessionId))
      .filter((session): session is ApiSession => Boolean(session))
    const rest = sessions.filter(s => !pinnedSet.has(s.id))
    return [...pinned, ...rest]
  }, [pinnedEntries, sessionLookup, sessions])
  const pinnedDividerAfterIds = useMemo(() => {
    const lastPinned = pinnedEntries
      .map(entry => sessionLookup.get(entry.sessionId))
      .filter((session): session is ApiSession => Boolean(session))
      .at(-1)
    if (!lastPinned) return undefined
    const pinnedSet = new Set(pinnedEntries.map(e => e.sessionId))
    return sessions.some(s => !pinnedSet.has(s.id)) ? new Set([lastPinned.id]) : undefined
  }, [pinnedEntries, sessionLookup, sessions])
  const resolvedPinnedSessions = useMemo(
    () =>
      pinnedEntries
        .map(entry => sessionLookup.get(entry.sessionId))
        .filter((session): session is ApiSession => Boolean(session)),
    [pinnedEntries, sessionLookup],
  )
  // 当前 lookup 里没有的置顶：灰色展示，始终可取消
  const unavailablePinnedEntries = useMemo(
    () => pinnedEntries.filter(entry => !sessionLookup.has(entry.sessionId)),
    [pinnedEntries, sessionLookup],
  )

  // 切服务器时清空跨目录 fetch 缓存，避免串服
  useEffect(() => {
    return serverStore.onServerChange(() => {
      setFetchedSessions({})
      inflightSessionIdsRef.current.clear()
      failedSessionIdsRef.current.clear()
    })
  }, [])

  // 需要补全的 session 集合：用内容 key 稳定，避免 busySessions 数组引用抖动触发重拉
  const missingSessionsKey = useMemo(() => {
    const byId = new Map<string, { sessionId: string; directory?: string; pinned?: boolean }>()
    const add = (sessionId: string, directory?: string, pinned?: boolean) => {
      if (sessionLookup.has(sessionId)) return
      const existing = byId.get(sessionId)
      if (existing) {
        byId.set(sessionId, {
          sessionId,
          directory: existing.directory || directory,
          pinned: existing.pinned || pinned,
        })
        return
      }
      byId.set(sessionId, { sessionId, directory, pinned })
    }

    for (const entry of busySessions) add(entry.sessionId, entry.directory)
    for (const entry of notifications) add(entry.sessionId, entry.directory)
    for (const entry of pinnedEntries) add(entry.sessionId, entry.directory, true)
    if (selectedSessionId) add(selectedSessionId, currentDirectory || undefined)

    return Array.from(byId.values())
      .map(e => `${e.sessionId}\0${e.directory ?? ''}\0${e.pinned ? '1' : '0'}`)
      .sort()
      .join('|')
  }, [busySessions, notifications, pinnedEntries, sessionLookup, selectedSessionId, currentDirectory])

  // 异步拉取不在 lookup 中的 active/notification/pinned/selected session
  useEffect(() => {
    const neededIds = new Set<string>()
    const missing: Array<{ sessionId: string; directory?: string; pinned?: boolean }> = []

    if (missingSessionsKey) {
      for (const token of missingSessionsKey.split('|')) {
        const [sessionId, directory, pinned] = token.split('\0')
        if (!sessionId) continue
        neededIds.add(sessionId)
        if (sessionLookup.has(sessionId)) continue
        if (inflightSessionIdsRef.current.has(sessionId)) continue
        if (failedSessionIdsRef.current.has(sessionId)) continue
        missing.push({
          sessionId,
          directory: directory || undefined,
          pinned: pinned === '1',
        })
      }
    }

    // 不再需要的失败记录清掉，session 再次出现时允许重试
    for (const sessionId of [...failedSessionIdsRef.current]) {
      if (!neededIds.has(sessionId)) failedSessionIdsRef.current.delete(sessionId)
    }

    if (missing.length === 0) return

    for (const entry of missing) {
      inflightSessionIdsRef.current.add(entry.sessionId)
    }

    void Promise.allSettled(
      missing.map(async entry => {
        try {
          const session = await getSession(entry.sessionId, entry.directory)
          inflightSessionIdsRef.current.delete(entry.sessionId)
          setFetchedSessions(prev => (prev[session.id] ? prev : { ...prev, [session.id]: session }))
          if (entry.pinned) {
            pinnedSessionsStore.update(session.id, {
              directory: session.directory || entry.directory,
              title: session.title || session.id.slice(0, 12) + '...',
            })
          }
        } catch {
          inflightSessionIdsRef.current.delete(entry.sessionId)
          // 失败只记一次，避免 SSE/busy 抖动时无限重试 /session
          failedSessionIdsRef.current.add(entry.sessionId)
        }
      }),
    )
  }, [missingSessionsKey, sessionLookup])

  // ---- 子 session 展示数据 ----
  const rootSessionIds = useMemo(() => new Set(sessions.map(s => s.id)), [sessions])

  const findParentId = useCallback(
    (id: string) => {
      // 输入可能是复合 key（serverId::sessionId）或原始 id；返回「原始 parentID」
      // （sessions/sessionLookup 以原始 id 存；childSessionStore 以复合 key 存）
      const { serverId, sessionId } = splitSessionKey(id)
      const s = sessionLookup.get(sessionId)
      if (s?.parentID) return s.parentID
      const childInfo = childSessionStore.getSessionInfo(id.includes('::') ? id : makeSessionKey(serverId, id))
      return childInfo ? splitSessionKey(childInfo.parentID).sessionId : undefined
    },
    [sessionLookup],
  )

  // 开关开 → 拉 /children 全量：选中的 root 或选中子 session 时保持其父展开
  const expandedChildSessionIds = useMemo(() => {
    if (search || !sidebarShowChildSessions || !selectedSessionId) return undefined
    if (multiServerConfig.enabled) {
      // 多服务器模式：选中 session 属于任意服务器，直接用全服务器的 childSessionStore 判断
      if (childSessionStore.getChildSessionIds(selectedSessionId).length > 0) {
        return new Set([splitSessionKey(selectedSessionId).sessionId])
      }
      const pid = findParentId(selectedSessionId)
      if (pid) return new Set([pid])
      return undefined
    }
    const selectedRaw = splitSessionKey(selectedSessionId).sessionId
    if (rootSessionIds.has(selectedRaw)) return new Set([selectedRaw])
    const pid = findParentId(selectedSessionId)
    if (pid && rootSessionIds.has(pid)) return new Set([pid])
    return undefined
  }, [search, sidebarShowChildSessions, selectedSessionId, rootSessionIds, findParentId, multiServerConfig.enabled])

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
      // 单服务器：父必须在当前列表（rootSessionIds）；多服务器：父在各自服务器列表，放宽
      const pidOk = multiServerConfig.enabled ? !!pid : (pid ? rootSessionIds.has(pid) : false)
      if (pid && pidOk) {
        const rawId = splitSessionKey(entry.sessionId).sessionId
        // sessionLookup 只含 active 服务器会话；其他服务器的子 session 用 entry 构造
        const s =
          sessionLookup.get(rawId) ??
          (entry.title || entry.directory
            ? ({ id: rawId, title: entry.title, directory: entry.directory } as ApiSession)
            : undefined)
        if (s) add(pid, s)
      }
    }
    if (
      !sidebarShowChildSessions &&
      selectedSessionId &&
      !rootSessionIds.has(splitSessionKey(selectedSessionId).sessionId)
    ) {
      const pid = findParentId(selectedSessionId)
      if (pid && rootSessionIds.has(pid)) {
        const s = sessionLookup.get(splitSessionKey(selectedSessionId).sessionId)
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
    multiServerConfig.enabled,
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
        const { projectId, workspaceDirectories } = getProjectGroupIdentity(normalizedDirectory, meta)
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
          workspaceDirectories,
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

  // 多服务器模式：项目选择器显示「焦点服务器」的工作区（读该服务器 per-server saved-directories）
  const focusedServerWorkspaces = useMemo(() => {
    if (!multiServerConfig.enabled) return [] as (typeof savedDirectories)[number][]
    const serverId = multiServerStore.getFocusedServerId()
    return readServerWorkspaces(serverId).map(
      dir => ({ path: dir, addedAt: 0 } as (typeof savedDirectories)[number]),
    )
  }, [multiServerConfig, storageVersionSnapshot])

  const selectorProjectGroups = useMemo<ProjectItem[]>(() => {
    if (multiServerConfig.enabled) {
      return buildProjectGroups(focusedServerWorkspaces)
    }
    const sortedDirectories = [...savedDirectories].sort((a, b) => {
      const aTime = recentProjects[a.path] || a.addedAt
      const bTime = recentProjects[b.path] || b.addedAt
      return bTime - aTime
    })

    return buildProjectGroups(sortedDirectories)
  }, [multiServerConfig.enabled, focusedServerWorkspaces, buildProjectGroups, recentProjects, savedDirectories])

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
    const { projectId, workspaceDirectories } = getProjectGroupIdentity(normalizedCurrentDirectory!, meta)
    const found = findProjectGroupForDirectory(folderProjectGroups, projectId)
    if (found) return found

    return {
      id: projectId,
      worktree: projectId,
      name: getDirectoryName(projectId),
      canReorder: false,
      memberDirectories: [],
      workspaceDirectories,
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

  const globalFolderProject = useMemo<ProjectItem>(
    () => ({ id: 'global', worktree: '', name: t('sidebar.global'), canReorder: true }),
    [t],
  )

  const folderProjects = useMemo<ProjectItem[]>(() => {
    const list = [...folderProjectGroups]

    if (currentDirectory && !list.some(project => isSameDirectory(project.worktree, currentProject.worktree))) {
      list.push({ ...currentProject, canReorder: false })
    }

    const insertAt = Math.min(Math.max(globalFolderIndex, 0), list.length)
    return [...list.slice(0, insertAt), globalFolderProject, ...list.slice(insertAt)]
  }, [folderProjectGroups, currentDirectory, currentProject, globalFolderProject, globalFolderIndex])
  // 文件夹模式开启（搜索时由 SearchResults 接管，文件夹与 session 一起搜）

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
      if (!project.worktree) {
        if (!currentDirectory) return
        setCurrentDirectory(undefined)
        return
      }
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
    (draggedId: string, targetId: string) => {
      const draggedIdx = folderProjects.findIndex(project => project.id === draggedId)
      const targetIdx = folderProjects.findIndex(project => project.id === targetId)
      if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return

      const draggedIsGlobal = folderProjects[draggedIdx].id === 'global'
      const targetIsGlobal = folderProjects[targetIdx].id === 'global'

      if (draggedIsGlobal) {
        // 全局移到 target 位置：globalFolderIndex 直接等于 targetIdx
        if (targetIdx !== globalFolderIndex) {
          setGlobalFolderIndex(targetIdx)
          localStorage.setItem('opencode-sidebar-global-folder-index', String(targetIdx))
        }
        return
      }

      if (targetIsGlobal) {
        // 普通目录拖到全局位置 = 交换：全局到普通目录原位，普通目录移到全局旁
        const adjacentIdx = draggedIdx < targetIdx ? targetIdx - 1 : targetIdx + 1
        if (draggedIdx !== adjacentIdx) {
          const draggedReorderPath = folderProjects[draggedIdx].reorderPath
          const adjacentReorderPath = folderProjects[adjacentIdx].reorderPath
          if (draggedReorderPath && adjacentReorderPath) {
            reorderDirectories(draggedReorderPath, adjacentReorderPath)
          }
        }
        if (draggedIdx !== globalFolderIndex) {
          setGlobalFolderIndex(draggedIdx)
          localStorage.setItem('opencode-sidebar-global-folder-index', String(draggedIdx))
        }
        return
      }

      const draggedReorderPath = folderProjects[draggedIdx].reorderPath
      const targetReorderPath = folderProjects[targetIdx].reorderPath
      if (!draggedReorderPath || !targetReorderPath) return
      reorderDirectories(draggedReorderPath, targetReorderPath)
    },
    [folderProjects, reorderDirectories, globalFolderIndex],
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

  // 多服务器模式：从分组列表选择 session（serverId 已由 MultiServerFolderList 附加）
  const handleSelectMultiServer = useCallback(
    (session: ApiSession & { serverId?: string }) => {
      onSelectSession(session)
      if (window.innerWidth < 768 && onCloseMobile) {
        onCloseMobile()
      }
    },
    [onSelectSession, onCloseMobile],
  )

  // Active tab 专用：跨目录的 session 需要确保目录在项目列表中
  // 多服务器模式：活跃 session 按服务器分组（组内保留父子结构）
  const activeServerGroups = useMemo(() => {
    if (!multiServerConfig.enabled) return [] as Array<{ serverId: string; roots: (typeof busySessions)[number][] }>
    const map = new Map<string, (typeof busySessions)[number][]>()
    for (const entry of activeSessionTree.rootEntries) {
      const serverId = splitSessionKey(entry.sessionId).serverId
      const list = map.get(serverId) ?? []
      list.push(entry)
      map.set(serverId, list)
    }
    return Array.from(map.entries()).map(([serverId, roots]) => ({ serverId, roots }))
  }, [multiServerConfig.enabled, activeSessionTree.rootEntries])

  const handleSelectActive = useCallback(
    (session: ApiSession & { serverId?: string }) => {
      if (session.directory) {
        if (session.serverId) {
          // 多服务器模式：写入该 session 所属服务器的工作区（避免污染活动服务器）
          addServerWorkspace(session.serverId, session.directory)
        } else {
          addDirectory(session.directory)
        }
      }
      // 多服务器模式：session 附带 serverId（App 用它合成复合 key 打开）
      onSelectSession(session)
      if (window.innerWidth < 768 && onCloseMobile) {
        onCloseMobile()
      }
    },
    [addDirectory, addServerWorkspace, onSelectSession, onCloseMobile],
  )

  const renderActiveSessionNode = useCallback(
    function renderActiveSessionNode(entry: (typeof busySessions)[number], level = 0): ReactNode {
      // entry.sessionId 是复合 key（serverId::sessionId），解析出服务器与原始 id
      const { serverId, sessionId } = splitSessionKey(entry.sessionId)
      const resolvedSession =
        sessionLookup.get(sessionId) ??
        (entry.title || entry.directory
          ? ({
              id: sessionId,
              title: entry.title,
              directory: entry.directory,
            } as ApiSession)
          : undefined)
      // childrenByParent 以原始 id 为 key（buildActiveSessionTree 统一）
      const childEntries = activeSessionTree.childrenByParent.get(sessionId) ?? []

      return (
        <div key={entry.sessionId} style={level > 0 ? { marginLeft: level * 12 } : undefined}>
          <ActiveSessionItem
            entry={entry}
            resolvedSession={resolvedSession}
            isSelected={entry.sessionId === selectedSessionId}
            onSelect={session =>
              handleSelectActive({ ...session, serverId } as ApiSession & { serverId?: string })
            }
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
        pinnedSessionsStore.update(sessionId, { title: newTitle })
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
        pinnedSessionsStore.update(session.id, { title: newTitle })
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
      pinnedSessionsStore.unpin(session.id)

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
          pinnedSessionsStore.unpin(id)
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
      <div className="mobile-safe-topbar-14 shrink-0 flex items-center">
        {/* Logo 区域 - 展开时显示 */}
        <div
          className="overflow-hidden transition-[width,padding,opacity] duration-300 ease-out"
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

        {!isMobile && (
          <div
            className="flex-1 flex items-center transition-all duration-300 ease-out"
            style={{ justifyContent: showLabels ? 'flex-end' : 'center', paddingRight: showLabels ? 8 : 0 }}
          >
            <button
              onClick={onToggleSidebar}
              aria-label={isExpanded ? t('sidebar.collapseSidebar') : t('sidebar.expandSidebar')}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-text-300 hover:text-text-100 hover:bg-bg-200 active:scale-[0.98] transition-all duration-200"
            >
              <SidebarIcon size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ===== Navigation - 图标位置固定；间距与 Header 面板按钮对齐 ===== */}
      <div className="flex flex-col gap-0.5 mx-2 -mt-2.5">
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
            <NewChatIcon size={16} />
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

        {/* Project Selector - 收起时仅图标，点击展开侧栏并打开列表 */}
        <button
          ref={projectToggleRef}
          type="button"
          onClick={() => {
            if (!showLabels) {
              pendingOpenProjectsRef.current = true
              onToggleSidebar()
              return
            }
            setProjectsExpanded(!projectsExpanded)
          }}
          aria-expanded={showLabels ? projectsExpanded : false}
          aria-label={currentProjectLabel}
          className={`h-8 flex items-center rounded-lg active:scale-[0.98] transition-all duration-300 overflow-hidden ${
            projectsExpanded && showLabels
              ? 'bg-bg-200 text-text-100'
              : 'text-text-300 hover:text-text-100 hover:bg-bg-200'
          }`}
          style={{
            width: showLabels ? '100%' : 32,
            paddingLeft: 6,
            paddingRight: 6,
          }}
          title={currentProjectLabel}
        >
          <span className="size-5 flex items-center justify-center shrink-0">
            {currentProject?.id === 'global' ? (
              <GlobeIcon size={16} className="text-accent-main-100" />
            ) : (
              <FolderIcon size={16} />
            )}
          </span>
          <div
            className="ml-2 min-w-0 flex-1 text-left text-[length:var(--fs-base)] transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
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
            className={`ml-auto text-text-400 transition-all duration-200 shrink-0 ${
              projectsExpanded && showLabels ? '' : '-rotate-90'
            }`}
            style={{ opacity: showLabels ? 1 : 0 }}
          />
        </button>

        {/* Projects Dropdown */}
        <div
          ref={projectsDropdownRef}
          className="overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out"
          style={{
            maxHeight: showLabels && projectsExpanded ? 304 : 0,
            opacity: showLabels && projectsExpanded ? 1 : 0,
            marginTop: showLabels && projectsExpanded ? 4 : 0,
            visibility: showLabels && projectsExpanded ? 'visible' : 'hidden',
            pointerEvents: showLabels && projectsExpanded ? 'auto' : 'none',
          }}
          aria-hidden={!showLabels || !projectsExpanded}
        >
          <div className="rounded-lg border border-border-200/60 glass-alt shadow-sm overflow-hidden">
            <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
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
                    onClick={() => handleSelectProject(project.id)}
                    className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                      isActive ? 'bg-bg-200/60 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        handleSelectProject(project.id)
                      }}
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
                        <div
                          className={`text-[length:var(--fs-xxs)] text-text-400 truncate opacity-70 ${isGlobal ? '' : 'font-mono'}`}
                        >
                          {isGlobal
                            ? t('sidebar.globalProjectHint')
                            : project.worktree
                              ? getParentPath(project.worktree)
                              : ''}
                        </div>
                      </div>
                    </button>
                    {!isGlobal && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setProjectDeleteConfirm({ isOpen: true, projectId: project.id })
                        }}
                        aria-label={t('sidebar.removeProject')}
                        className="p-1 rounded text-text-400 hover:text-danger-100 hover:bg-danger-100/10 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 transition-all"
                        title={t('common:remove')}
                      >
                        <TrashIcon size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="relative p-1 pt-1.5">
              <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-border-200/30" />
              {/* 多服务器模式：当前「焦点服务器」— 与项目项同款样式（图标位=状态点） */}
              {multiServerConfig.enabled && subscribedServerIds.length > 0 && (
                <div className="group mb-1 flex w-full items-center gap-2 rounded-md bg-bg-200/40 px-2 py-1.5">
                  <span className="relative w-5 h-5 flex items-center justify-center shrink-0">
                    <span className="h-2 w-2 rounded-full bg-success-100" />
                  </span>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-left text-[length:var(--fs-sm)] text-text-200 truncate">
                      {serverStore.getServer(multiServerStore.getFocusedServerId())?.name ??
                        multiServerStore.getFocusedServerId()}
                    </div>
                    <div className="text-[length:var(--fs-xxs)] text-text-400 truncate opacity-70">
                      {t('sidebar.focusServerHint', {
                        defaultValue: '焦点服务器 · 点击列表中服务器节点切换',
                      })}
                    </div>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={onAddProject}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors"
              >
                <PlusIcon size={14} />
                {t('sidebar.addProject')}
              </button>
            </div>
          </div>
        </div>

        {/* Search — 与上方导航同列 gap-0.5；收起时图标，展开时输入框 */}
        {showLabels ? (
          <div className="relative w-full">
            <span className="pointer-events-none absolute left-[6px] top-1/2 -translate-y-1/2 size-5 flex items-center justify-center text-text-300">
              <SearchIcon size={16} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              name="sidebar-chat-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('sidebar.searchChats')}
              aria-label={t('sidebar.searchChats')}
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full appearance-none rounded-lg border-0 bg-transparent pl-[34px] pr-[26px] text-[length:var(--fs-base)] text-text-100 shadow-none outline-none ring-0 placeholder:text-text-300 transition-shadow focus-visible:ring-1 focus-visible:ring-accent-main-100/30"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-[6px] top-1/2 flex size-[14px] -translate-y-1/2 items-center justify-center text-text-400 hover:text-text-100"
                aria-label={t('sidebar.clearSearch')}
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              pendingFocusSearchRef.current = true
              onToggleSidebar()
            }}
            aria-label={t('sidebar.searchChats')}
            className="h-8 flex items-center rounded-lg text-text-300 hover:text-text-100 hover:bg-bg-200 active:scale-[0.98] transition-all duration-300 overflow-hidden"
            style={{ width: 32, paddingLeft: 6, paddingRight: 6 }}
            title={t('sidebar.searchChats')}
          >
            <span className="size-5 flex items-center justify-center shrink-0">
              <SearchIcon size={16} />
            </span>
          </button>
        )}
      </div>

      {/* ===== Main Content ===== */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden transition-opacity duration-300 ease-out"
        style={{
          opacity: showLabels ? 1 : 0,
          visibility: showLabels ? 'visible' : 'hidden',
        }}
      >
        {/* Tab Bar: Recents / Active */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center mx-2 gap-1 shrink-0">
            {isEditMode && sidebarTab === 'recents' ? (
              <>
                {/* 与 tab 同字号字重，左侧文案变成状态提示 */}
                <span className="pl-[6px] pr-2 py-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-100 min-w-0 truncate">
                  {selectedSessionIds.size === 0 && selectedProjectIds.size === 0
                    ? t('sidebar.selectItems')
                    : selectedSessionIds.size > 0 && selectedProjectIds.size > 0
                      ? t('sidebar.selectedMixed', {
                          sessions: selectedSessionIds.size,
                          projects: selectedProjectIds.size,
                        })
                      : selectedSessionIds.size > 0
                        ? t('sidebar.selectedSessions', { count: selectedSessionIds.size })
                        : t('sidebar.selectedProjects', { count: selectedProjectIds.size })}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {selectedSessionIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setBatchDeleteSessionConfirm(true)}
                      className="p-1.5 rounded-md text-text-500 hover:text-danger-100 hover:bg-danger-100/10 active:bg-danger-100/15 transition-colors duration-150"
                      title={t('sidebar.deleteSessionsWithCount', { count: selectedSessionIds.size })}
                      aria-label={t('sidebar.deleteSessionsWithCount', { count: selectedSessionIds.size })}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                  {selectedProjectIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setBatchRemoveProjectConfirm(true)}
                      className="p-1.5 rounded-md text-text-500 hover:text-warning-100 hover:bg-warning-100/10 active:bg-warning-100/15 transition-colors duration-150"
                      title={t('sidebar.removeProjectsWithCount', { count: selectedProjectIds.size })}
                      aria-label={t('sidebar.removeProjectsWithCount', { count: selectedProjectIds.size })}
                    >
                      <FolderMinusIcon size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={exitEditMode}
                    aria-label={t('sidebar.doneManaging')}
                    aria-pressed
                    className="p-1.5 rounded-md text-text-500 hover:text-text-100 hover:bg-bg-300 active:bg-bg-300 transition-colors duration-150"
                    title={t('sidebar.doneManaging')}
                  >
                    <CheckIcon size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
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
                {sidebarTab === 'recents' && (
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={enterEditMode}
                    aria-label={t('sidebar.manageSessions')}
                    className="ml-auto p-1 rounded-md text-text-500 hover:text-text-300 hover:bg-bg-200/50 transition-colors duration-150"
                    title={t('sidebar.manageSessions')}
                  >
                    <ListFilterIcon size={14} />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Recents Tab */}
          {sidebarTab === 'recents' && (
            <div
              ref={recentsSelectionRootRef}
              className={`flex-1 overflow-hidden ${isEditMode ? 'select-none' : ''}`}
            >
              {multiServerConfig.enabled ? (
                subscribedServerIds.length > 0 ? (
                  search ? (
                    <SearchResults
                      search={search}
                      selectedSessionId={multiServerSelectedSessionKey}
                      onSelectSession={handleSelectMultiServer}
                    />
                  ) : (
                    <MultiServerFolderList
                      serverIds={subscribedServerIds}
                      selectedSessionId={multiServerSelectedSessionKey}
                      currentDirectory={currentDirectory}
                      onSelectSession={handleSelectMultiServer}
                      onNewSession={onNewSession}
                      expandedChildSessionIds={expandedChildSessionIds}
                      inlineChildSessions={inlineChildSessions}
                      onSelectChildSession={handleSelectActive}
                    />
                  )
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[length:var(--fs-xs)] text-text-400/70">
                    <span>{t('sidebar.noSubscribedServers', { defaultValue: 'No servers subscribed yet.' })}</span>
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="rounded-md px-2 py-1 text-[length:var(--fs-xs)] text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
                    >
                      {t('sidebar.openServerSettings', { defaultValue: 'Open Server Settings' })}
                    </button>
                  </div>
                )
              ) : sidebarFolderRecents ? (
                search ? (
                  /* 文件夹模式 + 搜索：文件夹 + session 一起搜（单服务器：无服务器组头） */
                  <SearchResults
                    search={search}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={handleSelect}
                  />
                ) : (
                  <FolderRecentList
                    projects={folderProjects}
                    {...commonFolderRecentListProps}
                    onReorderProject={handleReorderProjectGroup}
                    workspaceDirectoriesByProjectId={workspaceDirectoriesByProjectId}
                    pinnedSessions={resolvedPinnedSessions}
                    unavailablePinnedEntries={unavailablePinnedEntries}
                  />
                )
              ) : shouldRenderWorkspaceTreeOnly ? (
                <FolderRecentList
                  projects={currentProjectTreeProjects}
                  {...commonFolderRecentListProps}
                  onReorderProject={reorderDirectories}
                  pinnedSessions={resolvedPinnedSessions}
                  unavailablePinnedEntries={unavailablePinnedEntries}
                />
              ) : shouldWaitForWorkspaceResolution ? (
                <div className="flex h-full items-center justify-center text-text-400/70">
                  <SpinnerIcon size={14} className="animate-spin" />
                </div>
              ) : (
                <SessionList
                  sessions={orderedSessions}
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
                  pinnedDividerAfterIds={pinnedDividerAfterIds}
                  unavailablePinnedEntries={unavailablePinnedEntries}
                  availablePinnedCount={resolvedPinnedSessions.length}
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
              ) : multiServerConfig.enabled && activeServerGroups.length > 0 ? (
                <div className="mt-1 space-y-2">
                  {/* 多服务器模式：活跃 session 按服务器分组 */}
                  {activeServerGroups.map(({ serverId, roots }) => (
                    <div key={serverId}>
                      <div className="px-[6px] pt-0.5 pb-1 text-[length:var(--fs-xxs)] font-medium uppercase tracking-wider text-text-400">
                        {serverStore.getServer(serverId)?.name ?? serverId}
                      </div>
                      <div className="space-y-0.5">
                        {roots.map(entry => renderActiveSessionNode(entry))}
                      </div>
                    </div>
                  ))}

                  {/* Divider + actions between busy and notifications */}
                  {notifications.length > 0 && (
                    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border-200/30">
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
                    const { serverId, sessionId } = splitSessionKey(entry.sessionId)
                    const resolvedSession = sessionLookup.get(sessionId)
                    return (
                      <NotificationItem
                        key={entry.id}
                        entry={entry}
                        resolvedSession={resolvedSession}
                        onSelect={session =>
                          handleSelectActive({ ...session, serverId } as ApiSession & { serverId?: string })
                        }
                      />
                    )
                  })}
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
                    const { serverId, sessionId } = splitSessionKey(entry.sessionId)
                    const resolvedSession = sessionLookup.get(sessionId)
                    return (
                      <NotificationItem
                        key={entry.id}
                        entry={entry}
                        resolvedSession={resolvedSession}
                        onSelect={session =>
                          handleSelectActive({ ...session, serverId } as ApiSession & { serverId?: string })
                        }
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
