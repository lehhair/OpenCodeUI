import { lazy, memo, Suspense, useCallback, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TerminalIcon } from './Icons'
import { PanelContainer } from './PanelContainer'
import { layoutStore, useLayoutStore, type TerminalTab, type PanelTab } from '../store/layoutStore'
import { createPtySession, removePtySession, listPtySessions } from '../api/pty'
import { useMessageStore } from '../store'
import { ResizablePanel } from './ui/ResizablePanel'
import { logger } from '../utils/logger'
import { normalizeToForwardSlash, uiErrorHandler } from '../utils'
import { useChatViewport } from '../features/chat/chatViewport'

const Terminal = lazy(() => import('./Terminal').then(module => ({ default: module.Terminal })))
const SessionChangesPanel = lazy(() =>
  import('./SessionChangesPanel').then(module => ({ default: module.SessionChangesPanel })),
)
const FileExplorer = lazy(() => import('./FileExplorer').then(module => ({ default: module.FileExplorer })))
const McpPanel = lazy(() => import('./McpPanel').then(module => ({ default: module.McpPanel })))
const SkillPanel = lazy(() => import('./SkillPanel').then(module => ({ default: module.SkillPanel })))
const WorktreePanel = lazy(() => import('./WorktreePanel').then(module => ({ default: module.WorktreePanel })))

interface BottomPanelProps {
  directory?: string
}

function PanelFallback() {
  const { t } = useTranslation(['components', 'common'])
  return (
    <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">{t('bottomPanel.loadingPanel')}</div>
  )
}

export const BottomPanel = memo(function BottomPanel({ directory }: BottomPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { bottomPanelOpen, bottomPanelHeight } = useLayoutStore()
  const { sessionId } = useMessageStore()
  const { interaction, layout } = useChatViewport()

  const [isRestoring, setIsRestoring] = useState(false)
  const normalizedDirectory = directory ? normalizeToForwardSlash(directory) : undefined

  useEffect(() => {
    layoutStore.setCurrentTerminalDirectory(normalizedDirectory)
  }, [normalizedDirectory])

  // 追踪面板 resize 状态
  const [isPanelResizing, setIsPanelResizing] = useState(false)
  useEffect(() => {
    const onStart = () => setIsPanelResizing(true)
    const onEnd = () => setIsPanelResizing(false)
    window.addEventListener('panel-resize-start', onStart)
    window.addEventListener('panel-resize-end', onEnd)
    return () => {
      window.removeEventListener('panel-resize-start', onStart)
      window.removeEventListener('panel-resize-end', onEnd)
    }
  }, [])

  // 目录变化时（包括首次加载），重新拉取该目录的 PTY 会话
  const prevDirectoryRef = useRef<string | undefined>(undefined)
  const restoreRequestIdRef = useRef(0)
  useEffect(() => {
    if (!normalizedDirectory) return
    // 目录没变就不重复拉取
    if (prevDirectoryRef.current === normalizedDirectory) return
    prevDirectoryRef.current = normalizedDirectory
    const requestId = ++restoreRequestIdRef.current

    const restoreSessions = async () => {
      try {
        setIsRestoring(true)

        // 拉取新目录下的 PTY 会话
        const sessions = await listPtySessions(normalizedDirectory)
        if (restoreRequestIdRef.current !== requestId) return
        logger.log('[BottomPanel] PTY sessions for', normalizedDirectory, ':', sessions)

        layoutStore.syncTerminalSessions(
          normalizedDirectory,
          sessions.map(pty => ({
            id: pty.id,
            title: pty.title || 'Terminal',
            status: pty.status === 'running' ? 'connecting' : 'exited',
          })),
        )
      } catch (error) {
        uiErrorHandler('restore terminal sessions', error)
      } finally {
        if (restoreRequestIdRef.current === requestId) {
          setIsRestoring(false)
        }
      }
    }

    restoreSessions()
  }, [normalizedDirectory])

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      logger.log('[BottomPanel] Creating PTY session, directory:', normalizedDirectory)
      const pty = await createPtySession({ cwd: normalizedDirectory }, normalizedDirectory)
      logger.log('[BottomPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || 'Terminal',
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab)
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [normalizedDirectory])

  // 关闭终端
  const handleCloseTerminal = useCallback(
    async (ptyId: string) => {
      try {
        await removePtySession(ptyId, normalizedDirectory)
      } catch {
        // ignore - may already be closed
      }
    },
    [normalizedDirectory],
  )

  // 渲染内容
  const renderContent = useCallback(
    (activeTab: PanelTab | null) => {
      if (isRestoring) {
        return (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2">
            <TerminalIcon size={24} className="opacity-30 animate-pulse" />
            <span>{t('terminal.restoringSessions')}</span>
          </div>
        )
      }

      if (!activeTab) {
        return (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2">
            <TerminalIcon size={24} className="opacity-30" />
            <span>{t('common:noContent')}</span>
            <button
              onClick={handleNewTerminal}
              className="px-3 py-1.5 text-[length:var(--fs-sm)] bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
            >
              {t('terminal.createTerminal')}
            </button>
          </div>
        )
      }

      switch (activeTab.type) {
        case 'terminal':
          return (
            <Suspense fallback={<PanelFallback />}>
              <TerminalContent activeTab={activeTab} directory={directory} />
            </Suspense>
          )
        case 'files':
          return (
            <Suspense fallback={<PanelFallback />}>
              <FilesContent
                activeTab={activeTab}
                directory={directory ?? ''}
                isPanelResizing={isPanelResizing}
                sessionId={sessionId}
              />
            </Suspense>
          )
        case 'changes':
          if (!sessionId) {
            return (
              <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
                {t('rightPanel.noActiveSession')}
              </div>
            )
          }
          return (
            <Suspense fallback={<PanelFallback />}>
              <ChangesContent
                activeTab={activeTab}
                directory={directory}
                sessionId={sessionId}
                isPanelResizing={isPanelResizing}
              />
            </Suspense>
          )
        case 'mcp':
          return (
            <Suspense fallback={<PanelFallback />}>
              <McpPanel isResizing={isPanelResizing} />
            </Suspense>
          )
        case 'skill':
          return (
            <Suspense fallback={<PanelFallback />}>
              <SkillPanel isResizing={isPanelResizing} />
            </Suspense>
          )
        case 'worktree':
          return (
            <Suspense fallback={<PanelFallback />}>
              <WorktreePanel isResizing={isPanelResizing} />
            </Suspense>
          )
        default:
          return null
      }
    },
    [isRestoring, handleNewTerminal, directory, sessionId, isPanelResizing, t],
  )

  return (
    <ResizablePanel
      position="bottom"
      isOpen={bottomPanelOpen}
      overlay={interaction.bottomPanelBehavior === 'overlay'}
      size={bottomPanelHeight}
      maxSize={layout.bottomPanel.maxHeight}
      onSizeChange={h => layoutStore.setBottomPanelHeight(h)}
      onClose={() => layoutStore.closeBottomPanel()}
      className="pb-[var(--safe-area-inset-bottom)]"
    >
      <PanelContainer position="bottom" onNewTerminal={handleNewTerminal} onCloseTerminal={handleCloseTerminal}>
        {renderContent}
      </PanelContainer>
    </ResizablePanel>
  )
})

