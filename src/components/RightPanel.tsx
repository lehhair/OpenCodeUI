import { memo, useCallback, useState, useEffect } from 'react'
import { useLayoutStore, layoutStore, type PanelTab } from '../store/layoutStore'
import { PanelContainer } from './PanelContainer'
import { SessionChangesPanel } from './SessionChangesPanel'
import { FileExplorer } from './FileExplorer'
import { Terminal } from './Terminal'
import { McpPanel } from './McpPanel'
import { SkillPanel } from './SkillPanel'
import { WorktreePanel } from './WorktreePanel'
import { useMessageStore } from '../store'
import { useDirectory } from '../hooks'
import { createPtySession, removePtySession } from '../api/pty'
import type { TerminalTab } from '../store/layoutStore'
import { ResizablePanel } from './ui/ResizablePanel'

export const RightPanel = memo(function RightPanel() {
  const { rightPanelOpen, rightPanelWidth, previewFile } = useLayoutStore()
  const { sessionId } = useMessageStore()
  const { currentDirectory } = useDirectory()
  
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
  const handleCloseTerminal = useCallback(async (ptyId: string) => {
    try {
      await removePtySession(ptyId, currentDirectory)
    } catch {
      // ignore cleanup errors
    }
  }, [currentDirectory])

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      console.log('[RightPanel] Creating PTY session, directory:', currentDirectory)
      const pty = await createPtySession({ cwd: currentDirectory }, currentDirectory)
      console.log('[RightPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || 'Terminal',
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab, true, 'right')
    } catch (error) {
      console.error('[RightPanel] Failed to create terminal:', error)
    }
  }, [currentDirectory])

  // 渲染内容
  const renderContent = useCallback((activeTab: PanelTab | null) => {
    if (!activeTab) {
      return (
        <div className="flex items-center justify-center h-full text-text-400 text-xs">
          No content
        </div>
      )
    }

    switch (activeTab.type) {
      case 'files':
        return (
          <FileExplorer 
            directory={currentDirectory}
            previewFile={previewFile}
            position="right"
            isPanelResizing={isPanelResizing}
            sessionId={sessionId}
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
      case 'terminal':
        return (
          <TerminalContent
            activeTab={activeTab}
            directory={currentDirectory}
          />
        )
      case 'mcp':
        return <McpPanel isResizing={isPanelResizing} />
      case 'skill':
        return <SkillPanel isResizing={isPanelResizing} />
      case 'worktree':
        return <WorktreePanel isResizing={isPanelResizing} />
      default:
        return null
    }
  }, [currentDirectory, previewFile, sessionId, isPanelResizing])

  return (
    <ResizablePanel
      position="right"
      isOpen={rightPanelOpen}
      size={rightPanelWidth}
      onSizeChange={layoutStore.setRightPanelWidth}
      onClose={layoutStore.closeRightPanel}
      className="pt-[var(--safe-area-inset-top)] pb-[var(--safe-area-inset-bottom)]"
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

const TerminalContent = memo(function TerminalContent({ 
  activeTab,
  directory,
}: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()
  
  // 获取所有 right 位置的 terminal tabs
  const terminalTabs = panelTabs.filter(
    t => t.position === 'right' && t.type === 'terminal'
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
