import { useEffect } from 'react'
import { messageStore } from '../store/messageStore'
import { clearSessionMeasurements } from '../features/chat/timelineMetrics'

/** 窗口隐藏后闲置多久开始回收非活跃会话 */
const IDLE_TRIM_DELAY_MS = 10 * 60 * 1000
/** 回收后保留最近使用的会话数；正在流式和分屏保护的会话不受影响 */
const IDLE_TRIM_KEEP = 2
/** 持有量不到这个量级就不回收——正常使用不该感觉到切回会话变慢 */
const IDLE_TRIM_MIN_CHARS = 2 * 1024 * 1024

/**
 * 后台闲置时回收非活跃会话。
 *
 * 应用本身已经按最近使用保留了若干个会话，但一直开着不动时没有回收时机；
 * 这里把「窗口隐藏超过十分钟」当作低内存信号，只留当前/最近两个，
 * 被回收的会话下次打开会重新拉最近一页。
 */
export function useIdleSessionTrim() {
  useEffect(() => {
    let timer: number | null = null

    const cancel = () => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }

    const trim = () => {
      timer = null
      const before = messageStore.getHeldChatSize()
      if (before.totalChars < IDLE_TRIM_MIN_CHARS) return
      const evicted = messageStore.trimIdleSessions(IDLE_TRIM_KEEP)
      if (evicted.length === 0) return
      for (const sessionId of evicted) clearSessionMeasurements(sessionId)
      if (import.meta.env.DEV) {
        const held = messageStore.getHeldChatSize()
        console.warn(
          `[perf] chat.trim sessions=${evicted.length} kept=${held.sessions.length} ` +
            `chars=${before.totalChars}->${held.totalChars}`,
        )
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        cancel()
        timer = window.setTimeout(trim, IDLE_TRIM_DELAY_MS)
      } else {
        cancel()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancel()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
}
