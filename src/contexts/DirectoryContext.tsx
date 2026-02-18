// ============================================
// DirectoryContext - 管理当前工作目录
// ============================================

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { getPath, type ApiPath, getPendingPermissions, getPendingQuestions } from '../api'
import { useRouter } from '../hooks/useRouter'
import { handleError, normalizeToForwardSlash, getDirectoryName, isSameDirectory, serverStorage } from '../utils'
import { layoutStore, useLayoutStore } from '../store/layoutStore'
import { activeSessionStore } from '../store/activeSessionStore'
import { serverStore } from '../store/serverStore'

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
  /** 侧边栏是否展开（桌面端）- 从 layoutStore 读取 */
  sidebarExpanded: boolean
  /** 设置侧边栏展开状态 - 委托给 layoutStore */
  setSidebarExpanded: (expanded: boolean) => void
  /** 最近使用的项目时间戳 { [path]: lastUsedAt } */
  recentProjects: Record<string, number>
}

const DirectoryContext = createContext<DirectoryContextValue | null>(null)

const STORAGE_KEY_SAVED = 'opencode-saved-directories'
const STORAGE_KEY_RECENT = 'opencode-recent-projects'

// 最近使用记录: { [path]: lastUsedAt }
type RecentProjects = Record<string, number>

export function DirectoryProvider({ children }: { children: ReactNode }) {
  // 从 URL 获取 directory（替代 localStorage）
  const { directory: urlDirectory, setDirectory: setUrlDirectory } = useRouter()
  
  // 从 layoutStore 获取 sidebarExpanded
  const { sidebarExpanded } = useLayoutStore()
  
  const [savedDirectories, setSavedDirectories] = useState<SavedDirectory[]>(() => {
    return serverStorage.getJSON<SavedDirectory[]>(STORAGE_KEY_SAVED) ?? []
  })

  const [recentProjects, setRecentProjects] = useState<RecentProjects>(() => {
    return serverStorage.getJSON<RecentProjects>(STORAGE_KEY_RECENT) ?? {}
  })
  
  const [pathInfo, setPathInfo] = useState<ApiPath | null>(null)

  // 服务器切换时，重新从 serverStorage 读取（key 前缀已变）
  useEffect(() => {
    return serverStore.onServerChange(() => {
      setSavedDirectories(serverStorage.getJSON<SavedDirectory[]>(STORAGE_KEY_SAVED) ?? [])
      setRecentProjects(serverStorage.getJSON<RecentProjects>(STORAGE_KEY_RECENT) ?? {})
      setPathInfo(null) // 重置，等待重新加载
      setUrlDirectory(undefined) // 清除当前目录选择
    })
  }, [setUrlDirectory])

  // 加载路径信息
  useEffect(() => {
    getPath().then(setPathInfo).catch(handleError('get path info', 'api'))
  }, [])

  // 页面加载时，如果 URL 已有目录，拉取该目录下的 pending requests 补充 active 列表
  useEffect(() => {
    if (!urlDirectory) return
    Promise.all([
      getPendingPermissions(undefined, urlDirectory).catch(() => []),
      getPendingQuestions(undefined, urlDirectory).catch(() => []),
    ]).then(([permissions, questions]) => {
      if (permissions.length > 0 || questions.length > 0) {
        activeSessionStore.initializePendingRequests(permissions, questions)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只在挂载时跑一次

  // 保存 savedDirectories 到 per-server storage
  useEffect(() => {
    serverStorage.setJSON(STORAGE_KEY_SAVED, savedDirectories)
  }, [savedDirectories])

  // 保存 recentProjects 到 per-server storage
  useEffect(() => {
    serverStorage.setJSON(STORAGE_KEY_RECENT, recentProjects)
  }, [recentProjects])

  // 设置当前目录（更新 URL + 记录最近使用 + 拉取 pending requests）
  const setCurrentDirectory = useCallback((directory: string | undefined) => {
    setUrlDirectory(directory)
    if (directory) {
      setRecentProjects(prev => ({ ...prev, [directory]: Date.now() }))
    }
    // 切换目录后拉取该目录下的 pending permission/question，补充到 active 列表
    Promise.all([
      getPendingPermissions(undefined, directory).catch(() => []),
      getPendingQuestions(undefined, directory).catch(() => []),
    ]).then(([permissions, questions]) => {
      if (permissions.length > 0 || questions.length > 0) {
        activeSessionStore.initializePendingRequests(permissions, questions)
      }
    })
  }, [setUrlDirectory])

  // 添加目录
  const addDirectory = useCallback((path: string) => {
    let normalized = normalizeToForwardSlash(path)
    
    // normalizeToForwardSlash 会去掉尾斜杠，导致根路径 "/" → "" 和 "C:/" → "C:"
    // 需要修正：如果原始路径是根路径，恢复正确的值
    const trimmed = path.replace(/\\/g, '/').replace(/\/+$/, '/')
    if (!normalized && (trimmed === '/' || /^[a-zA-Z]:\/$/.test(trimmed))) {
      normalized = trimmed.slice(0, -1) || '/'
    }
    
    // 验证路径非空（只阻止空字符串和 "."）
    if (!normalized || normalized === '.') return
    
    // 使用 isSameDirectory 检查是否已存在（处理大小写和斜杠差异）
    if (savedDirectories.some(d => isSameDirectory(d.path, normalized))) {
      setCurrentDirectory(normalized)
      return
    }
    
    const newDir: SavedDirectory = {
      path: normalized,
      name: getDirectoryName(normalized) || normalized,
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

  // 设置侧边栏展开 - 委托给 layoutStore
  const setSidebarExpanded = useCallback((expanded: boolean) => {
    layoutStore.setSidebarExpanded(expanded)
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

// ============================================
// 细粒度 Hooks - 避免不必要的重渲染
// ============================================

/** 只获取当前目录 */
export function useCurrentDirectory(): string | undefined {
  const { currentDirectory } = useDirectory()
  return currentDirectory
}

/** 只获取保存的目录列表 */
export function useSavedDirectories(): SavedDirectory[] {
  const { savedDirectories } = useDirectory()
  return savedDirectories
}

/** 只获取路径信息 */
export function usePathInfo(): ApiPath | null {
  const { pathInfo } = useDirectory()
  return pathInfo
}

/** 侧边栏状态 - 直接从 layoutStore 读取，更高效 */
export function useSidebarExpanded(): [boolean, (expanded: boolean) => void] {
  const { sidebarExpanded } = useLayoutStore()
  const setSidebarExpanded = useCallback((expanded: boolean) => {
    layoutStore.setSidebarExpanded(expanded)
  }, [])
  return [sidebarExpanded, setSidebarExpanded]
}
