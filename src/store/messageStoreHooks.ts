// ============================================
// MessageStore React Hooks
// ============================================
//
// React 绑定层：snapshot 缓存 + useSyncExternalStore hooks
// 与 messageStore.ts 的纯 store 逻辑分离

import { useSyncExternalStore, useRef, useCallback } from 'react'
import { messageStore } from './messageStore'
import { paneLayoutStore } from './paneLayoutStore'
import type { MessageStoreSnapshot, SessionStateSnapshot } from './messageStoreTypes'

// ============================================
// Snapshot Cache (避免 useSyncExternalStore 无限循环)
// ============================================

let cachedSnapshot: MessageStoreSnapshot | null = null
let focusedSnapshotDirty = true

function createSnapshot(): MessageStoreSnapshot {
  const sessionId = paneLayoutStore.getFocusedSessionId()
  return {
    sessionId,
    messages: messageStore.getVisibleMessages(sessionId),
    isStreaming: messageStore.getIsStreaming(sessionId),
    revertState: messageStore.getRevertState(sessionId),
    hasMoreHistory: messageStore.getHasMoreHistory(sessionId),
    sessionDirectory: messageStore.getSessionDirectory(sessionId),
    sessionTitle: messageStore.getSessionTitle(sessionId),
    canUndo: messageStore.canUndo(sessionId),
    canRedo: messageStore.canRedo(sessionId),
    redoSteps: messageStore.getRedoSteps(sessionId),
    revertedContent: messageStore.getCurrentRevertedContent(sessionId),
    loadState: messageStore.getLoadState(sessionId),
    loadError: messageStore.getSessionState(sessionId ?? '')?.loadError,
  }
}

function isSameFocusedSnapshot(a: MessageStoreSnapshot, b: MessageStoreSnapshot): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.messages === b.messages &&
    a.isStreaming === b.isStreaming &&
    a.revertState === b.revertState &&
    a.hasMoreHistory === b.hasMoreHistory &&
    a.sessionDirectory === b.sessionDirectory &&
    a.sessionTitle === b.sessionTitle &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.redoSteps === b.redoSteps &&
    a.revertedContent === b.revertedContent &&
    a.loadState === b.loadState &&
    a.loadError === b.loadError
  )
}

function getSnapshot(): MessageStoreSnapshot {
  if (!focusedSnapshotDirty && cachedSnapshot) return cachedSnapshot
  focusedSnapshotDirty = false
  const next = createSnapshot()
  if (cachedSnapshot && isSameFocusedSnapshot(cachedSnapshot, next)) return cachedSnapshot
  cachedSnapshot = next
  return cachedSnapshot
}

// 标记脏；真正重建在 getSnapshot，字段全相同时复用旧引用，避免旁路组件空刷
messageStore.subscribe(() => {
  focusedSnapshotDirty = true
})

paneLayoutStore.subscribe(() => {
  focusedSnapshotDirty = true
})

function subscribeFocusedSnapshot(onStoreChange: () => void): () => void {
  const unsubscribeMessageStore = messageStore.subscribe(onStoreChange)
  const unsubscribePaneLayout = paneLayoutStore.subscribe(onStoreChange)
  return () => {
    unsubscribeMessageStore()
    unsubscribePaneLayout()
  }
}

// ============================================
// React Hooks
// ============================================

/**
 * React hook to subscribe to the focused pane's session snapshot.
 */
export function useMessageStore(): MessageStoreSnapshot {
  return useSyncExternalStore(subscribeFocusedSnapshot, getSnapshot, getSnapshot)
}

/**
 * 选择器模式 - 只订阅需要的字段，减少不必要的重渲染
 *
 * @example
 * // 只订阅 sessionId 和 isStreaming
 * const { sessionId, isStreaming } = useMessageStoreSelector(
 *   state => ({ sessionId: state.sessionId, isStreaming: state.isStreaming })
 * )
 */
export function useMessageStoreSelector<T>(
  selector: (state: MessageStoreSnapshot) => T,
  equalityFn: (a: T, b: T) => boolean = shallowEqual,
): T {
  const prevResultRef = useRef<T | undefined>(undefined)

  const getSelectedSnapshot = useCallback(() => {
    const fullSnapshot = getSnapshot()
    const newResult = selector(fullSnapshot)

    // 如果结果相等，返回之前的引用以避免重渲染
    if (prevResultRef.current !== undefined && equalityFn(prevResultRef.current, newResult)) {
      return prevResultRef.current
    }

    prevResultRef.current = newResult
    return newResult
  }, [selector, equalityFn])

  return useSyncExternalStore(subscribeFocusedSnapshot, getSelectedSnapshot, getSelectedSnapshot)
}

