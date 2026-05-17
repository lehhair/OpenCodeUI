import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { serverStore, makeBasicAuthHeader, type ServerConfig, type ServerHealth } from '../../../store/serverStore'
import {
  FolderIcon,
  ChevronDownIcon,
  WifiIcon,
  WifiOffIcon,
  SpinnerIcon,
  KeyIcon,
  GlobeIcon,
  CloseIcon,
  MessageSquareIcon,
} from '../../../components/Icons'
import { getDirectoryName } from '../../../utils'
import { formatPathForApi } from '../../../utils/directoryUtils'
import type { SessionStatus } from '../../../types/api/session'

// ============================================
// Types
// ============================================

/**
 * 从 SDK SessionStatus 联合类型中提取 status 字符串。
 * SDK 的 SessionStatus 为 { type: "idle" } | { type: "busy" } | { type: "retry" }，
 * 这里统一映射为面板内部使用的简化状态枚举。
 */
function extractStatusType(status: SessionStatus | undefined): SessionInfo['status'] {
  if (!status) return 'unknown'
  return status.type as SessionInfo['status']
}

/**
 * 面板内展示的 session 信息（从 SDK 数据简化而来）。
 */
interface SessionInfo {
  id: string
  title: string
  directory?: string
  status: 'idle' | 'busy' | 'paused' | 'unknown'
}

/**
 * 单个服务器下的工程分组。
 */
interface ProjectGroup {
  id: string
  name: string
  directory?: string
  sessions: SessionInfo[]
}

/**
 * 面板中每个服务器节点的数据结构。
 */
interface ServerNode {
  server: ServerConfig
  health: ServerHealth | null
  projects: ProjectGroup[]
  isLoading: boolean
  error: string | null
}

// ============================================
// SDK client per server (independent of active server)
// ============================================

/**
 * 缓存已创建的 SDK client 实例，按 "baseUrl|auth" 作为 key。
 * 避免每次渲染都重建 client，减少不必要的 HTTP 连接开销。
 */
const clientCache = new Map<string, OpencodeClient>()

/**
 * 为指定服务器创建或复用 SDK client。
 * 该 client 独立于当前 active server，使用目标服务器自己的 baseUrl 和认证信息。
 */
function getServerClient(server: ServerConfig): OpencodeClient {
  const authPart = server.auth?.password ? `${server.auth.username}:${server.auth.password}` : 'no-auth'
  const cacheKey = `${server.url}|${authPart}`

  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey)!
  }

  const headers: Record<string, string> = {}
  if (server.auth?.password) {
    headers['Authorization'] = makeBasicAuthHeader(server.auth)
  }

  const client = createOpencodeClient({
    baseUrl: server.url,
    headers,
  })

  clientCache.set(cacheKey, client)
  return client
}

// ============================================
// ServerQuickPanel Component
// ============================================

interface ServerQuickPanelProps {
  /** 触发按钮的 ref，用于定位面板弹出位置 */
  triggerRef: React.RefObject<HTMLElement | null>
  /** 关闭面板的回调 */
  onClose: () => void
  /** 选中 session 时的回调，传入 session 信息和所属 serverId */
  onSelectSession: (session: SessionInfo, serverId: string) => void
}

/**
 * 服务器快捷面板 — 以树形结构展示所有已配置服务器 → 工程 → 活跃 session。
 * 点击侧边栏 header 中的 "OpenCode" logo 触发弹出。
 *
 * 面板使用 createPortal 渲染到 document.body，通过绝对定位跟随触发按钮。
 * 支持点击外部区域和 ESC 键关闭。
 */
