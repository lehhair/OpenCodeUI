import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDownIcon, SendIcon, StopIcon, ImageIcon, AgentIcon, ThinkingIcon } from '../../../components/Icons'
import { DropdownMenu, MenuItem, IconButton, AnimatedPresence } from '../../../components/ui'
import { isTauri } from '../../../utils/tauri'
import type { ApiAgent } from '../../../api/client'

interface InputToolbarProps {
  agents: ApiAgent[]
  selectedAgent?: string
  onAgentChange?: (agentName: string) => void
  
  variants?: string[]
  selectedVariant?: string
  onVariantChange?: (variant: string | undefined) => void
  
  supportsImages?: boolean
  onImageUpload: (files: FileList | null) => void
  
  isStreaming?: boolean
  onAbort?: () => void
  
  canSend: boolean
  onSend: () => void
}

export function InputToolbar({ 
  agents,
  selectedAgent,
  onAgentChange,
  variants = [],
  selectedVariant,
  onVariantChange,
  supportsImages = false,
  onImageUpload,
  isStreaming,
  onAbort,
  canSend,
  onSend,
}: InputToolbarProps) {
  // State for menus
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [variantMenuOpen, setVariantMenuOpen] = useState(false)
  
  // Refs
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const agentMenuRef = useRef<HTMLDivElement>(null)
  const variantTriggerRef = useRef<HTMLButtonElement>(null)
  const variantMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Tauri 原生文件选择器
  const handleImageClick = useCallback(async () => {
    if (!isTauri()) {
      // 浏览器模式：走 <input type="file">
      fileInputRef.current?.click()
      return
    }

    try {
      // 动态导入 Tauri 插件
      const [{ open }, { readFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
      ])

      const selected = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
      })

      if (!selected || selected.length === 0) return

      const files: File[] = []
      for (const path of selected) {
        const fileName = path.split(/[\\/]/).pop() || 'image'
        const ext = fileName.split('.').pop()?.toLowerCase() || 'png'
        const mimeMap: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
        }
        const mime = mimeMap[ext] || 'image/png'

        const data = await readFile(path)
        const file = new File([data], fileName, { type: mime })
        files.push(file)
      }

      if (files.length > 0) {
        // 构造 FileList 传给 onImageUpload（保持接口一致）
        const dt = new DataTransfer()
        files.forEach(f => dt.items.add(f))
        onImageUpload(dt.files)
      }
    } catch (err) {
      console.warn('[InputToolbar] Tauri file picker error:', err)
    }
  }, [onImageUpload])

  // Click outside logic
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node) && !agentTriggerRef.current?.contains(e.target as Node)) {
        setAgentMenuOpen(false)
      }
      if (variantMenuRef.current && !variantMenuRef.current.contains(e.target as Node) && !variantTriggerRef.current?.contains(e.target as Node)) {
        setVariantMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  const selectableAgents = agents.filter(a => a.mode === 'primary' && !a.hidden)
  const currentAgent = agents.find(a => a.name === selectedAgent)

  return (
    <div className="flex items-center justify-between px-3 pb-3 relative">
      {/* Left side: Agent + Variant selectors */}
      <div className="flex items-center gap-2">
        {/* Agent Selector */}
        <AnimatedPresence show={selectableAgents.length > 1}>
          <div className="relative">
            <button
              ref={agentTriggerRef}
              onClick={() => setAgentMenuOpen(!agentMenuOpen)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer"
            >
              <span className="text-text-400" style={currentAgent?.color ? { color: currentAgent.color } : undefined}>
                <AgentIcon />
              </span>
              <span className="text-xs text-text-300 capitalize">{selectedAgent || 'build'}</span>
              <span className="text-text-400"><ChevronDownIcon /></span>
            </button>

            <DropdownMenu triggerRef={agentTriggerRef} isOpen={agentMenuOpen} position="top" align="left">
              <div ref={agentMenuRef}>
                {selectableAgents.map(agent => (
                  <MenuItem
                    key={agent.name}
                    label={agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}
                    description={agent.description}
                    icon={<span style={agent.color ? { color: agent.color } : undefined}><AgentIcon /></span>}
                    selected={selectedAgent === agent.name}
                    onClick={() => { onAgentChange?.(agent.name); setAgentMenuOpen(false) }}
                  />
                ))}
              </div>
            </DropdownMenu>
          </div>
        </AnimatedPresence>

        {/* Variant Selector */}
        <AnimatedPresence show={variants.length > 0}>
          <div className="relative">
            <button
              ref={variantTriggerRef}
              onClick={() => setVariantMenuOpen(!variantMenuOpen)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer"
            >
              <span className="text-text-400"><ThinkingIcon /></span>
              <span className="text-xs text-text-300">
                {selectedVariant ? selectedVariant.charAt(0).toUpperCase() + selectedVariant.slice(1) : 'Default'}
              </span>
              <span className="text-text-400"><ChevronDownIcon /></span>
            </button>

            <DropdownMenu triggerRef={variantTriggerRef} isOpen={variantMenuOpen} position="top" align="left">
              <div ref={variantMenuRef}>
                <MenuItem
                  label="Default"
                  icon={<ThinkingIcon />}
                  selected={!selectedVariant}
                  onClick={() => { onVariantChange?.(undefined); setVariantMenuOpen(false) }}
                />
                {variants.map(variant => (
                  <MenuItem
                    key={variant}
                    label={variant.charAt(0).toUpperCase() + variant.slice(1)}
                    icon={<ThinkingIcon />}
                    selected={selectedVariant === variant}
                    onClick={() => { onVariantChange?.(variant); setVariantMenuOpen(false) }}
                  />
                ))}
              </div>
            </DropdownMenu>
          </div>
        </AnimatedPresence>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1">
        <AnimatedPresence show={supportsImages}>
          <>
            {/* 浏览器模式下的隐藏文件输入 */}
            {!isTauri() && (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onImageUpload(e.target.files)}
              />
            )}
            <IconButton aria-label="Upload image" onClick={handleImageClick}>
              <ImageIcon />
            </IconButton>
          </>
        </AnimatedPresence>
        {isStreaming ? (
          <IconButton aria-label="Stop generation" variant="solid" onClick={onAbort}>
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton aria-label="Send message" variant="solid" disabled={!canSend} onClick={onSend}>
            <SendIcon />
          </IconButton>
        )}
      </div>
    </div>
  )
}
