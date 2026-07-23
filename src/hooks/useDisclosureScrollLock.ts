import { useCallback, useEffect, useRef, type RefCallback } from 'react'
import { lockScrollAroundAnchor, type LockScrollAroundAnchorOptions } from '../utils/scrollUtils'
import { useAutoScrollIntent } from './AutoScrollContext'

/**
 * 折叠/展开时把 header 钉在视口原位置。
 *
 * 用法：
 * - rootRef 挂在整块折叠容器（观察高度变化）
 * - headerRef 挂在点击条 / 标题
 * - 用户切换状态前调用 withScrollLock(() => setExpanded(...), expanding)
 *
 * expanding=true（展开）时同时通知 AutoScrollContext 停止贴底跟随 ——
 * 用户主动展开表示要停下来看内容，不应被流式拉走。
 * expanding=false（折叠）时不改变跟随状态 —— 折叠只是收起已看过的内容，
 * 不表达「我要停下来读」的意图。
 */
export function useDisclosureScrollLock(options?: LockScrollAroundAnchorOptions) {
  const rootNodeRef = useRef<HTMLElement | null>(null)
  const headerNodeRef = useRef<HTMLElement | null>(null)
  const unlockRef = useRef<(() => void) | null>(null)
  const optionsRef = useRef(options)
  const autoScroll = useAutoScrollIntent()

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    return () => {
      unlockRef.current?.()
      unlockRef.current = null
    }
  }, [])

  const rootRef = useCallback<RefCallback<HTMLElement>>((node) => {
    rootNodeRef.current = node
  }, [])

  const headerRef = useCallback<RefCallback<HTMLElement>>((node) => {
    headerNodeRef.current = node
  }, [])

  /**
   * @param action 实际切换状态的回调
   * @param expanding 是否是「展开」操作（true=展开→停止跟随；false=折叠→不动状态）
   */
  const withScrollLock = useCallback((action: () => void, expanding: boolean) => {
    unlockRef.current?.()
    unlockRef.current = lockScrollAroundAnchor(headerNodeRef.current, {
      observe: rootNodeRef.current,
      ...optionsRef.current,
    })
    if (expanding) autoScroll?.pause()
    action()
  }, [autoScroll])

  return { rootRef, headerRef, withScrollLock }
}
