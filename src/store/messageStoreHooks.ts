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
    shareUrl: messageStore.getShareUrl(sessionId),
    canUndo: messageStore.canUndo(sessionId),
    canRedo: messageStore.canRedo(sessionId),
    redoSteps: messageStore.getRedoSteps(sessionId),
    revertedContent: messageStore.getCurrentRevertedContent(sessionId),
    loadState: messageStore.getLoadState(sessionId),
  }
}

function getSnapshot(): MessageStoreSnapshot {
  if (cachedSnapshot === null) {
    cachedSnapshot = createSnapshot()
  }
  return cachedSnapshot
}

// 订阅 store 变化，清除缓存
messageStore.subscribe(() => {
  cachedSnapshot = null
})

paneLayoutStore.subscribe(() => {
  cachedSnapshot = null
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

// 缓存：sessionId -> Snapshot
const sessionSnapshots = new Map<string, SessionStateSnapshot>()

// 订阅 store 变化，清除相关缓存
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

    // 构建 snapshot 并缓存
    const snapshot: SessionStateSnapshot = {
      messages: state.messages,
      isStreaming: state.isStreaming,
      loadState: state.loadState,
      revertState: state.revertState,
      canUndo: !state.isStreaming && state.messages.some(m => m.info.role === 'user'),
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

  return useSyncExternalStore(
    onStoreChange => messageStore.subscribe(onStoreChange),
    getSessionSnapshot,
    getSessionSnapshot,
  )
}

// ============================================
// 便捷选择器 Hooks
// ============================================

/** 只订阅 sessionId */
export function useCurrentSessionId(): string | null {
  return useMessageStoreSelector(state => state.sessionId)
}

/** 只订阅 isStreaming */
export function useIsStreaming(): boolean {
  return useMessageStoreSelector(state => state.isStreaming)
}

/** 只订阅 messages */
export function useMessages(): Message[] {
  return useMessageStoreSelector(
    state => state.messages,
    (a, b) => a === b,
  )
}

/** 只订阅 canUndo/canRedo */
export function useUndoRedoState() {
  return useMessageStoreSelector(state => ({
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    redoSteps: state.redoSteps,
  }))
}

// Re-export types for convenience
import type { Message } from '../types/message'
export type { MessageStoreSnapshot, SessionStateSnapshot }
