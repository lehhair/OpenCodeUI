import { memo, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PanelRightIcon,
  PanelBottomIcon,
  ChevronDownIcon,
  SidebarIcon,
  SplitHorizontalIcon,
  MaximizeIcon,
  MinimizeIcon,
  DownloadIcon,
  GitWorktreeIcon,
} from '../../components/Icons'
import { DropdownMenu, IconButton, MenuItem } from '../../components/ui'
import { ModelSelector, type ModelSelectorHandle } from './ModelSelector'
import { SessionMoveDialog } from './SessionMoveDialog'
import { ShareDialog } from './ShareDialog'
import { useSessionActiveEntry } from '../../store/activeSessionStore'
import { serverStore } from '../../store/serverStore'
import { makeSessionKey } from '../../utils/sessionKey'
import { messageStore, useHeaderSessionMeta } from '../../store'
import { useLayoutStore, layoutStore } from '../../store/layoutStore'
import { useSessionContext } from '../../contexts/useSessionContext'
import { updateSession } from '../../api'
import { useDirectory } from '../../contexts/useDirectory'
import { uiErrorHandler } from '../../utils'
import { useChatViewport } from './chatViewport'
import { useTheme } from '../../hooks/useTheme'
import type { Model, Provider } from '../../api'

interface HeaderProps {
  models: Model[]
  providers?: Provider[]
  modelsLoading: boolean
  selectedModelKey: string | null
  onModelChange: (modelKey: string, model: Model) => void
  onOpenSidebar?: () => void
  onToggleRightPanel?: () => void
  onSplitPane?: () => void
  isPaneFullscreen?: boolean
  onTogglePaneFullscreen?: () => void
  modelSelectorRef?: React.RefObject<ModelSelectorHandle | null>
}

interface SessionTitleControlProps {
  compact: boolean
  isEditingTitle: boolean
  editTitle: string
  sessionTitle: string
  titleInputRef: React.RefObject<HTMLInputElement | null>
  setEditTitle: (value: string) => void
  setIsEditingTitle: (value: boolean) => void
  handleRename: () => void
  handleStartEdit: () => void
  onShare: () => void
  onMove: () => void
  /** 会话运行中：菜单里的「移动」置灰（官方 blocked while running） */
  moveDisabled: boolean
  clickToRenameTitle: string
  moreActionsTitle: string
  exportTitle: string
  exportDesc: string
  moveTitle: string
  moveRunningTitle: string
}

