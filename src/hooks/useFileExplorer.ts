// ============================================
// useFileExplorer - 文件浏览器 Hook
// 管理文件树状态、展开/折叠、文件预览
// ============================================

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { listDirectory, getFileContent, getFileStatus, getSessionDiff, getVcsDiff, writeFileBytes } from '../api'
import type { FileNode, FileContent, FileStatusItem, FileDiff } from '../api/types'
import { useSessionChangeScope } from '../store/changeScopeStore'
import { activeSessionStore } from '../store/activeSessionStore'
import { useAutoRefresh } from './useAutoRefresh'
import { canonicalizePath, fileBaseName, toAbsoluteFilePath } from '../utils/pathUtils'
import { createUploadId, getServerTmpDirectory } from '../api/file'
import {
  encodeTextPreservingFormat,
  encodeTextUnifyingLineEndings,
  hashBytes,
  MixedLineEndingsError,
} from '../utils/textEncoding'

/**
 * 文件树节点。
 *
 * v2 的 `file.list` / `file.find` 只返回扁平的 `{ path, type }`，
 * 没有 v1 的 `name` / `absolute` / `children`，因此这些字段由 UI 派生：
 *   - `name`     ← path 的 basename
 *   - `absolute` ← path 与工作区目录拼接
 *   - `children` ← 展开时再列目录（懒加载）
 *
 * v1 的 `ignored` 标志在 v2 不再返回（`file.list` 已过滤），
 * 因此这里不再声明该字段。
 */
export interface FileTreeNode {
  /** 根相对路径（唯一键，也是继续列子目录时传的 path） */
  path: string
  /** 展示名（path 的 basename） */
  name: string
  /** 绝对路径（拖拽 @mention、在系统文件管理器中显示用） */
  absolute: string
  type: 'file' | 'directory'
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
  loadPreview: (path: string, force?: boolean) => Promise<void>
  /** 保存编辑中的文件（需求三）：基线比对 → 保真编码 → 写 → 写后重读并更新缓存 */
  savePreview: (
    path: string,
    text: string,
    baselineHash?: string,
    force?: boolean,
    unifyEol?: boolean,
  ) => Promise<FileContent>
  /** 正在预览的文件被外部改动过（agent / 别的编辑器）；dirty 时即冲突来源 */
  externalChange: { path: string } | null
  clearExternalChange: () => void
  clearPreview: () => void

  /** 实际生效的目录（session 目录优先于传入目录）；预览按此作用域分键 */
  effectiveDirectory: string | undefined

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
    activeSessionStore.subscribe,
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
  /** 正在预览的内容（ref 版：事件回调里要读最新值） */
  const previewContentRef = useRef<FileContent | null>(null)
  /** 外部改动标记 */
  const [externalChange, setExternalChange] = useState<{ path: string } | null>(null)
  /** 最近一次由我们写入的文件（路径 + 内容指纹），用于自写事件抑制 */
  const lastWriteRef = useRef<{ path: string; hash: string } | null>(null)
  const previewLoadIdRef = useRef(0)

  // 文件状态（git）
  const [fileStatus, setFileStatus] = useState<Map<string, FileStatusItem>>(new Map())

  // 用于防止过时请求
  const loadIdRef = useRef(0)
  const childLoadIdsRef = useRef<Map<string, number>>(new Map())
  const statusLoadIdRef = useRef(0)

