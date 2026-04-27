import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, SendIcon, StopIcon, PaperclipIcon, AgentIcon, ThinkingIcon } from '../../../components/Icons'
import { DropdownMenu, MenuItem, IconButton, AnimatedPresence } from '../../../components/ui'
import { ModelSelector, type ModelSelectorHandle } from '../ModelSelector'
import { useChatViewport } from '../chatViewport'
import { isTauri, isTauriMobile, extToMime } from '../../../utils/tauri'
import type { ApiAgent } from '../../../api/client'
import type { ModelInfo, FileCapabilities } from '../../../api'

interface InputToolbarProps {
  agents: ApiAgent[]
  selectedAgent?: string
  onAgentChange?: (agentName: string) => void

  variants?: string[]
  selectedVariant?: string
  onVariantChange?: (variant: string | undefined) => void

  fileCapabilities?: FileCapabilities
  onFilesSelected: (files: File[]) => void

  isStreaming?: boolean
  isSending?: boolean
  onAbort?: () => void

  canSend: boolean
  onSend: () => void

  // Model selection（移动端显示在工具栏）
  models?: ModelInfo[]
  selectedModelKey?: string | null
  onModelChange?: (modelKey: string, model: ModelInfo) => void
  modelsLoading?: boolean
  // 输入框容器 ref，用于约束菜单边界
  inputContainerRef?: React.RefObject<HTMLDivElement | null>
  modelSelectorRef?: React.RefObject<ModelSelectorHandle | null>
}

