// ============================================
// File Types — OpenCode v2 原生
//
// ## v1 → v2 的重要变化
//
//   - 列目录：v1 `file.list` 返回 `FileNode[]`（含 children 的树）；
//     v2 `file.list` 返回 `{ location, data: FileSystemEntry[] }`，
//     `FileSystemEntry = { path, type: 'file' | 'directory' }` —— **扁平列表**，
//     不再有 children 字段，树形结构由 UI 自行组织。
//   - 读文件：v2 `file.read` 返回 `Uint8Array`（原始字节），不再是带
//     patch/hunks 的 JSON。文本解码与 diff 展示改由 UI 处理。
//   - 文件状态：v1 `file.status` 在 v2 移到 `vcs.status`。
//   - **搜索**：v2 删除了 `find.*`（files / symbols / text）。
//     现存的检索入口是 `file.find`（按路径/名称找文件与目录）
//     与 `reference.list`。符号搜索与全文内容搜索在 v2 不存在。
// ============================================

import type {
  FileDiffInfo,
  FileFindOutput,
  FileListOutput,
  FileReadOutput,
  FileSystemEntry,
  FileWriteOutput,
  VcsFileStatus,
} from '@opencode/client/promise'

/** 文件系统条目类型 */
export type FileNodeType = FileSystemEntry['type']

/**
 * 文件系统条目。
 *
 * v2 的 `file.list` / `file.find` 返回扁平条目（只有 path + type），
 * 树形结构（children）由 UI 的 FileExplorer 自行构建。
 */
export type FileNode = FileSystemEntry

export type FileListResponse = FileListOutput

export type FileFindResponse = FileFindOutput

/** `file.read` 返回原始字节 */
export type FileReadBytes = FileReadOutput

/**
 * 文件内容（解码后）。
 *
 * v2 的 `file.read` 返回 `Uint8Array`，没有 v1 的 patch/hunks，
 * 也没有 mimeType / base64 encoding 元信息。因此这里保留原始字节
 * （`bytes`，供媒体预览构造 data URL），并附带解码结果与二进制判断；
 * MIME 由调用方按路径推断。
 */
export interface FileContent {
  path: string
  content: string
  isBinary: boolean
  size: number
  /** 原始字节（v2 的 file.read 输出） */
  bytes: Uint8Array
}

export type FileWriteResponse = FileWriteOutput

/**
 * 文件在版本控制中的状态。
 * v1 的 `File` 在 v2 由 `vcs.status` 提供，形状等价于 FileDiffInfo 去掉 patch。
 */
export type FileStatusItem = VcsFileStatus

/**
 * 可 diff 的文件条目。
 *
 * v2 的 diff 由 `vcs.diff` / `session.diff` 提供，元素是 `FileDiffInfo`：
 * `{ file, patch, additions, deletions, status }`。
 * 这里保留 `before` / `after` 作为 UI 侧的填充位（v2 不返回，供本地预览使用）。
 */
export type FileDiff = FileDiffInfo & {
  before?: string
  after?: string
}

/** 过滤掉缺 file 字段的异常 diff 项 */
export function normalizeFileDiffs(diffs: FileDiffInfo[] | undefined | null): FileDiff[] {
  return (diffs ?? []).filter((diff): diff is FileDiff => typeof diff.file === 'string' && diff.file.length > 0)
}

/** 符号搜索在 v2 已移除；保留类型别名以免旧引用直接报错，值为 never。 */
export type Symbol = never

export type SymbolLocation = never

export type SymbolRange = never

/** 全文内容搜索在 v2 已移除 */
export type TextSearchMatch = never

/** 单个文件的 patch 与 hunks（v2 里 patch 是 unified diff 文本） */
export interface FilePatch {
  hunks: PatchHunk[]
}

export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}
