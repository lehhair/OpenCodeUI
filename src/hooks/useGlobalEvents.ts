// ============================================
// useGlobalEvents - 全局 SSE 事件订阅
// ============================================
//
// 职责：
// 1. 订阅全局 SSE 事件流
// 2. 将事件分发到 messageStore
// 3. 追踪子 session 关系（用于权限请求冒泡）
// 4. 与具体 session 无关，处理所有 session 的事件

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { messageStore, childSessionStore, paneLayoutStore, serverStore } from '../store'
import { activeSessionStore } from '../store/activeSessionStore'
import { notificationStore } from '../store/notificationStore'
import { soundStore } from '../store/soundStore'
import { playNotificationSoundDeduped } from '../utils/notificationSoundBridge'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { makeSessionKey, sessionKeyToServerId } from '../utils/sessionKey'
import { subscribeToServerEvents, getSessionStatus, getPendingPermissions, getPendingQuestions } from '../api'
import type { EventCallbacks } from '../types/api/event'
import { replyPermission } from '../api/permission'
import { autoApproveStore } from '../store/autoApproveStore'
import { multiServerStore } from '../store/multiServerStore'
import type { ApiMessage, ApiPart, ApiPermissionRequest, ApiQuestionRequest } from '../api/types'
import type { SessionStatusMap } from '../types/api/session'

// ============================================
// Session-level pub/sub 消费者注册
// ============================================
//
// 支持多个消费者（每个 pane 一个）按 sessionId 注册回调。
// SSE 事件到达后，按 sessionId 找到匹配的消费者分发。

/** 消费者可以注册的回调类型（与 GlobalEventsCallbacks 的子集对应） */
export interface SessionEventCallbacks {
  onPermissionAsked?: (request: ApiPermissionRequest) => void
  onPermissionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionAsked?: (request: ApiQuestionRequest) => void
  onQuestionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionRejected?: (data: { sessionID: string; requestID: string }) => void
  onScrollRequest?: () => void
  onSessionIdle?: (sessionID: string) => void
  onSessionError?: (sessionID: string) => void
  onReconnected?: (reason: 'network' | 'server-switch') => void
}

interface SessionConsumer {
  sessionId: string | null
  callbacks: SessionEventCallbacks
}

/** 全局消费者注册表 */
const sessionConsumers = new Map<string, SessionConsumer>()

/**
 * 注册一个 session 级事件消费者。
 * @param consumerId 唯一标识（通常用 paneId）
 * @param sessionId 关心的 sessionId（null = 不接收事件）
 * @param callbacks 回调函数集
 * @returns 注销函数
 */
export function registerSessionConsumer(
  consumerId: string,
  sessionId: string | null,
  callbacks: SessionEventCallbacks,
): () => void {
  sessionConsumers.set(consumerId, { sessionId, callbacks })
  return () => {
    sessionConsumers.delete(consumerId)
  }
}

/** 更新已注册消费者的 sessionId（pane 切换 session 时，无需重新注册） */
export function updateConsumerSessionId(consumerId: string, sessionId: string | null) {
  const c = sessionConsumers.get(consumerId)
  if (c) c.sessionId = sessionId
}

/** 按 sessionId 找到所有匹配的消费者回调（包括子 session 冒泡） */
function dispatchToConsumers(sessionId: string, invoke: (cb: SessionEventCallbacks) => void): boolean {
  let dispatched = false
  for (const consumer of sessionConsumers.values()) {
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId || childSessionStore.belongsToSession(sessionId, consumer.sessionId)) {
      invoke(consumer.callbacks)
      dispatched = true
    }
  }
  return dispatched
}

/** 检查是否有任何消费者关心此 sessionId */
function hasConsumerForSession(sessionId: string): boolean {
  for (const consumer of sessionConsumers.values()) {
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId) return true
    if (childSessionStore.belongsToSession(sessionId, consumer.sessionId)) return true
  }
  return false
}

