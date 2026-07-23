import { createContext, useContext } from 'react'

/**
 * 让 message tree 里的子组件（如 disclosure widget）能通知 ChatArea：
 * 「用户做了某个会停止贴底跟随的操作」（展开/折叠工具调用、跳转到消息等）。
 *
 * 由 ChatArea 提供，consume 方通过 useAutoScrollIntent() 拿到 pause。
 * Context 值应当 stable（pause 是 useCallback），不会引起消费方 re-render。
 */
export interface AutoScrollContextValue {
  pause: () => void
}

const AutoScrollContext = createContext<AutoScrollContextValue | null>(null)

export const AutoScrollProvider = AutoScrollContext.Provider

export function useAutoScrollIntent(): AutoScrollContextValue | null {
  return useContext(AutoScrollContext)
}
