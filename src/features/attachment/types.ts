export type AttachmentType = 'file' | 'folder' | 'agent' | 'text'

/**
 * 统一的附件类型
 * 支持图片、文件、文件夹、agent
 */
export interface Attachment {
  id: string                    // 唯一标识
  type: AttachmentType
  displayName: string           // 显示名称
  
  // file/folder/image 用
  url?: string                  // file:// URL 或 data URL
  mime?: string                 // MIME 类型
  relativePath?: string         // 相对路径（用于显示和 source.path）
  
  // 文件内容（从 synthetic text part 获取）
  content?: string              // 文件内容预览
  
  // agent 用
  agentName?: string            // agent 名称
  agentDescription?: string     // agent 描述
  
  // 在文本中的位置信息（发送时用于构建 source）
  // 图片没有这个，因为不在文本中
  textRange?: {
    value: string               // @xxx 的文本
    start: number
    end: number
  }
  
  // 附件类别
  category?: 'user' | 'system'
  
  // 原始 Source 对象 (用于展示更多元数据: Symbol, Resource 等)
  originalSource?: any
}
