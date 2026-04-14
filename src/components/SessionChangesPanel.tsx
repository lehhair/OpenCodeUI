// ============================================
// SessionChangesPanel - 会话变更查看器
// 布局：上方文件列表 + 下方 Diff 预览（类似 FileExplorer）
// 支持拖拽调整高度，CSS 变量 + requestAnimationFrame 优化
// ============================================

import { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RetryIcon, ChevronRightIcon, MaximizeIcon, ClockIcon, GitBranchIcon, GitDiffIcon, LayersIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { DiffViewer, type ViewMode } from './DiffViewer'
import { FullscreenViewer, ViewModeSwitch } from './FullscreenViewer'
import { getCurrentProject, initGitProject } from '../api/client'
import { getLastTurnDiff, getSessionDiff } from '../api/session'
import { getVcsDiff, getVcsInfo } from '../api/vcs'
import type { ApiProject, FileDiff, VcsDiffMode, VcsInfo } from '../api/types'
import { detectLanguage } from '../utils/languageUtils'
import { extractContentFromUnifiedDiff } from '../utils/diffUtils'
import { sessionErrorHandler } from '../utils'
import { PreviewTabsBar, type PreviewTabsBarItem } from './PreviewTabsBar'
import { useVerticalSplitResize } from '../hooks/useVerticalSplitResize'
import { DropdownMenu } from './ui'
import { changeScopeStore, useSessionChangeScope, type ChangeScopeMode } from '../store/changeScopeStore'

// 常量
const MIN_LIST_HEIGHT = 80
const MIN_PREVIEW_HEIGHT = 120

type ChangeMode = ChangeScopeMode

function getDefaultChangeMode(options: ChangeMode[]) {
  if (options.includes('session')) return 'session'
  if (options.includes('turn')) return 'turn'
  if (options.includes('git')) return 'git'
  if (options.includes('branch')) return 'branch'
  return options[0] ?? 'session'
}

function reconcileDiffPreviewState(diffs: FileDiff[], openFiles: string[], activeFile: string | null) {
  const availableFiles = new Set(diffs.map(diff => diff.file))
  const nextOpenFiles = openFiles.filter(file => availableFiles.has(file))

  if (nextOpenFiles.length === 0 && diffs.length > 0) {
    nextOpenFiles.push(diffs[0].file)
  }

  const nextActiveFile = activeFile && nextOpenFiles.includes(activeFile) ? activeFile : (nextOpenFiles[0] ?? null)

  return { nextOpenFiles, nextActiveFile }
}

interface SessionChangesPanelProps {
  sessionId: string
  directory?: string
  isResizing?: boolean
}

export const SessionChangesPanel = memo(function SessionChangesPanel({
  sessionId,
  directory,
  isResizing: isPanelResizing = false,
}: SessionChangesPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const {
    splitHeight: listHeight,
    isResizing,
    resetSplitHeight,
    handleResizeStart,
    handleTouchResizeStart,
  } = useVerticalSplitResize({
    containerRef,
    primaryRef: listRef,
    cssVariableName: '--list-height',
    minPrimaryHeight: MIN_LIST_HEIGHT,
    minSecondaryHeight: MIN_PREVIEW_HEIGHT,
  })

  const [project, setProject] = useState<ApiProject | null>(null)
  const [vcsInfo, setVcsInfo] = useState<VcsInfo | null>(null)
  const [projectLoading, setProjectLoading] = useState(false)
  const [initializingGit, setInitializingGit] = useState(false)
  const [loadingModes, setLoadingModes] = useState({ git: false, branch: false, session: false, turn: false })
  const [loadedModes, setLoadedModes] = useState({ git: false, branch: false, session: false, turn: false })
  const [gitDiffs, setGitDiffs] = useState<FileDiff[]>([])
  const [branchDiffs, setBranchDiffs] = useState<FileDiff[]>([])
  const [sessionDiffs, setSessionDiffs] = useState<FileDiff[]>([])
  const [turnDiffs, setTurnDiffs] = useState<FileDiff[]>([])
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const [listMode, setListMode] = useState<'flat' | 'tree'>('tree')
  const [changeMenuOpen, setChangeMenuOpen] = useState(false)
  const changeMode = useSessionChangeScope(sessionId)

  // 选中的文件（显示在预览区）
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [openDiffFiles, setOpenDiffFiles] = useState<string[]>([])

  // 展开的目录
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const projectRequestIdRef = useRef(0)
  const diffRequestIdRef = useRef({ git: 0, branch: 0, session: 0, turn: 0 })
  const openDiffFilesRef = useRef<string[]>([])
  const selectedFileRef = useRef<string | null>(null)
  const changeMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const changeMenuRef = useRef<HTMLDivElement>(null)

  const isAnyResizing = isPanelResizing || isResizing
  const setChangeMode = useCallback(
    (mode: ChangeMode) => {
      changeScopeStore.setMode(sessionId, mode)
    },
    [sessionId],
  )
  const changeOptions = useMemo<ChangeMode[]>(() => {
    const options: ChangeMode[] = []
    if (project?.vcs) options.push('session', 'turn', 'git')
    if (project?.vcs && vcsInfo?.branch && vcsInfo?.default_branch && vcsInfo.branch !== vcsInfo.default_branch) {
      options.push('branch')
    }
    return options
  }, [project?.vcs, vcsInfo?.branch, vcsInfo?.default_branch])
  const preferredChangeMode = useMemo(() => getDefaultChangeMode(changeOptions), [changeOptions])
  const changeModeMeta = useMemo(
    () => ({
      git: {
        label: t('sessionChanges.gitScope'),
        description: t('sessionChanges.gitScopeHint'),
        icon: <GitDiffIcon size={12} />,
      },
      branch: {
        label: t('sessionChanges.branchScope'),
        description: t('sessionChanges.branchScopeHint', { branch: vcsInfo?.default_branch ?? 'main' }),
        icon: <GitBranchIcon size={12} />,
      },
      session: {
        label: t('sessionChanges.sessionScope'),
        description: t('sessionChanges.sessionScopeHint'),
        icon: <LayersIcon size={12} />,
      },
      turn: {
        label: t('sessionChanges.turnScope'),
        description: t('sessionChanges.turnScopeHint'),
        icon: <ClockIcon size={12} />,
      },
    }),
    [t, vcsInfo?.default_branch],
  )
  const diffs = useMemo(
    () =>
      changeMode === 'git'
        ? gitDiffs
        : changeMode === 'branch'
          ? branchDiffs
          : changeMode === 'session'
            ? sessionDiffs
            : turnDiffs,
    [branchDiffs, changeMode, gitDiffs, sessionDiffs, turnDiffs],
  )
  const loading = projectLoading || initializingGit || loadingModes[changeMode]

  useEffect(() => {
    openDiffFilesRef.current = openDiffFiles
  }, [openDiffFiles])

  useEffect(() => {
    selectedFileRef.current = selectedFile
  }, [selectedFile])

  useEffect(() => {
    if (!changeMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (changeMenuRef.current?.contains(target) || changeMenuTriggerRef.current?.contains(target)) {
        return
      }
      setChangeMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChangeMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [changeMenuOpen])

  const loadProjectState = useCallback(async () => {
    if (!sessionId) return null

    const requestId = ++projectRequestIdRef.current
    setProjectLoading(true)
    setError(null)

    try {
      const nextProject = await getCurrentProject(directory)
      if (requestId !== projectRequestIdRef.current) return null
      setProject(nextProject)
      if (nextProject.vcs) {
        const nextVcsInfo = await getVcsInfo(directory).catch(() => null)
        if (requestId !== projectRequestIdRef.current) return null
        setVcsInfo(nextVcsInfo)
      } else {
        setVcsInfo(null)
      }
      return nextProject
    } catch (err) {
      if (requestId !== projectRequestIdRef.current) return null
      sessionErrorHandler('load current project', err)
      setProject(null)
      setVcsInfo(null)
      setError(t('sessionChanges.failedToLoad'))
      return null
    } finally {
      if (requestId === projectRequestIdRef.current) {
        setProjectLoading(false)
      }
    }
  }, [directory, sessionId, t])

  const loadDiffMode = useCallback(
    async (mode: ChangeMode, options?: { force?: boolean; project?: ApiProject | null }) => {
      const currentProject = options?.project ?? project
      if (!sessionId || !currentProject?.vcs) return
      if (!options?.force && loadedModes[mode]) return

      const requestId = ++diffRequestIdRef.current[mode]
      setLoadingModes(prev => ({ ...prev, [mode]: true }))
      setError(null)

      try {
        let data: FileDiff[]
        if (mode === 'git' || mode === 'branch') {
          data = await getVcsDiff(mode as VcsDiffMode, directory)
        } else if (mode === 'session') {
          data = await getSessionDiff(sessionId, directory)
        } else {
          data = await getLastTurnDiff(sessionId, directory)
        }

        if (requestId !== diffRequestIdRef.current[mode]) return

        if (mode === 'git') {
          setGitDiffs(data)
        } else if (mode === 'branch') {
          setBranchDiffs(data)
        } else if (mode === 'session') {
          setSessionDiffs(data)
        } else {
          setTurnDiffs(data)
        }

        setLoadedModes(prev => ({ ...prev, [mode]: true }))
      } catch (err) {
        if (requestId !== diffRequestIdRef.current[mode]) return
        sessionErrorHandler(`load ${mode} diff`, err)
        setError(t('sessionChanges.failedToLoad'))
      } finally {
        if (requestId === diffRequestIdRef.current[mode]) {
          setLoadingModes(prev => ({ ...prev, [mode]: false }))
        }
      }
    },
    [directory, loadedModes, project, sessionId, t],
  )

  useEffect(() => {
    setProject(null)
    setVcsInfo(null)
    setGitDiffs([])
    setBranchDiffs([])
    setSessionDiffs([])
    setTurnDiffs([])
    setLoadedModes({ git: false, branch: false, session: false, turn: false })
    setLoadingModes({ git: false, branch: false, session: false, turn: false })
    setError(null)
    setOpenDiffFiles([])
    setSelectedFile(null)
    setExpandedDirs(new Set())
    setChangeMenuOpen(false)
    resetSplitHeight()

    void loadProjectState()
  }, [directory, sessionId, loadProjectState, resetSplitHeight])

  useEffect(() => {
    if (changeOptions.length === 0) return
    if (changeOptions.includes(changeMode)) return
    setChangeMode(preferredChangeMode)
  }, [changeMode, changeOptions, preferredChangeMode, setChangeMode])

  useEffect(() => {
    if (!project?.vcs) return
    if (!changeOptions.includes(changeMode)) return
    void loadDiffMode(changeMode)
  }, [changeMode, changeOptions, loadDiffMode, project?.vcs])

  useEffect(() => {
    setExpandedDirs(collectExpandedDirPaths(buildChangesTree(diffs)))
    const { nextOpenFiles, nextActiveFile } = reconcileDiffPreviewState(
      diffs,
      openDiffFilesRef.current,
      selectedFileRef.current,
    )
    setOpenDiffFiles(nextOpenFiles)
    setSelectedFile(nextActiveFile)
    if (diffs.length === 0) {
      resetSplitHeight()
    }
  }, [diffs, resetSplitHeight])

  // 刷新
  const handleRefresh = useCallback(async () => {
    const nextProject = await loadProjectState()
    if (!nextProject?.vcs) return
    await loadDiffMode(changeMode, { force: true, project: nextProject })
  }, [changeMode, loadDiffMode, loadProjectState])

  const handleInitGit = useCallback(async () => {
    setInitializingGit(true)
    setError(null)

    try {
      const nextProject = await initGitProject(directory)
      setProject(nextProject)
      setVcsInfo(null)
      setGitDiffs([])
      setBranchDiffs([])
      setSessionDiffs([])
      setTurnDiffs([])
      setLoadedModes({ git: false, branch: false, session: false, turn: false })
      setLoadingModes({ git: false, branch: false, session: false, turn: false })
      setChangeMenuOpen(false)
      void loadProjectState()
    } catch (err) {
      sessionErrorHandler('init git project', err)
      setError(t('sessionChanges.failedToInitGit'))
    } finally {
      setInitializingGit(false)
    }
  }, [directory, loadProjectState, t])

  // 选中文件
  const handleSelectFile = useCallback((file: string) => {
    setOpenDiffFiles(prev => (prev.includes(file) ? prev : [...prev, file]))
    setSelectedFile(prev => (prev === file ? prev : file))
  }, [])

  // 切换目录展开/折叠
  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // 构建树形结构
  const changesTree = useMemo(() => buildChangesTree(diffs), [diffs])

  // 关闭预览
  const handleClosePreview = useCallback(() => {
    setOpenDiffFiles([])
    setSelectedFile(null)
    resetSplitHeight()
  }, [resetSplitHeight])

  const handleActivatePreview = useCallback((file: string) => {
    setSelectedFile(prev => (prev === file ? prev : file))
  }, [])

  const handleClosePreviewTab = useCallback((file: string) => {
    setOpenDiffFiles(prev => {
      const index = prev.indexOf(file)
      if (index === -1) return prev

      const next = prev.filter(item => item !== file)
      setSelectedFile(current => {
        if (current !== file) return current
        return next[Math.min(index, next.length - 1)] ?? null
      })
      return next
    })
  }, [])

  const handleReorderPreviewTabs = useCallback((draggedFile: string, targetFile: string) => {
    setOpenDiffFiles(prev => {
      const draggedIndex = prev.indexOf(draggedFile)
      const targetIndex = prev.indexOf(targetFile)
      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return prev

      const next = [...prev]
      const [dragged] = next.splice(draggedIndex, 1)
      next.splice(targetIndex, 0, dragged)
      return next
    })
  }, [])

  // 获取选中的 diff 数据
  const selectedDiff = selectedFile ? diffs.find(d => d.file === selectedFile) : null
  const previewDiffs = useMemo(
    () =>
      openDiffFiles
        .map(file => diffs.find(diff => diff.file === file))
        .filter((diff): diff is FileDiff => Boolean(diff)),
    [diffs, openDiffFiles],
  )
  const showPreview = !loading && selectedDiff !== null && !(error && diffs.length === 0)

  if (projectLoading && !project) {
    return <div className="p-4 text-center text-text-400 text-[length:var(--fs-sm)]">{t('sessionChanges.loadingChanges')}</div>
  }

  if (!project && error) {
    return <div className="p-4 text-center text-danger-100 text-[length:var(--fs-sm)]">{error}</div>
  }

  if (!project?.vcs) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="max-w-xs text-center space-y-3">
          <div className="space-y-1">
            <div className="text-[length:var(--fs-base)] font-medium text-text-200">{t('sessionChanges.noGit')}</div>
            <div className="text-[length:var(--fs-sm)] text-text-400">{t('sessionChanges.noGitHint')}</div>
          </div>
          <button
            onClick={handleInitGit}
            disabled={initializingGit}
            className="inline-flex items-center justify-center rounded px-3 py-1.5 text-[length:var(--fs-sm)] font-medium bg-accent-main-100 text-white hover:bg-accent-main-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {initializingGit ? t('sessionChanges.initializingGit') : t('sessionChanges.initGit')}
          </button>
          {error && <div className="text-[length:var(--fs-sm)] text-danger-100">{error}</div>}
        </div>
      </div>
    )
  }

  // 总统计
  const totalStats = diffs.reduce(
    (acc, d) => ({
      additions: acc.additions + d.additions,
      deletions: acc.deletions + d.deletions,
    }),
    { additions: 0, deletions: 0 },
  )

  const emptyText =
    changeMode === 'git'
      ? t('sessionChanges.noGitChanges')
      : changeMode === 'branch'
        ? t('sessionChanges.noBranchChanges')
        : changeMode === 'session'
          ? t('sessionChanges.noChanges')
          : t('sessionChanges.noTurnChanges')

  const activeChangeModeMeta = changeModeMeta[changeMode]
  const compactFileCountLabel = t('sessionChanges.fileCountCompact', { count: diffs.length })
  const fullFileCountLabel = t('sessionChanges.fileCount', { count: diffs.length })
  const statFadeMaskStyle = {
    WebkitMaskImage: 'linear-gradient(to right, black 0, black calc(100% - 10px), transparent 100%)',
    maskImage: 'linear-gradient(to right, black 0, black calc(100% - 10px), transparent 100%)',
  } as const

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* 文件列表区 */}
      <div
        ref={listRef}
        className="overflow-hidden flex flex-col shrink-0"
        style={
          {
            '--list-height': listHeight !== null ? `${listHeight}px` : '40%',
            height: showPreview ? 'var(--list-height)' : '100%',
            minHeight: showPreview ? MIN_LIST_HEIGHT : undefined,
          } as React.CSSProperties
        }
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-100 bg-bg-100/30 shrink-0 overflow-hidden">
          <div
            className="min-w-0 flex flex-1 overflow-hidden"
            title={`+${totalStats.additions} -${totalStats.deletions} ${fullFileCountLabel}`}
            style={statFadeMaskStyle}
          >
            <div className="inline-flex min-w-max items-center gap-1.5 whitespace-nowrap text-[length:var(--fs-xxs)] font-mono tabular-nums">
              <span className="text-success-100">+{totalStats.additions}</span>
              <span className="text-danger-100">-{totalStats.deletions}</span>
              <span className="text-text-400">{compactFileCountLabel}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              ref={changeMenuTriggerRef}
              type="button"
              onClick={() => setChangeMenuOpen(open => !open)}
              aria-label={`${t('sessionChanges.mode')}: ${activeChangeModeMeta.label}`}
              aria-haspopup="menu"
              aria-expanded={changeMenuOpen}
              title={activeChangeModeMeta.label}
              className={`
                flex items-center rounded p-1 transition-colors
                ${changeMenuOpen ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:text-text-100 hover:bg-bg-200'}
              `}
            >
              <span className="shrink-0">{activeChangeModeMeta.icon}</span>
            </button>

            <DropdownMenu
              triggerRef={changeMenuTriggerRef}
              isOpen={changeMenuOpen}
              position="bottom"
              align="right"
              minWidth="170px"
              maxWidth="min(220px, calc(100vw - 24px))"
              constrainToRef={containerRef}
              className="!rounded-lg !p-1"
            >
              <div ref={changeMenuRef} role="menu" aria-label={t('sessionChanges.mode')} className="space-y-px">
                {changeOptions.map(mode => {
                  const meta = changeModeMeta[mode]
                  const isSelected = mode === changeMode

                  return (
                    <button
                      key={mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      title={meta.description}
                      onClick={() => {
                        setChangeMode(mode)
                        setChangeMenuOpen(false)
                      }}
                      className={`
                        group flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[length:var(--fs-sm)] transition-colors
                        ${
                          isSelected
                            ? 'bg-bg-200/70 text-text-100 font-medium'
                            : 'text-text-200 hover:bg-bg-200/60 hover:text-text-100'
                        }
                      `}
                    >
                      <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                    </button>
                  )
                })}
              </div>
            </DropdownMenu>

            {/* List Mode Toggle */}
            <div className="flex shrink-0 items-center bg-bg-200/50 rounded overflow-hidden border border-border-200/50">
              <button
                onClick={() => setListMode('flat')}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  listMode === 'flat' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
                title={t('sessionChanges.flatList')}
              >
                {t('sessionChanges.list')}
              </button>
              <button
                onClick={() => setListMode('tree')}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  listMode === 'tree' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
                title={t('sessionChanges.treeView')}
              >
                {t('sessionChanges.tree')}
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex shrink-0 items-center bg-bg-200/50 rounded overflow-hidden border border-border-200/50">
              <button
                onClick={() => setViewMode('unified')}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  viewMode === 'unified' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
              >
                {t('sessionChanges.unified')}
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  viewMode === 'split' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
              >
                {t('sessionChanges.split')}
              </button>
            </div>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded transition-colors disabled:opacity-50"
              title={t('common:refresh')}
            >
              <RetryIcon size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-auto panel-scrollbar-y">
          {loading ? (
            <div className="p-4 text-center text-text-400 text-[length:var(--fs-sm)]">{t('sessionChanges.loadingChanges')}</div>
          ) : error && diffs.length === 0 ? (
            <div className="p-4 text-center text-danger-100 text-[length:var(--fs-sm)]">{error}</div>
          ) : diffs.length === 0 ? (
            <div className="p-4 text-center text-text-400 text-[length:var(--fs-sm)]">{emptyText}</div>
          ) : (
            <div className="py-0.5">
              {listMode === 'tree'
                ? // Tree view
                  changesTree.map(node => (
                    <ChangesTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      expandedDirs={expandedDirs}
                      onSelectFile={handleSelectFile}
                      onToggleDir={handleToggleDir}
                    />
                  ))
                : // Flat list view
                  diffs.map(diff => {
                    const fileStatus = getFileStatus(diff)

                    return (
                      <button
                        key={diff.file}
                        onClick={() => handleSelectFile(diff.file)}
                        className={`
                       w-full min-w-0 flex items-center gap-2 px-3 py-1 text-left
                       hover:bg-bg-200/50 transition-colors text-[length:var(--fs-sm)]
                       text-text-300
                     `}
                      >
                        <img
                          src={getMaterialIconUrl(diff.file, 'file')}
                          alt=""
                          width={16}
                          height={16}
                          className="shrink-0"
                          loading="lazy"
                          decoding="async"
                          onError={e => {
                            e.currentTarget.style.visibility = 'hidden'
                          }}
                        />
                        <span className={`flex-1 min-w-0 font-mono truncate ${FILE_STATUS_COLOR[fileStatus]}`}>
                          {diff.file}
                        </span>
                        <div className="flex items-center gap-2 text-[length:var(--fs-xxs)] font-mono shrink-0">
                          {diff.additions > 0 && <span className="text-success-100">+{diff.additions}</span>}
                          {diff.deletions > 0 && <span className="text-danger-100">-{diff.deletions}</span>}
                        </div>
                      </button>
                    )
                  })}
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle - 与标签栏同色 */}
      {showPreview && (
        <div
          className={`
            h-1.5 cursor-row-resize shrink-0 relative
            hover:bg-accent-main-100/50 active:bg-accent-main-100 transition-colors
            ${isResizing ? 'bg-accent-main-100' : 'bg-bg-200/60'}
          `}
          onMouseDown={handleResizeStart}
          onTouchStart={handleTouchResizeStart}
        />
      )}

      {/* Diff 预览区 */}
      {showPreview && selectedDiff && (
        <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: MIN_PREVIEW_HEIGHT }}>
          <DiffPreviewPanel
            diff={selectedDiff}
            previewDiffs={previewDiffs}
            viewMode={viewMode}
            isResizing={isAnyResizing}
            onActivatePreview={handleActivatePreview}
            onClosePreview={handleClosePreviewTab}
            onReorderPreview={handleReorderPreviewTabs}
            onClose={handleClosePreview}
          />
        </div>
      )}
    </div>
  )
})

