// ============================================
// DirectoryContext - 管理当前工作目录
// ============================================

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { getPath, type ApiPath } from '../api'
import { useRouter } from '../hooks/useRouter'
import { handleError, normalizeToForwardSlash, getDirectoryName, isSameDirectory } from '../utils'

export interface SavedDirectory {
  path: string
  name: string
  addedAt: number
}

export interface DirectoryContextValue {
  /** 当前工作目录（undefined 表示全部/不筛选） */
  currentDirectory: string | undefined
  /** 设置当前工作目录 */
  setCurrentDirectory: (directory: string | undefined) => void
  /** 保存的目录列表 */
  savedDirectories: SavedDirectory[]
  /** 添加目录 */
  addDirectory: (path: string) => void
  /** 移除目录 */
  removeDirectory: (path: string) => void
  /** 服务端路径信息 */
  pathInfo: ApiPath | null
  /** 侧边栏是否展开（桌面端） */
  sidebarExpanded: boolean
  /** 设置侧边栏展开状态 */
  setSidebarExpanded: (expanded: boolean) => void
  /** 最近使用的项目时间戳 { [path]: lastUsedAt } */
  recentProjects: Record<string, number>
}

const DirectoryContext = createContext<DirectoryContextValue | null>(null)

const STORAGE_KEY_SIDEBAR = 'opencode-sidebar-expanded'
const STORAGE_KEY_SAVED = 'opencode-saved-directories'
const STORAGE_KEY_RECENT = 'opencode-recent-projects'

// 最近使用记录: { [path]: lastUsedAt }
type RecentProjects = Record<string, number>

export function DirectoryProvider({ children }: { children: ReactNode }) {
  // 从 URL 获取 directory（替代 localStorage）
  const { directory: urlDirectory, setDirectory: setUrlDirectory } = useRouter()
  
  const [savedDirectories, setSavedDirectories] = useState<SavedDirectory[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SAVED)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  
  const [sidebarExpanded, setSidebarExpandedState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SIDEBAR)
    return saved !== 'false'
  })

  const [recentProjects, setRecentProjects] = useState<RecentProjects>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_RECENT)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  
  const [pathInfo, setPathInfo] = useState<ApiPath | null>(null)

  // 加载路径信息
  useEffect(() => {
    getPath().then(setPathInfo).catch(handleError('get path info', 'api'))
  }, [])

  // 保存 savedDirectories 到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SAVED, JSON.stringify(savedDirectories))
  }, [savedDirectories])

  // 保存 recentProjects 到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(recentProjects))
  }, [recentProjects])

  // 设置当前目录（更新 URL + 记录最近使用）
  const setCurrentDirectory = useCallback((directory: string | undefined) => {
    setUrlDirectory(directory)
    if (directory) {
      setRecentProjects(prev => ({ ...prev, [directory]: Date.now() }))
    }
  }, [setUrlDirectory])

  // 添加目录
  const addDirectory = useCallback((path: string) => {
    const normalized = normalizeToForwardSlash(path)
    
    // 使用 isSameDirectory 检查是否已存在（处理大小写和斜杠差异）
    if (savedDirectories.some(d => isSameDirectory(d.path, normalized))) {
      setCurrentDirectory(normalized)
      return
    }
    
    const newDir: SavedDirectory = {
      path: normalized,
      name: getDirectoryName(normalized),
      addedAt: Date.now(),
    }
    
    setSavedDirectories(prev => [...prev, newDir])
    setCurrentDirectory(normalized)
  }, [savedDirectories, setCurrentDirectory])

  // 移除目录
  const removeDirectory = useCallback((path: string) => {
    const normalized = normalizeToForwardSlash(path)
    setSavedDirectories(prev => prev.filter(d => !isSameDirectory(d.path, normalized)))
    if (isSameDirectory(urlDirectory, normalized)) {
      setCurrentDirectory(undefined)
    }
  }, [urlDirectory, setCurrentDirectory])

  // 设置侧边栏展开
  const setSidebarExpanded = useCallback((expanded: boolean) => {
    setSidebarExpandedState(expanded)
    localStorage.setItem(STORAGE_KEY_SIDEBAR, String(expanded))
  }, [])

  // 稳定化 Provider value，避免每次渲染创建新对象导致子组件不必要重渲染
  const value = useMemo<DirectoryContextValue>(() => ({
    currentDirectory: urlDirectory,
    setCurrentDirectory,
    savedDirectories,
    addDirectory,
    removeDirectory,
    pathInfo,
    sidebarExpanded,
    setSidebarExpanded,
    recentProjects,
  }), [
    urlDirectory,
    setCurrentDirectory,
    savedDirectories,
    addDirectory,
    removeDirectory,
    pathInfo,
    sidebarExpanded,
    setSidebarExpanded,
    recentProjects,
  ])

  return (
    <DirectoryContext.Provider value={value}>
      {children}
    </DirectoryContext.Provider>
  )
}

export function useDirectory(): DirectoryContextValue {
  const context = useContext(DirectoryContext)
  if (!context) {
    throw new Error('useDirectory must be used within a DirectoryProvider')
  }
  return context
}