export function InputToolbar({
  agents,
  selectedAgent,
  onAgentChange,
  variants = [],
  selectedVariant,
  onVariantChange,
  fileCapabilities,
  onFilesSelected,
  isStreaming,
  isSending = false,
  onAbort,
  canSend,
  onSend,
  models = [],
  selectedModelKey = null,
  onModelChange,
  modelsLoading = false,
  inputContainerRef,
  modelSelectorRef,
}: InputToolbarProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { presentation } = useChatViewport()
  const isCompact = presentation.isCompact
  const useBrowserFileInput = !isTauri() || isTauriMobile()

  // 根据模型能力计算支持的文件类型
  const caps = fileCapabilities ?? { image: false, pdf: false, audio: false, video: false }
  const supportsAnyFile = caps.image || caps.pdf || caps.audio || caps.video
  const controlsDisabled = isSending

  // 动态构建 HTML accept 和 Tauri filter
  const { acceptString, tauriFilters } = useMemo(() => {
    const accept: string[] = []
    const extensions: string[] = []
    const filterNames: string[] = []

    if (caps.image) {
      accept.push('image/*')
      extensions.push('png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg')
      filterNames.push('Images')
    }
    if (caps.pdf) {
      accept.push('application/pdf')
      extensions.push('pdf')
      filterNames.push('PDF')
    }
    if (caps.audio) {
      accept.push('audio/*')
      extensions.push('mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a')
      filterNames.push('Audio')
    }
    if (caps.video) {
      accept.push('video/*')
      extensions.push('mp4', 'webm', 'mov', 'avi', 'mkv')
      filterNames.push('Video')
    }

    return {
      acceptString: accept.join(','),
      tauriFilters: extensions.length > 0 ? [{ name: filterNames.join(' / '), extensions }] : [],
    }
  }, [caps.image, caps.pdf, caps.audio, caps.video])
  // State for menus
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [variantMenuOpen, setVariantMenuOpen] = useState(false)

  // Refs
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const agentMenuRef = useRef<HTMLDivElement>(null)
  const variantTriggerRef = useRef<HTMLButtonElement>(null)
  const variantMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const agentMenuFocusRef = useRef<'selected' | 'first' | 'last'>('selected')
  const variantMenuFocusRef = useRef<'selected' | 'first' | 'last'>('selected')
  const agentMenuId = 'input-toolbar-agent-menu'
  const variantMenuId = 'input-toolbar-variant-menu'

  const focusMenuItem = useCallback((menu: HTMLDivElement | null, mode: 'selected' | 'first' | 'last') => {
    if (!menu) return

    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], button'))
    if (items.length === 0) return

    const selectedItem = menu.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
    const target = mode === 'first' ? items[0] : mode === 'last' ? items[items.length - 1] : selectedItem ?? items[0]
    target?.focus()
  }, [])

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, menu: HTMLDivElement | null, onClose: () => void, trigger: HTMLButtonElement | null) => {
      const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], button') ?? [])
      if (items.length === 0) {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          trigger?.focus()
        }
        return
      }

      const currentIndex = items.findIndex(item => item === document.activeElement)
      const focusByIndex = (index: number) => items[index]?.focus()

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length
        focusByIndex(nextIndex)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        const nextIndex = currentIndex === -1 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
        focusByIndex(nextIndex)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusByIndex(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        focusByIndex(items.length - 1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        trigger?.focus()
      }
    },
    [],
  )

  // 文件选择器（Tauri 原生 / 浏览器 fallback）
  const handleFileClick = useCallback(async () => {
    if (useBrowserFileInput) {
      fileInputRef.current?.click()
      return
    }

    try {
      const [{ open }, { readFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
      ])

      const selected = await open({
        multiple: true,
        filters: tauriFilters,
        fileAccessMode: 'copy',
      })

      if (!selected) return

      const paths = Array.isArray(selected) ? selected : [selected]
      if (paths.length === 0) return

      const files: File[] = []
      for (const path of paths) {
        const fileName = path.split(/[\\/]/).pop() || 'file'
        const ext = fileName.split('.').pop()?.toLowerCase() || ''
        const mime = extToMime(ext)

        const data = await readFile(path)
        const file = new File([data], fileName, { type: mime })
        files.push(file)
      }

      if (files.length > 0) {
        onFilesSelected(files)
      }
    } catch (err) {
      console.warn('[InputToolbar] File picker error:', err)
    }
  }, [onFilesSelected, tauriFilters, useBrowserFileInput])

  // Click outside logic
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        agentMenuRef.current &&
        !agentMenuRef.current.contains(e.target as Node) &&
        !agentTriggerRef.current?.contains(e.target as Node)
      ) {
        setAgentMenuOpen(false)
      }
      if (
        variantMenuRef.current &&
        !variantMenuRef.current.contains(e.target as Node) &&
        !variantTriggerRef.current?.contains(e.target as Node)
      ) {
        setVariantMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!agentMenuOpen) return
    const timerId = window.setTimeout(() => {
      focusMenuItem(agentMenuRef.current, agentMenuFocusRef.current)
    }, 0)
    return () => clearTimeout(timerId)
  }, [agentMenuOpen, focusMenuItem])

  useEffect(() => {
    if (!variantMenuOpen) return
    const timerId = window.setTimeout(() => {
      focusMenuItem(variantMenuRef.current, variantMenuFocusRef.current)
    }, 0)
    return () => clearTimeout(timerId)
  }, [variantMenuOpen, focusMenuItem])

  const selectableAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
  const currentAgent = agents.find(a => a.name === selectedAgent)

  return (
    <div className="flex items-center justify-between px-3 pb-3 relative">
      {/* Left side: Model (mobile) + Agent + Variant selectors */}
      <div className={`flex items-center min-w-0 ${isCompact ? 'gap-1' : 'gap-2'}`}>
        {/* Model Selector — 移动端显示在最左边 */}
        {isCompact && onModelChange && (
          <ModelSelector
            ref={modelSelectorRef}
            models={models}
            selectedModelKey={selectedModelKey}
            onSelect={onModelChange}
            isLoading={modelsLoading}
            position="top"
            trigger="toolbar"
            constrainToRef={inputContainerRef}
          />
        )}

        {/* Agent Selector */}
        <AnimatedPresence show={selectableAgents.length > 1} className={isCompact ? 'shrink-0' : ''}>
          <div className="relative">
            <button
              ref={agentTriggerRef}
              type="button"
              onClick={() => {
                agentMenuFocusRef.current = 'selected'
                setAgentMenuOpen(!agentMenuOpen)
              }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  agentMenuFocusRef.current = e.key === 'ArrowUp' ? 'last' : 'first'
                  setAgentMenuOpen(true)
                }
              }}
              disabled={controlsDisabled}
              aria-haspopup="menu"
              aria-expanded={agentMenuOpen}
              aria-controls={agentMenuOpen ? agentMenuId : undefined}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[length:var(--fs-base)] rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer min-w-0 overflow-hidden w-full"
              title={
                currentAgent
                  ? `${currentAgent.name}${currentAgent.description ? ': ' + currentAgent.description : ''}`
                  : selectedAgent || 'build'
              }
            >
              {/* 紧凑信息流隐藏 AgentIcon 节省空间 */}
              <span
                className={`text-text-400 shrink-0 ${isCompact ? 'hidden' : ''}`}
                style={currentAgent?.color ? { color: currentAgent.color } : undefined}
              >
                <AgentIcon />
              </span>
              <span className="text-[length:var(--fs-sm)] text-text-300 capitalize truncate">{selectedAgent || 'build'}</span>
              <span className={`text-text-400 shrink-0 ${isCompact ? 'hidden' : ''}`}>
                <ChevronDownIcon />
              </span>
            </button>

            <DropdownMenu
              triggerRef={agentTriggerRef}
              isOpen={agentMenuOpen}
              position="top"
              align="left"
              constrainToRef={inputContainerRef}
            >
              <div
                id={agentMenuId}
                ref={agentMenuRef}
                role="menu"
                aria-label={currentAgent?.name || selectedAgent || 'Agent'}
                onKeyDown={event =>
                  handleMenuKeyDown(event, agentMenuRef.current, () => setAgentMenuOpen(false), agentTriggerRef.current)
                }
              >
                {selectableAgents.map(agent => (
                  <MenuItem
                    key={agent.name}
                    label={agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}
                    description={agent.description}
                    icon={
                      <span style={agent.color ? { color: agent.color } : undefined}>
                        <AgentIcon />
                      </span>
                    }
                    selected={selectedAgent === agent.name}
                    selectionRole="menuitemradio"
                    onClick={() => {
                      onAgentChange?.(agent.name)
                      setAgentMenuOpen(false)
                      agentTriggerRef.current?.focus()
                    }}
                  />
                ))}
              </div>
            </DropdownMenu>
          </div>
        </AnimatedPresence>

        {/* Variant Selector */}
        <AnimatedPresence show={variants.length > 0} className={isCompact ? 'shrink-0' : ''}>
          <div className="relative">
            <button
              ref={variantTriggerRef}
              type="button"
              onClick={() => {
                variantMenuFocusRef.current = 'selected'
                setVariantMenuOpen(!variantMenuOpen)
              }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  variantMenuFocusRef.current = e.key === 'ArrowUp' ? 'last' : 'first'
                  setVariantMenuOpen(true)
                }
              }}
              disabled={controlsDisabled}
              aria-haspopup="menu"
              aria-expanded={variantMenuOpen}
              aria-controls={variantMenuOpen ? variantMenuId : undefined}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[length:var(--fs-base)] rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer min-w-0 overflow-hidden w-full"
              title={
                selectedVariant
                  ? selectedVariant.charAt(0).toUpperCase() + selectedVariant.slice(1)
                  : t('inputToolbar.default')
              }
            >
              {/* 紧凑信息流隐藏 ThinkingIcon */}
              <span className={`text-text-400 shrink-0 ${isCompact ? 'hidden' : ''}`}>
                <ThinkingIcon />
              </span>
              <span className="text-[length:var(--fs-sm)] text-text-300 truncate">
                {selectedVariant
                  ? selectedVariant.charAt(0).toUpperCase() + selectedVariant.slice(1)
                  : t('inputToolbar.default')}
              </span>
              <span className={`text-text-400 shrink-0 ${isCompact ? 'hidden' : ''}`}>
                <ChevronDownIcon />
              </span>
            </button>

            <DropdownMenu
              triggerRef={variantTriggerRef}
              isOpen={variantMenuOpen}
              position="top"
              align="left"
              minWidth="auto"
              constrainToRef={inputContainerRef}
            >
              <div
                id={variantMenuId}
                ref={variantMenuRef}
                role="menu"
                aria-label={selectedVariant || t('inputToolbar.default')}
                onKeyDown={event =>
                  handleMenuKeyDown(event, variantMenuRef.current, () => setVariantMenuOpen(false), variantTriggerRef.current)
                }
              >
                <MenuItem
                  label={t('inputToolbar.default')}
                  icon={<ThinkingIcon />}
                  selected={!selectedVariant}
                  selectionRole="menuitemradio"
                  onClick={() => {
                    onVariantChange?.(undefined)
                    setVariantMenuOpen(false)
                    variantTriggerRef.current?.focus()
                  }}
                />
                {variants.map(variant => (
                  <MenuItem
                    key={variant}
                    label={variant.charAt(0).toUpperCase() + variant.slice(1)}
                    icon={<ThinkingIcon />}
                    selected={selectedVariant === variant}
                    selectionRole="menuitemradio"
                    onClick={() => {
                      onVariantChange?.(variant)
                      setVariantMenuOpen(false)
                      variantTriggerRef.current?.focus()
                    }}
                  />
                ))}
              </div>
            </DropdownMenu>
          </div>
        </AnimatedPresence>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1">
        <AnimatedPresence show={supportsAnyFile}>
          <>
            {/* 浏览器模式下的隐藏文件输入 */}
            {useBrowserFileInput && (
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptString}
                multiple
                className="hidden"
                onChange={e => {
                  onFilesSelected(Array.from(e.target.files ?? []))
                  e.currentTarget.value = ''
                }}
              />
            )}
            <IconButton aria-label={t('inputToolbar.attachFile')} disabled={controlsDisabled} onClick={handleFileClick}>
              <PaperclipIcon />
            </IconButton>
          </>
        </AnimatedPresence>
        {!canSend && isStreaming && !isSending ? (
          <IconButton aria-label={t('inputToolbar.stopGeneration')} variant="solid" onClick={onAbort}>
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            aria-label={isSending ? t('inputToolbar.sendingMessage') : t('inputToolbar.sendMessage')}
            variant="solid"
            disabled={!canSend || isSending}
            onClick={onSend}
          >
            <SendIcon />
          </IconButton>
        )}
      </div>
    </div>
  )
}
