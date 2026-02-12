import { memo, useCallback, useState, useEffect } from 'react'
import { Terminal } from './Terminal'
import { TerminalIcon } from './Icons'
import { PanelContainer } from './PanelContainer'
import { layoutStore, useLayoutStore, type TerminalTab, type PanelTab } from '../store/layoutStore'
import { createPtySession, removePtySession, listPtySessions } from '../api/pty'
import { SessionChangesPanel } from './SessionChangesPanel'
import { FileExplorer } from './FileExplorer'
import { McpPanel } from './McpPanel'
import { SkillPanel } from './SkillPanel'
import { WorktreePanel } from './WorktreePanel'
import { useMessageStore } from '../store'
import { ResizablePanel } from './ui/ResizablePanel'

interface BottomPanelProps {
  directory?: string
}

export const BottomPanel = memo(function BottomPanel({ directory }: BottomPanelProps) {
  const { bottomPanelOpen, bottomPanelHeight, previewFile } = useLayoutStore()
  const { sessionId } = useMessageStore()
  
  const [isRestoring, setIsRestoring] = useState(false)
  const [restored, setRestored] = useState(false)
  
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

  // 页面加载时恢复已有的 PTY sessions
  useEffect(() => {
    if (restored || !directory) return
    setRestored(true)

    const restoreSessions = async () => {
      try {
        setIsRestoring(true)
        const sessions = await listPtySessions(directory)
        console.log('[BottomPanel] Found existing PTY sessions:', sessions)
        
        if (sessions.length > 0) {
          for (const pty of sessions) {
            if (!layoutStore.getTerminalTabs().some(t => t.id === pty.id)) {
              const tab: TerminalTab = {
                id: pty.id,
                title: pty.title || 'Terminal',
                status: pty.running ? 'connecting' : 'exited',
              }
              layoutStore.addTerminalTab(tab, false)
            }
          }
        }
      } catch (error) {
        console.error('[BottomPanel] Failed to restore sessions:', error)
      } finally {
        setIsRestoring(false)
      }
    }

    restoreSessions()
  }, [directory, restored])

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      console.log('[BottomPanel] Creating PTY session, directory:', directory)
      const pty = await createPtySession({ cwd: directory }, directory)
      console.log('[BottomPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || 'Terminal',
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab)
    } catch (error) {
      console.error('[BottomPanel] Failed to create terminal:', error)
    }
  }, [directory])

  // 关闭终端
  const handleCloseTerminal = useCallback(async (ptyId: string) => {
    try {
      await removePtySession(ptyId, directory)
    } catch {
      // ignore - may already be closed
    }
  }, [directory])

  // 渲染内容
  const renderContent = useCallback((activeTab: PanelTab | null) => {
    if (isRestoring) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
          <TerminalIcon size={24} className="opacity-30 animate-pulse" />
          <span>Restoring sessions...</span>
        </div>
      )
    }

    if (!activeTab) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
          <TerminalIcon size={24} className="opacity-30" />
          <span>No content</span>
          <button
            onClick={handleNewTerminal}
            className="px-3 py-1.5 text-xs bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
          >
            Create Terminal
          </button>
        </div>
      )
    }

    switch (activeTab.type) {
      case 'terminal':
        return (
          <TerminalContent
            activeTab={activeTab}
            directory={directory}
          />
        )
      case 'files':
        return (
          <FileExplorer 
            directory={directory ?? ''}
            previewFile={previewFile}
            position="bottom"
            isPanelResizing={isPanelResizing}
          />
        )
      case 'changes':
        if (!sessionId) {
          return (
            <div className="flex items-center justify-center h-full text-text-400 text-xs">
              No active session
            </div>
          )
        }
        return <SessionChangesPanel sessionId={sessionId} isResizing={isPanelResizing} />
      case 'mcp':
        return <McpPanel isResizing={isPanelResizing} />
      case 'skill':
        return <SkillPanel isResizing={isPanelResizing} />
      case 'worktree':
        return <WorktreePanel isResizing={isPanelResizing} />
      default:
        return null
    }
  }, [isRestoring, handleNewTerminal, directory, previewFile, sessionId, isPanelResizing])

  return (
    <ResizablePanel
      position="bottom"
      isOpen={bottomPanelOpen}
      size={bottomPanelHeight}
      onSizeChange={layoutStore.setBottomPanelHeight}
      onClose={layoutStore.closeBottomPanel}
      className="pb-[var(--safe-area-inset-bottom)]"
    >
      <PanelContainer
        position="bottom"
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
}

const TerminalContent = memo(function TerminalContent({ 
  activeTab,
  directory,
}: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()
  
  // 获取所有 bottom 位置的 terminal tabs
  const terminalTabs = panelTabs.filter(
    t => t.position === 'bottom' && t.type === 'terminal'
  )

  return (
    <>
      {terminalTabs.map((tab) => (
        <Terminal
          key={tab.id}
          ptyId={tab.id}
          directory={directory}
          isActive={tab.id === activeTab.id}
        />
      ))}
    </>
  )
})
