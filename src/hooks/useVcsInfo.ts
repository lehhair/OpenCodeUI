// ============================================
// useVcsInfo - VCS 信息 Hook
// 轮询获取当前项目的 Git 分支信息
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { getVcsInfo } from '../api/vcs'
import type { VcsInfo } from '../types/api/vcs'

const POLL_INTERVAL = 15000 // 15s 轮询

export interface UseVcsInfoResult {
  vcsInfo: VcsInfo | null
  isLoading: boolean
  error: string | null
  refresh: () => void
}

export function useVcsInfo(directory?: string): UseVcsInfoResult {
  const [vcsInfo, setVcsInfo] = useState<VcsInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchVcs = useCallback(async () => {
    if (!directory) {
      setVcsInfo(null)
      return
    }
    
    setIsLoading(true)
    try {
      const info = await getVcsInfo(directory)
      if (mountedRef.current) {
        setVcsInfo(info)
        setError(null)
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to fetch VCS info')
        setVcsInfo(null)
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [directory])

  // 初始加载 + 目录变化时重新获取
  useEffect(() => {
    mountedRef.current = true
    fetchVcs()
    return () => { mountedRef.current = false }
  }, [fetchVcs])

  // 轮询
  useEffect(() => {
    if (!directory) return

    const timer = setInterval(fetchVcs, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [directory, fetchVcs])

  return { vcsInfo, isLoading, error, refresh: fetchVcs }
}
