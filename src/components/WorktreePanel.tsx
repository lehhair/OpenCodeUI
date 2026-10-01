// ============================================
// WorktreePanel - Git 面板
// 显示 VCS 分支信息 + Worktree 管理
// ============================================

import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GitWorktreeIcon,
  GitBranchIcon,
  PlusIcon,
  CloseIcon,
  TrashIcon,
  RetryIcon,
  SpinnerIcon,
  FolderIcon,
  AlertCircleIcon,
  ExternalLinkIcon,
} from './Icons'
import { getCurrentProject } from '../api/client'
import { listPtySessions, removePtySession } from '../api/pty'
import { listWorktrees, createWorktree, removeWorktree, refreshWorktrees } from '../api/worktree'
import { subscribeToEvents } from '../api/events'
import { useDirectory, useVcsInfo, requestGitWorkspaceCatalogRefresh } from '../hooks'
import { getDirectoryName, isSameDirectory, normalizeToForwardSlash } from '../utils'
import type { ApiProject } from '../api'
import { ConfirmDialog } from './ui/ConfirmDialog'

// ============================================
// WorktreePanel Component
// ============================================

interface WorktreePanelProps {
  isResizing?: boolean
}

export const WorktreePanel = memo(function WorktreePanel({ isResizing: _isResizing }: WorktreePanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { currentDirectory, addDirectory, setCurrentDirectory } = useDirectory()
  const { vcsInfo, refresh: refreshVcs } = useVcsInfo(currentDirectory)
  const [worktrees, setWorktrees] = useState<string[]>([])
  /**
   * 当前项目。
   *
   * v2 的 worktree 接口按 **projectID** 定位（v1 用 directory），
   * 且 Project 上不再有 `worktree` 字段——项目根用 `canonical`。
   */
  const [project, setProject] = useState<ApiProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const loadRequestIdRef = useRef(0)
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; directory: string | null }>({
    isOpen: false,
    directory: null,
  })
  const [resetConfirm, setResetConfirm] = useState<{ isOpen: boolean; directory: string | null }>({
    isOpen: false,
    directory: null,
  })

  /**
   * 解析当前目录所属项目。
   *
   * v2 的 Project 只有 `canonical`（项目根），没有 v1 的 `worktree` 字段；
   * worktree 列表改由 `worktree.list({ projectID })` 提供。
   */
  const resolveProject = useCallback(async (directory?: string): Promise<ApiProject | null> => {
    if (!directory) return null
    const current = await getCurrentProject(directory)
    // v2 的 ProjectVcs 是字符串（v1 是对象）
    if (!current || current.vcs !== 'git') return null
    return current
  }, [])

  // 加载 worktree 列表
  const loadWorktrees = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current

    if (!currentDirectory) {
      setError(null)
      setWorktrees([])
      setProject(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const resolvedProject = await resolveProject(currentDirectory)
      if (requestId !== loadRequestIdRef.current) return

      setProject(resolvedProject)
      if (!resolvedProject) {
        setWorktrees([])
        return
      }

      const list = await listWorktrees(resolvedProject.id)
      if (requestId !== loadRequestIdRef.current) return

      setWorktrees(list.map(entry => normalizeToForwardSlash(entry)))
    } catch (e) {
      if (requestId !== loadRequestIdRef.current) return
      setError(e instanceof Error ? e.message : t('worktreePanel.failedToLoad'))
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false)
      }
    }
  }, [currentDirectory, resolveProject, t])

  useEffect(() => {
    loadWorktrees()
  }, [loadWorktrees])

  // 订阅 SSE 事件：worktree 变更 + vcs branch 变更
  useEffect(() => {
    return subscribeToEvents({
      // v2 用 worktree.resolved / worktree.updated 取代 v1 的 ready / failed
      onWorktreeResolved: () => {
        loadWorktrees()
      },
      onWorktreeUpdated: () => {
        loadWorktrees()
      },
      onVcsBranchUpdated: () => {
        refreshVcs()
      },
    })
  }, [loadWorktrees, refreshVcs])

  const releaseWorktreeResources = useCallback(async (directory: string) => {
    try {
      const ptySessions = await listPtySessions(directory)
      await Promise.allSettled(ptySessions.map(pty => removePtySession(pty.id, directory)))
    } catch {
      // ignore cleanup failure here, let remove/reset report the real error
    }

    // v2 删除了 global.dispose / instance.dispose，改由 worktree.refresh 让服务端重扫
  }, [])

  const requireProject = useCallback((): ApiProject => {
    if (!project) {
      throw new Error(t('worktreePanel.failedToLoad'))
    }
    return project
  }, [project, t])

  const canManageWorktrees = !!project && !loading

  // 在 worktree 目录下开启新 session
  const handleOpenSession = useCallback(
    (worktreeDir: string) => {
      const normalized = normalizeToForwardSlash(worktreeDir)
      // 把 worktree 目录加入项目列表（同时切换过去）
      addDirectory(normalized)
      // 直接设置 URL hash 到新 session 状态（清掉 sessionId，用 worktree 目录）
      window.location.hash = `#/?dir=${normalized}`
    },
    [addDirectory],
  )

  // 创建 worktree
  const handleCreate = useCallback(
    async (name: string, autoOpen: boolean) => {
      if (!currentDirectory || !name.trim()) return

      setActionLoading('create')
      try {
        const current = requireProject()
        const wt = await createWorktree({ projectID: current.id, name: name.trim() })
        setShowCreateForm(false)
        await loadWorktrees()
        requestGitWorkspaceCatalogRefresh()
        if (autoOpen && wt.directory) {
          handleOpenSession(wt.directory)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t('worktreePanel.failedToCreate'))
      } finally {
        setActionLoading(null)
      }
    },
    [currentDirectory, handleOpenSession, loadWorktrees, requireProject, t],
  )

  // 删除 worktree
  const handleDelete = useCallback(
    async (directory: string) => {
      if (!currentDirectory) return

      setActionLoading(`delete-${directory}`)
      try {
        const current = requireProject()
        const isCurrentDirectory = isSameDirectory(currentDirectory, directory)

        if (isCurrentDirectory && !isSameDirectory(currentDirectory, current.canonical)) {
          setCurrentDirectory(current.canonical)
        }

        await releaseWorktreeResources(directory)
        await removeWorktree({ projectID: current.id, directory, force: true })
        await loadWorktrees()
        requestGitWorkspaceCatalogRefresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : t('worktreePanel.failedToRemove'))
      } finally {
        setActionLoading(null)
        setDeleteConfirm({ isOpen: false, directory: null })
      }
    },
    [currentDirectory, loadWorktrees, releaseWorktreeResources, requireProject, setCurrentDirectory, t],
  )

  /**
   * 刷新 worktree。
   *
   * v2 删除了 v1 的 `worktree.reset`，取而代之的是 `worktree.refresh`
   * （让服务端重新扫描 worktree 状态，而不是丢弃本地改动）。
   */
  const handleReset = useCallback(
    async (directory: string) => {
      if (!currentDirectory) return

      setActionLoading(`reset-${directory}`)
      try {
        const current = requireProject()
        await releaseWorktreeResources(directory)
        await refreshWorktrees(current.id)
        await loadWorktrees()
        requestGitWorkspaceCatalogRefresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : t('worktreePanel.failedToReset'))
      } finally {
        setActionLoading(null)
        setResetConfirm({ isOpen: false, directory: null })
      }
    },
    [currentDirectory, loadWorktrees, releaseWorktreeResources, requireProject, t],
  )

  // ==========================================
  // Render
  // ==========================================

  if (!currentDirectory) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)] gap-2 p-4">
        <GitWorktreeIcon size={24} className="opacity-30" />
        <span>{t('worktreePanel.selectProject')}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="relative flex h-10 items-center justify-between px-3">
        <div className="flex h-6 min-w-0 items-center gap-1.5 text-[length:var(--fs-xs)] text-text-100">
          <span className="font-medium">{t('worktreePanel.git')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              loadWorktrees()
              refreshVcs()
            }}
            disabled={loading}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-400 hover:text-text-100 hover:bg-bg-200/50 transition-colors"
            title={t('common:refresh')}
            aria-label={t('common:refresh')}
          >
            <RetryIcon size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
      </div>

      {/* VCS Branch — v2 的 branch 是 { current?, default? }，不是字符串 */}
      {vcsInfo?.branch?.current && (
        <div className="relative px-3 py-2">
          <div className="flex items-center gap-2">
            <GitBranchIcon size={14} className="text-accent-main-100 shrink-0" />
            <span
              className="text-[length:var(--fs-sm)] font-mono text-text-100 truncate"
              title={vcsInfo.branch.current}
            >
              {vcsInfo.branch.current}
            </span>
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
        </div>
      )}

      {/* Worktrees Section Header */}
      <div className="relative flex items-center justify-between px-3 py-1.5">
        <div className="flex h-6 items-center gap-1.5 text-[length:var(--fs-xs)] text-text-300">
          <span className="font-medium">{t('worktreePanel.worktrees')}</span>
          {!loading && <span className="text-text-400">({worktrees.length})</span>}
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm(true)}
          disabled={!!actionLoading || !canManageWorktrees}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-400 hover:text-text-100 hover:bg-bg-200/50 transition-colors"
          title={t('worktreePanel.createWorktree')}
          aria-label={t('worktreePanel.createWorktree')}
        >
          <PlusIcon size={12} />
        </button>
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-2 px-2.5 py-2 rounded-md bg-danger-100/10 border border-danger-100/20 flex items-start gap-2">
          <AlertCircleIcon size={12} className="text-danger-100 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="text-[length:var(--fs-xs)] text-danger-100 break-all">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={t('common:close')}
            className="p-0.5 rounded text-text-400 hover:text-text-100 shrink-0"
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && canManageWorktrees && (
        <CreateWorktreeForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)}
          isLoading={actionLoading === 'create'}
        />
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-400 text-[length:var(--fs-sm)] gap-2">
            <SpinnerIcon size={14} className="animate-spin" />
            <span>{t('worktreePanel.loadingWorktrees')}</span>
          </div>
        ) : worktrees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-400 text-[length:var(--fs-sm)] gap-2 p-4">
            <GitWorktreeIcon size={20} className="opacity-30" />
            <span>{t('worktreePanel.noWorktrees')}</span>
            <button
              onClick={() => setShowCreateForm(true)}
              disabled={!canManageWorktrees}
              className="px-3 py-1.5 text-[length:var(--fs-xs)] bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
            >
              {t('worktreePanel.createWorktree')}
            </button>
          </div>
        ) : (
          <div className="p-1">
            {worktrees.map(wt => (
              <WorktreeItem
                key={wt}
                directory={wt}
                name={getDirectoryName(wt)}
                isLoading={actionLoading === `delete-${wt}` || actionLoading === `reset-${wt}`}
                onOpenSession={() => handleOpenSession(wt)}
                onDelete={() => setDeleteConfirm({ isOpen: true, directory: wt })}
                onReset={() => setResetConfirm({ isOpen: true, directory: wt })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, directory: null })}
        onConfirm={() => {
          if (deleteConfirm.directory) {
            handleDelete(deleteConfirm.directory)
          }
        }}
        title={t('worktreePanel.removeWorktree')}
        description={t('worktreePanel.removeWorktreeConfirm', {
          name: deleteConfirm.directory ? getDirectoryName(deleteConfirm.directory) : '',
        })}
        confirmText={t('common:remove')}
        variant="danger"
      />

      {/* Reset Confirm */}
      <ConfirmDialog
        isOpen={resetConfirm.isOpen}
        onClose={() => setResetConfirm({ isOpen: false, directory: null })}
        onConfirm={() => {
          if (resetConfirm.directory) {
            handleReset(resetConfirm.directory)
          }
        }}
        title={t('worktreePanel.resetWorktree')}
        description={t('worktreePanel.resetWorktreeConfirm', {
          name: resetConfirm.directory ? getDirectoryName(resetConfirm.directory) : '',
        })}
        confirmText={t('common:reset')}
        variant="danger"
      />
    </div>
  )
})

