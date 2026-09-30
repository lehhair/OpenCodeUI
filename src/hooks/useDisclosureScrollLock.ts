import { useCallback, useEffect, useRef, type RefCallback } from 'react'
import { lockScrollAroundAnchor, type LockScrollAroundAnchorOptions } from '../utils/scrollUtils'

/**
 * 折叠/展开时把 header 钉在视口原位置。
 *
 * 用法：
 * - rootRef 挂在整块折叠容器（观察高度变化）
 * - headerRef 挂在点击条 / 标题
 * - 用户切换状态前调用 withScrollLock(() => setExpanded(...))
 */
export function useDisclosureScrollLock(options?: LockScrollAroundAnchorOptions) {
  const rootNodeRef = useRef<HTMLElement | null>(null)
  const headerNodeRef = useRef<HTMLElement | null>(null)
  const unlockRef = useRef<(() => void) | null>(null)
  const optionsRef = useRef(options)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    return () => {
      unlockRef.current?.()
      unlockRef.current = null
    }
  }, [])

  const rootRef = useCallback<RefCallback<HTMLElement>>(node => {
    rootNodeRef.current = node
  }, [])

  const headerRef = useCallback<RefCallback<HTMLElement>>(node => {
    headerNodeRef.current = node
  }, [])

  const withScrollLock = useCallback((action: () => void) => {
    unlockRef.current?.()
    unlockRef.current = lockScrollAroundAnchor(headerNodeRef.current, {
      observe: rootNodeRef.current,
      ...optionsRef.current,
    })
    action()
  }, [])

  return { rootRef, headerRef, withScrollLock }
}
