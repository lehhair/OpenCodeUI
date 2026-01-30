import { useState, useEffect, useCallback } from 'react'
import {
  getPathMode,
  setPathMode as setPathModeUtil,
  getEffectivePathStyle,
  getDetectedPathStyle,
  subscribePathMode,
  type PathMode,
  type DetectedPathStyle,
} from '../utils/directoryUtils'

interface UsePathModeReturn {
  /** 当前路径模式设置 (auto | unix | windows) */
  pathMode: PathMode
  /** 实际生效的路径风格 (unix | windows) */
  effectiveStyle: DetectedPathStyle
  /** 自动检测到的路径风格 */
  detectedStyle: DetectedPathStyle
  /** 设置路径模式 */
  setPathMode: (mode: PathMode) => void
  /** 是否为自动模式 */
  isAutoMode: boolean
  /** 是否使用 Windows 风格 */
  isWindowsStyle: boolean
}

/**
 * 路径模式管理 Hook
 * 
 * 提供路径模式的读取、设置和响应式更新
 */
export function usePathMode(): UsePathModeReturn {
  const [pathMode, setPathModeState] = useState<PathMode>(getPathMode)
  const [effectiveStyle, setEffectiveStyle] = useState<DetectedPathStyle>(getEffectivePathStyle)
  const [detectedStyle, setDetectedStyle] = useState<DetectedPathStyle>(getDetectedPathStyle)

  // 订阅路径模式变化
  useEffect(() => {
    const unsubscribe = subscribePathMode((mode, style) => {
      setPathModeState(mode)
      setEffectiveStyle(style)
      setDetectedStyle(getDetectedPathStyle())
    })
    return unsubscribe
  }, [])

  const setPathMode = useCallback((mode: PathMode) => {
    setPathModeUtil(mode)
    setPathModeState(mode)
    setEffectiveStyle(getEffectivePathStyle())
  }, [])

  return {
    pathMode,
    effectiveStyle,
    detectedStyle,
    setPathMode,
    isAutoMode: pathMode === 'auto',
    isWindowsStyle: effectiveStyle === 'windows',
  }
}