export function ServerQuickPanel({ triggerRef, onClose, onSelectSession }: ServerQuickPanelProps) {
  const { t } = useTranslation(['chat', 'common'])

  /** 所有服务器节点数据（含项目列表和 session 列表） */
  const [serverNodes, setServerNodes] = useState<ServerNode[]>([])
  /** 已展开的服务器 ID 集合 */
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  /** 已展开的工程 ID 集合 */
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  /** 面板是否已完成入场动画（控制 opacity/scale transition） */
  const [isVisible, setIsVisible] = useState(false)
  /** 面板弹出位置和尺寸 */
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 320 })

  /** 面板 DOM ref，用于点击外部检测 */
  const panelRef = useRef<HTMLDivElement>(null)
  /** 标记面板是否正在关闭中，防止关闭动画期间重复触发关闭 */
  const isClosingRef = useRef(false)

  /** 计算面板弹出位置：位于触发按钮正下方，确保不超出视口 */
  useEffect(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const panelWidth = 320
    const gap = 8

    const left = Math.min(rect.left, window.innerWidth - panelWidth - 16)

    setPanelPos({
      top: rect.bottom + gap,
      left: Math.max(8, left),
      width: panelWidth,
    })

    requestAnimationFrame(() => setIsVisible(true))
  }, [triggerRef])

  /** 获取所有服务器的项目和 session 数据 */
  useEffect(() => {
    const servers = serverStore.getServers()
    const healthMap = serverStore.getAllHealth()

    // 初始化所有节点为加载中状态
    const initialNodes: ServerNode[] = servers.map(server => ({
      server,
      health: healthMap.get(server.id) ?? null,
      projects: [],
      isLoading: true,
      error: null,
    }))

    setServerNodes(initialNodes)

    // 自动展开当前活跃的服务器
    const activeServer = serverStore.getActiveServer()
    if (activeServer) {
      setExpandedServers(new Set([activeServer.id]))
    }

    let cancelled = false

    const fetchAll = async () => {
      await Promise.allSettled(
        servers.map(async server => {
          try {
            const client = getServerClient(server)

            // 获取项目列表
            let projects: ProjectGroup[] = []
            try {
              const projectList = await client.project.list({ directory: formatPathForApi(undefined) })

              projects = (projectList.data ?? []).map(project => ({
                id: project.id,
                name: project.name || getDirectoryName(project.worktree),
                directory: project.worktree,
                sessions: [],
              }))
            } catch {
              // 项目列表获取失败时，使用一个兜底的 "All Projects" 分组
              projects = [
                {
                  id: '__all__',
                  name: t('sidebar.allProjects'),
                  sessions: [],
                },
              ]
            }

            // 并行获取每个项目的 session 列表和状态
            await Promise.allSettled(
              projects.map(async project => {
                try {
                  const sessionsData = await client.session.list({
                    directory: formatPathForApi(project.directory),
                    roots: true,
                    limit: 50,
                  })
                  const sessionList = sessionsData.data ?? []

                  // 获取 session 状态（非关键请求，失败不影响整体展示）
                  let statusMap: Record<string, SessionStatus> = {}
                  try {
                    const statusData = await client.session.status({
                      directory: formatPathForApi(project.directory),
                    })
                    statusMap = statusData.data ?? {}
                  } catch {
                    // Status fetch failure is non-critical
                  }

                  project.sessions = sessionList
                    .map(session => ({
                      id: session.id,
                      title: session.title || 'Untitled',
                      directory: session.directory,
                      status: extractStatusType(statusMap[session.id]),
                    }))
                    .sort((a, b) => {
                      // busy session 排在前面
                      if (a.status === 'busy' && b.status !== 'busy') return -1
                      if (a.status !== 'busy' && b.status === 'busy') return 1
                      return 0
                    })
                } catch {
                  project.sessions = []
                }
              }),
            )

            if (!cancelled) {
              setServerNodes(prev =>
                prev.map(node =>
                  node.server.id === server.id ? { ...node, projects, isLoading: false, error: null } : node,
                ),
              )
            }
          } catch (err) {
            if (!cancelled) {
              setServerNodes(prev =>
                prev.map(node =>
                  node.server.id === server.id
                    ? {
                        ...node,
                        isLoading: false,
                        error: err instanceof Error ? err.message : 'Failed to fetch',
                      }
                    : node,
                ),
              )
            }
          }
        }),
      )
    }

    fetchAll()

    return () => {
      cancelled = true
    }
  }, [t])

  /** 点击面板外部区域自动关闭 */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isClosingRef.current) return
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      handleClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [triggerRef])

  /** ESC 键关闭面板 */
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [])

  /** 关闭面板：先触发退出动画，延迟后调用 onClose 卸载组件 */
  const handleClose = useCallback(() => {
    isClosingRef.current = true
    setIsVisible(false)
    setTimeout(() => onClose(), 150)
  }, [onClose])

  /** 切换服务器的展开/收起状态 */
  const toggleServer = useCallback((serverId: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev)
      if (next.has(serverId)) next.delete(serverId)
      else next.add(serverId)
      return next
    })
  }, [])

  /** 切换工程的展开/收起状态 */
  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }, [])

  /** 选中 session：先通知父组件，再关闭面板 */
  const handleSelectSession = useCallback(
    (session: SessionInfo, serverId: string) => {
      onSelectSession(session, serverId)
      handleClose()
    },
    [onSelectSession, handleClose],
  )

  /** 统计所有服务器下的 session 总数 */
  const totalSessions = useMemo(() => {
    return serverNodes.reduce((sum, node) => {
      return sum + node.projects.reduce((s, p) => s + p.sessions.length, 0)
    }, 0)
  }, [serverNodes])

  const floatingPanel = createPortal(
    <div
      ref={panelRef}
      className={`
        fixed z-[9999] rounded-xl border border-border-200/60 glass-alt shadow-lg overflow-hidden
        transition-all duration-150 ease-out
        ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
      `}
      style={{
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        maxHeight: Math.min(520, window.innerHeight - panelPos.top - 16),
        transformOrigin: 'top left',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-200/40 bg-bg-100/60">
        <div>
          <h3 className="text-sm font-semibold text-text-100">{t('sidebar.servers')}</h3>
          <p className="text-[10px] text-text-400 mt-0.5">
            {serverNodes.length} {t('sidebar.servers').toLowerCase()} · {totalSessions}{' '}
            {t('sidebar.sessions').toLowerCase()}
          </p>
        </div>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-md text-text-400 hover:text-text-100 hover:bg-bg-200 transition-colors"
          title={t('common:close')}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* Server List */}
      <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(100% - 52px)' }}>
        {serverNodes.map(node => (
          <ServerTreeItem
            key={node.server.id}
            node={node}
            isExpanded={expandedServers.has(node.server.id)}
            expandedProjects={expandedProjects}
            onToggleServer={toggleServer}
            onToggleProject={toggleProject}
            onSelectSession={handleSelectSession}
          />
        ))}
      </div>
    </div>,
    document.body,
  )

  return floatingPanel
}

