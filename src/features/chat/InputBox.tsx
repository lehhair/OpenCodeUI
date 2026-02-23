import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { AttachmentPreview, type Attachment } from '../attachment'
import { MentionMenu, detectMentionTrigger, type MentionMenuHandle, type MentionItem } from '../mention'
import { SlashCommandMenu, type SlashCommandMenuHandle } from '../slash-command'
import { InputToolbar } from './input/InputToolbar'
import { InputFooter } from './input/InputFooter'
import { UndoStatus } from './input/UndoStatus'
import { useImageCompressor } from '../../hooks/useImageCompressor'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import { useMessages } from '../../store/messageStore'
import { getMessageText, type FilePart, type AgentPart } from '../../types/message'
import { useIsMobile } from '../../hooks'
import { ArrowDownIcon, ArrowUpIcon, PermissionListIcon, QuestionIcon } from '../../components/Icons'
import type { ApiAgent } from '../../api/client'
import type { ModelInfo } from '../../api'
import type { Command } from '../../api/command'

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
  supportsImages?: boolean
  // Model（移动端 InputToolbar 用）
  models?: ModelInfo[]
  selectedModelKey?: string | null
  onModelChange?: (modelKey: string, model: ModelInfo) => void
  modelsLoading?: boolean
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
  isAtBottom?: boolean
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
  // Collapsed dialog capsules
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
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
  supportsImages = false,
  models = [],
  selectedModelKey = null,
  onModelChange,
  modelsLoading = false,
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
  isAtBottom = true,
  showScrollToBottom = false,
  onScrollToBottom,
  collapsedPermission,
  collapsedQuestion,
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

  // ============================================
  // 历史消息导航（类终端体验）
  // ============================================
  interface HistoryEntry { text: string; attachments: Attachment[] }

  const messages = useMessages()
  const userHistory = useMemo((): HistoryEntry[] => {
    const entries: HistoryEntry[] = []
    const seen = new Set<string>()
    for (const msg of messages) {
      if (msg.info.role !== 'user') continue
      const t = getMessageText(msg).trim()
      if (!t || seen.has(t)) continue
      seen.add(t)

      // 提取附件（复用 undo 的逻辑）
      const atts: Attachment[] = []
      for (const part of msg.parts) {
        if (part.type === 'file') {
          const fp = part as FilePart
          const isFolder = fp.mime === 'application/x-directory'
          const sourcePath = fp.source && 'path' in fp.source ? fp.source.path :
                            fp.source && 'uri' in fp.source ? (fp.source as any).uri : undefined
          atts.push({
            id: fp.id || crypto.randomUUID(),
            type: isFolder ? 'folder' : 'file',
            displayName: fp.filename || sourcePath || 'file',
            url: fp.url,
            mime: fp.mime,
            relativePath: sourcePath,
            textRange: fp.source?.text ? {
              value: fp.source.text.value,
              start: fp.source.text.start,
              end: fp.source.text.end,
            } : undefined,
          })
        } else if (part.type === 'agent') {
          const ap = part as AgentPart
          atts.push({
            id: ap.id || crypto.randomUUID(),
            type: 'agent',
            displayName: ap.name,
            agentName: ap.name,
            textRange: ap.source ? {
              value: ap.source.value,
              start: ap.source.start,
              end: ap.source.end,
            } : undefined,
          })
        }
      }
      entries.push({ text: t, attachments: atts })
    }
    return entries
  }, [messages])

  // -1 = 未进入历史模式，0 = 最后一条，往上递增
  const historyIndexRef = useRef(-1)
  // 进入历史前暂存用户的输入
  const savedInputRef = useRef<HistoryEntry>({ text: '', attachments: [] })

  // ============================================
  // Mobile Input Dock: 滚动收起/展开
  // ============================================
  // isFocused: textarea 是否聚焦中
  const [isFocused, setIsFocused] = useState(false)

  // 直接计算是否收起（纯派生值）
  const hasContent = text.trim().length > 0 || attachments.length > 0
  const hasPendingDialogs = !!collapsedPermission || !!collapsedQuestion
  const isCollapsed = isMobile
    && !isAtBottom
    && !hasContent
    && !isFocused
    && !hasPendingDialogs

  // 点击胶囊展开：先标记聚焦（阻止收起），等输入框渲染后 focus textarea
  const handleExpandInput = useCallback(() => {
    setIsFocused(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [])

  // textarea focus/blur 追踪
  const handleFocus = useCallback(() => setIsFocused(true), [])
  // blur 延迟：给输入框上方按钮（scroll-to-bottom、undo 等）的 click 事件时间先触发
  // 否则 blur → 收起 → 按钮消失 → click 丢失
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => setIsFocused(false), 150)
  }, [])
  // focus 时清掉 pending 的 blur timer（比如点了按钮后焦点又回到 textarea）
  useEffect(() => {
    if (isFocused && blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
  }, [isFocused])

  // 注册输入框容器用于动画
  useEffect(() => {
    if (registerInputBox) {
      registerInputBox(isCollapsed ? null : inputContainerRef.current)
      return () => registerInputBox(null)
    }
  }, [registerInputBox, isCollapsed])

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
  }, [text, isMobile])

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
    historyIndexRef.current = -1
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
    
    // 历史消息导航（类终端体验）
    // 进入条件：光标在首行 + (内容为空 或 正在浏览历史且内容未被修改)
    if (e.key === 'ArrowUp' && userHistory.length > 0) {
      const ta = textareaRef.current
      if (ta) {
        const cursorAtFirstLine = ta.selectionStart === ta.selectionEnd
          && ta.value.lastIndexOf('\n', ta.selectionStart - 1) === -1

        const inHistory = historyIndexRef.current >= 0
        const currentEntry = inHistory
          ? userHistory[userHistory.length - 1 - historyIndexRef.current]
          : null
        const contentUnmodified = inHistory && currentEntry && text === currentEntry.text

        if (cursorAtFirstLine && (text.trim() === '' || contentUnmodified)) {
          e.preventDefault()
          if (!inHistory) {
            // 刚进入历史模式，暂存当前输入
            savedInputRef.current = { text, attachments: [...attachments] }
          }
          const nextIndex = Math.min(historyIndexRef.current + 1, userHistory.length - 1)
          if (nextIndex !== historyIndexRef.current) {
            historyIndexRef.current = nextIndex
            const entry = userHistory[userHistory.length - 1 - nextIndex]
            setText(entry.text)
            setAttachments(entry.attachments)
          }
          return
        }
      }
    }
    if (e.key === 'ArrowDown' && historyIndexRef.current >= 0) {
      const ta = textareaRef.current
      if (ta) {
        const cursorAtLastLine = ta.selectionStart === ta.selectionEnd
          && ta.value.indexOf('\n', ta.selectionStart) === -1

        const currentEntry = userHistory[userHistory.length - 1 - historyIndexRef.current]
        const contentUnmodified = currentEntry && text === currentEntry.text

        if (cursorAtLastLine && contentUnmodified) {
          e.preventDefault()
          const nextIndex = historyIndexRef.current - 1
          historyIndexRef.current = nextIndex
          if (nextIndex < 0) {
            // 退出历史模式，恢复暂存的输入
            setText(savedInputRef.current.text)
            setAttachments(savedInputRef.current.attachments)
          } else {
            const entry = userHistory[userHistory.length - 1 - nextIndex]
            setText(entry.text)
            setAttachments(entry.attachments)
          }
          return
        }
      }
    }
    
    // 发送消息（读取 keybinding 配置）
    const sendKey = keybindingStore.getKey('sendMessage')
    if (sendKey && matchesKeybinding(e.nativeEvent, sendKey)) {
      e.preventDefault()
      handleSend()
    }
  }, [mentionOpen, slashOpen, mentionQuery, handleSend, text, attachments, userHistory])
  
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
    
    // 用户修改了内容，检查是否应退出历史模式
    if (historyIndexRef.current >= 0) {
      const currentEntry = userHistory[userHistory.length - 1 - historyIndexRef.current]
      if (!currentEntry || newText !== currentEntry.text) {
        historyIndexRef.current = -1
      }
    }
    
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

  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl px-4 pb-4 pointer-events-auto transition-[max-width] duration-300 ease-in-out" style={{ paddingBottom: 'max(16px, var(--safe-area-inset-bottom, 16px))' }}>
        <div className="flex flex-col gap-2">
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
              {showScrollToBottom && !isCollapsed && (
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

          {/* Collapsed Capsule - 移动端收起状态 */}
          {isCollapsed ? (
            <div className="flex items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <button
                type="button"
                onClick={handleExpandInput}
                className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-bg-000/95 backdrop-blur-md border border-border-200/50 shadow-lg shadow-black/5 text-text-300 hover:text-text-200 hover:bg-bg-000 active:scale-95 transition-all"
              >
                <ArrowUpIcon size={14} />
                <span className="text-[11px]">Reply...</span>
              </button>
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
          ) : (
            <>
              {/* Input Container */}
              <div 
                ref={inputContainerRef}
                data-input-box
                className={`bg-bg-000 rounded-2xl relative z-30 transition-all focus-within:outline-none shadow-lg shadow-black/5 ${
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
                  <div className="overflow-hidden">
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
                    <div className="px-4 pt-4 pb-2">
                      <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onScroll={handleScroll}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
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
                      models={models}
                      selectedModelKey={selectedModelKey}
                      onModelChange={onModelChange}
                      modelsLoading={modelsLoading}
                      inputContainerRef={inputContainerRef}
                    />
                  </div>
                </div>
              </div>

              {/* Footer: disclaimer + todo progress — 键盘弹起时被键盘遮挡，无需隐藏 */}
              <InputFooter sessionId={sessionId} onNewChat={onNewChat} inputContainerRef={inputContainerRef} />
            </>
          )}
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
