/**
 * PaneHeader — Compact header bar for each split pane.
 *
 * Shows: session title (editable) | split H | split V | close
 * Supports drag-to-swap via native drag & drop between pane headers.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CloseIcon,
  SplitHorizontalIcon,
  SplitVerticalIcon,
  PanelBottomIcon,
  PanelRightIcon,
  SidebarIcon,
  MaximizeIcon,
  MinimizeIcon,
} from '../../components/Icons'
import { IconButton } from '../../components/ui'
import { paneLayoutStore } from '../../store/paneLayoutStore'
import { useSessionState } from '../../store'
import { layoutStore, useLayoutStore } from '../../store/layoutStore'
import { messageStore } from '../../store'
import { updateSession } from '../../api'
import { useDirectory } from '../../contexts/useDirectory'
import { uiErrorHandler } from '../../utils'
import { useChatViewport, canUseSplitPane } from './chatViewport'

interface PaneHeaderProps {
  paneId: string
  sessionId: string | null
  isFocused: boolean
  paneCount: number
  canSplitPane?: boolean
  isPaneFullscreen?: boolean
  showSidebarButton?: boolean
  onOpenSidebar?: () => void
  onTogglePaneFullscreen?: () => void
  onFocus: () => void
}

export function PaneHeader({
  paneId,
  sessionId,
  isFocused,
  paneCount,
  canSplitPane,
  isPaneFullscreen = false,
  showSidebarButton = false,
  onOpenSidebar,
  onTogglePaneFullscreen,
  onFocus,
}: PaneHeaderProps) {
  const { t } = useTranslation('chat')
  const viewport = useChatViewport()
  const sessionState = useSessionState(sessionId)
  const { currentDirectory } = useDirectory()
  const { rightPanelOpen, bottomPanelOpen } = useLayoutStore()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Drag state for swap
  const [isDragOver, setIsDragOver] = useState(false)

  const title = sessionState?.title || t('header.newChat')
  const splitEnabled = canSplitPane ?? canUseSplitPane(viewport)

  // Reset editing when session changes
  useEffect(() => {
    setIsEditing(false)
  }, [sessionId])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = useCallback(() => {
    if (!sessionId) return
    setEditValue(title)
    setIsEditing(true)
  }, [sessionId, title])

  const handleRename = useCallback(async () => {
    if (!sessionId || !editValue.trim() || editValue === title) {
      setIsEditing(false)
      return
    }
    try {
      const dir = sessionState?.directory || currentDirectory
      const updated = await updateSession(sessionId, { title: editValue.trim() }, dir)
      messageStore.updateSessionMetadata(sessionId, { title: updated.title })
    } catch (e) {
      uiErrorHandler('rename session', e)
    } finally {
      setIsEditing(false)
    }
  }, [sessionId, editValue, title, sessionState?.directory, currentDirectory])

  // ---- Split actions ----
  const handleSplitH = useCallback(() => {
    paneLayoutStore.splitPane(paneId, 'horizontal')
  }, [paneId])

  const handleSplitV = useCallback(() => {
    paneLayoutStore.splitPane(paneId, 'vertical')
  }, [paneId])

  const handleClose = useCallback(() => {
    paneLayoutStore.closePane(paneId)
  }, [paneId])

  // ---- Drag & Drop (swap panes) ----
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('text/x-pane-id', paneId)
      e.dataTransfer.effectAllowed = 'move'
    },
    [paneId],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/x-pane-id')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false)
      const sourcePaneId = e.dataTransfer.getData('text/x-pane-id')
      if (sourcePaneId && sourcePaneId !== paneId) {
        paneLayoutStore.swapPanes(sourcePaneId, paneId)
      }
    },
    [paneId],
  )

  return (
    <div
      className={`relative h-10 flex items-center justify-between px-2 transition-colors duration-200 shrink-0 z-20 ${
        isDragOver ? 'bg-accent-main-100/10' : 'bg-bg-100'
      }`}
      onClick={onFocus}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Left: Title */}
      <div className="flex items-center min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setIsEditing(false)
            }}
            className="px-1.5 py-0.5 text-xs font-medium text-text-100 bg-transparent border-none outline-none w-[140px]"
          />
        ) : (
          <button
            onClick={handleStartEdit}
            className="px-1.5 py-0.5 text-xs font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[200px] cursor-text select-none"
            title={t('header.clickToRename')}
          >
            {title}
          </button>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center gap-0.5 shrink-0">
          {paneCount > 1 && (
            <IconButton
              size="sm"
              aria-label="Close pane"
              onClick={e => {
                e.stopPropagation()
                handleClose()
              }}
              className="text-text-400 hover:text-red-400 hover:bg-bg-200/50"
            >
              <CloseIcon size={14} />
            </IconButton>
          )}

          {isFocused && onTogglePaneFullscreen && (
            <IconButton
              size="sm"
              aria-label={isPaneFullscreen ? 'Exit fullscreen pane' : 'Fullscreen pane'}
              onClick={e => {
                e.stopPropagation()
                onTogglePaneFullscreen()
              }}
              className={`transition-colors ${
                isPaneFullscreen
                  ? 'text-accent-main-100 bg-bg-200/50'
                  : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'
              }`}
            >
              {isPaneFullscreen ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
            </IconButton>
          )}

          {splitEnabled && (
            <>
              <IconButton
                size="sm"
                aria-label="Split horizontal"
                onClick={e => {
                  e.stopPropagation()
                  handleSplitH()
                }}
                className="text-text-400 hover:text-text-100 hover:bg-bg-200/50"
              >
                <SplitHorizontalIcon size={14} />
              </IconButton>

              <IconButton
                size="sm"
                aria-label="Split vertical"
                onClick={e => {
                  e.stopPropagation()
                  handleSplitV()
                }}
                className="text-text-400 hover:text-text-100 hover:bg-bg-200/50"
              >
                <SplitVerticalIcon size={14} />
              </IconButton>
            </>
          )}
        </div>

        {isFocused && (
          <div className="flex items-center gap-0.5 shrink-0">
            {showSidebarButton && onOpenSidebar && (
              <IconButton
                size="sm"
                aria-label={t('header.openSidebar')}
                onClick={e => {
                  e.stopPropagation()
                  onOpenSidebar()
                }}
                className="text-text-400 hover:text-text-100 hover:bg-bg-200/50"
              >
                <SidebarIcon size={14} />
              </IconButton>
            )}

            <IconButton
              size="sm"
              aria-label={bottomPanelOpen ? t('header.closeBottomPanel') : t('header.openBottomPanel')}
              onClick={e => {
                e.stopPropagation()
                layoutStore.toggleBottomPanel()
              }}
              className={`transition-colors ${
                bottomPanelOpen
                  ? 'text-accent-main-100 bg-bg-200/50'
                  : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'
              }`}
            >
              <PanelBottomIcon size={14} />
            </IconButton>

            <IconButton
              size="sm"
              aria-label={rightPanelOpen ? t('header.closePanel') : t('header.openPanel')}
              onClick={e => {
                e.stopPropagation()
                layoutStore.toggleRightPanel()
              }}
              className={`transition-colors ${
                rightPanelOpen
                  ? 'text-accent-main-100 bg-bg-200/50'
                  : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'
              }`}
            >
              <PanelRightIcon size={14} />
            </IconButton>
          </div>
        )}
      </div>

      <div className="absolute top-full left-0 right-0 h-8 bg-gradient-to-b from-bg-100 to-transparent pointer-events-none z-10" />
    </div>
  )
}