// ============================================
// CreateWorktreeForm Component
// ============================================

interface CreateWorktreeFormProps {
  onSubmit: (name: string, autoOpen: boolean) => void
  onCancel: () => void
  isLoading: boolean
}

function CreateWorktreeForm({ onSubmit, onCancel, isLoading }: CreateWorktreeFormProps) {
  const { t } = useTranslation(['components', 'common'])
  const [name, setName] = useState('')
  const [autoOpen, setAutoOpen] = useState(true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onSubmit(name, autoOpen)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-3 mt-2 p-2.5 rounded-lg bg-bg-100/50 border border-border-200/60">
      <div className="text-[length:var(--fs-xs)] text-text-300 font-medium mb-2">{t('worktreePanel.newWorktree')}</div>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={t('worktreePanel.worktreeNamePlaceholder')}
        className="w-full bg-bg-000 border border-border-200 rounded-md px-2.5 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/60 focus:outline-none focus:border-accent-main-100/50 transition-colors"
        autoFocus
        disabled={isLoading}
      />
      <label className="flex items-center gap-1.5 mt-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={autoOpen}
          onChange={e => setAutoOpen(e.target.checked)}
          disabled={isLoading}
          className="rounded border-border-200 text-accent-main-100 focus:ring-accent-main-100/30 w-3.5 h-3.5"
        />
        <span className="text-[length:var(--fs-xs)] text-text-300">{t('worktreePanel.openSessionAfter')}</span>
      </label>
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-2.5 py-1 text-[length:var(--fs-xs)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 rounded-md transition-colors"
        >
          {t('common:cancel')}
        </button>
        <button
          type="submit"
          disabled={!name.trim() || isLoading}
          className="px-2.5 py-1 text-[length:var(--fs-xs)] bg-accent-main-100 hover:bg-accent-main-200 text-oncolor-100 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {isLoading && <SpinnerIcon size={10} className="animate-spin" />}
          {t('common:create')}
        </button>
      </div>
    </form>
  )
}

// ============================================
// WorktreeItem Component
// ============================================

interface WorktreeItemProps {
  directory: string
  name: string
  isLoading: boolean
  onOpenSession: () => void
  onDelete: () => void
  onReset: () => void
}

const WorktreeItem = memo(function WorktreeItem({
  directory,
  name,
  isLoading,
  onOpenSession,
  onDelete,
  onReset,
}: WorktreeItemProps) {
  const { t } = useTranslation(['components', 'common'])

  return (
    <div className="group flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-bg-200/50 transition-colors">
      {/* Icon */}
      <div className="w-7 h-7 rounded-md bg-bg-200/60 flex items-center justify-center shrink-0">
        <FolderIcon size={14} className="text-text-400" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[length:var(--fs-sm)] text-text-100 font-medium truncate">{name}</div>
        <div className="text-[length:var(--fs-xxs)] text-text-400/70 font-mono truncate" title={directory}>
          {directory}
        </div>
      </div>

      {/* Actions */}
      {isLoading ? (
        <SpinnerIcon size={12} className="animate-spin text-text-400 shrink-0" />
      ) : (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={onOpenSession}
            className="p-1 rounded-md text-text-400 hover:text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
            title={t('worktreePanel.openSession')}
          >
            <ExternalLinkIcon size={12} />
          </button>
          <button
            onClick={onReset}
            className="p-1 rounded-md text-text-400 hover:text-warning-100 hover:bg-warning-100/10 transition-colors"
            title={t('worktreePanel.resetWorktreeAction')}
          >
            <RetryIcon size={12} />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded-md text-text-400 hover:text-danger-100 hover:bg-danger-100/10 transition-colors"
            title={t('worktreePanel.removeWorktreeAction')}
          >
            <TrashIcon size={12} />
          </button>
        </div>
      )}
    </div>
  )
})
