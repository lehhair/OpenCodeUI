// ============================================
// useFileExplorer - 文件浏览器 Hook
// 管理文件树状态、展开/折叠、文件预览
// ============================================

import { useState, useCallback, useEffect, useRef } from 'react'
import { listDirectory, getFileContent, getFileStatus, getSessionDiff } from '../api'
import type { FileNode, FileContent, FileStatusItem, FileDiff } from '../api/types'

export interface FileTreeNode extends FileNode {
  children?: FileTreeNode[]
  isLoading?: boolean
  isLoaded?: boolean
}

export interface UseFileExplorerOptions {
  directory?: string
  autoLoad?: boolean
  sessionId?: string
}

export interface UseFileExplorerResult {
  // 文件树状态
  tree: FileTreeNode[]
  isLoading: boolean
  error: string | null
  
  // 展开状态
  expandedPaths: Set<string>
  toggleExpand: (path: string) => void
  expandPath: (path: string) => void
  collapsePath: (path: string) => void
  
  // 选中状态
  selectedPath: string | null
  selectFile: (path: string) => void
  
  // 文件预览
  previewContent: FileContent | null
  previewLoading: boolean
  previewError: string | null
  loadPreview: (path: string) => Promise<void>
  clearPreview: () => void
  
  // 文件状态
  fileStatus: Map<string, FileStatusItem>
  
  // 操作
  refresh: () => Promise<void>
  loadChildren: (parentPath: string) => Promise<void>
}

export function useFileExplorer(options: UseFileExplorerOptions = {}): UseFileExplorerResult {
  const { directory, autoLoad = true, sessionId } = options
  
  // 文件树状态
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // 展开状态
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  
  // 选中状态
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  
  // 预览状态
  const [previewContent, setPreviewContent] = useState<FileContent | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  
  // 文件状态（git）
  const [fileStatus, setFileStatus] = useState<Map<string, FileStatusItem>>(new Map())
  
  // 用于防止过时请求
  const loadIdRef = useRef(0)

  // 加载根目录
  const loadRoot = useCallback(async () => {
    if (!directory) return
    
    const loadId = ++loadIdRef.current
    setIsLoading(true)
    setError(null)
    
    try {
      const nodes = await listDirectory('', directory)
      
      // 检查请求是否过时
      if (loadId !== loadIdRef.current) return
      
      // 排序：目录在前，文件在后，按名称排序
      const sorted = sortNodes(nodes)
      setTree(sorted.map(n => ({ ...n, children: n.type === 'directory' ? undefined : undefined })))
      
      // 同时加载文件状态（session diffs 为主，git status 为辅）
      const statusMap = new Map<string, FileStatusItem>()
      
      // 1. 先加载 git status（路径可能包含 ../ 等前缀，需要规范化）
      try {
        const status = await getFileStatus(directory)
        if (loadId === loadIdRef.current) {
          status.forEach(s => {
            // 规范化路径：统一分隔符为 /，去掉 ../ 前缀
            const normalized = normalizePath(s.path)
            // 跳过包含 ../ 的路径（文件在当前目录之外）
            if (!normalized.startsWith('../')) {
              statusMap.set(normalized, { ...s, path: normalized })
            }
          })
        }
      } catch {
        // 忽略文件状态加载失败
      }
      
      // 2. 再加载 session diffs（优先级更高，会覆盖 git status）
      if (sessionId) {
        try {
          const diffs = await getSessionDiff(sessionId)
          if (loadId === loadIdRef.current) {
            diffs.forEach(diff => {
              const status = getFileStatusFromDiff(diff)
              const normalized = normalizePath(diff.file)
              statusMap.set(normalized, {
                path: normalized,
                added: diff.additions,
                removed: diff.deletions,
                status,
              })
            })
          }
        } catch {
          // 忽略 session diff 加载失败
        }
      }
      
      if (loadId === loadIdRef.current) {
        // 从文件状态推算所有父目录的累积状态
        computeDirectoryStatus(statusMap)
        setFileStatus(statusMap)
      }
    } catch (e) {
      if (loadId === loadIdRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load files')
      }
    } finally {
      if (loadId === loadIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [directory, sessionId])

  // 加载子目录
  const loadChildren = useCallback(async (parentPath: string) => {
    if (!directory) return
    
    // 更新树，标记为加载中
    setTree(prev => updateTreeNode(prev, parentPath, node => ({
      ...node,
      isLoading: true,
    })))
    
    try {
      const nodes = await listDirectory(parentPath, directory)
      const sorted = sortNodes(nodes)
      
      setTree(prev => updateTreeNode(prev, parentPath, node => ({
        ...node,
        children: sorted.map(n => ({ ...n })),
        isLoading: false,
        isLoaded: true,
      })))
    } catch (e) {
      setTree(prev => updateTreeNode(prev, parentPath, node => ({
        ...node,
        isLoading: false,
        isLoaded: true,
        children: [],
      })))
    }
  }, [directory])

  // 切换展开/折叠
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
        // 如果该目录尚未加载，触发加载
        const node = findTreeNode(tree, path)
        if (node && node.type === 'directory' && !node.isLoaded && !node.isLoading) {
          loadChildren(path)
        }
      }
      return next
    })
  }, [tree, loadChildren])

  const expandPath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
    const node = findTreeNode(tree, path)
    if (node && node.type === 'directory' && !node.isLoaded && !node.isLoading) {
      loadChildren(path)
    }
  }, [tree, loadChildren])

  const collapsePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

  // 选中文件
  const selectFile = useCallback((path: string) => {
    setSelectedPath(path)
  }, [])

  // 加载文件预览
  const loadPreview = useCallback(async (path: string) => {
    if (!directory) return
    
    setPreviewLoading(true)
    setPreviewError(null)
    
    try {
      const content = await getFileContent(path, directory)
      setPreviewContent(content)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Failed to load file')
      setPreviewContent(null)
    } finally {
      setPreviewLoading(false)
    }
  }, [directory])

  const clearPreview = useCallback(() => {
    setPreviewContent(null)
    setPreviewError(null)
  }, [])

  // 刷新
  const refresh = useCallback(async () => {
    setExpandedPaths(new Set())
    setSelectedPath(null)
    setPreviewContent(null)
    await loadRoot()
  }, [loadRoot])

  // 初始加载
  useEffect(() => {
    if (autoLoad && directory) {
      loadRoot()
    }
  }, [autoLoad, directory, loadRoot])

  return {
    tree,
    isLoading,
    error,
    expandedPaths,
    toggleExpand,
    expandPath,
    collapsePath,
    selectedPath,
    selectFile,
    previewContent,
    previewLoading,
    previewError,
    loadPreview,
    clearPreview,
    fileStatus,
    refresh,
    loadChildren,
  }
}