// ============================================
// Diff Preview Panel - 下方预览区
// ============================================

interface DiffPreviewPanelProps {
  diff: FileDiff
  previewDiffs: FileDiff[]
  viewMode: ViewMode
  isResizing: boolean
  onActivatePreview: (file: string) => void
  onClosePreview: (file: string) => void
  onReorderPreview: (draggedFile: string, targetFile: string) => void
  onClose: () => void
}

const DiffPreviewPanel = memo(function DiffPreviewPanel({
  diff,
  previewDiffs,
  viewMode,
  isResizing,
  onActivatePreview,
  onClosePreview,
  onReorderPreview,
  onClose,
}: DiffPreviewPanelProps) {
  const language = detectLanguage(diff.file) || 'text'
  // 优先用 patch 提取 before/after，回退到直接的 before/after 字段（旧版后端兼容）
  const { before, after } = useMemo(() => {
    if (diff.patch) return extractContentFromUnifiedDiff(diff.patch)
    if (diff.before !== undefined && diff.after !== undefined) return { before: diff.before, after: diff.after }
    return { before: '', after: '' }
  }, [diff.patch, diff.before, diff.after])
  const { t } = useTranslation(['components', 'common'])
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [fullscreenViewMode, setFullscreenViewMode] = useState<ViewMode>(viewMode)
  const fileName = diff.file.split(/[/\\]/).pop() || diff.file
  const previewTabItems = useMemo<PreviewTabsBarItem[]>(
    () =>
      previewDiffs.map(previewDiff => {
        const currentFileName = previewDiff.file.split(/[/\\]/).pop() || previewDiff.file

        return {
          id: previewDiff.file,
          title: previewDiff.file,
          closeTitle: `${t('common:close')} ${currentFileName}`,
          iconPath: previewDiff.file,
          label: (
            <>
              <span className="block min-w-0 flex-1 truncate text-[length:var(--fs-xs)] font-mono">{currentFileName}</span>
              <span className="shrink-0 text-[length:var(--fs-xxs)] font-mono text-success-100/90">
                {previewDiff.additions > 0 ? `+${previewDiff.additions}` : ''}
              </span>
              <span className="shrink-0 text-[length:var(--fs-xxs)] font-mono text-danger-100/90">
                {previewDiff.deletions > 0 ? `-${previewDiff.deletions}` : ''}
              </span>
            </>
          ),
        }
      }),
    [previewDiffs, t],
  )

  return (
    <div className="flex flex-col h-full">
      <PreviewTabsBar
        items={previewTabItems}
        activeId={diff.file}
        closeAllTitle={t('common:closeAllTabs')}
        onActivate={onActivatePreview}
        onClose={onClosePreview}
        onCloseAll={onClose}
        onReorder={onReorderPreview}
        tabWidthClassName="w-44 max-w-44"
        rightActions={
          <button
            onClick={() => {
              setFullscreenViewMode(viewMode)
              setFullscreenOpen(true)
            }}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-300/50 rounded transition-colors"
            title={t('contentBlock.fullscreen')}
          >
            <MaximizeIcon size={12} />
          </button>
        }
      />

      {/* Diff Content - DiffViewer 自带滚动 */}
      <div className="flex-1 min-h-0">
        <DiffViewer before={before} after={after} language={language} viewMode={viewMode} isResizing={isResizing} />
      </div>

      <FullscreenViewer
        isOpen={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
        title={fileName}
        titleExtra={
          <div className="flex items-center gap-1.5 text-[length:var(--fs-xs)] font-mono tabular-nums shrink-0">
            {diff.additions > 0 && <span className="text-success-100">+{diff.additions}</span>}
            {diff.deletions > 0 && <span className="text-danger-100">-{diff.deletions}</span>}
          </div>
        }
        headerRight={<ViewModeSwitch viewMode={fullscreenViewMode} onChange={setFullscreenViewMode} />}
      >
        <DiffViewer before={before} after={after} language={language} viewMode={fullscreenViewMode} />
      </FullscreenViewer>
    </div>
  )
})

// ============================================
// File Status Helpers
// ============================================

type FileStatus = 'added' | 'modified' | 'deleted'

function getFileStatus(diff: FileDiff): FileStatus {
  if (diff.status) return diff.status as FileStatus
  if (diff.deletions === 0 && diff.additions > 0) return 'added'
  if (diff.additions === 0 && diff.deletions > 0) return 'deleted'
  // 旧版 before/after 兼容
  if (diff.before !== undefined && diff.after !== undefined) {
    if (!diff.before.trim()) return 'added'
    if (!diff.after.trim()) return 'deleted'
  }
  return 'modified'
}

const FILE_STATUS_COLOR: Record<FileStatus, string> = {
  added: 'text-success-100',
  deleted: 'text-danger-100',
  modified: 'text-warning-100',
}

// ============================================
// Changes Tree Data Structure
// ============================================

interface ChangesTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  diff?: FileDiff
  children: ChangesTreeNode[]
  additions: number
  deletions: number
  status?: FileStatus
}