function shouldPlayPermissionSound(sessionId: string): boolean {
  if (autoApproveStore.fullAutoMode === 'global') return false

  for (const [consumerId, consumer] of sessionConsumers.entries()) {
    if (!consumer.sessionId) continue
    if (autoApproveStore.getPaneFullAutoMode(consumerId) !== 'session') continue
    if (consumer.sessionId === sessionId || childSessionStore.belongsToSession(sessionId, consumer.sessionId)) {
      return false
    }
  }

  return true
}

/** 检查是否有“其他”消费者仍在使用该 sessionId（排除当前 pane 自己） */
export function hasOtherConsumerForSession(sessionId: string, consumerId: string): boolean {
  for (const [id, consumer] of sessionConsumers.entries()) {
    if (id === consumerId) continue
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId) return true
    if (childSessionStore.belongsToSession(sessionId, consumer.sessionId)) return true
  }
  return false
}

// ============================================
// 待处理请求缓存 - 处理 permission/question 事件先于 session.created 到达的时序问题
// 同一 session 可能有多个 pending 请求，所以用数组
// ============================================
interface PendingRequest<T> {
  request: T
  timestamp: number
}

const pendingPermissions = new Map<string, PendingRequest<ApiPermissionRequest>[]>()
const pendingQuestions = new Map<string, PendingRequest<ApiQuestionRequest>[]>()

// 5秒后过期，防止内存泄漏
const PENDING_TIMEOUT = 5000

function cleanupExpired<T>(map: Map<string, PendingRequest<T>[]>) {
  const now = Date.now()
  for (const [key, arr] of map) {
    const filtered = arr.filter(item => now - item.timestamp <= PENDING_TIMEOUT)
    if (filtered.length === 0) {
      map.delete(key)
    } else if (filtered.length !== arr.length) {
      map.set(key, filtered)
    }
  }
}

function addPending<T>(map: Map<string, PendingRequest<T>[]>, sessionID: string, request: T) {
  const arr = map.get(sessionID) || []
  arr.push({ request, timestamp: Date.now() })
  map.set(sessionID, arr)
}

function drainPending<T>(map: Map<string, PendingRequest<T>[]>, sessionID: string): T[] {
  const arr = map.get(sessionID)
  if (!arr || arr.length === 0) return []
  map.delete(sessionID)
  return arr.map(item => item.request)
}

function getScopeKey(directories?: string[]) {
  if (!directories || directories.length === 0) return '__global__'
  return directories.join('|')
}

function removePendingByRequestId<T extends { id: string }>(
  map: Map<string, PendingRequest<T>[]>,
  sessionID: string,
  requestID: string,
) {
  const arr = map.get(sessionID)
  if (!arr || arr.length === 0) return

  const filtered = arr.filter(item => item.request.id !== requestID)
  if (filtered.length === 0) {
    map.delete(sessionID)
  } else if (filtered.length !== arr.length) {
    map.set(sessionID, filtered)
  }
}

async function fetchActiveScopeData(directories: string[] | undefined, serverId: string) {
  const scopes = directories && directories.length > 0 ? directories : [undefined]
  const results = await Promise.all(
    scopes.map(async directory => {
      const [statusMap, permissions, questions] = await Promise.all([
        getSessionStatus(directory, serverId).catch(() => ({}) as SessionStatusMap),
        getPendingPermissions(undefined, directory, serverId).catch(() => []),
        getPendingQuestions(undefined, directory, serverId).catch(() => []),
      ])

      return { directory, statusMap, permissions, questions }
    }),
  )

  const mergedStatusMap: SessionStatusMap = {}
  const permissionMap = new Map<string, ApiPermissionRequest>()
  const questionMap = new Map<string, ApiQuestionRequest>()
  const sessionMetaEntries: Array<{ sessionId: string; directory?: string }> = []

  results.forEach(({ directory, statusMap, permissions, questions }) => {
    // statusMap 的 key 复合化（事件/store 内部统一用 serverId::sessionId）
    for (const [sid, status] of Object.entries(statusMap)) {
      mergedStatusMap[makeSessionKey(serverId, sid)] = status
    }

    if (directory) {
      Object.keys(statusMap).forEach(sid => {
        sessionMetaEntries.push({ sessionId: makeSessionKey(serverId, sid), directory })
      })
    }

    permissions.forEach(permission => {
      if (directory) {
        sessionMetaEntries.push({ sessionId: makeSessionKey(serverId, permission.sessionID), directory })
      }
      permissionMap.set(permission.id, { ...permission, sessionID: makeSessionKey(serverId, permission.sessionID) })
    })

    questions.forEach(question => {
      if (directory) {
        sessionMetaEntries.push({ sessionId: makeSessionKey(serverId, question.sessionID), directory })
      }
      questionMap.set(question.id, { ...question, sessionID: makeSessionKey(serverId, question.sessionID) })
    })
  })

  return {
    statusMap: mergedStatusMap,
    permissions: Array.from(permissionMap.values()),
    questions: Array.from(questionMap.values()),
    sessionMetaEntries,
  }
}

