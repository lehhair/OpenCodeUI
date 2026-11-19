import { useEffect, useState } from 'react'

// 只看主输入：any-hover / any-pointer 只要系统里存在精确指针就成立，
// 会把带笔的手机判成桌面机。
const CAN_HOVER_QUERY = '(hover: hover) and (pointer: fine)'
const COARSE_POINTER_QUERY = '(pointer: coarse)'

export interface InputCapabilities {
  canHover: boolean
  hasCoarsePointer: boolean
  hasTouch: boolean
  preferTouchUi: boolean
}

function getMatchMediaMatches(query: string) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia(query).matches
}

/** 手机/平板。移动端的媒体查询会被笔和外接指针带偏，UA 才是稳定信号。 */
function isHandheldDevice() {
  if (typeof navigator === 'undefined') return false
  if (/Android|iPhone|iPod|iPad|Mobile/i.test(navigator.userAgent)) return true
  // iPadOS 13+ 的 UA 伪装成桌面 Mac，只能靠触点数区分
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function getInputCapabilities(): InputCapabilities {
  const handheld = isHandheldDevice()
  const canHover = getMatchMediaMatches(CAN_HOVER_QUERY)
  const hasCoarsePointer = getMatchMediaMatches(COARSE_POINTER_QUERY)
  const hasTouch = handheld || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  // 手持设备一律触摸优先，不让媒体查询否决
  const preferTouchUi = handheld || ((hasCoarsePointer || hasTouch) && !canHover)

  return {
    canHover,
    hasCoarsePointer,
    hasTouch,
    preferTouchUi,
  }
}

export function useInputCapabilities() {
  const [capabilities, setCapabilities] = useState<InputCapabilities>(getInputCapabilities)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const canHoverMediaQuery = window.matchMedia(CAN_HOVER_QUERY)
    const coarsePointerMediaQuery = window.matchMedia(COARSE_POINTER_QUERY)
    const handleChange = () => {
      setCapabilities(getInputCapabilities())
    }

    handleChange()

    if (typeof canHoverMediaQuery.addEventListener === 'function') {
      canHoverMediaQuery.addEventListener('change', handleChange)
      coarsePointerMediaQuery.addEventListener('change', handleChange)
    } else {
      canHoverMediaQuery.addListener(handleChange)
      coarsePointerMediaQuery.addListener(handleChange)
    }

    window.addEventListener('pointerdown', handleChange, { passive: true })

    return () => {
      if (typeof canHoverMediaQuery.removeEventListener === 'function') {
        canHoverMediaQuery.removeEventListener('change', handleChange)
        coarsePointerMediaQuery.removeEventListener('change', handleChange)
      } else {
        canHoverMediaQuery.removeListener(handleChange)
        coarsePointerMediaQuery.removeListener(handleChange)
      }

      window.removeEventListener('pointerdown', handleChange)
    }
  }, [])

  return capabilities
}
