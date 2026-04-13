import { lazy, memo, Suspense, useCallback, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayoutStore, layoutStore, type PanelTab } from '../store/layoutStore'
import { PanelContainer } from './PanelContainer'
import { createPtySession, removePtySession } from '../api/pty'
import type { TerminalTab } from '../store/layoutStore'
import { ResizablePanel } from './ui/ResizablePanel'
import { logger } from '../utils/logger'
import { normalizeToForwardSlash, uiErrorHandler } from '../utils'
import { useChatViewport } from '../features/chat/chatViewport'

const SessionChangesPanel = lazy(() =>
  import('./SessionChangesPanel').then(module => ({ default: module.SessionChangesPanel })),
)
const FileExplorer = lazy(() => import('./FileExplorer').then(module => ({ default: module.FileExplorer })))
const Terminal = lazy(() => import('./Terminal').then(module => ({ default: module.Terminal })))
const McpPanel = lazy(() => import('./McpPanel').then(module => ({ default: module.McpPanel })))
const SkillPanel = lazy(() => import('./SkillPanel').then(module => ({ default: module.SkillPanel })))
const WorktreePanel = lazy(() => import('./WorktreePanel').then(module => ({ default: module.WorktreePanel })))

function PanelFallback() {
  const { t } = useTranslation(['components', 'common'])
  return (
    <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">{t('rightPanel.loadingPanel')}</div>
  )
}

interface RightPanelProps {
  directory?: string
  sessionId?: string | null
}

export const RightPanel = memo(function RightPanel({ directory, sessionId }: RightPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { rightPanelOpen, rightPanelWidth } = useLayoutStore()
  const { interaction, layout } = useChatViewport()
  const normalizedDirectory = directory ? normalizeToForwardSlash(directory) : undefined

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

  // 关闭终端时清理 PTY 会话
  const handleCloseTerminal = useCallback(
    async (ptyId: string) => {
      try {
        await removePtySession(ptyId, normalizedDirectory)
      } catch {
        // ignore cleanup errors
      }
    },
    [normalizedDirectory],
  )

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      logger.log('[RightPanel] Creating PTY session, directory:', normalizedDirectory)
      const pty = await createPtySession({ cwd: normalizedDirectory }, normalizedDirectory)
      logger.log('[RightPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || 'Terminal',
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab, true, 'right')
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [normalizedDirectory])

  // 渲染内容
  const renderContent = useCallback(
    (activeTab: PanelTab | null) => {
      if (!activeTab) {
        return (
          <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">{t('common:noContent')}</div>
        )
      }

      switch (activeTab.type) {
        case 'files':
          return (
            <Suspense fallback={<PanelFallback />}>
              <FilesContent
                activeTab={activeTab}
                directory={normalizedDirectory}
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
                directory={normalizedDirectory}
                sessionId={sessionId}
                isPanelResizing={isPanelResizing}
              />
            </Suspense>
          )
        case 'terminal':
          return (
            <Suspense fallback={<PanelFallback />}>
              <TerminalContent activeTab={activeTab} directory={normalizedDirectory} />
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
    [normalizedDirectory, sessionId, isPanelResizing, t],
  )

  return (
    <ResizablePanel
      position="right"
      isOpen={rightPanelOpen}
      overlay={interaction.rightPanelBehavior === 'overlay'}
      size={layout.rightPanel.dockedWidth || rightPanelWidth}
      minSize={layout.rightPanel.hardMinWidth}
      maxSize={layout.rightPanel.resizeMaxWidth}
      onSizeChange={w => layoutStore.setRightPanelWidth(w)}
      onClose={() => layoutStore.closeRightPanel()}
      className="pb-[var(--safe-area-inset-bottom)]"
    >
      <PanelContainer position="right" onNewTerminal={handleNewTerminal} onCloseTerminal={handleCloseTerminal}>
        {renderContent}
      </PanelContainer>
    </ResizablePanel>
  )
})

// ============================================
// Terminal Content - 渲染所有终端实例 (右侧面板)
// ============================================

interface TerminalContentProps {
  activeTab: PanelTab
  directory?: string
}

const TerminalContent = memo(function TerminalContent({ activeTab, directory }: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()

  // 获取所有 right 位置的 terminal tabs
  const terminalTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'terminal')

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
  const fileTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'files')

  return (
    <>
      {fileTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <FileExplorer
            panelTabId={tab.id}
            directory={directory}
            previewFile={tab.previewFile ?? null}
            previewFiles={tab.previewFiles ?? []}
            position="right"
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
  const changeTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'changes')

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