/**
 * 检查 sessionID 是否属于当前活跃的 session family。
 * 依次检查：
 *   1. focused pane 的 session family
 *   2. pub/sub 消费者注册表（其他 pane）
 */
function belongsToCurrentSession(sessionId: string): boolean {
  const focusedSessionId = paneLayoutStore.getFocusedSessionId()

  // 检查当前 focused pane 的 session family
  if (focusedSessionId) {
    if (sessionId === focusedSessionId) return true
    if (childSessionStore.belongsToSession(sessionId, focusedSessionId)) return true
  }

  // 检查 pub/sub 消费者注册表（多 pane 模式下各 pane 注册的 session）
  if (hasConsumerForSession(sessionId)) return true

  return false
}

/**
 * 检查 session 是否被某个 pane 直接打开。
 *
 * 和 belongsToCurrentSession() 的区别：
 * - belongsToCurrentSession(): 包含当前 session 的子 session family
 * - isSessionDirectlyOpen(): 只认 pane 直接打开的 session 本身
 *
 * 这样父 session 正在查看时，子 session 的事件可以继续在界面内冒泡，
 * 但不会再被当成“当前 session 自己”的提示音来播放。
 */
function isSessionDirectlyOpen(sessionId: string): boolean {
  const focusedSessionId = paneLayoutStore.getFocusedSessionId()
  if (focusedSessionId === sessionId) return true

  for (const consumer of sessionConsumers.values()) {
    if (consumer.sessionId === sessionId) return true
  }

  return false
}

/**
 * 收集当前活跃服务器：
 * - 所有 pane 打开的 session 所属 server
 * - active server
 * - 多服务器模式：白名单订阅的服务器（即使没有 pane 打开也要保持 SSE 连接，避免列表断连）
 */
function collectActiveServerIds(): string[] {
  const ids = new Set<string>()
  for (const leaf of paneLayoutStore.allLeaves()) {
    if (leaf.sessionId) ids.add(sessionKeyToServerId(leaf.sessionId))
  }
  if (ids.size === 0) ids.add(serverStore.getActiveServerId())
  if (multiServerStore.isEnabled()) {
    // 多服务器模式：白名单服务器保持连接 + 至少 active server
    // （白名单的清理在删除服务器时由设置页同步处理）
    for (const serverId of multiServerStore.getSubscribedServerIds()) {
      ids.add(serverId)
    }
    ids.add(serverStore.getActiveServerId())
  }
  // 过滤未注册服务器：WSL 白名单 id 在 sidecar 就绪前就存在于持久化配置中，
  // 而 getServerBaseUrl 对未知 id 静默回退 local——不过滤就会拿 local 的数据
  // 写到 wsl: 键下（数据串服）。服务器注册进 serverStore 时 notify 触发重算，自然入集
  const registered = Array.from(ids).filter(id => serverStore.getServer(id) !== null)
  // 兜底：pane 可能仍指向已失效的服务器（如 WSL sidecar 崩溃后未清理），
  // 过滤后为空会让 SSE 全灭——active server 恒注册，保住它
  return registered.length > 0 ? registered : [serverStore.getActiveServerId()]
}

