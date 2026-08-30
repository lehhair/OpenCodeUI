// ============================================
// MultiServerFolderList - 多服务器模式的文件夹分组会话列表
//
// 结构 = 文件夹模式 + 服务器层级：
//   ● 服务器1（状态点 + 服务器名；行结构、拖拽方式、拖拽时自动收起与文件夹行完全一致）
//      FolderRecentList（原封不动的文件夹模式：全局 + 工作区文件夹 → session）
//   ● 服务器2
//      ...
//
// 工作区数据统一复用 per-server storage 的 saved-directories（与单服务器模式
// 完全相同的存储），多服务器只是显示层面的按服务器分组，不做独立存储。
// ============================================

import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useServerStore } from '../../../hooks/useServerStore'
import { serverStore } from '../../../store/serverStore'
import { multiServerStore } from '../../../store/multiServerStore'
import { subscribeToServerConnectionState, getServerConnectionInfo, type ConnectionInfo } from '../../../api/events'
import { ExpandableSection } from '../../../components/ui'
import { GripVerticalIcon } from '../../../components/Icons'
import { subscribePerServerStorageVersion, getStorageVersion } from '../../../utils/perServerStorage'
import { useDirectory } from '../../../contexts/useDirectory'
import {
  readServerWorkspaces,
  addServerWorkspace,
  reorderServerWorkspaces,
} from '../../../utils/serverWorkspaces'
import { deleteSession, updateSession, type ApiSession } from '../../../api'
import { isSameDirectory } from '../../../utils'
import { clearSessionRuntimeState } from '../../../utils/sessionLifecycle'
import { uiErrorHandler } from '../../../utils'
import { isWslServerId } from '../../wsl/settings-model'
import {
  FolderRecentList,
  createDirectoryProject,
  useReorderableList,
  useCollapseExpandedIdsOnDrag,
  type FolderRecentProject,
} from './FolderRecentList'

interface MultiServerFolderListProps {
  serverIds: string[]
  selectedSessionId: string | null
  currentDirectory?: string
  onSelectSession: (session: ApiSession & { serverId?: string }) => void
  /** 点击服务器节点：切焦点服务器并进入该服务器的新建会话页 */
  onNewSession: () => void
  /** 子会话展示（SidePanel 按选中/活跃计算；key 为原始 id，与列表 session.id 一致） */
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
}

