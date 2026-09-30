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
    <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
      {t('rightPanel.loadingPanel')}
    </div>
  )
}

interface RightPanelProps {
  directory?: string
  sessionId?: string | null
  /** 数据所属服务器（跟随焦点 session；缺省用活动服务器） */
  serverId?: string
  inline?: boolean
  renderPanelContent?: boolean
}

export const RightPanel = memo(function RightPanel({
  directory,
  sessionId,
  serverId,
  inline = false,
  renderPanelContent = true,
}: RightPanelProps) {
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
        await removePtySession(ptyId, normalizedDirectory, serverId)
      } catch {
        // ignore cleanup errors
      }
    },
    [normalizedDirectory, serverId],
  )

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      logger.log('[RightPanel] Creating PTY session, directory:', normalizedDirectory, 'server:', serverId)
      const pty = await createPtySession({ cwd: normalizedDirectory }, normalizedDirectory, serverId)
      logger.log('[RightPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || 'Terminal',
        status: 'connecting',
        serverId,
      }
      layoutStore.addTerminalTab(tab, true, 'right')
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [normalizedDirectory, serverId])

  // 渲染内容
  const renderContent = useCallback(
    (activeTab: PanelTab | null) => {
      if (!activeTab) {
        return (
          <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
            {t('common:noContent')}
          </div>
        )
      }

      return (
        <>
          {/* Keep files mounted so expanded folders and previews survive tab switches.
              切换服务器（serverId 变化）时重挂载：文件树展开/选中/预览整体重置，
              与单服务器模式切换工作区的"侧边栏整个变"体验一致 */}
          <div className={activeTab.type === 'files' ? 'h-full' : 'hidden'}>
            <Suspense fallback={<PanelFallback />}>
              <FilesContent
                key={serverId ?? 'default'}
                activeTab={activeTab}
                directory={normalizedDirectory}
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
                  key={serverId ?? 'default'}
                  activeTab={activeTab}
                  directory={normalizedDirectory}
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
              <TerminalContent activeTab={activeTab} directory={normalizedDirectory} serverId={serverId} />
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
    [normalizedDirectory, sessionId, isPanelResizing, t, serverId],
  )

  if (inline) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-bg-100 [contain:layout_paint]">
        {renderPanelContent ? (
          <PanelContainer
            position="right"
            directory={normalizedDirectory}
            onNewTerminal={handleNewTerminal}
            onCloseTerminal={handleCloseTerminal}
            forceOpen
          >
            {renderContent}
          </PanelContainer>
        ) : null}
      </div>
    )
  }

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
    >
      <PanelContainer
        position="right"
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
// Terminal Content - 渲染所有终端实例 (右侧面板)
// ============================================

interface TerminalContentProps {
  activeTab: PanelTab
  directory?: string
  serverId?: string
}

const TerminalContent = memo(function TerminalContent({ activeTab, directory, serverId }: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()

  // 获取所有 right 位置的 terminal tabs
  const terminalTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'terminal')

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
  const fileTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'files')

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
  const changeTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'changes')

  return (
    <>
      {changeTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <SessionChangesPanel
            sessionId={sessionId}
            directory={directory}
            serverId={serverId}
            position="right"
            isResizing={isPanelResizing}
          />
        </div>
      ))}
    </>
  )
})
