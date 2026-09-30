import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { normalizeToForwardSlash, serverStorage } from '../utils'
import { STORAGE_KEY_LAST_DIRECTORY } from '../constants/storage'
import { useIsMobile } from './useIsMobile'

/**
 * Hash 路由。sessionId 使用「服务器作用域复合 key」（serverId::sessionId），
 * 直接在 URL 中携带服务器身份，不再需要独立 server 参数，避免参数与
 * pane 实际状态不一致导致的 URL 振荡。
 *
 * 格式: #/session/{serverId}::{sessionId}?dir={path} 或 #/?dir={path}
 * 旧格式（无 :: 前缀的原始 sessionId）自动兼容：视为活动服务器。
 */

interface RouteState {
  /** 服务器作用域复合 key（serverId::sessionId）或 null */
  sessionId: string | null
  /** home（无 session）时的服务器（?server= 参数） */
  serverId: string | null
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
  let serverId: string | null = null
  if (queryString) {
    const dirMatch = queryString.match(/(?:^|&)dir=([^&]*)/)
    if (dirMatch && dirMatch[1]) {
      directory = normalizeToForwardSlash(decodeDirectoryParam(dirMatch[1])) || undefined
    }
    const serverMatch = queryString.match(/(?:^|&)server=([^&]*)/)
    if (serverMatch && serverMatch[1]) {
      try {
        serverId = decodeURIComponent(serverMatch[1]) || null
      } catch {
        serverId = serverMatch[1] || null
      }
    }
  }

  if (!directory) {
    const saved = serverStorage.get(STORAGE_KEY_LAST_DIRECTORY)
    if (saved) directory = saved
  }

  const sessionMatch = path.match(/^#\/session\/(.+)$/)
  if (sessionMatch) {
    let sessionKey = sessionMatch[1]
    try {
      sessionKey = decodeURIComponent(sessionKey)
    } catch {
      // 保持原样（非法编码时）
    }
    return { sessionId: sessionKey, serverId, directory }
  }

  return { sessionId: null, serverId, directory }
}

function buildHash(
  sessionId: string | null,
  serverId: string | null | undefined,
  directory: string | undefined,
): string {
  const path = sessionId ? `#/session/${encodeURIComponent(sessionId)}` : '#/'
  const params: string[] = []
  // 仅 home（无 session）写 server 参数；session URL 的复合 key 已携带服务器
  if (!sessionId && serverId) {
    params.push(`server=${encodeURIComponent(serverId)}`)
  }
  if (directory) {
    params.push(`dir=${encodeURIComponent(directory)}`)
  }
  return params.length > 0 ? `${path}?${params.join('&')}` : path
}

function isSameRoute(a: RouteState, b: RouteState): boolean {
  return a.sessionId === b.sessionId && a.serverId === b.serverId && a.directory === b.directory
}

function ensureSnapshot(): RouteState {
  if (typeof window === 'undefined') {
    return { sessionId: null, serverId: null, directory: undefined }
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

  useEffect(() => {
    isMobileRef.current = isMobile
  }, [isMobile])

  const navigateToSession = useCallback((sessionKey: string, directory?: string) => {
    const currentRoute = getSnapshot()
    const dir = directory !== undefined ? normalizeToForwardSlash(directory) || undefined : currentRoute.directory
    const next = { sessionId: sessionKey, serverId: currentRoute.serverId, directory: dir }
    const newHash = buildHash(sessionKey, currentRoute.serverId, dir)
    if (isMobileRef.current) {
      window.history.replaceState(null, '', newHash)
    } else {
      window.location.hash = newHash
    }
    emitRoute(next)
  }, [])

  const navigateHome = useCallback((serverId?: string) => {
    const currentRoute = getSnapshot()
    const sid = serverId ?? currentRoute.serverId
    const next = { sessionId: null, serverId: sid, directory: currentRoute.directory }
    const newHash = buildHash(null, sid, currentRoute.directory)
    if (isMobileRef.current) {
      window.history.replaceState(null, '', newHash)
    } else {
      window.location.hash = newHash
    }
    emitRoute(next)
  }, [])

  const replaceSession = useCallback((sessionKey: string | null, directory?: string) => {
    const currentRoute = getSnapshot()
    const dir = directory !== undefined ? normalizeToForwardSlash(directory) || undefined : currentRoute.directory
    const newHash = buildHash(sessionKey, currentRoute.serverId, dir)
    window.history.replaceState(null, '', newHash)
    emitRoute({ sessionId: sessionKey, serverId: currentRoute.serverId, directory: dir })
  }, [])

  const setDirectory = useCallback((directory: string | undefined) => {
    const currentRoute = getSnapshot()
    const normalized = directory ? normalizeToForwardSlash(directory) : undefined
    const newHash = buildHash(null, currentRoute.serverId, normalized || undefined)
    const next = { sessionId: null, serverId: currentRoute.serverId, directory: normalized || undefined }
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
    const newHash = buildHash(currentRoute.sessionId, currentRoute.serverId, normalized || undefined)
    if (normalized) {
      serverStorage.set(STORAGE_KEY_LAST_DIRECTORY, normalized)
    } else {
      serverStorage.remove(STORAGE_KEY_LAST_DIRECTORY)
    }
    window.history.replaceState(null, '', newHash)
    emitRoute({
      sessionId: currentRoute.sessionId,
      serverId: currentRoute.serverId,
      directory: normalized || undefined,
    })
  }, [])

  return {
    sessionId: route.sessionId,
    serverId: route.serverId,
    directory: route.directory,
    navigateToSession,
    navigateHome,
    replaceSession,
    setDirectory,
    replaceDirectory,
  }
}