// ============================================
// Server Tree Item (expandable)
// ============================================

/**
 * 服务器树节点 — 展示服务器名称、URL、健康状态和 session 总数。
 * 点击展开/收起下方工程列表。
 */
function ServerTreeItem({
  node,
  isExpanded,
  expandedProjects,
  onToggleServer,
  onToggleProject,
  onSelectSession,
}: {
  node: ServerNode
  isExpanded: boolean
  expandedProjects: Set<string>
  onToggleServer: (id: string) => void
  onToggleProject: (id: string) => void
  onSelectSession: (session: SessionInfo, serverId: string) => void
}) {
  const { t } = useTranslation(['chat', 'common'])
  const isActive = node.server.id === serverStore.getActiveServer()?.id

  /** 根据健康状态返回对应的图标组件 */
  const statusIcon = (() => {
    const health = node.health
    if (!health || health.status === 'checking') return <SpinnerIcon size={11} className="animate-spin text-text-400" />
    if (health.status === 'online') return <WifiIcon size={11} className="text-success-100" />
    if (health.status === 'unauthorized') return <KeyIcon size={11} className="text-warning-100" />
    return <WifiOffIcon size={11} className="text-danger-100" />
  })()

  /** 该服务器下所有工程的 session 总数 */
  const totalSessions = node.projects.reduce((sum, p) => sum + p.sessions.length, 0)

  return (
    <div className="border-b border-border-200/20 last:border-b-0">
      {/* Server header */}
      <button
        onClick={() => onToggleServer(node.server.id)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-200/40 ${
          isExpanded ? 'bg-bg-200/30' : ''
        }`}
      >
        <ChevronDownIcon
          size={12}
          className={`text-text-400 transition-transform duration-200 shrink-0 ${isExpanded ? '' : '-rotate-90'}`}
        />
        <GlobeIcon size={13} className={isActive ? 'text-accent-main-100' : 'text-text-400'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-text-100 truncate">{node.server.name}</span>
            {isActive && (
              <span className="inline-flex items-center px-1 py-0.5 rounded-full text-[9px] font-medium text-accent-main-100 bg-accent-main-100/10 shrink-0">
                {t('emptyState.current')}
              </span>
            )}
          </div>
          <div className="text-[10px] text-text-400 truncate font-mono flex items-center gap-1">
            {node.server.url}
            {node.server.auth?.password && <KeyIcon size={8} className="shrink-0 text-text-400" />}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {totalSessions > 0 && (
            <span className="text-[10px] text-text-400 bg-bg-200 rounded-full px-1.5 py-0.5">{totalSessions}</span>
          )}
          {statusIcon}
        </div>
      </button>

      {/* Server content */}
      {isExpanded && (
        <div className="bg-bg-200/20">
          {node.isLoading ? (
            <div className="flex items-center justify-center py-4 text-text-400">
              <SpinnerIcon size={14} className="animate-spin mr-2" />
              <span className="text-xs">{t('common:loading')}</span>
            </div>
          ) : node.error ? (
            <div className="px-3 py-3 text-xs text-danger-100">{node.error}</div>
          ) : node.projects.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-400 text-center">{t('sidebar.noProjects')}</div>
          ) : (
            node.projects.map(project => (
              <ProjectTreeItem
                key={project.id}
                project={project}
                serverId={node.server.id}
                isExpanded={expandedProjects.has(project.id)}
                onToggle={onToggleProject}
                onSelectSession={onSelectSession}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ============================================
// Project Tree Item (expandable)
// ============================================

/**
 * 工程树节点 — 展示工程名称、session 数量和活跃 session 数。
 * 点击展开/收起下方的 session 列表。
 */
function ProjectTreeItem({
  project,
  serverId,
  isExpanded,
  onToggle,
  onSelectSession,
}: {
  project: ProjectGroup
  serverId: string
  isExpanded: boolean
  onToggle: (id: string) => void
  onSelectSession: (session: SessionInfo, serverId: string) => void
}) {
  /** 该工程下的 session 总数 */
  const sessionCount = project.sessions.length
  /** 处于 busy 状态的 session 数量 */
  const busyCount = project.sessions.filter(s => s.status === 'busy').length

  return (
    <div className="border-t border-border-200/15">
      {/* Project header */}
      <button
        onClick={() => onToggle(project.id)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 pl-8 text-left transition-colors hover:bg-bg-200/40 ${
          isExpanded ? 'bg-bg-200/20' : ''
        }`}
        disabled={sessionCount === 0}
      >
        <ChevronDownIcon
          size={10}
          className={`text-text-400 transition-transform duration-200 shrink-0 ${
            sessionCount === 0 ? 'invisible' : isExpanded ? '' : '-rotate-90'
          }`}
        />
        <FolderIcon size={12} className="text-text-400 shrink-0" />
        <span className="flex-1 text-xs text-text-200 truncate">{project.name}</span>
        <div className="flex items-center gap-1 shrink-0">
          {busyCount > 0 && (
            <span className="text-[9px] text-success-100 bg-success-100/10 rounded-full px-1 py-0.5">
              {busyCount} {busyCount === 1 ? 'active' : 'active'}
            </span>
          )}
          {sessionCount > 0 && <span className="text-[10px] text-text-400">{sessionCount}</span>}
        </div>
      </button>

      {/* Sessions */}
      {isExpanded && sessionCount > 0 && (
        <div className="bg-bg-100/30">
          {project.sessions.map(session => (
            <SessionItem key={session.id} session={session} serverId={serverId} onSelect={onSelectSession} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================
// Session Item
// ============================================

/**
 * 单个 session 条目 — 展示 session 标题和状态指示点。
 * 状态点颜色：busy=绿色脉冲、idle=灰色、paused=黄色、unknown=深灰。
 */
function SessionItem({
  session,
  serverId,
  onSelect,
}: {
  session: SessionInfo
  serverId: string
  onSelect: (session: SessionInfo, serverId: string) => void
}) {
  /** 根据 session 状态返回对应的 CSS 类名 */
  const statusDot =
    session.status === 'busy'
      ? 'bg-success-100 animate-pulse'
      : session.status === 'idle'
        ? 'bg-text-400'
        : session.status === 'paused'
          ? 'bg-warning-100'
          : 'bg-text-500'

  return (
    <button
      onClick={() => onSelect(session, serverId)}
      className="w-full flex items-center gap-2 px-3 py-1.5 pl-12 text-left transition-colors hover:bg-bg-200/50 group"
    >
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
      <MessageSquareIcon size={11} className="text-text-400 shrink-0" />
      <span className="flex-1 text-[11px] text-text-300 truncate group-hover:text-text-100 transition-colors">
        {session.title}
      </span>
    </button>
  )
}
