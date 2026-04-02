import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PanelRightIcon,
  PanelBottomIcon,
  ChevronDownIcon,
  SidebarIcon,
  SplitHorizontalIcon,
  MaximizeIcon,
  MinimizeIcon,
} from '../../components/Icons'
import { IconButton } from '../../components/ui'
import { ModelSelector, type ModelSelectorHandle } from './ModelSelector'
import { ShareDialog } from './ShareDialog'
import { messageStore, useMessageStore } from '../../store'
import { useLayoutStore, layoutStore } from '../../store/layoutStore'
import { useSessionContext } from '../../contexts/useSessionContext'
import { updateSession } from '../../api'
import { useDirectory } from '../../contexts/useDirectory'
import { uiErrorHandler } from '../../utils'
import { useChatViewport } from './chatViewport'
import type { ModelInfo } from '../../api'

interface HeaderProps {
  models: ModelInfo[]
  modelsLoading: boolean
  selectedModelKey: string | null
  onModelChange: (modelKey: string, model: ModelInfo) => void
  onOpenSidebar?: () => void
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
  clickToRenameTitle: string
  shareTitle: string
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
  clickToRenameTitle,
  shareTitle,
}: SessionTitleControlProps) {
  const inputClass = compact
    ? 'px-2 py-1.5 text-sm font-medium text-text-100 bg-transparent border-none outline-none w-[160px] h-full'
    : 'px-3 py-1.5 text-sm font-medium text-text-100 bg-transparent border-none outline-none w-[200px] lg:w-[300px] h-full text-center'
  const buttonClass = compact
    ? 'px-2 py-1.5 text-sm font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[200px] cursor-text select-none'
    : 'px-3 py-1.5 text-sm font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[300px] cursor-text select-none text-center'
  const dividerClass = compact
    ? 'w-[1.5px] h-3 bg-border-200/50 mx-0.5 shrink-0'
    : 'w-[1.5px] h-3 bg-border-200/50 mx-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(any-pointer:coarse)]:opacity-100 transition-opacity'
  const shareButtonClass = compact
    ? 'p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 shrink-0'
    : 'p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(any-pointer:coarse)]:opacity-100 shrink-0'

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
        <button onClick={handleStartEdit} className={buttonClass} title={clickToRenameTitle}>
          {sessionTitle}
        </button>
      )}

      {!isEditingTitle && (
        <>
          <div className={dividerClass} />
          <button className={shareButtonClass} title={shareTitle} onClick={onShare}>
            <ChevronDownIcon size={12} />
          </button>
        </>
      )}
    </div>
  )
}

export function Header({
  models,
  modelsLoading,
  selectedModelKey,
  onModelChange,
  onOpenSidebar,
  onSplitPane,
  isPaneFullscreen = false,
  onTogglePaneFullscreen,
  modelSelectorRef,
}: HeaderProps) {
  const { t } = useTranslation('chat')
  const { sessionId, sessionDirectory, sessionTitle: currentSessionTitle } = useMessageStore()
  const { rightPanelOpen, bottomPanelOpen } = useLayoutStore()
  const { refresh } = useSessionContext()
  const { currentDirectory } = useDirectory()
  const { presentation, interaction } = useChatViewport()

  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const sessionTitle = currentSessionTitle || t('header.newChat')
  const isCompact = presentation.isCompact

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
      clickToRenameTitle={t('header.clickToRename')}
      shareTitle={t('header.shareSession')}
    />
  )

  return (
    <div
      className={`h-14 flex justify-between items-center z-20 bg-bg-100 transition-colors duration-200 relative ${isCompact ? 'px-2' : 'px-4'}`}
    >
      <div className="flex items-center gap-2 min-w-0 shrink-1 z-20">
        {interaction.sidebarBehavior === 'overlay' && onOpenSidebar && (
          <IconButton
            aria-label={t('header.openSidebar')}
            onClick={onOpenSidebar}
            className="hover:bg-bg-200/50 text-text-400 hover:text-text-100"
          >
            <SidebarIcon size={18} />
          </IconButton>
        )}

        {!isCompact && (
          <ModelSelector
            ref={modelSelectorRef}
            models={models}
            selectedModelKey={selectedModelKey}
            onSelect={onModelChange}
            isLoading={modelsLoading}
          />
        )}

        {isCompact && <div className="min-w-0">{titleControl}</div>}
      </div>

      {!isCompact && <div className="absolute left-1/2 -translate-x-1/2 flex z-20">{titleControl}</div>}

      <div className="flex items-center gap-1 pointer-events-auto shrink-0 z-20">
        <div className="flex items-center gap-0.5">
          {onTogglePaneFullscreen && (
            <IconButton
              aria-label={isPaneFullscreen ? 'Exit fullscreen pane' : 'Fullscreen pane'}
              onClick={onTogglePaneFullscreen}
              className={`transition-colors ${
                isPaneFullscreen
                  ? 'text-accent-main-100 bg-bg-200/50'
                  : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'
              }`}
            >
              {isPaneFullscreen ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
            </IconButton>
          )}

          {onSplitPane && (
            <IconButton
              aria-label="Split pane"
              onClick={onSplitPane}
              className="transition-colors text-text-400 hover:text-text-100 hover:bg-bg-200/50"
            >
              <SplitHorizontalIcon size={18} />
            </IconButton>
          )}

          <IconButton
            aria-label={bottomPanelOpen ? t('header.closeBottomPanel') : t('header.openBottomPanel')}
            onClick={() => layoutStore.toggleBottomPanel()}
            className={`transition-colors ${bottomPanelOpen ? 'text-accent-main-100 bg-bg-200/50' : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'}`}
          >
            <PanelBottomIcon size={18} />
          </IconButton>

          <IconButton
            aria-label={rightPanelOpen ? t('header.closePanel') : t('header.openPanel')}
            onClick={() => layoutStore.toggleRightPanel()}
            className={`transition-colors ${rightPanelOpen ? 'text-accent-main-100 bg-bg-200/50' : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'}`}
          >
            <PanelRightIcon size={18} />
          </IconButton>
        </div>
      </div>

      <ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />

      <div className="absolute top-full left-0 right-0 h-8 bg-gradient-to-b from-bg-100 to-transparent pointer-events-none z-10" />
    </div>
  )
}
