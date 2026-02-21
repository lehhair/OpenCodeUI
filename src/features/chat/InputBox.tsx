import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { AttachmentPreview, type Attachment } from '../attachment'
import { MentionMenu, detectMentionTrigger, type MentionMenuHandle, type MentionItem } from '../mention'
import { SlashCommandMenu, type SlashCommandMenuHandle } from '../slash-command'
import { InputToolbar } from './input/InputToolbar'
import { InputFooter } from './input/InputFooter'
import { UndoStatus } from './input/UndoStatus'
import { type ModelSelectorHandle } from './ModelSelector'
import { useImageCompressor } from '../../hooks/useImageCompressor'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import { useIsMobile } from '../../hooks'
import { ArrowDownIcon, PermissionListIcon, QuestionIcon } from '../../components/Icons'
import type { ApiAgent } from '../../api/client'
import type { Command } from '../../api/command'
import type { ModelInfo } from '../../api'

// ============================================
// Types
// ============================================

export interface CollapsedDialogInfo {
  label: string
  queueLength: number
  onExpand: () => void
}

export interface InputBoxProps {
  onSend: (text: string, attachments: Attachment[], options?: { agent?: string; variant?: string }) => void
  onAbort?: () => void
  onCommand?: (command: string) => void  // 斜杠命令回调，接收完整命令字符串如 "/help"
  onNewChat?: () => void  // 新建对话回调
  disabled?: boolean
  isStreaming?: boolean
  agents?: ApiAgent[]
  selectedAgent?: string
  onAgentChange?: (agentName: string) => void
  variants?: string[]
  selectedVariant?: string
  onVariantChange?: (variant: string | undefined) => void
  models?: ModelInfo[]
  selectedModelKey?: string | null
  onModelChange?: (modelKey: string, model: ModelInfo) => void
  modelsLoading?: boolean
  modelSelectorRef?: React.RefObject<ModelSelectorHandle | null>
  supportsImages?: boolean
  rootPath?: string
  sessionId?: string | null
  // Undo/Redo
  revertedText?: string
  revertedAttachments?: Attachment[]
  canRedo?: boolean
  revertSteps?: number
  onRedo?: () => void
  onRedoAll?: () => void
  onClearRevert?: () => void
  // Animation
  registerInputBox?: (element: HTMLElement | null) => void
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
  // Collapsed dialog capsules
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
  isDocked?: boolean
  onUndock?: () => void
}

// ============================================
// InputBox Component
// ============================================