// ============================================
// Terminal Content - 渲染所有终端实例
// ============================================

interface TerminalContentProps {
  activeTab: PanelTab
  directory?: string
}

const TerminalContent = memo(function TerminalContent({ activeTab, directory }: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()

  // 获取所有 bottom 位置的 terminal tabs
  const terminalTabs = panelTabs.filter(t => t.position === 'bottom' && t.type === 'terminal')

  return (
    <>
      {terminalTabs.map(tab => (
        <Terminal key={tab.id} ptyId={tab.id} directory={directory} isActive={tab.id === activeTab.id} />
      ))}
    </>
  )
})

interface FilesContentProps {
  activeTab: PanelTab
  directory?: string
  isPanelResizing?: boolean
  sessionId?: string | null
}

const FilesContent = memo(function FilesContent({
  activeTab,
  directory,
  isPanelResizing = false,
  sessionId,
}: FilesContentProps) {
  const { panelTabs } = useLayoutStore()
  const fileTabs = panelTabs.filter(t => t.position === 'bottom' && t.type === 'files')

  return (
    <>
      {fileTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <FileExplorer
            panelTabId={tab.id}
            directory={directory}
            previewFile={tab.previewFile ?? null}
            previewFiles={tab.previewFiles ?? []}
            position="bottom"
            isPanelResizing={isPanelResizing}
            sessionId={sessionId}
          />
        </div>
      ))}
    </>
  )
})

interface ChangesContentProps {
  activeTab: PanelTab
  directory?: string
  sessionId: string
  isPanelResizing?: boolean
}

const ChangesContent = memo(function ChangesContent({
  activeTab,
  directory,
  sessionId,
  isPanelResizing = false,
}: ChangesContentProps) {
  const { panelTabs } = useLayoutStore()
  const changeTabs = panelTabs.filter(t => t.position === 'bottom' && t.type === 'changes')

  return (
    <>
      {changeTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <SessionChangesPanel sessionId={sessionId} directory={directory} isResizing={isPanelResizing} />
        </div>
      ))}
    </>
  )
})
