import { useEffect, useRef } from 'react'

/**
 * Keep the screen awake while the page is visible and `enabled` is true.
 * Uses the Screen Wake Lock API (https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
 * Automatically releases on page hide and re-acquires on page visible.
 * No-ops silently in environments that don't support the API (e.g. Firefox, some desktop browsers).
 */
export function useWakeLock(enabled: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return

    let cancelled = false

    const request = async () => {
      if (cancelled) return
      if (document.visibilityState !== 'visible') return
      if (wakeLockRef.current && !wakeLockRef.current.released) return

      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      } catch {
        // request can fail if the page loses visibility between the check and the await,
        // or if the user/OS denies the request — silently ignore.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        request()
      }
    }

    request()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [enabled])
}
