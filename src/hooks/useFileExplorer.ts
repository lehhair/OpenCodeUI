// ============================================
// useFileExplorer - 文件浏览器 Hook
// 管理文件树状态、展开/折叠、文件预览
// ============================================

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { listDirectory, getFileContent, getFileStatus, getSessionDiff, getLastTurnDiff, getVcsDiff } from '../api'
import { toVcsDiffMode } from '../api/vcs'
import type { FileNode, FileContent, FileStatusItem, FileDiff } from '../api/types'
import { useSessionChangeScope } from '../store/changeScopeStore'
import { activeSessionStore } from '../store/activeSessionStore'
import { useAutoRefresh } from './useAutoRefresh'

export interface FileTreeNode extends FileNode {
  children?: FileTreeNode[]
  isLoading?: boolean
  isLoaded?: boolean
}

export interface UseFileExplorerOptions {
  directory?: string
  autoLoad?: boolean
  sessionId?: string
  /** 数据所属服务器（缺省用活动服务器；右侧面板跟随焦点 session 时传入） */
  serverId?: string
  /** 唯一标识，用于注册 SSE 消费者，避免多实例冲突 */
  consumerId?: string
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
  softRefresh: () => Promise<void>
  loadChildren: (parentPath: string) => Promise<void>
}