  // 加载根目录
  const loadRoot = useCallback(async () => {
    if (!effectiveDirectory) return

    const loadId = ++loadIdRef.current
    setIsLoading(true)
    setError(null)

    try {
      const nodes = await listDirectory('', effectiveDirectory, serverId)

      // 检查请求是否过时
      if (loadId !== loadIdRef.current) return

      // 排序：目录在前，文件在后，按名称排序
      const sorted = sortNodes(nodes.map(n => toTreeNode(n, '', effectiveDirectory)))
      setTree(sorted)
    } catch (e) {
      if (loadId === loadIdRef.current) {
        setError(e instanceof Error ? e.message : t('fileExplorer.failedToLoadFiles'))
      }
    } finally {
      if (loadId === loadIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [effectiveDirectory, serverId, t])

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
          // v2 的 VcsFileStatus 用 `file` 而不是 `path`
          const normalized = normalizePath(item.file)
          if (normalized.startsWith('../')) return
          statusMap.set(normalized, { ...item, file: normalized })
        })
      } else {
        // 与官方 review 三模式一致：git → vcs.diff(working)，branch →
        // vcs.diff(branch)，turn → session.diff（服务端按 session 自身
        // location 解析快照仓库，无需调用方传 directory）
        const diffs =
          changeMode === 'turn'
            ? await getSessionDiff(sessionId, serverId)
            : await getVcsDiff(changeMode === 'git' ? 'working' : 'branch', effectiveDirectory, serverId)

        if (loadId !== statusLoadIdRef.current) return

        diffs.forEach(diff => {
          const normalized = normalizePath(diff.file)
          statusMap.set(normalized, {
            file: normalized,
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

      const isCurrentLoad = () => directoryRef.current === effectiveDirectory && childLoadIdsRef.current.get(loadKey) === loadId

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

        const sorted = sortNodes(nodes.map(n => toTreeNode(n, parentPath, effectiveDirectory)))

        setTree(prev =>
          updateTreeNode(prev, parentPath, node => ({
            ...node,
            children: sorted,
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

  const collapsePath = useCallback((path: string) => {
    updateExpandedPaths(prev => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [updateExpandedPaths])

  /**
   * 保存编辑中的文件（需求三：保存事务）。
   *
   * 服务端的 `fs.write` 没有 If-Match / 版本号（协议里只有 path + 裸字节），
   * 所以乐观并发只能自己做：**保存前重读磁盘**，与编辑开始时的基线指纹比对。
   * 不一致且未 force → 抛 `code: 'STALE_REVISION'`，由 UI 弹"重新载入 / 覆盖"。
   *
   * 写回时按原文保真（行尾 / BOM）；混合行尾原文直接拒绝（写出去必然整文件 diff）。
   */
  const savePreview = useCallback(
    async (path: string, text: string, baselineHash?: string, force = false, unifyEol = false): Promise<FileContent> => {
      if (!effectiveDirectory) throw new Error('No workspace is available')

      // ⓪ 写入安全边界（§4.7）：只允许写工作区内的路径。
      //    fs.write 本身不受 location 限制，所以必须自己拦一道。
      const absTarget = canonicalizePath(toAbsoluteFilePath(path, effectiveDirectory))
      const absRoot = canonicalizePath(effectiveDirectory).replace(/[/\\]+$/, "")
      const withinRoot =
        absTarget === absRoot || absTarget.startsWith(`${absRoot}/`) || absTarget.startsWith(`${absRoot}\\`)
      if (!withinRoot) {
        const outside = new Error(t("fileExplorer.writeOutsideWorkspace")) as Error & { code?: string }
        outside.code = "OUTSIDE_WORKSPACE"
        throw outside
      }
      const cacheKey = `${serverId ?? ''}::${effectiveDirectory}::${path}`
      const baseline = previewCacheRef.current.get(cacheKey)

      // ① 条件校验：同时保证"只改已存在的文件"——文件没了就地报错，不会凭空创建
      const disk = await getFileContent(path, effectiveDirectory, serverId).catch(() => {
        const missing = new Error(t("fileExplorer.fileMissing")) as Error & { code?: string }
        missing.code = "FILE_MISSING"
        throw missing
      })
      if (!force && baselineHash && hashBytes(disk.bytes) !== baselineHash) {
        const conflict = new Error(t('fileExplorer.saveConflict')) as Error & { code?: string }
        conflict.code = 'STALE_REVISION'
        throw conflict
      }

      // ② 保真编码（混合行尾默认拒绝；unifyEol 是用户确认后的"按多数行尾统一"兜底）
      let encoded: Uint8Array
      try {
        const original = baseline?.bytes ?? disk.bytes
        encoded = unifyEol
          ? encodeTextUnifyingLineEndings(original, text)
          : encodeTextPreservingFormat(original, text)
      } catch (error) {
        if (error instanceof MixedLineEndingsError) {
          const mixed = new Error(t("fileExplorer.mixedLineEndings")) as Error & { code?: string }
          mixed.code = "MIXED_EOL"
          throw mixed
        }
        throw error
      }

      // ③ 覆盖前留备份：服务端 fs.write 没有版本号/快照，备份是唯一兜底。
      //    备份失败不阻断保存（用户要的是存下来）。
      try {
        const tmp = await getServerTmpDirectory(serverId)
        const backupTarget = `${tmp.replace(/[/\\]+$/, "")}/backups/${createUploadId()}/${fileBaseName(path)}`
        await writeFileBytes(backupTarget, disk.bytes, effectiveDirectory, serverId)
      } catch (backupError) {
        console.warn("[useFileExplorer] 备份失败（保存继续）:", backupError)
      }

      // ④ 写入
      await writeFileBytes(path, encoded, effectiveDirectory, serverId)

      // ④ 写后重读（既做校验，也让缓存与磁盘一致——顺手修掉"存完切走再切回是旧内容"）
      const saved = await getFileContent(path, effectiveDirectory, serverId)

      // ⑥ 写后校验：磁盘上真的是我们刚写的那些字节吗？
      //    不一致说明保存被打断，或写完立刻又被并发改了 —— 保留 dirty 让用户重试。
      if (hashBytes(saved.bytes) !== hashBytes(encoded)) {
        const verifyError = new Error(t("fileExplorer.saveVerifyFailed")) as Error & { code?: string }
        verifyError.code = "VERIFY_FAILED"
        throw verifyError
      }
      previewCacheRef.current.set(cacheKey, saved)
      setPreviewContent(current => (current?.path === path ? saved : current))
      // 记下"这是我刚写的内容"：后续 filesystem.changed 用内容指纹认出自己的写，
      // 避免把自己的保存当成外部改动（那会导致保存后立刻弹冲突）。
      lastWriteRef.current = { path, hash: hashBytes(saved.bytes) }
      return saved
    },
    [effectiveDirectory, serverId, t],
  )

  useEffect(() => {
    previewContentRef.current = previewContent
  }, [previewContent])

  /**
   * filesystem.changed 命中正在预览的文件时（需求三：和 agent 抢同一个文件）。
   *
   * 两件事：
   *  1) **自写抑制**：内容指纹与我们刚写入的一致 → 是我们自己的保存，忽略
   *  2) 内容真变了 → 刷新预览内容与缓存（只读视图立刻看到最新），并把这次
   *     外部改动标记出去；若用户正在编辑（dirty），保存时会由基线比对报冲突
   */
  const handleExternalFileChange = useCallback(
    async (file: string) => {
      const current = previewContentRef.current
      if (!current || !effectiveDirectory) return

      const absChanged = toAbsoluteFilePath(file, effectiveDirectory)
      const absCurrent = toAbsoluteFilePath(current.path, effectiveDirectory)
      if (canonicalizePath(absChanged) !== canonicalizePath(absCurrent)) return

      const fresh = await getFileContent(current.path, effectiveDirectory, serverId).catch(() => null)
      if (!fresh) return
      const freshHash = hashBytes(fresh.bytes)

      // 自写抑制：是我们刚写下去的内容 → 不是外部改动
      const last = lastWriteRef.current
      if (last && last.path === current.path && last.hash === freshHash) return
      // 内容其实没变（touch / 权限变更等）：无需提示
      if (current.bytes && hashBytes(current.bytes) === freshHash) return

      const cacheKey = `${serverId ?? ""}::${effectiveDirectory}::${current.path}`
      previewCacheRef.current.set(cacheKey, fresh)
      setPreviewContent(fresh)
      setExternalChange({ path: current.path })
    },
    [effectiveDirectory, serverId],
  )

  // 加载文件预览
  const loadPreview = useCallback(
    async (path: string, force = false) => {
      if (!effectiveDirectory) return

      const loadId = ++previewLoadIdRef.current

      setPreviewLoading(true)
      setPreviewError(null)

      // 缓存键必须带服务器+目录维度：相对路径在不同工作区会撞名（两边都有
      // src/app.ts），只按 path 缓存会在切工作区后预览到上一个工作区的同名文件
      const cacheKey = `${serverId ?? ''}::${effectiveDirectory}::${path}`
      const cached = force ? undefined : previewCacheRef.current.get(cacheKey)
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
        previewCacheRef.current.set(cacheKey, content)
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
  const softRefresh = useCallback(async () => {
    await Promise.all([loadRoot(), loadStatuses()])
  }, [loadRoot, loadStatuses])

  // 自动刷新：文件/分支变更事件 + session idle + SSE 重连（见 useAutoRefresh）
  useAutoRefresh(consumerId, sessionId ?? null, softRefresh, !!effectiveDirectory, {
    watchDirectory: effectiveDirectory,
    onFilesystemChanged: data => {
      void handleExternalFileChange(data.file)
    },
  })

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
    // 目录/会话/服务器切换：清的是「当前显示」与在途请求，缓存按目录分键保留——
    // 切回工作区时预览秒开，且绝不会串到另一个工作区的同名文件内容
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
    savePreview,
    externalChange,
    clearExternalChange: () => setExternalChange(null),
    clearPreview,
    effectiveDirectory,
    fileStatus,
    refresh,
    softRefresh,
    loadChildren,
  }
}

// ============================================
// Helper Functions
// ============================================

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    // 目录在前
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    // 按名称排序（忽略大小写）
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
}

/**
 * 把 v2 的扁平条目投影成树节点。
 *
 * v2 的条目路径是**相对工作区根**的（`file.find` 的命中来自整棵树，
 * 只有根相对路径才有意义）。这里做一次归一化：若条目路径没有以
 * 所列出目录为前缀，则按「相对该目录」解释并补上前缀，两种约定都能正确成树。
 */
function toTreeNode(entry: FileNode, parentPath: string, directory?: string): FileTreeNode {
  const entryPath = normalizePath(entry.path)
  const parent = normalizePath(parentPath)
  const path =
    parent && entryPath !== parent && !entryPath.startsWith(`${parent}/`)
      ? `${parent}/${entryPath}`
      : entryPath

  return {
    path,
    name: fileBaseName(path),
    absolute: toAbsoluteFilePath(path, directory),
    type: entry.type,
  }
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

// Helper: 规范化路径 — 统一分隔符为 /，去掉前导 ./ 与尾斜杠。
// 尾斜杠必须剥掉：部分服务器版本（Windows v2 见过）目录条目带 `/` 后缀，
// 留着会让 toTreeNode 的父前缀判断失效，拼出 `parent//parent/file` 的重复路径，
// 读取时服务端原样报 FileNotFound（issue #176）。
function normalizePath(p: string): string {
  let result = p.replace(/\\/g, '/')
  if (result.startsWith('./')) result = result.slice(2)
  if (result.length > 1) result = result.replace(/\/+$/, '')
  return result
}

// Helper: 从 diff 推断文件状态（优先 status 字段，回退统计推断，最后 before/after 推断）
function getFileStatusFromDiff(diff: FileDiff): 'added' | 'modified' | 'deleted' {
  if (diff.status) return diff.status as 'added' | 'modified' | 'deleted'
  if (diff.deletions === 0 && diff.additions > 0) return 'added'
  if (diff.additions === 0 && diff.deletions > 0) return 'deleted'
  // 旧版 before/after 兼容
  if (diff.before !== undefined && diff.after !== undefined) {
    if (!diff.before.trim()) return 'added'
    if (!diff.after.trim()) return 'deleted'
  }
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
      statusMap.set(dirPath, { file: dirPath, added: 0, removed: 0, status })
    }
  }
}