function SessionTitleControl({
  compact,
  isEditingTitle,
  editTitle,
  sessionTitle,
  titleInputRef,
  setEditTitle,
  setIsEditingTitle,
  handleRename,
  handleStartEdit,
  onShare,
  onMove,
  moveDisabled,
  clickToRenameTitle,
  moreActionsTitle,
  exportTitle,
  exportDesc,
  moveTitle,
  moveRunningTitle,
}: SessionTitleControlProps) {
  // 标题右侧的 chevron 是「会话操作」入口：导出 / 移动都收进这个菜单，
  // 不再单独占一个按钮。
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  // 注意：进入重命名时菜单会自动收起——点击标题按钮属于「外部点击」，
  // 上面的 mousedown 监听会先关掉菜单，无需额外 effect。

  const inputClass = compact
    ? 'px-2 py-1.5 text-[length:var(--fs-base)] font-medium text-text-100 bg-transparent border-none outline-none w-[160px] h-full'
    : 'px-3 py-1.5 text-[length:var(--fs-base)] font-medium text-text-100 bg-transparent border-none outline-none w-[200px] lg:w-[300px] h-full text-center'
  const buttonClass = compact
    ? 'px-2 py-1.5 text-[length:var(--fs-base)] font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[200px] cursor-text select-none'
    : 'px-3 py-1.5 text-[length:var(--fs-base)] font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[300px] cursor-text select-none text-center'
  const dividerClass = compact
    ? 'w-[1.5px] h-3 bg-border-200/50 mx-0.5 shrink-0'
    : 'w-[1.5px] h-3 bg-border-200/50 mx-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(any-pointer:coarse)]:opacity-100 transition-opacity'
  const menuButtonClass = compact
    ? 'p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 shrink-0'
    : 'p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(any-pointer:coarse)]:opacity-100 shrink-0'

  const pick = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  return (
    <div
      className={`flex items-center group ${isEditingTitle ? 'bg-bg-200/50 ring-1 ring-accent-main-100' : 'bg-transparent hover:bg-bg-200/50 border border-transparent hover:border-border-200/50'} rounded-lg transition-all duration-200 p-0.5 min-w-0 shrink`}
    >
      {isEditingTitle ? (
        <input
          ref={titleInputRef}
          type="text"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={e => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') setIsEditingTitle(false)
          }}
          className={inputClass}
        />
      ) : (
          <button type="button" onClick={handleStartEdit} className={buttonClass} title={clickToRenameTitle}>
            {sessionTitle}
          </button>
      )}

      {!isEditingTitle && (
        <>
          <div className={`${dividerClass} ${menuOpen ? 'opacity-100' : ''}`} />
          <button
            ref={triggerRef}
            type="button"
            className={`${menuButtonClass} ${menuOpen ? 'opacity-100' : ''}`}
            title={moreActionsTitle}
            aria-label={moreActionsTitle}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(v => !v)}
          >
            <ChevronDownIcon size={12} />
          </button>
          <DropdownMenu
            triggerRef={triggerRef}
            isOpen={menuOpen}
            position="bottom"
            align="left"
            minWidth="224px"
            mobileFullWidth
          >
            <div ref={menuRef} role="menu" aria-label={moreActionsTitle} className="p-1">
              <MenuItem
                label={exportTitle}
                description={exportDesc}
                icon={<DownloadIcon size={14} />}
                onClick={() => pick(onShare)}
              />
              <MenuItem
                label={moveDisabled ? moveRunningTitle : moveTitle}
                icon={<GitWorktreeIcon size={14} />}
                disabled={moveDisabled}
                onClick={() => pick(onMove)}
              />
            </div>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}

export const Header = memo(function Header({
  models,
  providers,
  modelsLoading,
  selectedModelKey,
  onModelChange,
  onOpenSidebar,
  onToggleRightPanel,
  onSplitPane,
  isPaneFullscreen = false,
  onTogglePaneFullscreen,
  modelSelectorRef,
}: HeaderProps) {
  const { t } = useTranslation('chat')
  const { sessionId, sessionDirectory, sessionTitle: currentSessionTitle } = useHeaderSessionMeta()
  const { rightPanelOpen, bottomPanelOpen } = useLayoutStore()
  const { refresh } = useSessionContext()
  const { currentDirectory } = useDirectory()
  const { presentation, interaction } = useChatViewport()
  // 汇总菜单模式下模型选择器移到输入框内，标题栏不再重复显示
  const { composerSelectorStyle } = useTheme()

  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const sessionTitle = currentSessionTitle || t('header.newChat')
  const isCompact = presentation.isCompact

  // 会话运行中禁止移动（官方 blocked while running）——用活跃状态判断
  const activeSessionKey = sessionId ? makeSessionKey(serverStore.getActiveServerId(), sessionId) : ''
  const activeEntry = useSessionActiveEntry(activeSessionKey)
  const sessionRunning = activeEntry?.status?.type === 'busy' || activeEntry?.status?.type === 'retry'

  useEffect(() => {
    document.title = currentSessionTitle ? `${currentSessionTitle} - OpenCode` : 'OpenCode'
    return () => {
      document.title = 'OpenCode'
    }
  }, [currentSessionTitle])

  useEffect(() => {
    setIsEditingTitle(false)
  }, [sessionId])

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  const handleStartEdit = () => {
    if (!sessionId) return
    setEditTitle(sessionTitle)
    setIsEditingTitle(true)
  }

  const handleRename = async () => {
    if (!sessionId || !editTitle.trim() || editTitle === sessionTitle) {
      setIsEditingTitle(false)
      return
    }
    try {
      const updated = await updateSession(sessionId, { title: editTitle.trim() }, sessionDirectory || currentDirectory)
      messageStore.updateSessionMetadata(sessionId, { title: updated.title })
      refresh()
    } catch (e) {
      uiErrorHandler('rename session', e)
    } finally {
      setIsEditingTitle(false)
    }
  }

  const titleControl = (
    <SessionTitleControl
      compact={isCompact}
      isEditingTitle={isEditingTitle}
      editTitle={editTitle}
      sessionTitle={sessionTitle}
      titleInputRef={titleInputRef}
      setEditTitle={setEditTitle}
      setIsEditingTitle={setIsEditingTitle}
      handleRename={handleRename}
      handleStartEdit={handleStartEdit}
      onShare={() => setShareDialogOpen(true)}
      onMove={() => setMoveDialogOpen(true)}
      moveDisabled={sessionRunning}
      clickToRenameTitle={t('header.clickToRename')}
      moreActionsTitle={t('header.moreActions')}
      exportTitle={t('header.shareSession')}
      exportDesc={t('header.exportSessionDesc')}
      moveTitle={t('sessionMove.title')}
      moveRunningTitle={t('sessionMove.runningTitle')}
    />
  )

  return (
    <div
      className={`mobile-safe-topbar-14 flex justify-between items-center z-20 bg-bg-100 transition-colors duration-200 relative ${isCompact ? 'px-2' : 'px-4'}`}
    >
      <div className="flex items-center gap-2 min-w-0 shrink-1 z-20">
        {interaction.sidebarBehavior === 'overlay' && onOpenSidebar && (
          <IconButton
            aria-label={t('header.openSidebar')}
            onClick={onOpenSidebar}
            className="hover:bg-bg-200/50 text-text-300 hover:text-text-100"
          >
            <SidebarIcon size={16} />
          </IconButton>
        )}

        {!isCompact && composerSelectorStyle !== 'seat' && (
          <ModelSelector
            ref={modelSelectorRef}
            models={models}
            providers={providers}
            selectedModelKey={selectedModelKey}
            onSelect={onModelChange}
            isLoading={modelsLoading}
          />
        )}

        {isCompact && <div className="min-w-0 flex items-center">{titleControl}</div>}
      </div>

      {!isCompact && <div className="absolute left-1/2 -translate-x-1/2 flex items-center z-20">{titleControl}</div>}

      <div className="flex items-center gap-1 pointer-events-auto shrink-0 z-20">
        <div className="flex items-center gap-0.5">
          {onTogglePaneFullscreen && (
            <IconButton
              aria-label={isPaneFullscreen ? 'Exit fullscreen pane' : 'Fullscreen pane'}
              onClick={onTogglePaneFullscreen}
              className={`transition-colors ${
                isPaneFullscreen
                  ? 'text-accent-main-100 bg-bg-200/50'
                  : 'text-text-300 hover:text-text-100 hover:bg-bg-200/50'
              }`}
            >
              {isPaneFullscreen ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
            </IconButton>
          )}

          {onSplitPane && (
            <IconButton
              aria-label="Split pane"
              onClick={onSplitPane}
              className="transition-colors text-text-300 hover:text-text-100 hover:bg-bg-200/50"
            >
              <SplitHorizontalIcon size={16} />
            </IconButton>
          )}

          <IconButton
            aria-label={bottomPanelOpen ? t('header.closeBottomPanel') : t('header.openBottomPanel')}
            onClick={() => layoutStore.toggleBottomPanel()}
            className={`transition-colors ${bottomPanelOpen ? 'text-accent-main-100 bg-bg-200/50' : 'text-text-300 hover:text-text-100 hover:bg-bg-200/50'}`}
          >
            <PanelBottomIcon size={16} />
          </IconButton>

          <IconButton
            aria-label={rightPanelOpen ? t('header.closePanel') : t('header.openPanel')}
            onClick={onToggleRightPanel ?? (() => layoutStore.toggleRightPanel())}
            className={`transition-colors ${rightPanelOpen ? 'text-accent-main-100 bg-bg-200/50' : 'text-text-300 hover:text-text-100 hover:bg-bg-200/50'}`}
          >
            <PanelRightIcon size={16} />
          </IconButton>
        </div>
      </div>

      <ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />

      {sessionId && (
        <SessionMoveDialog
          isOpen={moveDialogOpen}
          onClose={() => setMoveDialogOpen(false)}
          sessionId={sessionId}
          directory={sessionDirectory || currentDirectory || ''}
        />
      )}

      {/* 用纯色块 + mask 渐隐，而不是 bg-gradient：渐变类在 Tailwind v4 里默认走 oklab，
          从 bg-bg-100 插值到 transparent（透明黑）中间会带出灰，和内容叠起来就是分层。
          mask 只动 alpha，不插值颜色，任何主题下都干净。 */}
      <div
        data-chat-header-shadow
        className="absolute top-full left-0 right-0 h-8 bg-bg-100 pointer-events-none z-10 [-webkit-mask-image:linear-gradient(to_bottom,black,transparent)] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
    </div>
  )
})
