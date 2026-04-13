import { useCallback, useRef, useSyncExternalStore } from 'react'
import { normalizeToForwardSlash, serverStorage } from '../utils'
import { STORAGE_KEY_LAST_DIRECTORY } from '../constants/storage'
import { useIsMobile } from './useIsMobile'

/**
 * Hash 路由，支持 directory 参数
 * 格式: #/session/{sessionId}?dir={path} 或 #/?dir={path}
 *
 * 这里使用模块级 route store，而不是每个 useRouter() 各自 useState。
 * 原因：App、DirectoryProvider、Settings 都会消费路由；如果各自持有本地 state，
 * replaceState 只会更新当前实例，其他实例看不到，导致侧边栏目录/项目高亮错乱。
 */

interface RouteState {
  sessionId: string | null
  directory: string | undefined
}

type Listener = () => void

const listeners = new Set<Listener>()
let routeSnapshot: RouteState | null = null
let isListening = false

function decodeDirectoryParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseHash(): RouteState {
  const hash = window.location.hash
  const [path, queryString] = hash.split('?')

  let directory: string | undefined
  if (queryString) {
    const dirMatch = queryString.match(/(?:^|&)dir=([^&]*)/)
    if (dirMatch && dirMatch[1]) {
      directory = normalizeToForwardSlash(decodeDirectoryParam(dirMatch[1])) || undefined
    }
  }

  if (!directory) {
    const saved = serverStorage.get(STORAGE_KEY_LAST_DIRECTORY)
    if (saved) directory = saved
  }

  const sessionMatch = path.match(/^#\/session\/(.+)$/)
  if (sessionMatch) {
    return { sessionId: sessionMatch[1], directory }
  }

  return { sessionId: null, directory }
}

function buildHash(sessionId: string | null, directory: string | undefined): string {
  const path = sessionId ? `#/session/${sessionId}` : '#/'
  if (directory) {
    return `${path}?dir=${encodeURIComponent(directory)}`
  }
  return path
}

function isSameRoute(a: RouteState, b: RouteState): boolean {
  return a.sessionId === b.sessionId && a.directory === b.directory
}

function ensureSnapshot(): RouteState {
  if (typeof window === 'undefined') {
    return { sessionId: null, directory: undefined }
  }
  if (routeSnapshot === null) {
    routeSnapshot = parseHash()
  }
  return routeSnapshot
}

function emitRoute(next: RouteState) {
  const prev = ensureSnapshot()
  if (isSameRoute(prev, next)) return
  routeSnapshot = next
  for (const listener of listeners) listener()
}

function syncRouteFromHash() {
  emitRoute(parseHash())
}

function ensureWindowListener() {
  if (typeof window === 'undefined' || isListening) return
  routeSnapshot = parseHash()
  window.addEventListener('hashchange', syncRouteFromHash)
  isListening = true
}

function subscribe(listener: Listener): () => void {
  ensureWindowListener()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): RouteState {
  ensureWindowListener()
  return ensureSnapshot()
}

export function useRouter() {
  const route = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // 移动端用 replaceState 导航，避免浏览器历史栈堆积会话路由。
  // 手机浏览器左右滑动 = 前进/后退，历史栈里堆满会话会导致疯狂横跳。
  const isMobile = useIsMobile()
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  const navigateToSession = useCallback((sessionId: string, directory?: string) => {
    const currentRoute = getSnapshot()
    const dir = directory !== undefined ? normalizeToForwardSlash(directory) || undefined : currentRoute.directory
    const next = { sessionId, directory: dir }
    const newHash = buildHash(sessionId, dir)
    if (isMobileRef.current) {
      window.history.replaceState(null, '', newHash)
    } else {
      window.location.hash = newHash
    }
    emitRoute(next)
  }, [])

  const navigateHome = useCallback(() => {
    const currentRoute = getSnapshot()
    const next = { sessionId: null, directory: currentRoute.directory }
    const newHash = buildHash(null, currentRoute.directory)
    if (isMobileRef.current) {
      window.history.replaceState(null, '', newHash)
    } else {
      window.location.hash = newHash
    }
    emitRoute(next)
  }, [])

  const replaceSession = useCallback((sessionId: string | null, directory?: string) => {
    const currentRoute = getSnapshot()
    const dir = directory !== undefined ? normalizeToForwardSlash(directory) || undefined : currentRoute.directory
    const newHash = buildHash(sessionId, dir)
    window.history.replaceState(null, '', newHash)
    emitRoute({ sessionId, directory: dir })
  }, [])

  const setDirectory = useCallback((directory: string | undefined) => {
    const normalized = directory ? normalizeToForwardSlash(directory) : undefined
    const newHash = buildHash(null, normalized || undefined)
    const next = { sessionId: null, directory: normalized || undefined }
    if (normalized) {
      serverStorage.set(STORAGE_KEY_LAST_DIRECTORY, normalized)
    } else {
      serverStorage.remove(STORAGE_KEY_LAST_DIRECTORY)
    }
    window.location.hash = newHash
    emitRoute(next)
  }, [])

  const replaceDirectory = useCallback((directory: string | undefined) => {
    const currentRoute = getSnapshot()
    const normalized = directory ? normalizeToForwardSlash(directory) : undefined
    const newHash = buildHash(currentRoute.sessionId, normalized || undefined)
    if (normalized) {
      serverStorage.set(STORAGE_KEY_LAST_DIRECTORY, normalized)
    } else {
      serverStorage.remove(STORAGE_KEY_LAST_DIRECTORY)
    }
    window.history.replaceState(null, '', newHash)
    emitRoute({ sessionId: currentRoute.sessionId, directory: normalized || undefined })
  }, [])

  return {
    sessionId: route.sessionId,
    directory: route.directory,
    navigateToSession,
    navigateHome,
    replaceSession,
    setDirectory,
    replaceDirectory,
  }
}