/**
 * 将扁平的 FileDiff[] 转换为树形结构
 */
function buildChangesTree(diffs: FileDiff[]): ChangesTreeNode[] {
  const root: ChangesTreeNode[] = []

  for (const diff of diffs) {
    const parts = diff.file.split(/[/\\]/).filter(Boolean)
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      let existing = currentLevel.find(n => n.name === part)

      if (!existing) {
        const status = isFile ? getFileStatus(diff) : undefined
        existing = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          diff: isFile ? diff : undefined,
          children: [],
          additions: isFile ? diff.additions : 0,
          deletions: isFile ? diff.deletions : 0,
          status,
        }
        currentLevel.push(existing)
      }

      if (!isFile) {
        // 累加目录的统计
        existing.additions += diff.additions
        existing.deletions += diff.deletions
        currentLevel = existing.children
      }
    }
  }

  // 递归排序 + 计算目录状态：目录在前，文件在后，同类按名称排序
  const processNodes = (nodes: ChangesTreeNode[]): ChangesTreeNode[] => {
    return nodes
      .map(n => {
        const processedChildren = processNodes(n.children)
        // 计算目录的累积状态
        let dirStatus: FileStatus | undefined = undefined
        if (n.type === 'directory' && processedChildren.length > 0) {
          // 优先级: added > modified > deleted
          const hasAdded = processedChildren.some(c => c.status === 'added')
          const hasModified = processedChildren.some(c => c.status === 'modified')
          const hasDeleted = processedChildren.some(c => c.status === 'deleted')
          if (hasAdded) dirStatus = 'added'
          else if (hasModified) dirStatus = 'modified'
          else if (hasDeleted) dirStatus = 'deleted'
        }
        return {
          ...n,
          children: processedChildren,
          status: n.type === 'directory' ? dirStatus : n.status,
        }
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  return processNodes(root)
}

function collectExpandedDirPaths(nodes: ChangesTreeNode[]): Set<string> {
  const allDirPaths = new Set<string>()

  const collectDirs = (entries: ChangesTreeNode[]) => {
    for (const node of entries) {
      if (node.type === 'directory') {
        allDirPaths.add(node.path)
        collectDirs(node.children)
      }
    }
  }

  collectDirs(nodes)
  return allDirPaths
}

// ============================================
// ChangesTreeItem Component
// ============================================

interface ChangesTreeItemProps {
  node: ChangesTreeNode
  depth: number
  expandedDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
}

const ChangesTreeItem = memo(function ChangesTreeItem({
  node,
  depth,
  expandedDirs,
  onSelectFile,
  onToggleDir,
}: ChangesTreeItemProps) {
  const isExpanded = expandedDirs.has(node.path)
  const paddingLeft = 8 + depth * 16

  // 状态颜色
  const statusColor = node.status ? FILE_STATUS_COLOR[node.status] : 'text-text-400'

  if (node.type === 'directory') {
    return (
      <>
        <button
          onClick={() => onToggleDir(node.path)}
          className="w-full min-w-0 flex items-center gap-1.5 py-1 hover:bg-bg-200/50 transition-colors text-[length:var(--fs-sm)] text-text-300"
          style={{ paddingLeft }}
        >
          <ChevronRightIcon size={12} className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          <img
            src={getMaterialIconUrl(node.path, 'directory', isExpanded)}
            alt=""
            width={16}
            height={16}
            className="shrink-0"
            loading="lazy"
            decoding="async"
            onError={e => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
          <span className={`flex-1 min-w-0 truncate text-left ${node.status ? statusColor : ''}`}>{node.name}</span>
          <div className="flex items-center gap-1.5 text-[length:var(--fs-xxs)] font-mono pr-3 shrink-0">
            {node.additions > 0 && <span className="text-success-100">+{node.additions}</span>}
            {node.deletions > 0 && <span className="text-danger-100">-{node.deletions}</span>}
          </div>
        </button>
        {isExpanded &&
          node.children.map(child => (
            <ChangesTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
            />
          ))}
      </>
    )
  }

  // File node
  return (
    <button
      onClick={() => node.diff && onSelectFile(node.diff.file)}
      className={`
         w-full min-w-0 flex items-center gap-1.5 py-1 transition-colors text-[length:var(--fs-sm)]
         hover:bg-bg-200/50
         text-text-300
       `}
      style={{ paddingLeft: paddingLeft + 16 }}
    >
      <img
        src={getMaterialIconUrl(node.name, 'file')}
        alt=""
        width={16}
        height={16}
        className="shrink-0"
        loading="lazy"
        decoding="async"
        onError={e => {
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
      <span
        className={`flex-1 min-w-0 font-mono truncate text-left ${node.status ? FILE_STATUS_COLOR[node.status] : ''}`}
      >
        {node.name}
      </span>
      <div className="flex items-center gap-1.5 text-[length:var(--fs-xxs)] font-mono pr-3 shrink-0">
        {node.additions > 0 && <span className="text-success-100">+{node.additions}</span>}
        {node.deletions > 0 && <span className="text-danger-100">-{node.deletions}</span>}
      </div>
    </button>
  )
})
