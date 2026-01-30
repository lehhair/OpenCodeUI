import type { Attachment } from '../features/attachment'

// ============================================
// DOM Helpers for ContentEditable
// ============================================

/**
 * 获取编辑器的纯文本内容
 * Tag 节点会被序列化为其文本内容（@xxx）
 */
export function getEditorText(editor: HTMLElement): string {
  let text = ''
  
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.classList.contains('mention-tag')) {
        // Tag 直接取文本内容
        text += el.textContent || ''
      } else {
        el.childNodes.forEach(walk)
      }
    }
  }
  
  editor.childNodes.forEach(walk)
  return text
}

/**
 * 获取编辑器中所有 Tag 的位置范围
 */
export function getTagRanges(editor: HTMLElement): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let offset = 0
  
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length || 0
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.classList.contains('mention-tag')) {
        const text = el.textContent || ''
        ranges.push({ start: offset, end: offset + text.length })
        offset += text.length
      } else {
        el.childNodes.forEach(walk)
      }
    }
  }
  
  editor.childNodes.forEach(walk)
  return ranges
}

export function getCursorPosition(editor: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(editor)
  preCaretRange.setEnd(range.endContainer, range.endOffset)
  return preCaretRange.toString().length
}

/**
 * 设置光标位置
 */
export function setCursorPosition(editor: HTMLElement, position: number): void {
  const selection = window.getSelection()
  if (!selection) return
  
  // 简化实现：遍历文本节点找到位置
  const textNodes: Text[] = []
  const collectTextNodes = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.classList.contains('mention-tag')) {
        // Tag 视为原子，创建一个虚拟文本节点占位
        // 实际上我们跳过 Tag 内部
      } else {
        node.childNodes.forEach(collectTextNodes)
      }
    }
  }
  editor.childNodes.forEach(collectTextNodes)
  
  let currentOffset = 0
  for (const textNode of textNodes) {
    const len = textNode.length
    if (currentOffset + len >= position) {
      const range = document.createRange()
      try {
        range.setStart(textNode, position - currentOffset)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
      } catch {
        // 忽略错误
      }
      return
    }
    currentOffset += len
  }
  
  // 如果没找到，放到末尾
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * 重建编辑器内容，保留已有的 Tag
 */
export function rebuildEditorWithText(
  editor: HTMLElement, 
  newText: string, 
  attachments: Attachment[]
): void {
  // 按 textRange.start 排序的 mention attachments
  // 只有通过 @ 引用的附件才有 textRange
  const mentionAttachments = attachments
    .filter(a => a.textRange)
    .sort((a, b) => (a.textRange?.start || 0) - (b.textRange?.start || 0))
  
  if (mentionAttachments.length === 0) {
    // 没有 mention，直接设置文本
    editor.textContent = newText
    return
  }
  
  // 检查 attachment 的位置是否还在新文本中有效
  // 如果新文本中对应位置的内容不匹配，就不重建那个 Tag
  editor.innerHTML = ''
  let lastIndex = 0
  
  for (const attachment of mentionAttachments) {
    if (!attachment.textRange) continue
    const { start, end, value } = attachment.textRange
    
    // 检查新文本中对应位置是否匹配
    const textAtPosition = newText.slice(start, end)
    if (textAtPosition !== value) {
      // 不匹配，跳过这个 Tag
      continue
    }
    
    // 添加 Tag 之前的文本
    if (start > lastIndex) {
      editor.appendChild(document.createTextNode(newText.slice(lastIndex, start)))
    }
    
    // 创建 Tag
    const span = document.createElement('span')
    span.contentEditable = 'false'
    span.className = `mention-tag mention-tag-${attachment.type}`
    span.dataset.attachmentId = attachment.id
    span.dataset.mentionType = attachment.type
    span.dataset.mentionValue = attachment.url || attachment.agentName || ''
    span.textContent = value
    editor.appendChild(span)
    
    lastIndex = end
  }
  
  // 添加剩余文本
  if (lastIndex < newText.length) {
    editor.appendChild(document.createTextNode(newText.slice(lastIndex)))
  }
}

/**
 * 从编辑器 DOM 同步附件状态（更新 textRange）
 * 确保 state 中的位置与 DOM 保持一致
 */
export function syncAttachmentsFromEditor(
  editor: HTMLElement, 
  currentAttachments: Attachment[]
): Attachment[] {
  const newAttachments: Attachment[] = []
  const seenIds = new Set<string>()
  
  let currentOffset = 0
  
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      currentOffset += node.textContent?.length || 0
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.classList.contains('mention-tag')) {
        const id = el.dataset.attachmentId
        const text = el.textContent || ''
        
        if (id) {
          const original = currentAttachments.find(a => a.id === id)
          if (original) {
            // Clone and update range
            newAttachments.push({
              ...original,
              textRange: {
                value: text,
                start: currentOffset,
                end: currentOffset + text.length
              }
            })
            seenIds.add(id)
          }
        }
        currentOffset += text.length
      } else {
        el.childNodes.forEach(walk)
      }
    }
  }
  
  editor.childNodes.forEach(walk)
  
  // Keep non-mention attachments (images, etc)
  const nonMentionAttachments = currentAttachments.filter(a => !a.textRange)
  
  return [...newAttachments, ...nonMentionAttachments]
}
