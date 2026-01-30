import { useState, useRef, useEffect, useCallback } from 'react'
import { AttachmentPreview, type Attachment, getMentionText } from '../attachment'
import { MentionMenu, detectMentionTrigger, type MentionMenuHandle, type MentionItem } from '../mention'
import { getEditorText, getTagRanges, getCursorPosition, setCursorPosition, rebuildEditorWithText, syncAttachmentsFromEditor } from '../../utils/editorUtils'
import { InputToolbar } from './input/InputToolbar'
import { UndoStatus } from './input/UndoStatus'
import type { ApiAgent } from '../../api/client'

// ============================================
// Types
// ============================================

export interface InputBoxProps {
  onSend: (text: string, attachments: Attachment[], options?: { agent?: string; variant?: string }) => void
  onAbort?: () => void
  disabled?: boolean
  isStreaming?: boolean
  agents?: ApiAgent[]
  selectedAgent?: string
  onAgentChange?: (agentName: string) => void
  variants?: string[]
  selectedVariant?: string
  onVariantChange?: (variant: string | undefined) => void
  supportsImages?: boolean
  rootPath?: string
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
}

// ============================================
// InputBox Component
// ============================================

export function InputBox({ 
  onSend, 
  onAbort, 
  disabled, 
  isStreaming,
  agents = [],
  selectedAgent,
  onAgentChange,
  variants = [],
  selectedVariant,
  onVariantChange,
  supportsImages = false,
  rootPath = '',
  revertedText,
  revertedAttachments,
  canRedo = false,
  revertSteps = 0,
  onRedo,
  onRedoAll,
  onClearRevert,
  registerInputBox,
}: InputBoxProps) {
  // 文本状态（纯文本，@ mention 用 @path 格式）
  const [text, setText] = useState('')
  // 附件状态（包括图片、文件、文件夹、agent）
  const [attachments, setAttachments] = useState<Attachment[]>([])
  
  // @ Mention 状态
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIndex, setMentionStartIndex] = useState(-1)
  
  // Refs
  const editorRef = useRef<HTMLDivElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<MentionMenuHandle>(null)
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
    if (revertedText !== undefined && editorRef.current) {
      rebuildEditorWithText(editorRef.current, revertedText, revertedAttachments || [])
      
      setText(revertedText)
      setAttachments(revertedAttachments || [])
      
      // 聚焦并移动光标到末尾
      editorRef.current.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editorRef.current)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    } else if (prevRevertedTextRef.current !== undefined && revertedText === undefined && editorRef.current) {
      editorRef.current.innerHTML = ''
      setText('')
      setAttachments([])
    }
    prevRevertedTextRef.current = revertedText
  }, [revertedText, revertedAttachments])

  // 计算
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled

  // ============================================
  // Handlers
  // ============================================

  const handleSend = useCallback(() => {
    if (!canSend) return
    
    // 从 attachments 中找 agent mention（如果有的话用它）
    const agentAttachment = attachments.find(a => a.type === 'agent')
    const mentionedAgent = agentAttachment?.agentName
    
    onSend(text, attachments, {
      agent: mentionedAgent || selectedAgent,
      variant: selectedVariant,
    })
    
    // 清空
    setText('')
    setAttachments([])
    if (editorRef.current) {
      editorRef.current.textContent = ''
    }
    onClearRevert?.()
  }, [canSend, text, attachments, selectedAgent, selectedVariant, onSend, onClearRevert])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
            // 确保路径不会有重复斜杠
            const basePath = (selected.relativePath || selected.displayName).replace(/\/+$/, '')
            const folderPath = basePath + '/'
            updateMentionQueryInEditor(folderPath)
          }
          return
        }
        case 'ArrowLeft': {
          // 返回上一级
          if (mentionQuery.includes('/')) {
            e.preventDefault()
            const parts = mentionQuery.replace(/\/$/, '').split('/')
            parts.pop()
            const parentPath = parts.length > 0 ? parts.join('/') + '/' : ''
            updateMentionQueryInEditor(parentPath)
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
          // 焦点留在编辑器，光标位置不变
          return
      }
    }
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [mentionOpen, mentionQuery, handleSend])
  
  // 更新编辑器中的 @ 查询文本（用于进入/退出文件夹）
  const updateMentionQueryInEditor = useCallback((newQuery: string) => {
    if (!editorRef.current) return
    
    const editor = editorRef.current
    const currentText = getEditorText(editor)
    
    // 替换 @ 开始到当前 query 结束的部分
    const beforeAt = currentText.slice(0, mentionStartIndex)
    const afterQuery = currentText.slice(mentionStartIndex + 1 + mentionQuery.length)
    const newText = beforeAt + '@' + newQuery + afterQuery
    
    // 重建编辑器内容（保留已有的 Tag）
    rebuildEditorWithText(editor, newText, attachments)
    setText(newText)
    setMentionQuery(newQuery)
    
    // 移动光标到 @ 查询末尾
    requestAnimationFrame(() => {
      if (!editorRef.current) return
      const pos = mentionStartIndex + 1 + newQuery.length
      setCursorPosition(editorRef.current, pos)
      editorRef.current.focus()
    })
  }, [mentionStartIndex, mentionQuery, attachments])

  // 状态更新辅助函数
  const updateState = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    
    const newText = getEditorText(editor)
    setText(newText)
    
    // Sync attachments positions from DOM
    setAttachments(prev => syncAttachmentsFromEditor(editor, prev))
    
    // 获取 Tag 位置范围（用于判断 @ 是否在 Tag 内）
    const tagRanges = getTagRanges(editor)
    
    // 检测 @ 触发
    const cursorPos = getCursorPosition(editor)
    const trigger = detectMentionTrigger(newText, cursorPos, '@')
    
    if (trigger) {
      // 检查这个 @ 是否在某个 Tag 内
      const isInsideTag = tagRanges.some(r => 
        trigger.startIndex >= r.start && trigger.startIndex < r.end
      )
      
      if (!isInsideTag) {
        setMentionQuery(trigger.query)
        setMentionStartIndex(trigger.startIndex)
        setMentionOpen(true)
      } else {
        setMentionOpen(false)
      }
    } else {
      setMentionOpen(false)
    }
  }, [])

  const handleInput = useCallback(() => {
    updateState()
  }, [updateState])


  // @ Mention 选择处理
  const handleMentionSelect = useCallback((item: MentionItem & { _enterFolder?: boolean }) => {
    if (!editorRef.current) return
    
    const editor = editorRef.current
    const currentText = getEditorText(editor)
    
    // 如果是进入文件夹（双击或右箭头），更新 query 而不是选中
    if (item._enterFolder && item.type === 'folder') {
      // 确保路径不会有重复斜杠
      const basePath = (item.relativePath || item.displayName).replace(/\/+$/, '')
      const folderPath = basePath + '/'
      const beforeAt = currentText.slice(0, mentionStartIndex)
      const afterQuery = currentText.slice(mentionStartIndex + 1 + mentionQuery.length)
      const newText = beforeAt + '@' + folderPath + afterQuery
      
      // 使用 rebuild 更新，保持现有 tag
      rebuildEditorWithText(editor, newText, attachments)
      setText(newText)
      setMentionQuery(folderPath)
      
      // 移动光标到文件夹路径末尾
      requestAnimationFrame(() => {
        if (!editorRef.current) return
        const pos = mentionStartIndex + 1 + folderPath.length
        setCursorPosition(editorRef.current, pos)
        editorRef.current.focus()
      })
      return
    }
    
    // 构建 @ 显示文本
    const mentionText = item.type === 'agent' 
      ? `@${item.displayName}`
      : `@${item.relativePath || item.displayName}`
    
    // 计算新文本
    const beforeAt = currentText.slice(0, mentionStartIndex)
    const afterQuery = currentText.slice(mentionStartIndex + 1 + mentionQuery.length)
    // 插入 Tag 文本和空格
    const newText = beforeAt + mentionText + ' ' + afterQuery
    
    // 创建附件
    const attachmentId = crypto.randomUUID()
    const attachment: Attachment = {
      id: attachmentId,
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
    
    const nextAttachments = [...attachments, attachment]
    
    // 使用 rebuild 重建整个编辑器内容，这样可以保留之前的 Tag
    rebuildEditorWithText(editor, newText, nextAttachments)
    
    setText(newText)
    setAttachments(nextAttachments)
    setMentionOpen(false)
    
    // 移动光标到 Tag 后面的空格之后
    requestAnimationFrame(() => {
      if (!editorRef.current) return
      const newCursorPos = mentionStartIndex + mentionText.length + 1
      setCursorPosition(editorRef.current, newCursorPos)
      editorRef.current.focus()
    })
  }, [mentionStartIndex, mentionQuery, attachments])

  const handleMentionClose = useCallback(() => {
    setMentionOpen(false)
    editorRef.current?.focus()
  }, [])

  // 图片上传
  const handleImageUpload = useCallback((files: FileList | null) => {
    if (!files || !supportsImages) return
    
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          type: 'file',
          displayName: file.name,
          url: dataUrl,
          mime: file.type,
        }
        setAttachments(prev => [...prev, attachment])
      }
      reader.readAsDataURL(file)
    })
  }, [supportsImages])

  // 删除附件（同时删除文本中的 @ mention）
  const handleRemoveAttachment = useCallback((id: string) => {
    const attachment = attachments.find(a => a.id === id)
    if (!attachment) return
    
    // 如果有 textRange，从文本中删除
    if (attachment.textRange && editorRef.current) {
      const currentText = editorRef.current.textContent || ''
      
      // 简化处理：直接找并删除 mentionText
      const mentionText = getMentionText(attachment)
      const newText = currentText.replace(mentionText + ' ', '').replace(mentionText, '')
      
      editorRef.current.textContent = newText
      setText(newText)
    }
    
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [attachments])

  // 粘贴处理
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault() // 阻止默认 HTML 粘贴，只允许纯文本或文件
    
    // 1. 处理文件
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
          const dt = new DataTransfer()
          imageFiles.forEach(f => dt.items.add(f))
          handleImageUpload(dt.files)
          return
        }
      }
    }
    
    // 2. 处理纯文本
    const text = e.clipboardData.getData('text/plain')
    if (text) {
      if (!editorRef.current) return
      
      const selection = window.getSelection()
      if (!selection || !selection.rangeCount) return
      
      const range = selection.getRangeAt(0)
      if (!editorRef.current.contains(range.commonAncestorContainer)) return

      range.deleteContents()
      const textNode = document.createTextNode(text)
      range.insertNode(textNode)
      
      range.setStartAfter(textNode)
      range.setEndAfter(textNode)
      selection.removeAllRanges()
      selection.addRange(range)
      
      updateState()
    }
  }, [supportsImages, handleImageUpload, updateState])

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
      <div className="mx-auto max-w-3xl px-4 pb-4 pointer-events-auto transition-[max-width] duration-300 ease-in-out">
        <div className="flex flex-col gap-2">
          {/* Revert Status Bar */}
          <UndoStatus 
            canRedo={canRedo} 
            revertSteps={revertSteps} 
            onRedo={onRedo} 
            onRedoAll={onRedoAll} 
          />
          
          {/* Input Container */}
          <div 
            ref={inputContainerRef}
            className={`bg-bg-000 rounded-2xl relative z-30 transition-all focus-within:outline-none cursor-text shadow-2xl shadow-black/5 ${
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
              onClose={handleMentionClose}
            />
            
            <div className="relative">
              <div className="overflow-hidden" style={{ height: 'auto', opacity: 1 }}>
                {/* Attachments Preview */}
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

                {/* Text Input */}
                <div className="px-4 pt-4 pb-2">
                  <div className="relative">
                    <div
                      ref={editorRef}
                      contentEditable
                      onInput={handleInput}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      className="w-full resize-none focus:outline-none focus:ring-0 focus:border-transparent text-text-100 overflow-y-auto custom-scrollbar text-sm max-w-none whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-text-400 empty:before:pointer-events-none"
                      data-placeholder="Reply to Agent (type @ to mention)"
                      style={{ minHeight: '24px', maxHeight: '50vh', outline: 'none' }}
                      tabIndex={0}
                    />
                  </div>
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
                />
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="flex justify-center pt-2 text-text-500">
            <a href="#" className="text-[11px] hover:text-text-300 transition-colors text-center shadow-sm">
              AI can make mistakes. Please double-check responses.
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
