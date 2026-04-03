// ============================================
// SessionNavigationContext
// ============================================
//
// 提供统一的 session 导航方法。
// 默认实现走 hash 路由（单 session 模式），
// 各消费者（如分屏 pane）可通过 Provider 覆盖为自己的导航逻辑。
//
// 这样 SubtaskPartView、TaskRenderer 等深层组件不再硬编码
// window.location.hash，而是通过 context 获取导航方法。

import { createContext, useContext } from 'react'

export interface SessionNavigationContextValue {
  /** 导航到指定 session */
  navigateToSession: (sessionId: string, directory?: string) => void
  /** 当前 pane / 视图正在查看的 session */
  currentSessionId?: string | null
  /** 当前 pane / 视图的有效目录 */
  currentDirectory?: string
}

/** 默认实现：走 hash 路由 */
function defaultNavigateToSession(sessionId: string, directory?: string) {
  const hash = directory ? `#/session/${sessionId}?dir=${encodeURIComponent(directory)}` : `#/session/${sessionId}`
  window.location.hash = hash
}

export const SessionNavigationContext = createContext<SessionNavigationContextValue>({
  navigateToSession: defaultNavigateToSession,
  currentSessionId: null,
  currentDirectory: undefined,
})

export function useSessionNavigation(): SessionNavigationContextValue {
  return useContext(SessionNavigationContext)
}
