// ============================================
// Mention System Types
// ============================================

/** Mention 类型（reference 是 v2 的命名引用目录，选中后按 folder 附件插入；skill 是 v2 技能提及） */
export type MentionType = 'agent' | 'file' | 'folder' | 'reference' | 'skill'

/** Mention 项目 */
export interface MentionItem {
  type: MentionType
  value: string // 完整值（绝对路径或 agent name）
  displayName: string // 显示名称（文件名或 agent name）
  relativePath?: string // 相对路径（用于显示）
}

/** 解析后的文本片段 */
export interface ParsedSegment {
  type: 'text' | 'mention'
  content: string
  mentionType?: MentionType
  mentionValue?: string // mention 的完整值
}

/** Mention 菜单状态 */
export interface MentionMenuState {
  isOpen: boolean
  query: string // @ 后面的搜索词
  startIndex: number // @ 在文本中的位置
  position?: { x: number; y: number }
}

/** Mention 配置 */
export interface MentionConfig {
  /** 触发字符，默认 @ */
  trigger?: string
  /** 项目根路径，用于生成绝对路径 */
  rootPath?: string
  /** 是否允许多个 mention */
  allowMultiple?: boolean
}

/** 序列化的 mention 格式：[[type:value]] */
export const MENTION_PATTERN = /\[\[(agent|file|folder):([^\]]+)\]\]/g

/** 获取 mention 标记的正则（用于单次匹配） */
export const getMentionPattern = () => /\[\[(agent|file|folder):([^\]]+)\]\]/g