export function useGlobalEvents(directories?: string[]) {
  const directoriesRef = useRef<string[] | undefined>(directories)
  const refreshRef = useRef<((strategy?: 'replace' | 'merge') => void) | null>(null)
  const initializedDirectoriesRef = useRef(false)

  // 活跃服务器集合：所有 pane 打开的 session 所属 server + active server
  const [activeServerIds, setActiveServerIds] = useState<string[]>(() => collectActiveServerIds())

  // 内容不变时保持引用稳定，避免 useGlobalEvents effect 因新数组引用重跑导致 SSE 全量重连
  const updateActiveServerIds = useCallback(() => {
    setActiveServerIds(prev => {
      const next = collectActiveServerIds()
      if (prev.length === next.length && prev.every((id, index) => id === next[index])) return prev
      return next
    })
  }, [])
  const activeServerIdsRef = useRef(activeServerIds)

  // 订阅集合增量同步入口：主 effect 挂载时写入，集合变化 effect 调用
  const serverSyncRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    activeServerIdsRef.current = activeServerIds
  }, [activeServerIds])

  // pane 布局变化（打开/关闭 session、切换 server）时重算活跃服务器
  useEffect(() => {
    const unsubscribeLayout = paneLayoutStore.subscribe(() => {
      updateActiveServerIds()
    })
    const unsubscribeMulti = multiServerStore.subscribe(() => {
      updateActiveServerIds()
    })
    // 服务器注册/注销（WSL sidecar 就绪注册进 serverStore）也要重算：
    // collectActiveServerIds 现在会过滤未注册 id，就绪事件是它们入集的唯一信号
    const unsubscribeServerStore = serverStore.subscribe(() => {
      updateActiveServerIds()
    })
    return () => {
      unsubscribeLayout()
      unsubscribeMulti()
      unsubscribeServerStore()
    }
  }, [updateActiveServerIds])

  useEffect(() => {
    // 节流滚动
    let scrollPending = false
    const pendingScrollSessionIds = new Set<string>()
    const fetchVersions = new Map<string, number>()
    const activeFetchVersions = new Map<string, number>()
    let disposed = false
    const latePendingRequests = new Map<
      string,
      {
        requestId: string
        sessionId: string
        type: 'permission' | 'question'
        description?: string
        scopeKey: string
        directory?: string
      }
    >()

    const scheduleScroll = (sessionId: string) => {
      pendingScrollSessionIds.add(sessionId)
      if (scrollPending) return
      scrollPending = true
      requestAnimationFrame(() => {
        scrollPending = false

        // 分发到 pub/sub 消费者
        for (const sid of pendingScrollSessionIds) {
          dispatchToConsumers(sid, cb => cb.onScrollRequest?.())
        }
        pendingScrollSessionIds.clear()
      })
    }

    // ============================================
    // 拉取 session 状态 + pending requests（初始化 & 重连共用，按 server）
    // ============================================

    const fetchAndInitialize = (serverId: string, strategy?: 'replace' | 'merge') => {
      const effectiveStrategy = strategy ?? (multiServerStore.isEnabled() ? 'merge' : 'replace')
      const currentVersion = (fetchVersions.get(serverId) ?? 0) + 1
      fetchVersions.set(serverId, currentVersion)
      activeFetchVersions.set(serverId, currentVersion)
      void fetchActiveScopeData(directoriesRef.current, serverId)
        .then(({ statusMap, permissions, questions, sessionMetaEntries }) => {
          if (disposed || currentVersion !== fetchVersions.get(serverId)) return
          if (effectiveStrategy === 'merge') {
            activeSessionStore.mergeStatusRefresh(statusMap)
            activeSessionStore.mergePendingRequests(permissions, questions)
          } else {
            activeSessionStore.initialize(statusMap)
            activeSessionStore.initializePendingRequests(permissions, questions)
          }
          const currentDirectories = directoriesRef.current
          const currentScopeKey = getScopeKey(directoriesRef.current)
          for (const pending of latePendingRequests.values()) {
            // 只处理属于该 server 的 pending（复合 key 前缀）
            if (!pending.sessionId.startsWith(`${serverId}::`)) continue
            const matchesScope = pending.directory
              ? !currentDirectories || currentDirectories.length === 0 || currentDirectories.includes(pending.directory)
              : pending.scopeKey === currentScopeKey
            if (!matchesScope) continue
            activeSessionStore.addPendingRequest(pending.requestId, pending.sessionId, pending.type, pending.description)
          }
          activeSessionStore.setSessionMetaBulk(sessionMetaEntries)
        })
        .catch(() => {
          // best effort: 下次目录切换或 SSE 重连会再拉一次
        })
        .finally(() => {
          if (currentVersion === fetchVersions.get(serverId)) {
            activeFetchVersions.set(serverId, 0)
          }
        })
    }

    const refreshServerHealth = (serverId: string) => {
      void serverStore.checkHealth(serverId).catch(() => {})
    }

    const markPermissionReplied = (sessionID: string, requestID: string) => {
      removePendingByRequestId(pendingPermissions, sessionID, requestID)
      latePendingRequests.delete(requestID)
      activeSessionStore.resolvePendingRequest(requestID)

      // Broadcast to ALL consumers regardless of session match.
      // Each consumer clears its local state by requestID (which is globally unique),
      // so a no-op for consumers that don't have this request.
      for (const { callbacks } of sessionConsumers.values()) {
        callbacks.onPermissionReplied?.({ sessionID, requestID })
      }
    }

    refreshRef.current = (strategy?: 'replace' | 'merge') => {
      for (const serverId of activeServerIdsRef.current) {
        fetchAndInitialize(serverId, strategy)
      }
    }

    const approveGlobalPendingPermissions = () => {
      if (!autoApproveStore.approvePendingOnFullAuto || autoApproveStore.fullAutoMode !== 'global') return

      const serverIds = activeServerIdsRef.current
      const directoriesToFetch =
        directoriesRef.current && directoriesRef.current.length > 0 ? directoriesRef.current : [undefined]

      void Promise.all(
        serverIds.flatMap(serverId =>
          directoriesToFetch.map(async directory => {
            const permissions = await getPendingPermissions(undefined, directory, serverId).catch(() => [])

            await Promise.all(
              permissions.map(async request => {
                if (!autoApproveStore.claimAutoReply(request.id)) return

                const dir =
                  directory ?? activeSessionStore.getSessionMeta(makeSessionKey(serverId, request.sessionID))?.directory
                try {
                  await replyPermission(request.id, 'once', undefined, dir, request.sessionID, serverId)
                  if (!disposed) markPermissionReplied(makeSessionKey(serverId, request.sessionID), request.id)
                } catch {
                  autoApproveStore.releaseAutoReply(request.id)
                }
              }),
            )
          }),
        ),
      )
    }

    const unsubscribeAutoApprove = autoApproveStore.subscribe(approveGlobalPendingPermissions)
    const unsubscribeServerChange = serverStore.onServerChange(serverId => {
      void serverStore.checkHealth(serverId).catch(() => {})
    })

    // ============================================
    // 每个活跃服务器一条 SSE 订阅（事件回调按 server 作用域复合 sessionId）
    // ============================================

    const buildServerCallbacks = (serverId: string): EventCallbacks => {
      const scope = (sid: string) => makeSessionKey(serverId, sid)

      return {
        // ============================================
        // Message Events → messageStore
        // ============================================

        onMessageUpdated: (apiMsg: ApiMessage) => {
          messageStore.handleMessageUpdated({ ...apiMsg, sessionID: scope(apiMsg.sessionID) })
        },

        onPartUpdated: (apiPart: ApiPart) => {
          if ('sessionID' in apiPart && 'messageID' in apiPart) {
            const scopedId = scope(apiPart.sessionID)
            messageStore.handlePartUpdated({
              ...(apiPart as ApiPart & { sessionID: string; messageID: string }),
              sessionID: scopedId,
            })
            scheduleScroll(scopedId)
          }
        },

        onPartDelta: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handlePartDelta({ ...data, sessionID: scopedId })
          scheduleScroll(scopedId)
        },

        onPartRemoved: data => {
          messageStore.handlePartRemoved({ ...data, sessionID: scope(data.sessionID) })
        },

        // ============================================
        // Session Events → childSessionStore
        // ============================================

        onSessionCreated: session => {
          const scopedId = scope(session.id)
          // 注册子 session 关系
          if (session.parentID) {
            childSessionStore.registerChildSession(session, serverId)

            // 处理因时序问题缓存的权限请求（可能有多个）
            if (belongsToCurrentSession(scopedId)) {
              for (const req of drainPending(pendingPermissions, scopedId)) {
                dispatchToConsumers(req.sessionID, cb => cb.onPermissionAsked?.(req))
              }
              for (const req of drainPending(pendingQuestions, scopedId)) {
                dispatchToConsumers(req.sessionID, cb => cb.onQuestionAsked?.(req))
              }
            }
          }

          // 更新 session meta 供 active tab 使用
          activeSessionStore.setSessionMeta(scopedId, session.title, session.directory)

          // 清理过期缓存
          cleanupExpired(pendingPermissions)
          cleanupExpired(pendingQuestions)
        },

        onSessionIdle: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleSessionIdle(scopedId)
          childSessionStore.markIdle(scopedId)
          dispatchToConsumers(scopedId, cb => cb.onSessionIdle?.(scopedId))
        },

        onSessionError: error => {
          const isAbort = error.name === 'MessageAbortedError' || error.name === 'AbortError'
          if (!isAbort && import.meta.env.DEV) {
            console.warn('[GlobalEvents] Session error:', error)
          }
          if (error.sessionID == null || error.sessionID.length < 1) {
            return // Don't handle errors with no sessionID
          }
          const scopedId = scope(error.sessionID)
          messageStore.handleSessionError(scopedId)
          childSessionStore.markError(scopedId)
          if (!isAbort) {
            // 从 Working 列表移除
            activeSessionStore.updateStatus(scopedId, { type: 'idle' })
            // 通知（跳过当前 session family）
            if (!belongsToCurrentSession(scopedId)) {
              const meta = activeSessionStore.getSessionMeta(scopedId)
              const sessionLabel = meta?.title || error.sessionID.slice(0, 8)
              notificationStore.push('error', sessionLabel, 'Session error', scopedId, meta?.directory)
            } else if (isSessionDirectlyOpen(scopedId) && soundStore.getSnapshot().currentSessionEnabled) {
              playNotificationSoundDeduped('error')
            }
          }
          dispatchToConsumers(scopedId, cb => cb.onSessionError?.(scopedId))
        },

        onSessionUpdated: session => {
          const scopedId = scope(session.id)
          // 更新 session meta 供 active tab 使用
          activeSessionStore.setSessionMeta(scopedId, session.title, session.directory)
          if (session.parentID) {
            childSessionStore.registerChildSession(session, serverId)
          }

          // 同步标题到 messageStore，让 Header 等依赖 messageStore 的组件实时更新
          if (session.title && messageStore.getSessionState(scopedId)) {
            messageStore.updateSessionMetadata(scopedId, { title: session.title })
          }
        },

        onSessionDeleted: sessionId => {
          const scopedId = scope(sessionId)
          const removedSessionIds = childSessionStore.getSessionAndDescendants(scopedId)
          clearSessionRuntimeState(scopedId)
          for (const id of removedSessionIds) paneLayoutStore.clearSession(id)
        },

        onServerConnected: data => {
          serverStore.applyServerConnectedTimestamp(serverId, data.timestamp)
        },

        // ============================================
        // Permission Events → callbacks (通过 ref 调用)
        // ============================================

        onPermissionAsked: request => {
          const scopedId = scope(request.sessionID)

          // Full Auto 全局模式拦截 — 所有会话的权限请求直接放行
          if (autoApproveStore.fullAutoMode === 'global') {
            const dir = activeSessionStore.getSessionMeta(scopedId)?.directory
            if (autoApproveStore.claimAutoReply(request.id)) {
              replyPermission(request.id, 'once', undefined, dir, request.sessionID, serverId)
                .then(() => {
                  if (!disposed) markPermissionReplied(scopedId, request.id)
                })
                .catch(() => {
                  autoApproveStore.releaseAutoReply(request.id)
                })
            }
            return
          }

          const meta = activeSessionStore.getSessionMeta(scopedId)
          const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
          const desc = request.patterns?.length ? `${request.permission}: ${request.patterns[0]}` : request.permission

          // Active 列表：注册 pending request
          activeSessionStore.addPendingRequest(request.id, scopedId, 'permission', desc)
          if (activeFetchVersions.get(serverId) !== 0) {
            latePendingRequests.set(request.id, {
              requestId: request.id,
              sessionId: scopedId,
              type: 'permission',
              description: desc,
              scopeKey: getScopeKey(directoriesRef.current),
              directory: meta?.directory,
            })
          }

          // Toast 通知 — 不属于当前 session family 的才弹
          if (!belongsToCurrentSession(scopedId)) {
            notificationStore.push('permission', `${sessionLabel} — Permission`, desc, scopedId, meta?.directory)
          } else if (
            shouldPlayPermissionSound(scopedId) &&
            isSessionDirectlyOpen(scopedId) &&
            soundStore.getSnapshot().currentSessionEnabled
          ) {
            // 当前会话：如果开启了当前会话提示音
            playNotificationSoundDeduped('permission')
          }

          if (belongsToCurrentSession(scopedId)) {
            dispatchToConsumers(scopedId, cb => cb.onPermissionAsked?.({ ...request, sessionID: scopedId }))
          } else {
            addPending(pendingPermissions, scopedId, { ...request, sessionID: scopedId })
          }
        },

        onPermissionReplied: data => {
          markPermissionReplied(scope(data.sessionID), data.requestID)
        },

        // ============================================
        // Question Events
        // ============================================

        onQuestionAsked: request => {
          const scopedId = scope(request.sessionID)
          const meta = activeSessionStore.getSessionMeta(scopedId)
          const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
          const desc = request.questions?.[0]?.header || 'AI is waiting for your input'

          // Active 列表：注册 pending request
          activeSessionStore.addPendingRequest(request.id, scopedId, 'question', desc)
          if (activeFetchVersions.get(serverId) !== 0) {
            latePendingRequests.set(request.id, {
              requestId: request.id,
              sessionId: scopedId,
              type: 'question',
              description: desc,
              scopeKey: getScopeKey(directoriesRef.current),
              directory: meta?.directory,
            })
          }

          // Toast 通知
          if (!belongsToCurrentSession(scopedId)) {
            notificationStore.push('question', `${sessionLabel} — Question`, desc, scopedId, meta?.directory)
          } else if (isSessionDirectlyOpen(scopedId) && soundStore.getSnapshot().currentSessionEnabled) {
            playNotificationSoundDeduped('question')
          }

          if (belongsToCurrentSession(scopedId)) {
            dispatchToConsumers(scopedId, cb => cb.onQuestionAsked?.({ ...request, sessionID: scopedId }))
          } else {
            addPending(pendingQuestions, scopedId, { ...request, sessionID: scopedId })
          }
        },

        onQuestionReplied: data => {
          const scopedId = scope(data.sessionID)
          removePendingByRequestId(pendingQuestions, scopedId, data.requestID)
          latePendingRequests.delete(data.requestID)
          activeSessionStore.resolvePendingRequest(data.requestID)

          if (belongsToCurrentSession(scopedId)) {
            dispatchToConsumers(scopedId, cb => cb.onQuestionReplied?.({ ...data, sessionID: scopedId }))
          }
        },

        onQuestionRejected: data => {
          const scopedId = scope(data.sessionID)
          removePendingByRequestId(pendingQuestions, scopedId, data.requestID)
          latePendingRequests.delete(data.requestID)
          activeSessionStore.resolvePendingRequest(data.requestID)

          if (belongsToCurrentSession(scopedId)) {
            dispatchToConsumers(scopedId, cb => cb.onQuestionRejected?.({ ...data, sessionID: scopedId }))
          }
        },

        // ============================================
        // Session Status → activeSessionStore
        // ============================================

        onSessionStatus: data => {
          const scopedId = scope(data.sessionID)
          const prevStatus = activeSessionStore.getSnapshot().statusMap[scopedId]
          const wasBusy = prevStatus && (prevStatus.type === 'busy' || prevStatus.type === 'retry')

          activeSessionStore.updateStatus(scopedId, data.status)

          // Toast — session 从 busy/retry 变成 idle 时弹 completed 通知
          if (wasBusy && data.status.type === 'idle' && !belongsToCurrentSession(scopedId)) {
            const meta = activeSessionStore.getSessionMeta(scopedId)
            const sessionLabel = meta?.title || data.sessionID.slice(0, 8)
            notificationStore.push('completed', sessionLabel, 'Session completed', scopedId, meta?.directory)
          } else if (
            wasBusy &&
            data.status.type === 'idle' &&
            isSessionDirectlyOpen(scopedId) &&
            soundStore.getSnapshot().currentSessionEnabled
          ) {
            playNotificationSoundDeduped('completed')
          }
        },

        // ============================================
        // Reconnected → 通知调用方刷新数据 + 重新拉取 session status
        // ============================================

        onReconnected: reason => {
          if (import.meta.env.DEV) {
            console.log(`[GlobalEvents] SSE reconnected (${serverId}, reason: ${reason}), notifying for data refresh`)
          }
          refreshServerHealth(serverId)
          // 重连后重新拉取全量状态 + pending requests
          fetchAndInitialize(serverId)
          // 通知所有 pub/sub 消费者
          for (const consumer of sessionConsumers.values()) {
            consumer.callbacks.onReconnected?.(reason)
          }
        },
      }
    }

    // 订阅集合增量管理（Map 按 serverId 索引）：服务器加入 → 只连新的
    // （建订阅 + 初始拉取 + 健康检查），移出 → 只拆旧的。集合变化不再
    // 触发全量 SSE 拆建与全量重拉（WSL 就绪注册、active 切换是典型场景）
    const subscriptions = new Map<string, () => void>()
    const syncSubscriptions = () => {
      const desired = activeServerIdsRef.current
      let attached = false
      for (const [serverId, unsubscribe] of subscriptions) {
        if (!desired.includes(serverId)) {
          unsubscribe()
          subscriptions.delete(serverId)
        }
      }
      for (const serverId of desired) {
        if (subscriptions.has(serverId)) continue
        subscriptions.set(serverId, subscribeToServerEvents(serverId, buildServerCallbacks(serverId)))
        fetchAndInitialize(serverId)
        refreshServerHealth(serverId)
        attached = true
      }
      // 有新服务器接入时补一次全局自动审批（该服务器上的 pending 权限也要被处理）
      if (attached) approveGlobalPendingPermissions()
    }
    serverSyncRef.current = syncSubscriptions
    syncSubscriptions()

    // WSL 服务器端点变化（sidecar 重启换端口）：对已在订阅集合内的定向拆旧建新。
    // 不能指望自动重连——旧连接一直「健康」地连着死地址，不断线就永远不会自愈。
    // 不在集合内的无需处理：注册事件本身会触发集合重算 → 建订阅时 URL 现读 serverStore
    const offRuntimeChange = serverStore.onServerChange((changedId, reason) => {
      if (reason !== 'server-runtime-updated') return
      const unsubscribe = subscriptions.get(changedId)
      if (!unsubscribe) return
      subscriptions.set(changedId, subscribeToServerEvents(changedId, buildServerCallbacks(changedId)))
      unsubscribe()
    })

    return () => {
      disposed = true
      refreshRef.current = null
      serverSyncRef.current = null
      offRuntimeChange()
      subscriptions.forEach(unsubscribe => unsubscribe())
      unsubscribeAutoApprove()
      unsubscribeServerChange()
    }
  }, [])

  // 活跃服务器集合变化 → 增量同步订阅（ref 由前面的 effect 更新，
  // syncSubscriptions 由主 effect 挂载；主 effect 本身只在 mount 跑一次）
  useEffect(() => {
    serverSyncRef.current?.()
  }, [activeServerIds])

  useLayoutEffect(() => {
    directoriesRef.current = directories
    if (initializedDirectoriesRef.current) {
      refreshRef.current?.('merge')
      return
    }
    initializedDirectoriesRef.current = true
  }, [directories])
}
