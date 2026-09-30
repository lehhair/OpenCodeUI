// ============================================
// SearchResults - 侧栏全局搜索结果（多服务器模式）
//
// 搜索范围：服务器节点 + 文件夹（工作区）+ session
//   - 服务器 / 文件夹：本地即时过滤（白名单服务器 + 每服务器 saved-directories）
//   - session：per-server API 搜索（getSessions({search}, serverId)，防抖 300ms）
//
// 结果按「服务器 → 文件夹 → session」三级分组展示，与浏览视图结构一致。
// 单服务器模式不启用本组件（保持原有 SessionList 搜索行为不变）。
// ============================================

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { getSessions, type ApiSession } from '../../../api'
import { makeSessionKey } from '../../../utils/sessionKey'
import { serverStore } from '../../../store/serverStore'
import { multiServerStore, useMultiServerStore } from '../../../store/multiServerStore'
import { useDirectory } from '../../../contexts/useDirectory'
import { readServerWorkspaces } from '../../../utils/serverWorkspaces'
import { getStorageVersion, subscribePerServerStorageVersion } from '../../../utils/perServerStorage'
import { subscribeToServerConnectionState, getServerConnectionInfo, type ConnectionInfo } from '../../../api/events'
import { ChevronDownIcon, FolderIcon, MessageSquareIcon } from '../../../components/Icons'
import { useServerStore } from '../../../hooks/useServerStore'

function statusDotClass(state: ConnectionInfo['state']): string {
  switch (state) {
    case 'connected':
      return 'bg-success-100'
    case 'connecting':
      return 'bg-warning-100'
    case 'error':
      return 'bg-danger-100'
    default:
      return 'bg-text-500/50'
  }
}

