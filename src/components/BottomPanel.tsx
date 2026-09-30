import { lazy, memo, Suspense, useCallback, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TerminalIcon } from './Icons'
import { PanelContainer } from './PanelContainer'
import { layoutStore, useLayoutStore, type TerminalTab, type PanelTab } from '../store/layoutStore'
import { affectsBoundServer } from '../store/serverChangeScope'
import { serverStore } from '../store/serverStore'
import { createPtySession, removePtySession, listPtySessions } from '../api/pty'
import { useCurrentSessionId } from '../store'
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
  /** 数据所属服务器（跟随焦点 session；缺省用活动服务器） */
  serverId?: string
}

function PanelFallback() {
  const { t } = useTranslation(['components', 'common'])
  return (
    <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
      {t('bottomPanel.loadingPanel')}
    </div>
  )
}

export const BottomPanel = memo(function BottomPanel({ directory, serverId }: BottomPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { bottomPanelOpen, bottomPanelHeight } = useLayoutStore()
  const sessionId = useCurrentSessionId()
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

  // 目录变化时（包括全局模式），重新拉取该目录的 PTY 会话
  const prevDirectoryRef = useRef<string | undefined>(undefined)
  const hasRestoredDirectoryRef = useRef(false)
  const restoreRequestIdRef = useRef(0)
  useEffect(() => {
    // 目录没变就不重复拉取
    if (hasRestoredDirectoryRef.current && prevDirectoryRef.current === normalizedDirectory) return
    hasRestoredDirectoryRef.current = true
    prevDirectoryRef.current = normalizedDirectory

    const restoreSessions = async (requestId: number) => {
      try {
        setIsRestoring(true)

        // 拉取新目录下的 PTY 会话
        const sessions = await listPtySessions(normalizedDirectory, serverId)
        if (restoreRequestIdRef.current !== requestId) return
        logger.log('[BottomPanel] PTY sessions for', normalizedDirectory, ':', sessions)

        layoutStore.syncTerminalSessions(
          normalizedDirectory,
          sessions.map(pty => ({
            id: pty.id,
            title: pty.title || 'Terminal',
            status: pty.status === 'running' ? 'connecting' : 'exited',
            serverId,
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

    void restoreSessions(++restoreRequestIdRef.current)
    return serverStore.onServerChange((changedId, reason) => {
      // 评审 N2：终端恢复的数据主体是 serverId ?? active（对齐 useVcsInfo 的绑定语义）。
      // 旧实现拿 changedId 与 active 比对：面板固定绑定 WSL 而 active 在 local 时，
      // 这台 WSL 换端口重启会被误跳过（终端全部失联）；反之无关服务器切换会误触发重恢复。
      if (!affectsBoundServer(serverId, changedId, reason, serverStore.getActiveServerId())) return
      void restoreSessions(++restoreRequestIdRef.current)
    })
  }, [normalizedDirectory, serverId])

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      logger.log('[BottomPanel] Creating PTY session, directory:', normalizedDirectory)
      const pty = await createPtySession({ cwd: normalizedDirectory }, normalizedDirectory, serverId)
      logger.log('[BottomPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || 'Terminal',
        status: 'connecting',
        serverId,
      }
      layoutStore.addTerminalTab(tab)
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [normalizedDirectory, serverId])

  // 关闭终端
  const handleCloseTerminal = useCallback(
    async (ptyId: string) => {
      try {
        await removePtySession(ptyId, normalizedDirectory, serverId)
      } catch {
        // ignore - may already be closed
      }
    },
    [normalizedDirectory, serverId],
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

      return (
        <>
          {/* Keep files mounted so expanded folders and previews survive tab switches. */}
          <div className={activeTab.type === 'files' ? 'h-full' : 'hidden'}>
            <Suspense fallback={<PanelFallback />}>
              <FilesContent
                activeTab={activeTab}
                directory={directory ?? ''}
                isPanelResizing={isPanelResizing}
                sessionId={sessionId}
                serverId={serverId}
              />
            </Suspense>
          </div>

          {sessionId ? (
            <div className={activeTab.type === 'changes' ? 'h-full' : 'hidden'}>
              <Suspense fallback={<PanelFallback />}>
                <ChangesContent
                  activeTab={activeTab}
                  directory={directory}
                  sessionId={sessionId}
                  isPanelResizing={isPanelResizing}
                  serverId={serverId}
                />
              </Suspense>
            </div>
          ) : activeTab.type === 'changes' ? (
            <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
              {t('rightPanel.noActiveSession')}
            </div>
          ) : null}

          {activeTab.type === 'terminal' ? (
            <Suspense fallback={<PanelFallback />}>
              <TerminalContent activeTab={activeTab} directory={directory} serverId={serverId} />
            </Suspense>
          ) : null}

          {activeTab.type === 'mcp' ? (
            <Suspense fallback={<PanelFallback />}>
              <McpPanel isResizing={isPanelResizing} />
            </Suspense>
          ) : null}

          {activeTab.type === 'skill' ? (
            <Suspense fallback={<PanelFallback />}>
              <SkillPanel isResizing={isPanelResizing} />
            </Suspense>
          ) : null}

          {activeTab.type === 'worktree' ? (
            <Suspense fallback={<PanelFallback />}>
              <WorktreePanel isResizing={isPanelResizing} />
            </Suspense>
          ) : null}
        </>
      )
    },
    [isRestoring, handleNewTerminal, directory, sessionId, isPanelResizing, t, serverId],
  )

  return (
    <ResizablePanel
      position="bottom"
      isOpen={bottomPanelOpen}
      overlay={interaction.bottomPanelBehavior === 'overlay'}
      overlayBackdrop={false}
      size={bottomPanelHeight}
      maxSize={layout.bottomPanel.maxHeight}
      onSizeChange={h => layoutStore.setBottomPanelHeight(h)}
      onClose={() => layoutStore.closeBottomPanel()}
    >
      <PanelContainer
        position="bottom"
        directory={normalizedDirectory}
        onNewTerminal={handleNewTerminal}
        onCloseTerminal={handleCloseTerminal}
      >
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
  serverId?: string
}

const TerminalContent = memo(function TerminalContent({ activeTab, directory, serverId }: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()

  // 获取所有 bottom 位置的 terminal tabs
  const terminalTabs = panelTabs.filter(t => t.position === 'bottom' && t.type === 'terminal')

  return (
    <>
      {terminalTabs.map(tab => (
        <Terminal
          key={tab.id}
          ptyId={tab.id}
          directory={directory}
          serverId={tab.serverId ?? serverId}
          isActive={tab.id === activeTab.id}
        />
      ))}
    </>
  )
})

interface FilesContentProps {
  activeTab: PanelTab
  directory?: string
  isPanelResizing?: boolean
  sessionId?: string | null
  serverId?: string
}

const FilesContent = memo(function FilesContent({
  activeTab,
  directory,
  isPanelResizing = false,
  sessionId,
  serverId,
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
            serverId={serverId}
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
  serverId?: string
}

const ChangesContent = memo(function ChangesContent({
  activeTab,
  directory,
  sessionId,
  isPanelResizing = false,
  serverId,
}: ChangesContentProps) {
  const { panelTabs } = useLayoutStore()
  const changeTabs = panelTabs.filter(t => t.position === 'bottom' && t.type === 'changes')

  return (
    <>
      {changeTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <SessionChangesPanel
            sessionId={sessionId}
            directory={directory}
            serverId={serverId}
            position="bottom"
            isResizing={isPanelResizing}
          />
        </div>
      ))}
    </>
  )
})