// ============================================
// Helper Functions
// ============================================

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    // 目录在前
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    // 按名称排序（忽略大小写）
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
}

function findTreeNode(tree: FileTreeNode[], path: string): FileTreeNode | null {
  for (const node of tree) {
    if (node.path === path) return node
    if (node.children) {
      const found = findTreeNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

function updateTreeNode(
  tree: FileTreeNode[],
  path: string,
  updater: (node: FileTreeNode) => FileTreeNode
): FileTreeNode[] {
  return tree.map(node => {
    if (node.path === path) {
      return updater(node)
    }
    if (node.children) {
      return {
        ...node,
        children: updateTreeNode(node.children, path, updater),
      }
    }
    return node
  })
}

// Helper: 规范化路径 — 统一分隔符为 /，去掉前导 ./
function normalizePath(p: string): string {
  let result = p.replace(/\\/g, '/')
  if (result.startsWith('./')) result = result.slice(2)
  return result
}

// Helper: 从 diff 推断文件状态
function getFileStatusFromDiff(diff: FileDiff): 'added' | 'modified' | 'deleted' {
  if (!diff.before || diff.before.trim() === '') return 'added'
  if (!diff.after || diff.after.trim() === '') return 'deleted'
  return 'modified'
}

// Helper: 计算目录的累积状态（基于子文件状态）
function computeDirectoryStatus(statusMap: Map<string, FileStatusItem>): void {
  // 收集所有需要设置状态的目录路径
  const dirStatuses = new Map<string, 'added' | 'modified' | 'deleted'>()
  
  for (const [filePath, item] of statusMap) {
    const parts = filePath.split('/')
    // 构建所有父目录路径
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/')
      const existingStatus = dirStatuses.get(dirPath)
      const newStatus = item.status as 'added' | 'modified' | 'deleted'
      
      // 优先级: added > modified > deleted
      if (!existingStatus || 
          (newStatus === 'added') ||
          (newStatus === 'modified' && existingStatus === 'deleted')) {
        dirStatuses.set(dirPath, newStatus)
      }
    }
  }
  
  // 将目录状态添加到 statusMap
  for (const [dirPath, status] of dirStatuses) {
    if (!statusMap.has(dirPath)) {
      statusMap.set(dirPath, { path: dirPath, added: 0, removed: 0, status })
    }
  }
}