export function useFileExplorer(options: UseFileExplorerOptions = {}): UseFileExplorerResult {
  const { directory, autoLoad = true, sessionId, serverId, consumerId = 'file-explorer' } = options
  const { t } = useTranslation(['components'])
  const changeMode = useSessionChangeScope(sessionId ?? null)

  // 多服务器模式：session 可能属于远端服务器，其工作区目录是远端路径（session 创建时的工作区）。
  // 文件树/文件状态应使用 session 自身目录，而不是本地 URL/currentDirectory 派生的目录。
  const sessionDirectory = useSyncExternalStore(
    cb => activeSessionStore.subscribe(cb),
    () => (sessionId ? activeSessionStore.getSessionMeta(sessionId)?.directory : undefined),
    () => (sessionId ? activeSessionStore.getSessionMeta(sessionId)?.directory : undefined),
  )
  const effectiveDirectory = sessionId && sessionDirectory ? sessionDirectory : directory
  const directoryRef = useRef(effectiveDirectory)
  directoryRef.current = effectiveDirectory

  // 文件树状态
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 展开状态
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const expandedPathsByDirectoryRef = useRef<Map<string, Set<string>>>(new Map())

  // 预览状态
  const [previewContent, setPreviewContent] = useState<FileContent | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewCacheRef = useRef<Map<string, FileContent>>(new Map())
  const previewLoadIdRef = useRef(0)

  // 文件状态（git）
  const [fileStatus, setFileStatus] = useState<Map<string, FileStatusItem>>(new Map())

  // 用于防止过时请求
  const loadIdRef = useRef(0)
  const childLoadIdsRef = useRef<Map<string, number>>(new Map())
  const statusLoadIdRef = useRef(0)

  // 加载根目录
  const loadRoot = useCallback(
    async (force = false) => {
      if (!effectiveDirectory) return

      const loadId = ++loadIdRef.current
      setIsLoading(true)
      setError(null)

      try {
        // ⚠️ 空串表示「location 根目录」。V2 实测：`path=''`、`path='.'`、不传 path
        //    三者等价，都返回 location 根（不会报错），所以这里保持 V1 的写法不变。
        // `force` 由 softRefresh（自动刷新）传入，用来绕开根目录的 10s TTL 缓存
        const nodes = await listDirectory('', effectiveDirectory, serverId, force ? { force: true } : undefined)

        // 检查请求是否过时
        if (loadId !== loadIdRef.current) return

        // 排序：目录在前，文件在后，按名称排序
        const sorted = sortNodes(nodes)
        setTree(sorted.map(n => ({ ...n, children: n.type === 'directory' ? undefined : undefined })))
      } catch (e) {
        if (loadId === loadIdRef.current) {
          setError(e instanceof Error ? e.message : t('fileExplorer.failedToLoadFiles'))
        }
      } finally {
        if (loadId === loadIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [effectiveDirectory, serverId, t],
  )

  const loadStatuses = useCallback(async () => {
    if (!effectiveDirectory) {
      setFileStatus(new Map())
      return
    }

    const loadId = ++statusLoadIdRef.current
    const statusMap = new Map<string, FileStatusItem>()

    try {
      if (!sessionId) {
        const status = await getFileStatus(effectiveDirectory, serverId)
        if (loadId !== statusLoadIdRef.current) return

        status.forEach(item => {
          const normalized = normalizePath(item.path)
          if (normalized.startsWith('../')) return
          statusMap.set(normalized, { ...item, path: normalized })
        })
      } else {
        const diffs =
          changeMode === 'git' || changeMode === 'branch'
            ? // ⚠️ V2 的 mode 枚举是 working|branch|committed，UI 的 'git' 必须翻译成 'working'
              //（实测直接传 'git' → 400 Expected Vcs.Mode）
              await getVcsDiff(toVcsDiffMode(changeMode), effectiveDirectory, serverId)
            : changeMode === 'turn'
              ? await getLastTurnDiff(sessionId, effectiveDirectory, serverId)
              : await getSessionDiff(sessionId, effectiveDirectory, serverId)

        if (loadId !== statusLoadIdRef.current) return

        diffs.forEach(diff => {
          const normalized = normalizePath(diff.file)
          statusMap.set(normalized, {
            path: normalized,
            added: diff.additions,
            removed: diff.deletions,
            status: getFileStatusFromDiff(diff),
          })
        })
      }

      computeDirectoryStatus(statusMap)
      setFileStatus(statusMap)
    } catch {
      if (loadId !== statusLoadIdRef.current) return
      setFileStatus(new Map())
    }
  }, [changeMode, effectiveDirectory, sessionId, serverId])

  // 加载子目录
  const loadChildren = useCallback(
    async (parentPath: string) => {
      if (!effectiveDirectory) return

      const loadKey = `${effectiveDirectory}\0${parentPath}`
      const loadId = (childLoadIdsRef.current.get(loadKey) ?? 0) + 1
      childLoadIdsRef.current.set(loadKey, loadId)

      const isCurrentLoad = () =>
        directoryRef.current === effectiveDirectory && childLoadIdsRef.current.get(loadKey) === loadId

      // 更新树，标记为加载中
      setTree(prev =>
        updateTreeNode(prev, parentPath, node => ({
          ...node,
          isLoading: true,
        })),
      )

      try {
        const nodes = await listDirectory(parentPath, effectiveDirectory, serverId)
        if (!isCurrentLoad()) return

        const sorted = sortNodes(nodes)

        setTree(prev =>
          updateTreeNode(prev, parentPath, node => ({
            ...node,
            children: sorted.map(n => ({ ...n })),
            isLoading: false,
            isLoaded: true,
          })),
        )
      } catch {
        if (!isCurrentLoad()) return

        setTree(prev =>
          updateTreeNode(prev, parentPath, node => ({
            ...node,
            isLoading: false,
            isLoaded: true,
            children: [],
          })),
        )
      }
    },
    [effectiveDirectory, serverId],
  )

  const updateExpandedPaths = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setExpandedPaths(prev => {
        const next = updater(prev)
        if (effectiveDirectory) {
          expandedPathsByDirectoryRef.current.set(effectiveDirectory, new Set(next))
        }
        return next
      })
    },
    [effectiveDirectory],
  )

  // 切换展开/折叠
  const toggleExpand = useCallback(
    (path: string) => {
      updateExpandedPaths(prev => {
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
    },
    [tree, loadChildren, updateExpandedPaths],
  )

  const expandPath = useCallback(
    (path: string) => {
      updateExpandedPaths(prev => {
        const next = new Set(prev)
        next.add(path)
        return next
      })
      const node = findTreeNode(tree, path)
      if (node && node.type === 'directory' && !node.isLoaded && !node.isLoading) {
        loadChildren(path)
      }
    },
    [tree, loadChildren, updateExpandedPaths],
  )

  const collapsePath = useCallback(
    (path: string) => {
      updateExpandedPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    },
    [updateExpandedPaths],
  )

  // 加载文件预览
  const loadPreview = useCallback(
    async (path: string) => {
      if (!effectiveDirectory) return

      const loadId = ++previewLoadIdRef.current

      setPreviewLoading(true)
      setPreviewError(null)

      const cached = previewCacheRef.current.get(path)
      if (cached) {
        if (loadId === previewLoadIdRef.current) {
          setPreviewContent(cached)
          setPreviewLoading(false)
        }
        return
      }

      try {
        const content = await getFileContent(path, effectiveDirectory, serverId)
        if (loadId !== previewLoadIdRef.current) return
        previewCacheRef.current.set(path, content)
        setPreviewContent(content)
      } catch (e) {
        if (loadId !== previewLoadIdRef.current) return
        setPreviewError(e instanceof Error ? e.message : t('fileExplorer.failedToLoadFile'))
        setPreviewContent(null)
      } finally {
        if (loadId === previewLoadIdRef.current) {
          setPreviewLoading(false)
        }
      }
    },
    [effectiveDirectory, t, serverId],
  )

  const clearPreview = useCallback(() => {
    previewLoadIdRef.current += 1
    setPreviewContent(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }, [])

  // 刷新
  const refresh = useCallback(async () => {
    if (effectiveDirectory) {
      expandedPathsByDirectoryRef.current.delete(effectiveDirectory)
    }
    setExpandedPaths(new Set())
    previewCacheRef.current.clear()
    setPreviewContent(null)
    await Promise.all([loadRoot(), loadStatuses()])
  }, [effectiveDirectory, loadRoot, loadStatuses])

  // 软刷新：重新加载根目录和状态，但保留展开路径和预览
  //
  // ⚠️ 阶段 3b：这里**强制绕开根目录的 10 秒 TTL 缓存**。
  //    该缓存是为「`useChatSession` 预热 + 面板首次挂载」省一次请求而加的；
  //    但软刷新是「session idle / 窗口聚焦 / SSE 重连」触发的，用户期望立刻看到新文件，
  //    走缓存会最多滞后 10 秒（V1 遗留行为）。
  const softRefresh = useCallback(async () => {
    await Promise.all([loadRoot(true), loadStatuses()])
  }, [loadRoot, loadStatuses])

  // 自动刷新：session idle / 窗口聚焦 / SSE 重连
  useAutoRefresh(consumerId, sessionId ?? null, softRefresh, !!effectiveDirectory)

  // 初始加载
  useEffect(() => {
    if (autoLoad && effectiveDirectory) {
      loadRoot()
    }
  }, [autoLoad, effectiveDirectory, loadRoot])

  useEffect(() => {
    if (autoLoad && effectiveDirectory) {
      loadStatuses()
    }
  }, [autoLoad, effectiveDirectory, loadStatuses])

  useEffect(() => {
    if (!effectiveDirectory) {
      setExpandedPaths(new Set())
      return
    }

    const storedPaths = expandedPathsByDirectoryRef.current.get(effectiveDirectory)
    setExpandedPaths(storedPaths ? new Set(storedPaths) : new Set())
  }, [effectiveDirectory])

  useEffect(() => {
    if (!effectiveDirectory || tree.length === 0 || expandedPaths.size === 0) return

    const pendingPaths = collectPendingExpandedDirectoryPaths(tree, expandedPaths)
    if (pendingPaths.length === 0) return

    pendingPaths.forEach(path => {
      void loadChildren(path)
    })
  }, [effectiveDirectory, expandedPaths, loadChildren, tree])

  useEffect(() => {
    previewCacheRef.current.clear()
    previewLoadIdRef.current += 1
    setPreviewContent(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }, [effectiveDirectory, sessionId, serverId])

  return {
    tree,
    isLoading,
    error,
    expandedPaths,
    toggleExpand,
    expandPath,
    collapsePath,
    previewContent,
    previewLoading,
    previewError,
    loadPreview,
    clearPreview,
    fileStatus,
    refresh,
    softRefresh,
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
  updater: (node: FileTreeNode) => FileTreeNode,
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

function collectPendingExpandedDirectoryPaths(tree: FileTreeNode[], expandedPaths: Set<string>): string[] {
  const pending: string[] = []

  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'directory') continue

      if (expandedPaths.has(node.path)) {
        if (!node.isLoaded && !node.isLoading) {
          pending.push(node.path)
          continue
        }
      }

      if (node.children) {
        visit(node.children)
      }
    }
  }

  visit(tree)
  return pending
}

// Helper: 规范化路径 — 统一分隔符为 /，去掉前导 ./
function normalizePath(p: string): string {
  let result = p.replace(/\\/g, '/')
  if (result.startsWith('./')) result = result.slice(2)
  return result
}

// Helper: 从 diff 推断文件状态（优先 status 字段，回退统计推断）
//
// ⛔ 阶段 3b 删掉了「旧版 before/after 兼容」分支：
//    V2 的 `FileDiff.Info`（`packages/schema/src/file-diff.ts`）没有 before/after 字段
//    → 该分支永远不成立（阶段 3a 已核实，见主文档 §9.3）。
function getFileStatusFromDiff(diff: FileDiff): 'added' | 'modified' | 'deleted' {
  if (diff.status) return diff.status as 'added' | 'modified' | 'deleted'
  if (diff.deletions === 0 && diff.additions > 0) return 'added'
  if (diff.additions === 0 && diff.deletions > 0) return 'deleted'
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
      if (!existingStatus || newStatus === 'added' || (newStatus === 'modified' && existingStatus === 'deleted')) {
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