/** 关键词分词（空格分隔，任一分词命中即匹配） */
function splitTerms(search: string): string[] {
  return search.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function useServerConnectionState(serverId: string): ConnectionInfo {
  const subscribe = useCallback(
    (onStoreChange: () => void) => (serverId ? subscribeToServerConnectionState(serverId, onStoreChange) : () => {}),
    [serverId],
  )
  const getSnapshot = useCallback(() => getServerConnectionInfo(serverId), [serverId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

interface ServerSearchGroupProps {
  serverId: string
  search: string
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession & { serverId?: string }) => void
  /** 是否显示服务器组头（多服务器模式；单服务器模式直接平铺文件夹/session） */
  showHeader?: boolean
}

function ServerSearchGroup({
  serverId,
  search,
  selectedSessionId,
  onSelectSession,
  showHeader = true,
}: ServerSearchGroupProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { setCurrentDirectory } = useDirectory()
  const server = serverStore.getServer(serverId)
  const { getHealth } = useServerStore()
  const health = getHealth(serverId)
  const connectionState = useServerConnectionState(serverId)
  const [expanded, setExpanded] = useState(true)

  // 工作区列表（本地；storage 写入时刷新）
  const storageVersion = useSyncExternalStore(subscribePerServerStorageVersion, getStorageVersion, getStorageVersion)
  const workspaces = useMemo(() => {
    void storageVersion
    return readServerWorkspaces(serverId)
  }, [serverId, storageVersion])

  // 本地匹配：服务器名称/URL + 文件夹路径
  const matchedFolders = useMemo(() => {
    const terms = splitTerms(search)
    if (terms.length === 0) return []
    return workspaces.filter(dir => {
      const name = dir.split('/').pop() ?? dir
      return terms.some(term => dir.toLowerCase().includes(term) || name.toLowerCase().includes(term))
    })
  }, [workspaces, search])

  const serverMatched = useMemo(() => {
    const terms = splitTerms(search)
    if (terms.length === 0) return false
    const name = server?.name ?? serverId
    const url = server?.url ?? ''
    return terms.some(term => name.toLowerCase().includes(term) || url.toLowerCase().includes(term))
  }, [server, serverId, search])

  // session：per-server API 搜索（防抖）
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const terms = splitTerms(search)
    const requestId = ++requestIdRef.current
    if (terms.length === 0) {
      setSessions([])
      setIsLoadingSessions(false)
      return
    }
    const timer = window.setTimeout(() => {
      setIsLoadingSessions(true)
      getSessions({ search, roots: false, limit: 50 }, serverId)
        .then(data => {
          if (requestId === requestIdRef.current) setSessions(data)
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setSessions([])
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setIsLoadingSessions(false)
        })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, serverId])

  const hasMatch = serverMatched || matchedFolders.length > 0 || sessions.length > 0
  if (!hasMatch) return null

  const displayName = server?.name ?? serverId
  const folderCount = matchedFolders.length
  const sessionCount = sessions.length

  // 单服务器模式：无组头，直接展开内容
  const body = (
    <div className="ml-1.5 pl-2 border-l border-border-200/40">
      {/* 匹配文件夹：点击切焦点服务器 + 目录 */}
      {matchedFolders.map(dir => (
        <button
          key={dir}
          type="button"
          onClick={() => {
            if (multiServerStore.isEnabled()) {
              multiServerStore.setFocusedServerId(serverId)
            }
            setCurrentDirectory(dir)
          }}
          className="flex w-full items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-bg-200/40"
          title={dir}
        >
          <FolderIcon size={13} className="shrink-0 text-text-400" />
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-200">
            {dir.split('/').pop() || dir}
          </span>
          <span className="shrink-0 max-w-[40%] truncate text-[length:var(--fs-xxs)] text-text-400/70">{dir}</span>
        </button>
      ))}

      {/* 匹配 session */}
      {sessions.map(session => {
        // 精确匹配复合 key（serverId::sessionId）：两个服务器连同一后端时 session.id 相同，
        // 用 endsWith 会把两个服务器的同名 session 都高亮，必须带服务器前缀精确匹配
        const isSelected = !!selectedSessionId && selectedSessionId === makeSessionKey(serverId, session.id)
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelectSession({ ...session, serverId })}
            className={`flex w-full items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-bg-200/40 ${
              isSelected ? 'bg-bg-200/60' : ''
            }`}
            title={session.directory}
          >
            <MessageSquareIcon size={13} className="shrink-0 text-text-400" />
            <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-200">
              {session.title || t('sessions.untitledChat', { defaultValue: 'Untitled chat' })}
            </span>
            {session.directory && (
              <span className="shrink-0 max-w-[40%] truncate text-[length:var(--fs-xxs)] text-text-400/70">
                {session.directory}
              </span>
            )}
          </button>
        )
      })}

      {/* session 搜索中 */}
      {isLoadingSessions && sessions.length === 0 && (
        <div className="px-2 py-1 text-[length:var(--fs-xxs)] text-text-400/70">
          {t('sidebar.searchingSessions', { defaultValue: '搜索会话中…' })}
        </div>
      )}

      {/* 服务器本身命中但无文件夹/session */}
      {serverMatched && sessions.length === 0 && matchedFolders.length === 0 && (
        <div className="px-2 py-1 text-[length:var(--fs-xxs)] text-text-400/70">
          {t('sidebar.searchServerMatchHint', { defaultValue: '服务器匹配 · 点击组头切换焦点' })}
        </div>
      )}
    </div>
  )

  if (!showHeader) {
    return body
  }

  return (
    <div className="mb-0.5">
      {/* 服务器组头：点击切换焦点服务器 + 折叠/展开 */}
      <button
        type="button"
        onClick={() => {
          multiServerStore.setFocusedServerId(serverId)
          setExpanded(prev => !prev)
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left select-none hover:bg-bg-200/40"
        title={server?.url ?? serverId}
      >
        <span className="relative size-5 shrink-0 flex items-center justify-center">
          <span className={`h-2 w-2 rounded-full ${statusDotClass(connectionState.state)}`} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium text-text-300">
          {displayName}
          {health?.status === 'online' && health.version ? ` · v${health.version}` : ''}
        </span>
        {(folderCount > 0 || sessionCount > 0) && (
          <span className="shrink-0 text-[length:var(--fs-xxs)] text-text-400/80">
            {folderCount > 0 ? `${folderCount}${t('sidebar.searchFolderUnit', { defaultValue: ' 文件夹' })}` : ''}
            {folderCount > 0 && sessionCount > 0 ? ' · ' : ''}
            {sessionCount > 0 ? `${sessionCount}${t('sidebar.searchSessionUnit', { defaultValue: ' 会话' })}` : ''}
          </span>
        )}
        <ChevronDownIcon
          size={12}
          className={`shrink-0 text-text-400 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
        />
      </button>

      {expanded && body}
    </div>
  )
}

interface SearchResultsProps {
  search: string
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession & { serverId?: string }) => void
}

export function SearchResults({ search, selectedSessionId, onSelectSession }: SearchResultsProps) {
  const { t } = useTranslation(['chat', 'common'])

  // 活动服务器（响应式：单服务器模式切服务器后刷新）
  const activeServerId = useSyncExternalStore(
    cb => serverStore.subscribe(cb),
    () => serverStore.getActiveServerId(),
    () => serverStore.getActiveServerId(),
  )
  // 响应式订阅多服务器配置：白名单增删 / 拖拽重排 / 开关切换都会重算服务器集合
  const multiServerConfig = useMultiServerStore()

  // 多服务器模式：白名单服务器（过滤已删除的）；单服务器：活动服务器
  const serverIds = useMemo(() => {
    if (multiServerConfig.enabled) {
      return multiServerConfig.subscribedServerIds.filter(id => serverStore.getServers().some(s => s.id === id))
    }
    return [activeServerId]
  }, [multiServerConfig, activeServerId])

  if (splitTerms(search).length === 0) return null

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-1.5 py-1 select-none">
      <div className="px-2 pt-1 pb-1.5 text-[length:var(--fs-xxs)] font-medium uppercase tracking-wider text-text-400">
        {t('sidebar.searchResults', { defaultValue: 'Search results' })}
      </div>
      {serverIds.map(serverId => (
        <ServerSearchGroup
          key={serverId}
          serverId={serverId}
          search={search}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          showHeader={multiServerConfig.enabled}
        />
      ))}
      <div className="px-2 py-3 text-center text-[length:var(--fs-xs)] text-text-400/70">
        {t('sidebar.searchHint', {
          defaultValue: '按服务器、文件夹或会话名称搜索',
        })}
      </div>
    </div>
  )
}
