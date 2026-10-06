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
import { inboxStore } from '../store/inboxStore'
import { usageExceededStore } from '../store/usageExceededStore'
import { activeSessionStore } from '../store/activeSessionStore'
import { notificationStore } from '../store/notificationStore'
import { soundStore } from '../store/soundStore'
import { playNotificationSoundDeduped } from '../utils/notificationSoundBridge'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { makeSessionKey, sessionKeyToServerId } from '../utils/sessionKey'
import {
  subscribeToServerEvents,
  reconnectServerSSE,
  getSessionStatus,
  getPendingPermissions,
  getPendingForms,
  getSessionMessages,
} from '../api'
import { createSessionPlaceholder } from '../utils/sessionPlaceholder'
import { refreshModels } from './useModels'
import type { EventCallbacks } from '../types/api/event'
import { replyPermission } from '../api/permission'
import { outboxConfirm } from '../api/sendAdmission'
import { autoApproveStore } from '../store/autoApproveStore'
import { multiServerStore } from '../store/multiServerStore'
import type { ApiFormInfo, ApiPermissionRequest } from '../api/types'
import type { SessionStatusMap } from '../types/api/session'
import { INITIAL_MESSAGE_LIMIT } from '../constants'

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
  /** v2：question 由 form 取代 */
  onFormCreated?: (form: ApiFormInfo) => void
  onFormReplied?: (data: { sessionID: string; formID: string }) => void
  onFormCancelled?: (data: { sessionID: string; formID: string }) => void
  onScrollRequest?: () => void
  onSessionIdle?: (sessionID: string) => void
  /** v2：会话错误由 execution.failed 表达 */
  onExecutionFailed?: (sessionID: string) => void
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
const pendingQuestions = new Map<string, PendingRequest<ApiFormInfo>[]>()

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
        getPendingForms(undefined, directory, serverId).catch(() => []),
      ])

      return { directory, statusMap, permissions, questions }
    }),
  )

  const mergedStatusMap: SessionStatusMap = {}
  const permissionMap = new Map<string, ApiPermissionRequest>()
  const questionMap = new Map<string, ApiFormInfo>()
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
            activeSessionStore.addPendingRequest(
              pending.requestId,
              pending.sessionId,
              pending.type,
              pending.description,
            )
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

    // ============================================
    // 执行结束后仍有工具停在 streaming/running → 重拉消息列表
    // ============================================
    //
    // 官方 data.ts 的行为：`session.execution.succeeded|failed|interrupted` 之后，
    // 若该会话里还有工具没收到收尾事件（SSE 丢包 / 断线），说明本地增量已经不完整，
    // 此时失效并重拉消息列表，让 UI 回到服务端权威状态。
    // store 不做任何 I/O，因此这一步必须在事件层完成。

    const hasLiveTool = (sessionId: string): boolean => {
      const state = messageStore.getSessionState(sessionId)
      if (!state) return false
      return state.messages.some(
        message =>
          message.type === 'assistant' &&
          message.content.some(
            content =>
              content.type === 'tool' && (content.state.status === 'streaming' || content.state.status === 'running'),
          ),
      )
    }

    const refreshIfToolStillLive = (sessionId: string) => {
      const state = messageStore.getSessionState(sessionId)
      if (!state || !hasLiveTool(sessionId)) return

      void getSessionMessages(
        sessionId,
        Math.max(INITIAL_MESSAGE_LIMIT, state.messages.length),
        state.directory,
        sessionKeyToServerId(sessionId),
      )
        .then(messages => {
          if (disposed) return
          const current = messageStore.getSessionState(sessionId)
          if (!current) return
          messageStore.setMessages(sessionId, messages, {
            directory: current.directory,
            title: current.title,
            hasMoreHistory: current.hasMoreHistory,
            // 撤销点原样保留（store 会按 messageID 重建 history）
            revertState: current.revertState ? { messageID: current.revertState.messageId } : null,
          })
        })
        .catch(() => {
          // best effort：下一次 idle / 重连还会再拉
        })
    }

    const buildServerCallbacks = (serverId: string): EventCallbacks => {
      const scope = (sid: string) => makeSessionKey(serverId, sid)

      return {
        // ============================================
        // 流式文本 / 推理 / 工具 → messageStore
        //
        // v2 没有 v1 的 part 事件（message.part.updated/delta/removed）；
        // 实时输出是一串扁平事件，按 ordinal（文本/推理）或 id（工具）关联。
        //
        // 这里**不接** `session.message.content.updated`：该类型虽然存在于生成
        // 类型里，但不在事件流的联合类型 V2Event 中 —— SSE 根本不会推送它。
        // （我曾实现过 onMessageContentUpdated，看起来"接好了"，实际永远收不到，
        // 属于"实现了却没人调用"的死代码；已删除，避免再次误判。）
        // 助手消息的 content 只有两条来源，都在下面：
        //   1. 文本/推理 → session.text.* / session.reasoning.*
        //   2. 工具 → session.tool.input.started（唯一带工具名）+ called/progress/success/failed
        // ============================================

        /**
         * 工具事件。
         *
         * v2 把工具生命周期拆成 7 个事件；store 用**一个**入口按 `type` 分发
         * （对齐官方 data.ts:919-981），因此这里把事件类型与负载一起传进去。
         * 只有 `input.started` 带工具名（`data.name`）：called / progress /
         * success / failed 都不带，靠 store 里已建好的 tool 定位。
         */
        onToolInputStarted: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleToolEvent({
            type: 'session.tool.input.started',
            data: { ...data, sessionID: scopedId },
            facts,
          })
          scheduleScroll(scopedId)
        },

        onToolInputDelta: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleToolEvent({
            type: 'session.tool.input.delta',
            data: { ...data, sessionID: scopedId },
            facts,
          })
        },

        onToolInputEnded: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleToolEvent({
            type: 'session.tool.input.ended',
            data: { ...data, sessionID: scopedId },
            facts,
          })
        },

        onToolCalled: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleToolEvent({
            type: 'session.tool.called',
            data: { ...data, sessionID: scopedId },
            facts,
          })
          scheduleScroll(scopedId)
        },

        onToolProgress: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleToolEvent({
            type: 'session.tool.progress',
            data: { ...data, sessionID: scopedId },
            facts,
          })
        },

        onToolSuccess: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleToolEvent({
            type: 'session.tool.success',
            data: { ...data, sessionID: scopedId },
            facts,
          })
          scheduleScroll(scopedId)
        },

        onToolFailed: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleToolEvent({
            type: 'session.tool.failed',
            data: { ...data, sessionID: scopedId },
            facts,
          })
          scheduleScroll(scopedId)
        },

        onTextStarted: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleTextStarted({ ...data, sessionID: scopedId })
          scheduleScroll(scopedId)
        },

        onTextDelta: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleTextDelta({ ...data, sessionID: scopedId })
          scheduleScroll(scopedId)
        },

        onTextEnded: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleTextEnded({ ...data, sessionID: scopedId })
          scheduleScroll(scopedId)
        },

        onReasoningStarted: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleReasoningStarted({ ...data, sessionID: scopedId }, facts)
          scheduleScroll(scopedId)
        },

        onReasoningDelta: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleReasoningDelta({ ...data, sessionID: scopedId })
          scheduleScroll(scopedId)
        },

        onReasoningEnded: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleReasoningEnded({ ...data, sessionID: scopedId }, facts)
          scheduleScroll(scopedId)
        },

        /**
         * 重试已排期。
         *
         * 负载是 `{ assistantMessageID, attempt, at, error }`：不接的话，
         * 重试提示只能重新加载后才出现，实时会话中看不到「正在重试」。
         */
        onRetryScheduled: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleRetryScheduled({ ...data, sessionID: scopedId })
        },

        // ---- step / 压缩 / shell / skill / instructions ----
        //
        // 这些事件都带信封 facts（`id` / `created`）：store 用 `id` 派生
        // idle/synthetic/shell/compaction/skill 这些「没有服务端消息 id」的
        // 消息 id（重放时才能保持稳定），用 `created` 填 time.created。

        onStepStarted: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleStepStarted({ ...data, sessionID: scopedId }, facts)
        },

        onStepStreamed: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleStepStreamed({ ...data, sessionID: scopedId }, facts)
        },

        onStepEnded: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleStepEnded({ ...data, sessionID: scopedId }, facts)
        },

        onStepFailed: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleStepFailed({ ...data, sessionID: scopedId }, facts)
        },

        onCompactionStarted: (data, facts) => {
          const scopedId = scope(data.sessionID)
          // 官方 data.ts:1013 同款：压缩消息落位后，其 inbox 条目即出队，
          // 否则队列视图里会留一条永不投递的 compaction 条目
          if (data.inputID) inboxStore.removeItem(scopedId, data.inputID)
          messageStore.handleCompactionStarted({ ...data, sessionID: scopedId }, facts)
        },

        onCompactionDelta: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleCompactionDelta({ ...data, sessionID: scopedId })
        },

        onCompactionEnded: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleCompactionEnded({ ...data, sessionID: scopedId }, facts)
        },

        onCompactionFailed: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleCompactionFailed({ ...data, sessionID: scopedId }, facts)
        },

        onSynthetic: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleSynthetic({ ...data, sessionID: scopedId }, facts)
        },

        onShellStarted: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleShellStarted({ ...data, sessionID: scopedId }, facts)
        },

        onShellEnded: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleShellEnded({ ...data, sessionID: scopedId }, facts)
        },

        onSkillActivated: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleSkillActivated({ ...data, sessionID: scopedId }, facts)
        },

        onInstructionsUpdated: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleInstructionsUpdated({ ...data, sessionID: scopedId }, facts)
        },

        // ---- inbox（prompt 入队 / 投递 / 取消 / 投递方式变更）----
        //
        // 官方 data.ts:749-790 同款：durable 回声用同一 inboxID upsert 用户消息
        // （与发送侧的乐观插入同 id 对账，files/skills 等 durable 字段在此补齐）
        // 并进队列视图（inboxStore）；投递/取消出队，取消同时把转写里的
        // 用户消息整条撤下（retractLocal）。compaction / move 各有专属事件。
        onInboxEnqueued: (data, facts) => {
          const scopedId = scope(data.sessionID)
          // 回声到达 = 服务端已确认该行（官方 outbox.delete 同款）：
          // 此后 POST 失败/回滚都不得再撤它
          outboxConfirm(data.inboxID)
          const item = {
            id: data.inboxID,
            sessionID: data.sessionID,
            time: { created: facts?.created ?? Date.now() },
            ...data.item,
          } as Parameters<typeof inboxStore.upsertItem>[1]
          // 官方 admitLocal：入队条目进队列视图 + 物化进转写（同 id 对账，
          // durable payload/time 覆盖本地猜测）
          inboxStore.upsertItem(scopedId, item)
          messageStore.materializeInboxMessage(scopedId, item)
        },

        onInboxDelivered: (data, facts) => {
          // 服务端开始处理该条目（官方 data.ts:749-763 同款）：
          // 出队列视图 + 把转写里那条改写为投递事件时间并挪到末尾。
          // 队列期间的位置由入队顺序决定，投递后才成为当前回合的输入；
          // 只删队列条目而不挪位置，上屏顺序就不是真实服务器事件的顺序。
          const scopedId = scope(data.sessionID)
          inboxStore.removeItem(scopedId, data.inboxID)
          messageStore.handleInboxDelivered(scopedId, data.inboxID, facts?.created ?? Date.now())
        },

        onInboxCancelled: data => {
          const scopedId = scope(data.sessionID)
          inboxStore.removeItem(scopedId, data.inboxID)
          messageStore.removeMessage(scopedId, data.inboxID)
        },

        onInboxDeliveryChanged: data => {
          inboxStore.updateDelivery(scope(data.sessionID), data.inboxID, data.delivery)
        },

        // ---- 会话级 agent / 模型切换（v2 把它们放在会话状态，不在消息上）----

        onAgentSelected: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleAgentSelected({ ...data, sessionID: scopedId }, facts)
        },

        onModelSelected: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleModelSelected({ ...data, sessionID: scopedId }, facts)
        },

        // ---- 会话用量（成本 / token）----
        //
        // 只更新会话级状态；消息级用量指示仍由 sessionStatsCompute 从消息 tokens 推算。
        onUsageUpdated: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleUsageUpdated({ ...data, sessionID: scopedId })
        },

        // ---- 目录失效 ----
        //
        // 真机验证（v2 服务端 v2.0.14）：`provider.updated` / `model.updated`
        // 在连接建立后与配置变更时确实会推（负载为空 `{}`）。
        // 本地只有 `useModels` 是**模块级缓存**，不刷新就会一直显示旧目录；
        // 其余目录（agents / commands / skills / MCP 资源）都是打开时现拉，无陈旧问题。
        // 官方对应处理：invalidate + 重新 sync（client/solid/data.ts:1208-1215）。
        onProviderUpdated: () => {
          void refreshModels(serverId)
        },
        onModelUpdated: () => {
          void refreshModels(serverId)
        },

        // ---- 执行生命周期 ----
        //
        // busy/idle 以 execution.* 为准兜底写 statusMap：官方 Web App
        // 就是从 session.execution.* 派生会话状态的（session.idle 在
        // schema 已标 deprecated，服务端不一定推 session.status）。

        onExecutionStarted: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleExecutionStarted({ ...data, sessionID: scopedId })
          activeSessionStore.updateStatus(scopedId, { type: 'busy' })
        },

        onExecutionSucceeded: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleExecutionSucceeded({ ...data, sessionID: scopedId }, facts)
          activeSessionStore.updateStatus(scopedId, { type: 'idle' })
          refreshIfToolStillLive(scopedId)
        },

        onExecutionInterrupted: (data, facts) => {
          const scopedId = scope(data.sessionID)
          messageStore.handleExecutionInterrupted({ ...data, sessionID: scopedId }, facts)
          activeSessionStore.updateStatus(scopedId, { type: 'idle' })
          refreshIfToolStillLive(scopedId)
        },

        // 注：`session.usage.updated` 只写进 store 的会话级 cost/tokens；
        // 消息级用量指示仍由 sessionStatsCompute 从消息 tokens 推算，
        // 「服务端值优先还是本地估算优先」留给用量 UI 自己定，这里不做取舍。

        // ============================================
        // Session Events → childSessionStore
        // ============================================

        onSessionCreated: data => {
          // v2 的 session.created 负载以 sessionID 为键（不是 id），
          // 且带 slug/version 等创建期字段。
          const scopedId = scope(data.sessionID)
          activeSessionStore.setSessionMeta(scopedId, data.title, data.location?.directory)

          if (data.parentID) {
            // session.created 的负载是**创建记录**（没有 cost/tokens/time.updated 等），
            // 因此用占位构造器补齐 SessionInfo 的必填字段，而不是强转。
            const placeholder = createSessionPlaceholder({
              id: scopedId,
              title: data.title,
              directory: data.location?.directory,
            })
            childSessionStore.registerChildSession(
              {
                ...placeholder,
                parentID: scope(data.parentID),
                projectID: data.projectID,
              },
              serverId,
            )

            // 处理因时序问题缓存的权限/表单请求
            if (belongsToCurrentSession(scopedId)) {
              for (const req of drainPending(pendingPermissions, scopedId)) {
                dispatchToConsumers(req.sessionID, cb => cb.onPermissionAsked?.(req))
              }
              for (const req of drainPending(pendingQuestions, scopedId)) {
                dispatchToConsumers(req.sessionID, cb => cb.onFormCreated?.(req))
              }
            }
          }

          cleanupExpired(pendingPermissions)
          cleanupExpired(pendingQuestions)
        },

        onSessionIdle: data => {
          const scopedId = scope(data.sessionID)
          messageStore.handleSessionIdle(scopedId)
          childSessionStore.markIdle(scopedId)
          dispatchToConsumers(scopedId, cb => cb.onSessionIdle?.(scopedId))
        },

        onExecutionFailed: (data, facts) => {
          // v2 用 execution.failed 表达会话级失败（取代 v1 的 session.error）
          const scopedId = scope(data.sessionID)
          messageStore.handleExecutionFailed({ ...data, sessionID: scopedId }, facts)
          childSessionStore.markError(scopedId)
          activeSessionStore.updateStatus(scopedId, { type: 'idle' })

          if (!belongsToCurrentSession(scopedId)) {
            const meta = activeSessionStore.getSessionMeta(scopedId)
            const sessionLabel = meta?.title || data.sessionID.slice(0, 8)
            notificationStore.push('error', sessionLabel, 'Session error', scopedId, meta?.directory)
          } else if (isSessionDirectlyOpen(scopedId) && soundStore.getSnapshot().currentSessionEnabled) {
            playNotificationSoundDeduped('error')
          }
          dispatchToConsumers(scopedId, cb => cb.onExecutionFailed?.(scopedId))
          refreshIfToolStillLive(scopedId)
        },

        onSessionRenamed: data => {
          const scopedId = scope(data.sessionID)
          activeSessionStore.setSessionMeta(scopedId, data.title, undefined)
          if (data.title && messageStore.getSessionState(scopedId)) {
            messageStore.updateSessionMetadata(scopedId, { title: data.title })
          }
        },

        onSessionDeleted: data => {
          const scopedId = scope(data.sessionID)
          const removedSessionIds = childSessionStore.getSessionAndDescendants(scopedId)
          clearSessionRuntimeState(scopedId)
          for (const id of removedSessionIds) paneLayoutStore.clearSession(id)
        },

        onServerConnected: () => {
          // 时钟校准不走这里：以前把本地时钟 Date.now() 当"服务器时间"校准，
          // 偏移恒为 0，是伪校准。真实校准在事件分发层用事件自带的 created
          // 完成（api/events.ts → serverStore.calibrateFromServerTimestamp）。
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
          const desc = request.resources?.length ? `${request.action}: ${request.resources[0]}` : request.action

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
        // Form Events（取代 v1 的 Question Events）
        // ============================================

        onFormCreated: data => {
          // v2 的 form.created 把表单包在 data.form 里
          const form = data.form as ApiFormInfo
          const scopedId = scope(form.sessionID)
          const meta = activeSessionStore.getSessionMeta(scopedId)
          const sessionLabel = meta?.title || form.sessionID.slice(0, 8)
          const desc = form.title || 'AI is waiting for your input'

          activeSessionStore.addPendingRequest(form.id, scopedId, 'question', desc)
          if (activeFetchVersions.get(serverId) !== 0) {
            latePendingRequests.set(form.id, {
              requestId: form.id,
              sessionId: scopedId,
              type: 'question',
              description: desc,
              scopeKey: getScopeKey(directoriesRef.current),
              directory: meta?.directory,
            })
          }

          if (!belongsToCurrentSession(scopedId)) {
            notificationStore.push('question', `${sessionLabel} — Question`, desc, scopedId, meta?.directory)
          } else if (isSessionDirectlyOpen(scopedId) && soundStore.getSnapshot().currentSessionEnabled) {
            playNotificationSoundDeduped('question')
          }

          if (belongsToCurrentSession(scopedId)) {
            dispatchToConsumers(scopedId, cb => cb.onFormCreated?.({ ...form, sessionID: scopedId }))
          } else {
            addPending(pendingQuestions, scopedId, { ...form, sessionID: scopedId })
          }
        },

        onFormReplied: data => {
          const scopedId = scope(data.sessionID)
          removePendingByRequestId(pendingQuestions, scopedId, data.id)
          latePendingRequests.delete(data.id)
          activeSessionStore.resolvePendingRequest(data.id)

          if (belongsToCurrentSession(scopedId)) {
            dispatchToConsumers(scopedId, cb => cb.onFormReplied?.({ sessionID: scopedId, formID: data.id }))
          }
        },

        onFormCancelled: data => {
          const scopedId = scope(data.sessionID)
          removePendingByRequestId(pendingQuestions, scopedId, data.id)
          latePendingRequests.delete(data.id)
          activeSessionStore.resolvePendingRequest(data.id)

          if (belongsToCurrentSession(scopedId)) {
            dispatchToConsumers(scopedId, cb => cb.onFormCancelled?.({ sessionID: scopedId, formID: data.id }))
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

          // 用量超限对话框（官方 usage-exceeded-dialogs 同款）：
          // retry + action 且 provider ∈ {opencode, opencode-go} 时上报，
          // 24h 窗口与「不再提示」由 store 判定
          if (data.status.type === 'retry') {
            usageExceededStore.report(data.status.action)
          }

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

    // WSL 服务器端点变化（sidecar 重启换端口）：对已在订阅集合内的服务器定向重连。
    // 不能指望自动重连——旧连接一直「健康」地连着死地址，不断线就永远不会自愈。
    // 不在集合内的无需处理：注册事件本身会触发集合重算 → 建订阅时 URL 现读 serverStore。
    // 注意：不能用「先 subscribe 再 unsubscribe」拆旧建新——订阅是引用计数的，
    // 同服务器 size 只走 1→2→1，连接从不断开（空操作）；reconnectServerSSE 才真正
    // 拆掉旧传输并按新端点重连，且只动 changedId 那条连接，不碰 active 的 SSE
    const offRuntimeChange = serverStore.onServerChange((changedId, reason) => {
      if (reason !== 'server-runtime-updated') return
      if (!subscriptions.has(changedId)) return
      reconnectServerSSE(changedId)
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
