// ============================================
// useFileExplorer - 文件浏览器 Hook
// 管理文件树状态、展开/折叠、文件预览
// ============================================

import { useState, useCallback, useEffect, useRef } from 'react'
import { listDirectory, getFileContent, getFileStatus } from '../api'
import type { FileNode, FileContent, FileStatusItem } from '../api/types'

export interface FileTreeNode extends FileNode {
  children?: FileTreeNode[]
  isLoading?: boolean
  isLoaded?: boolean
}

export interface UseFileExplorerOptions {
  directory?: string
  autoLoad?: boolean
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
  const { directory, autoLoad = true } = options
  
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
      
      // 同时加载文件状态
      try {
        const status = await getFileStatus(directory)
        if (loadId === loadIdRef.current) {
          const statusMap = new Map<string, FileStatusItem>()
          status.forEach(s => statusMap.set(s.path, s))
          setFileStatus(statusMap)
        }
      } catch {
        // 忽略文件状态加载失败
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
  }, [directory])

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