/**
 * 浅比较两个对象
 */
function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a === null || b === null) return false

  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)

  if (keysA.length !== keysB.length) return false

  const recordA = a as Record<string, unknown>
  const recordB = b as Record<string, unknown>

  for (const key of keysA) {
    if (recordA[key] !== recordB[key]) return false
  }

  return true
}

// 模块级 selector：避免组件内联 () => ({...}) 导致 getSnapshot 身份每帧变化
const selectSessionId = (state: MessageStoreSnapshot) => state.sessionId
const selectIsStreaming = (state: MessageStoreSnapshot) => state.isStreaming
const selectMessages = (state: MessageStoreSnapshot) => state.messages
const selectHasMessages = (state: MessageStoreSnapshot) => state.messages.length > 0
const selectHeaderSessionMeta = (state: MessageStoreSnapshot) => ({
  sessionId: state.sessionId,
  sessionDirectory: state.sessionDirectory,
  sessionTitle: state.sessionTitle,
})
const selectUndoRedoState = (state: MessageStoreSnapshot) => ({
  canUndo: state.canUndo,
  canRedo: state.canRedo,
  redoSteps: state.redoSteps,
})
const sameMessageArray = (a: Message[], b: Message[]) => a === b

// 缓存：sessionId -> Snapshot
const sessionSnapshots = new Map<string, SessionStateSnapshot>()

messageStore.subscribe(() => {
  sessionSnapshots.clear()
})

/**
 * React hook to subscribe to a SPECIFIC session state
 */
export function useSessionState(sessionId: string | null): SessionStateSnapshot | null {
  const getSessionSnapshot = (): SessionStateSnapshot | null => {
    if (!sessionId) return null

    // 如果缓存中有，直接返回
    if (sessionSnapshots.has(sessionId)) {
      return sessionSnapshots.get(sessionId) ?? null
    }

    const state = messageStore.getSessionState(sessionId)
    if (!state) return null
    const visibleMessages = messageStore.getVisibleMessages(sessionId)

    // 构建 snapshot 并缓存
    const snapshot: SessionStateSnapshot = {
      messages: visibleMessages,
      isStreaming: state.isStreaming,
      loadState: state.loadState,
      loadError: state.loadError,
      revertState: state.revertState,
      canUndo: messageStore.canUndo(sessionId),
      canRedo: !state.isStreaming && (state.revertState?.history.length ?? 0) > 0,
      redoSteps: state.revertState?.history.length ?? 0,
      revertedContent: state.revertState?.history?.[0] ?? null,
      hasMoreHistory: state.hasMoreHistory,
      directory: state.directory,
      title: state.title ?? null,
    }

    sessionSnapshots.set(sessionId, snapshot)
    return snapshot
  }

  const subscribeSession = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionId) return () => undefined
      return messageStore.subscribeSession(sessionId, () => {
        sessionSnapshots.delete(sessionId)
        onStoreChange()
      })
    },
    [sessionId],
  )

  return useSyncExternalStore(subscribeSession, getSessionSnapshot, getSessionSnapshot)
}

// ============================================
// 便捷选择器 Hooks
// ============================================

/** 只订阅 sessionId */
export function useCurrentSessionId(): string | null {
  return useMessageStoreSelector(selectSessionId)
}

/** 只订阅 isStreaming */
export function useIsStreaming(): boolean {
  return useMessageStoreSelector(selectIsStreaming)
}

/** 只订阅 messages */
export function useMessages(): Message[] {
  return useMessageStoreSelector(selectMessages, sameMessageArray)
}

/** 当前 focused session 是否已有消息（length 级，流式加字不触发） */
export function useHasMessages(): boolean {
  return useMessageStoreSelector(selectHasMessages)
}

/** Header 用：session 身份与标题，不跟 messages 文本 */
export function useHeaderSessionMeta() {
  return useMessageStoreSelector(selectHeaderSessionMeta)
}

/** 只订阅 canUndo/canRedo */
export function useUndoRedoState() {
  return useMessageStoreSelector(selectUndoRedoState)
}

// Re-export types for convenience
import type { Message } from '../types/message'
export type { MessageStoreSnapshot, SessionStateSnapshot }