function InputBoxComponent({ 
  onSend, 
  onAbort,
  onCommand,
  onNewChat,
  disabled, 
  isStreaming,
  agents = [],
  selectedAgent,
  onAgentChange,
  variants = [],
  selectedVariant,
  onVariantChange,
  models = [],
  selectedModelKey = null,
  onModelChange,
  modelsLoading = false,
  modelSelectorRef,
  supportsImages = false,
  rootPath = '',
  sessionId,
  revertedText,
  revertedAttachments,
  canRedo = false,
  revertSteps = 0,
  onRedo,
  onRedoAll,
  onClearRevert,
  registerInputBox,
  showScrollToBottom = false,
  onScrollToBottom,
  collapsedPermission,
  collapsedQuestion,
  isDocked = false,
  onUndock,
}: InputBoxProps) {
  // 文本状态
  const [text, setText] = useState('')
  // 附件状态（图片、文件、文件夹、agent）
  const [attachments, setAttachments] = useState<Attachment[]>([])
  
  // @ Mention 状态
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIndex, setMentionStartIndex] = useState(-1)
  
  // / Slash Command 状态
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashStartIndex, setSlashStartIndex] = useState(-1)
  
  // 响应式 placeholder
  const isMobile = useIsMobile()
  
  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<MentionMenuHandle>(null)
  const slashMenuRef = useRef<SlashCommandMenuHandle>(null)
  const prevRevertedTextRef = useRef<string | undefined>(undefined)

  // 注册输入框容器用于动画
  useEffect(() => {
    if (registerInputBox) {
      registerInputBox(inputContainerRef.current)
      return () => registerInputBox(null)
    }
  }, [registerInputBox])

  // 处理 revert 恢复
  useEffect(() => {
    if (revertedText !== undefined) {
      setText(revertedText)
      setAttachments(revertedAttachments || [])
      // 聚焦并移动光标到末尾
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(revertedText.length, revertedText.length)
      }
    } else if (prevRevertedTextRef.current !== undefined && revertedText === undefined) {
      setText('')
      setAttachments([])
    }
    prevRevertedTextRef.current = revertedText
  }, [revertedText, revertedAttachments])

  // 自动调整 textarea 高度
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (isDocked) return
    
    // 文本为空时重置为最小高度
    if (!text.trim()) {
      textarea.style.height = '24px'
      return
    }
    
    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    // 原生层已处理键盘 resize，window.innerHeight 即可用高度
    const viewportH = window.innerHeight
    // 可用高度 = viewport - header(48px) - toolbar/padding/footer(~100px) - 安全余量
    const maxH = isMobile ? Math.max(80, viewportH - 48 - 100 - 72) : viewportH * 0.35
    textarea.style.height = Math.max(24, Math.min(scrollHeight, maxH)) + 'px'
  }, [text, isMobile, isDocked])

  // 计算
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled

  // ============================================
  // Handlers
  // ============================================

  const handleSend = useCallback(() => {
    if (!canSend) return
    
    // 检测 command attachment
    const commandAttachment = attachments.find(a => a.type === 'command')
    if (commandAttachment && commandAttachment.commandName) {
      // 提取命令后的参数文本
      const textRange = commandAttachment.textRange
      const afterCommand = textRange ? text.slice(textRange.end).trim() : ''
      const commandStr = `/${commandAttachment.commandName}${afterCommand ? ' ' + afterCommand : ''}`
      
      onCommand?.(commandStr)
      setText('')
      setAttachments([])
      onClearRevert?.()
      return
    }
    
    // 从 attachments 中找 agent mention
    const agentAttachment = attachments.find(a => a.type === 'agent')
    const mentionedAgent = agentAttachment?.agentName
    
    onSend(text, attachments, {
      agent: mentionedAgent || selectedAgent,
      variant: selectedVariant,
    })
    
    // 清空
    setText('')
    setAttachments([])
    onClearRevert?.()
  }, [canSend, text, attachments, selectedAgent, selectedVariant, onSend, onCommand, onClearRevert])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash Command 菜单打开时，拦截导航键
    if (slashOpen && slashMenuRef.current) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          slashMenuRef.current.moveUp()
          return
        case 'ArrowDown':
          e.preventDefault()
          slashMenuRef.current.moveDown()
          return
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          slashMenuRef.current.selectCurrent()
          return
        case 'Escape':
          e.preventDefault()
          setSlashOpen(false)
          return
      }
    }
    
    // Mention 菜单打开时，拦截导航键
    if (mentionOpen && mentionMenuRef.current) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          mentionMenuRef.current.moveUp()
          return
        case 'ArrowDown':
          e.preventDefault()
          mentionMenuRef.current.moveDown()
          return
        case 'ArrowRight': {
          // 进入文件夹
          const selected = mentionMenuRef.current.getSelectedItem()
          if (selected?.type === 'folder') {
            e.preventDefault()
            const basePath = (selected.relativePath || selected.displayName).replace(/\/+$/, '')
            const folderPath = basePath + '/'
            updateMentionQuery(folderPath)
          }
          return
        }
        case 'ArrowLeft': {
          // 返回上一级
          if (mentionQuery.includes('/')) {
            e.preventDefault()
            const parts = mentionQuery.replace(/\/$/, '').split('/')
            // 记住当前目录名，返回后定位到它
            const folderName = parts[parts.length - 1]
            if (folderName) {
              mentionMenuRef.current.setRestoreFolder(folderName)
            }
            parts.pop()
            const parentPath = parts.length > 0 ? parts.join('/') + '/' : ''
            updateMentionQuery(parentPath)
          }
          return
        }
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          mentionMenuRef.current.selectCurrent()
          return
        case 'Escape':
          e.preventDefault()
          setMentionOpen(false)
          return
      }
    }
    
    // Tab 键：mention 菜单关闭时，不做任何事（阻止跳到工具栏）
    if (e.key === 'Tab') {
      e.preventDefault()
      return
    }
    
    // 发送消息（读取 keybinding 配置）
    const sendKey = keybindingStore.getKey('sendMessage')
    if (sendKey && matchesKeybinding(e.nativeEvent, sendKey)) {
      e.preventDefault()
      handleSend()
    }
  }, [mentionOpen, slashOpen, mentionQuery, handleSend])
  
  // 更新 @ 查询文本（用于进入/退出文件夹）
  const updateMentionQuery = useCallback((newQuery: string) => {
    if (!textareaRef.current) return
    
    const beforeAt = text.slice(0, mentionStartIndex)
    const afterQuery = text.slice(mentionStartIndex + 1 + mentionQuery.length)
    const newText = beforeAt + '@' + newQuery + afterQuery
    
    setText(newText)
    setMentionQuery(newQuery)
    
    // 移动光标到 @ 查询末尾
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      const pos = mentionStartIndex + 1 + newQuery.length
      textareaRef.current.setSelectionRange(pos, pos)
      textareaRef.current.focus()
    })
  }, [text, mentionStartIndex, mentionQuery])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)
    
    // 同步检测 mention 是否被破坏/删除
    // 比对 attachments 的 textRange：如果文本中对应位置不再匹配，删除该 attachment
    setAttachments(prev => {
      const surviving = prev.filter(a => {
        if (!a.textRange) return true // 图片等无 textRange 的保留
        const { start, end, value } = a.textRange
        const actual = newText.slice(start, end)
        return actual === value
      })
      // 只在数量变化时更新（避免不必要的 re-render）
      return surviving.length === prev.length ? prev : surviving
    })
    
    // 检测 @ 触发
    const cursorPos = e.target.selectionStart || 0
    const trigger = detectMentionTrigger(newText, cursorPos, '@')
    
    if (trigger) {
      setMentionQuery(trigger.query)
      setMentionStartIndex(trigger.startIndex)
      setMentionOpen(true)
      setSlashOpen(false)  // 关闭斜杠菜单
    } else {
      setMentionOpen(false)
      
      // 检测 / 触发（只在行首或空白后）
      const slashTrigger = detectSlashTrigger(newText, cursorPos)
      if (slashTrigger) {
        setSlashQuery(slashTrigger.query)
        setSlashStartIndex(slashTrigger.startIndex)
        setSlashOpen(true)
      } else {
        setSlashOpen(false)
      }
    }
  }, [])

  // @ Mention 选择处理
  const handleMentionSelect = useCallback((item: MentionItem & { _enterFolder?: boolean }) => {
    if (!textareaRef.current) return
    
    // 如果是进入文件夹
    if (item._enterFolder && item.type === 'folder') {
      const basePath = (item.relativePath || item.displayName).replace(/\/+$/, '')
      const folderPath = basePath + '/'
      updateMentionQuery(folderPath)
      return
    }
    
    // 构建 @ 文本
    const mentionText = item.type === 'agent' 
      ? `@${item.displayName}`
      : `@${item.relativePath || item.displayName}`
    
    // 计算新文本
    const beforeAt = text.slice(0, mentionStartIndex)
    const afterQuery = text.slice(mentionStartIndex + 1 + mentionQuery.length)
    const newText = beforeAt + mentionText + ' ' + afterQuery
    
    // 创建附件
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      type: item.type,
      displayName: item.displayName,
      relativePath: item.relativePath,
      url: item.type !== 'agent' ? item.value : undefined,
      mime: item.type !== 'agent' ? 'text/plain' : undefined,
      agentName: item.type === 'agent' ? item.displayName : undefined,
      textRange: {
        value: mentionText,
        start: mentionStartIndex,
        end: mentionStartIndex + mentionText.length,
      },
    }
    
    setText(newText)
    setAttachments(prev => [...prev, attachment])
    setMentionOpen(false)
    
    // 移动光标到 mention 后
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      const newCursorPos = mentionStartIndex + mentionText.length + 1
      textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      textareaRef.current.focus()
    })
  }, [text, mentionStartIndex, mentionQuery, updateMentionQuery])

  const handleMentionClose = useCallback(() => {
    setMentionOpen(false)
    textareaRef.current?.focus()
  }, [])

  // / Slash Command 选择处理 - 类似 @ mention
  const handleSlashSelect = useCallback((command: Command) => {
    if (!textareaRef.current) return
    
    // 构建 /command 文本
    const commandText = `/${command.name}`
    
    // 计算新文本：替换 /query 为 /command
    const beforeSlash = text.slice(0, slashStartIndex)
    const afterQuery = text.slice(slashStartIndex + 1 + slashQuery.length)
    const newText = beforeSlash + commandText + ' ' + afterQuery
    
    // 创建 command attachment
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      type: 'command',
      displayName: command.name,
      commandName: command.name,
      textRange: {
        value: commandText,
        start: slashStartIndex,
        end: slashStartIndex + commandText.length,
      },
    }
    
    setText(newText)
    setAttachments(prev => [...prev, attachment])
    setSlashOpen(false)
    
    // 移动光标到命令后
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      const newCursorPos = slashStartIndex + commandText.length + 1
      textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      textareaRef.current.focus()
    })
  }, [text, slashStartIndex, slashQuery])

  const handleSlashClose = useCallback(() => {
    setSlashOpen(false)
    textareaRef.current?.focus()
  }, [])

  // 图片压缩器（使用 Web Worker）
  const { compress, needsCompression } = useImageCompressor()

  // 图片上传（使用 Web Worker 压缩，避免阻塞主线程）
  const handleImageUpload = useCallback(async (files: FileList | null) => {
    if (!files || !supportsImages) return
    
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      
      try {
        let dataUrl: string
        let mimeType: string
        
        // 小图片直接使用，大图片用 Worker 压缩
        if (!needsCompression(file)) {
          // 小于 500KB，直接读取
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = (e) => resolve(e.target?.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          mimeType = file.type
        } else {
          // 使用 Worker 压缩
          const result = await compress(file)
          dataUrl = result.dataUrl
          mimeType = result.mimeType
        }
        
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          type: 'file',
          displayName: file.name,
          url: dataUrl,
          mime: mimeType,
        }
        setAttachments(prev => [...prev, attachment])
      } catch (err) {
        console.warn('[InputBox] Failed to process image:', err)
      }
    }
  }, [supportsImages, compress, needsCompression])

  // 删除附件
  const handleRemoveAttachment = useCallback((id: string) => {
    const attachment = attachments.find(a => a.id === id)
    if (!attachment) return
    
    // 如果有 textRange，从文本中删除 @mention
    if (attachment.textRange) {
      const { value } = attachment.textRange
      // 删除 @mention 和后面的空格
      const newText = text.replace(value + ' ', '').replace(value, '')
      setText(newText)
    }
    
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [attachments, text])

  // 粘贴处理
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // 处理图片粘贴
    if (supportsImages) {
      const items = e.clipboardData?.items
      const files: File[] = []
      
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file') {
            const file = items[i].getAsFile()
            if (file) files.push(file)
          }
        }
      }
      
      if (files.length > 0) {
        const imageFiles = files.filter(f => f.type.startsWith('image/'))
        if (imageFiles.length > 0) {
          e.preventDefault()
          const dt = new DataTransfer()
          imageFiles.forEach(f => dt.items.add(f))
          handleImageUpload(dt.files)
          return
        }
      }
    }
    
    // 文本粘贴：让 textarea 默认处理（天然支持换行和 undo）
  }, [supportsImages, handleImageUpload])

  // 滚动同步（备用，overlay 内部也监听了 scroll）
  const handleScroll = useCallback(() => {
    // overlay 通过 useEffect 自动同步，这里留空
  }, [])

  // ============================================
  // Render
  // ============================================

  // 计算已选择的 items (用于过滤菜单)
  const excludeValues = new Set<string>()
  attachments.forEach(a => {
    if (a.url) excludeValues.add(a.url)
    if (a.agentName) excludeValues.add(a.agentName)
  })

  if (isDocked) {
    return (
      <div className="pointer-events-auto">
        <button
          type="button"
          onClick={onUndock}
          className="h-10 px-3 rounded-full bg-bg-000/90 border border-border-200/70 shadow-xl shadow-black/15 backdrop-blur-md flex items-center gap-1.5 text-text-200"
          aria-label="Expand input"
        >
          <span className="text-xs font-medium">Reply</span>
          <ArrowDownIcon size={14} className="rotate-180" />
        </button>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl px-3 md:px-4 pb-2 md:pb-4 pointer-events-auto transition-[max-width] duration-300 ease-in-out" style={{ paddingBottom: isMobile ? 'max(8px, var(--safe-area-inset-bottom, 8px))' : 'max(16px, var(--safe-area-inset-bottom, 16px))' }}>
        <div className="flex flex-col gap-1 md:gap-2">
          {(showScrollToBottom || canRedo || collapsedPermission || collapsedQuestion) && (
            <div className={`flex items-center justify-center gap-2`}>
              {/* Collapsed Permission Capsule */}
              {collapsedPermission && (
                <button
                  type="button"
                  onClick={collapsedPermission.onExpand}
                  className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 text-[11px] text-accent-main-000 hover:bg-accent-main-100/20 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-150"
                >
                  <PermissionListIcon size={14} />
                  <span className="whitespace-nowrap">{collapsedPermission.label}</span>
                  {collapsedPermission.queueLength > 1 && (
                    <span className="text-[10px] opacity-70">+{collapsedPermission.queueLength - 1}</span>
                  )}
                </button>
              )}

              {/* Collapsed Question Capsule */}
              {collapsedQuestion && (
                <button
                  type="button"
                  onClick={collapsedQuestion.onExpand}
                  className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 text-[11px] text-accent-main-000 hover:bg-accent-main-100/20 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-150"
                >
                  <QuestionIcon size={14} />
                  <span className="whitespace-nowrap">{collapsedQuestion.label}</span>
                  {collapsedQuestion.queueLength > 1 && (
                    <span className="text-[10px] opacity-70">+{collapsedQuestion.queueLength - 1}</span>
                  )}
                </button>
              )}

              {canRedo && (
                <UndoStatus 
                  canRedo={canRedo} 
                  revertSteps={revertSteps} 
                  onRedo={onRedo} 
                  onRedoAll={onRedoAll} 
                />
              )}
              {showScrollToBottom && (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  className="h-[32px] w-[32px] min-w-[32px] rounded-full bg-accent-main-100/10 border border-accent-main-100/20 backdrop-blur-md flex items-center justify-center text-accent-main-000 hover:bg-accent-main-100/20 transition-colors shrink-0"
                  aria-label="Scroll to bottom"
                >
                  <ArrowDownIcon size={16} />
                </button>
              )}
            </div>
          )}
          
          {/* Input Container */}
          <div 
            ref={inputContainerRef}
            data-input-box
            className={`bg-bg-000 rounded-2xl relative z-30 transition-all focus-within:outline-none shadow-2xl shadow-black/5 ${
              isStreaming 
                ? 'border border-accent-main-100/50 animate-border-pulse' 
                : 'border border-border-200/50'
            }`}
          >
            {/* @ Mention Menu */}
            <MentionMenu
              ref={mentionMenuRef}
              isOpen={mentionOpen}
              query={mentionQuery}
              agents={agents}
              rootPath={rootPath}
              excludeValues={excludeValues}
              onSelect={handleMentionSelect}
              onNavigate={updateMentionQuery}
              onClose={handleMentionClose}
            />
            
            {/* / Slash Command Menu */}
            <SlashCommandMenu
              ref={slashMenuRef}
              isOpen={slashOpen}
              query={slashQuery}
              rootPath={rootPath}
              onSelect={handleSlashSelect}
              onClose={handleSlashClose}
            />
            
            <div className="relative">
              <div className="overflow-visible">
                {/* Attachments Preview - 显示在输入框上方 */}
                <div className={`overflow-hidden transition-all duration-300 ease-out ${
                  attachments.length > 0 ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                }`}>
                  <div className="px-4 pt-3">
                    <AttachmentPreview 
                      attachments={attachments}
                      onRemove={handleRemoveAttachment}
                    />
                  </div>
                </div>

                {/* Text Input - 简单的 textarea，直接显示文本 */}
                <div className="px-3 md:px-4 pt-3 md:pt-4 pb-1.5 md:pb-2">
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onScroll={handleScroll}
                    placeholder={isMobile ? "Reply to Agent..." : "Reply to Agent (type @ to mention, / for commands)"}
                    className="w-full resize-none focus:outline-none focus:ring-0 bg-transparent text-text-100 placeholder:text-text-400 custom-scrollbar"
                    style={{ 
                      ...TEXT_STYLE,
                      minHeight: '24px', 
                      maxHeight: isMobile
                        ? 'calc(var(--app-height, 100vh) - 220px)'
                        : '35vh',
                    }}
                    rows={1}
                  />
                </div>

                {/* Bottom Bar -> InputToolbar */}
                <InputToolbar 
                  models={models}
                  selectedModelKey={selectedModelKey}
                  onModelChange={onModelChange}
                  modelsLoading={modelsLoading}
                  modelSelectorRef={modelSelectorRef}
                  agents={agents}
                  selectedAgent={selectedAgent}
                  onAgentChange={onAgentChange}
                  variants={variants}
                  selectedVariant={selectedVariant}
                  onVariantChange={onVariantChange}
                  supportsImages={supportsImages}
                  onImageUpload={handleImageUpload}
                  isStreaming={isStreaming}
                  onAbort={onAbort}
                  canSend={canSend || false} 
                  onSend={handleSend}
                />
              </div>
            </div>
          </div>

          {/* Footer: disclaimer + todo progress — 键盘弹起时被键盘遮挡，无需隐藏 */}
          <InputFooter sessionId={sessionId} onNewChat={onNewChat} />
        </div>
      </div>
    </div>
  )
}

// ============================================
// 文本样式常量
// ============================================

const TEXT_STYLE: React.CSSProperties = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '14px',
  fontWeight: 400,
  lineHeight: '20px',
  letterSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
}

// ============================================
// detectSlashTrigger - 检测斜杠命令触发
// 只在文本最开头触发
// ============================================

function detectSlashTrigger(text: string, cursorPos: number): { query: string; startIndex: number } | null {
  // 斜杠命令只能在文本最开头
  if (!text.startsWith('/')) return null
  
  // 提取 / 之后到光标的文本作为 query
  const query = text.slice(1, cursorPos)
  
  // 如果 query 中包含空格或换行，说明命令已经输入完毕
  if (query.includes(' ') || query.includes('\n')) {
    return null
  }
  
  return { query, startIndex: 0 }
}

// ============================================
// Export with memo for performance optimization
// ============================================

export const InputBox = memo(InputBoxComponent)