function useServerConnectionState(serverId: string): ConnectionInfo {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      serverId ? subscribeToServerConnectionState(serverId, onStoreChange) : () => {},
    [serverId],
  )
  const getSnapshot = useCallback(() => getServerConnectionInfo(serverId), [serverId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function statusDotClass(state: ConnectionInfo['state']): string {
  switch (state) {
    case 'connected':
      return 'bg-success-100'
    case 'connecting':
      return 'bg-warning-100'
    case 'error':
      return 'bg-error-100'
    default:
      return 'bg-text-500/50'
  }
}

const ServerFolderGroup = memo(function ServerFolderGroup({
  serverId,
  selectedSessionId,
  currentDirectory,
  onSelectSession,
  onNewSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  isExpanded,
  onToggleExpanded,
  isDragged,
  registerRef,
  onDragStart,
  onTouchDragStart,
  onTouchMove,
  onTouchEnd,
}: {
  serverId: string
  selectedSessionId: string | null
  currentDirectory?: string
  onSelectSession: (session: ApiSession & { serverId?: string }) => void
  onNewSession: () => void
  expandedChildSessionIds?: Set<string>
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  isExpanded: boolean
  onToggleExpanded: () => void
  isDragged: boolean
  registerRef: (el: HTMLDivElement | null) => void
  onDragStart: (e: React.PointerEvent) => void
  onTouchDragStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}) {
  // 与 FolderRecentList / SidePanel 一致的 namespace，保证 t('sidebar.global') 等翻译正确
  const { t } = useTranslation(['chat', 'common'])
  const { getHealth } = useServerStore()
  const server = serverStore.getServer(serverId)
  const health = getHealth(serverId)
  const connectionState = useServerConnectionState(serverId)
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])

  // 该服务器的工作区 = 该服务器 per-server storage 的 saved-directories（与单服务器模式同一套存储）
  // 版本号在写入时递增 → 触发重渲染并重读数据
  const storageVersion = useSyncExternalStore(
    subscribePerServerStorageVersion,
    getStorageVersion,
    getStorageVersion,
  )
  const workspaces = useMemo(() => {
    void storageVersion
    return readServerWorkspaces(serverId)
  }, [serverId, storageVersion])

  // 展示顺序：global 固定第一，工作区按存储顺序
  const projects = useMemo<FolderRecentProject[]>(() => {
    const globalProject: FolderRecentProject = {
      id: 'global',
      worktree: '',
      name: t('sidebar.global'),
      sectionKind: 'project',
      canReorder: true,
    }
    return [
      globalProject,
      ...workspaces.map(dir => ({ ...createDirectoryProject(dir, 'project'), canReorder: true })),
    ]
  }, [workspaces, t])

  // 仅当当前选中的 session 属于本服务器时才高亮（复合 key 前缀匹配），
  // 避免多个服务器连同一后端时同名 session 串高亮
  const localSelectedSessionId = useMemo(() => {
    const prefix = `${serverId}::`
    return selectedSessionId && selectedSessionId.startsWith(prefix)
      ? selectedSessionId.slice(prefix.length)
      : null
  }, [serverId, selectedSessionId])

  // 与文件夹模式（SidePanel.handleSelectFolderProject）完全一致的点击行为：
  // 已在当前目录 → 跳过 setCurrentDirectory（否则 currentDirectory 值变化会触发
  // FolderRecentList 的 reconcile effect 把目录强制展开，吞掉「点击已展开文件夹=收起」）
  const { setCurrentDirectory } = useDirectoryCtx()
  const handleSelectProject = useCallback(
    (project: FolderRecentProject) => {
      const wasFocusedServer = multiServerStore.getFocusedServerId() === serverId
      // 项目选择器焦点同步到该文件夹所在的服务器
      multiServerStore.setFocusedServerId(serverId)
      if (!project.worktree) {
        // global 文件夹：已在 global 且焦点本就在该服务器 → 跳过（点击=收起）；否则清目录
        if (wasFocusedServer && !currentDirectory) return
        setCurrentDirectory(undefined)
        return
      }
      // 仅「同一服务器 + 已在当前目录」才跳过（让 FolderRow 的 toggle 收起生效）。
      // 跨服务器即使路径相同也要切换目录上下文（A/B 同后端时路径相同但服务器不同）
      if (wasFocusedServer && currentDirectory && isSameDirectory(currentDirectory, project.worktree)) return
      setCurrentDirectory(project.worktree)
    },
    [serverId, currentDirectory, setCurrentDirectory],
  )

  const displayName = server?.name ?? serverId

  return (
    <div
      ref={registerRef}
      onTouchStart={onTouchDragStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`relative transition-all duration-150 group/folder ${
        isDragged
          ? 'z-10 shadow-lg shadow-black/20 ring-1 ring-inset ring-accent-main-100/30 rounded-md bg-bg-100'
          : ''
      }`}
    >
      {/* 服务器节点行 — 与文件夹行结构完全一致（含 drag-handle），图标位换成连接状态点 */}
      <div className="relative flex w-full items-center transition-colors duration-150 select-none rounded-md hover:bg-bg-200/40">
        <button
          type="button"
          onClick={() => {
            // 本身就在这个节点 → 展开/收起；不在这个节点 → 切焦点服务器 + 进入该服务器新建会话页
            const wasFocused = multiServerStore.getFocusedServerId() === serverId
            multiServerStore.setFocusedServerId(serverId)
            if (wasFocused) {
              onToggleExpanded()
            } else {
              onNewSession()
            }
          }}
          className="flex flex-1 min-w-0 items-center gap-2 pl-2 pr-2 py-1.5 text-left cursor-default select-none"
          title={server?.url ?? serverId}
        >
          {/* size-5 图标位 → 连接状态点 */}
          <span className="relative size-5 shrink-0 flex items-center justify-center">
            <span className={`h-2 w-2 rounded-full ${statusDotClass(connectionState.state)}`} />
            {connectionState.state === 'connected' && (
              <span
                className={`absolute h-2 w-2 rounded-full ${statusDotClass(connectionState.state)} animate-ping opacity-50`}
              />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium text-text-300">
            {displayName}
            {isWslServerId(serverId) && (
              <span
                className="ml-1.5 shrink-0 text-[length:var(--fs-xs)] font-medium text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded"
              >
                {t('wsl.server.label', { ns: 'settings' })}
              </span>
            )}
            {health?.status === 'online' && health.version ? ` · v${health.version}` : ''}
          </span>
        </button>
        {/* 拖拽把手 — 与文件夹行完全一致（服务器拖拽排序） */}
        <span
          data-drag-handle
          onPointerDown={onDragStart}
          className="shrink-0 flex items-center justify-center w-0 group-hover/folder:w-5 overflow-hidden cursor-grab active:cursor-grabbing text-text-500 opacity-0 group-hover/folder:opacity-60 hover:!opacity-100 transition-all duration-150 touch-none"
          title={t('sidebar.dragToReorder', { defaultValue: 'Drag to reorder' })}
        >
          <GripVerticalIcon size={12} />
        </span>
      </div>

      {/* 展开内容：文件夹缩进在服务器节点下（内容自然展开，随外层滚动） */}
      <ExpandableSection show={isExpanded}>
        <div className="pl-3">
          <FolderRecentList
            key={serverId}
            serverId={serverId}
            projects={projects}
              currentDirectory={currentDirectory}
              selectedSessionId={localSelectedSessionId}
              expandedProjectIds={expandedProjectIds}
              onExpandedProjectIdsChange={setExpandedProjectIds}
              onSelectProject={handleSelectProject}
              onSelectSession={session => {
                // 全局文件夹（无工作区归属）点 session：自动把目录加入该服务器工作区（与文件夹模式一致）
                if (session.directory) {
                  addServerWorkspace(serverId, session.directory)
                }
                onSelectSession({ ...session, serverId } as ApiSession & { serverId?: string })
              }}
              onRenameSession={async session => {
                await updateSession(session.id, { title: session.title }, session.directory, serverId)
              }}
              onDeleteSession={async session => {
                try {
                  await deleteSession(session.id, session.directory, serverId)
                  clearSessionRuntimeState(`${serverId}::${session.id}`)
                } catch (e) {
                  uiErrorHandler('delete session', e)
                }
              }}
              onReorderProject={(draggedPath, targetPath) => {
                reorderServerWorkspaces(serverId, draggedPath, targetPath)
              }}
              expandedChildSessionIds={expandedChildSessionIds}
              inlineChildSessions={inlineChildSessions}
              onSelectChildSession={onSelectChildSession}
              pinnedSessions={[]}
            />
        </div>
      </ExpandableSection>
    </div>
  )
})

/** 轻量 useDirectory 取值（取 currentDirectory + setCurrentDirectory） */
function useDirectoryCtx() {
  return useDirectory()
}

export function MultiServerFolderList({
  serverIds,
  selectedSessionId,
  currentDirectory,
  onSelectSession,
  onNewSession,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
}: MultiServerFolderListProps) {
  // 服务器展开状态（父级管理，拖拽时自动收起/恢复 — 与文件夹模式对齐）
  const [expandedServerIds, setExpandedServerIds] = useState<string[]>(() => [...serverIds])
  useEffect(() => {
    setExpandedServerIds(prev => {
      const missing = serverIds.filter(id => !prev.includes(id))
      return missing.length > 0 ? [...prev, ...missing] : prev
    })
  }, [serverIds])

  const { handleDragActivated, handleDragFinished } = useCollapseExpandedIdsOnDrag(
    expandedServerIds,
    setExpandedServerIds,
  )

  // 服务器节点列表的拖拽 — 与文件夹模式完全相同的 useReorderableList 实现（拖拽时收起）
  const {
    draggedId,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  } = useReorderableList({
    ids: serverIds,
    canDrag: () => true,
    onCommit: (draggedId, targetId) => {
      const current = multiServerStore.getSubscribedServerIds()
      const next = [...current]
      const from = next.indexOf(draggedId)
      const to = next.indexOf(targetId)
      if (from !== -1 && to !== -1) {
        next.splice(from, 1)
        next.splice(to, 0, draggedId)
        multiServerStore.setSubscribedServerIds(next)
      }
    },
    onDragActivated: handleDragActivated,
    onDragFinished: handleDragFinished,
  })

  const handleToggleServer = useCallback((serverId: string) => {
    setExpandedServerIds(prev => (prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId]))
  }, [])

  // 稳定回调（ServerFolderGroup 是 memo 组件：内联箭头会让每次父级重渲染都穿透 memo）
  const makeToggleExpanded = useCallback(
    (serverId: string) => () => handleToggleServer(serverId),
    [handleToggleServer],
  )
  const makeRegisterRef = useCallback(
    (serverId: string) => (el: HTMLDivElement | null) => registerRef(serverId, el),
    [registerRef],
  )
  const makeDragStart = useCallback(
    (serverId: string) => (e: React.PointerEvent) => handlePointerStart(serverId, e),
    [handlePointerStart],
  )
  const makeTouchDragStart = useCallback(
    (serverId: string) => (e: React.TouchEvent) => handleTouchStart(serverId, e),
    [handleTouchStart],
  )

  // 焦点服务器 id（快照；ServerFolderGroup 内部已用 memo，这里只需在父级重渲染时更新）
  const focusedServerId = multiServerStore.getFocusedServerId()

  return (
    // 根容器与 FolderRecentList 相同的 px-1.5 内边距，保证服务器行图标与文件夹图标对齐
    <div className="h-full overflow-y-auto custom-scrollbar px-1.5">
      {displayOrder.map(serverId => (
        <ServerFolderGroup
          key={serverId}
          serverId={serverId}
          selectedSessionId={selectedSessionId}
          // 非焦点服务器不传全局 currentDirectory：避免 reconcile effect 强制展开/高亮同路径文件夹，
          // 同时让 memo 对非焦点组保持 currentDirectory 恒 undefined（父级重渲染时跳过）
          currentDirectory={serverId === focusedServerId ? currentDirectory : undefined}
          onSelectSession={onSelectSession}
          onNewSession={onNewSession}
          isExpanded={expandedServerIds.includes(serverId)}
          onToggleExpanded={makeToggleExpanded(serverId)}
          isDragged={draggedId === serverId}
          registerRef={makeRegisterRef(serverId)}
          onDragStart={makeDragStart(serverId)}
          onTouchDragStart={makeTouchDragStart(serverId)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          expandedChildSessionIds={expandedChildSessionIds}
          inlineChildSessions={inlineChildSessions}
          onSelectChildSession={onSelectChildSession}
        />
      ))}
    </div>
  )
}
