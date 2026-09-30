// ============================================
// Server Workspaces - 按服务器管理的工作区目录（统一存储）
//
// 工作区数据复用 per-server storage 的 `opencode-saved-directories`
// （与单服务器模式完全相同的存储），多服务器只是显示层面的按服务器分组。
// ============================================

import { serverStorage } from './perServerStorage'
import { isSameDirectory, normalizeToForwardSlash } from './directoryUtils'
import type { SavedDirectory } from '../contexts/DirectoryContext.shared'

export const SAVED_DIRECTORIES_KEY = 'opencode-saved-directories'

/** 读取某服务器的工作区目录列表（规范化 + 去重，避免同目录不同格式导致 key 重复） */
export function readServerWorkspaces(serverId: string): string[] {
  const saved = serverStorage.getJSONFor<SavedDirectory[]>(SAVED_DIRECTORIES_KEY, serverId)
  if (!Array.isArray(saved)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const d of saved) {
    if (!d || typeof d.path !== 'string') continue
    const normalized = normalizeToForwardSlash(d.path)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

/** 读取某服务器的 saved-directories 原始条目 */
export function readServerSavedDirectories(serverId: string): SavedDirectory[] {
  const saved = serverStorage.getJSONFor<SavedDirectory[]>(SAVED_DIRECTORIES_KEY, serverId)
  return Array.isArray(saved) ? saved : []
}

/** 添加工作区目录到某服务器（规范化 + 去重，与 addDirectory 数据格式一致） */
export function addServerWorkspace(serverId: string, directory: string): boolean {
  const normalized = normalizeToForwardSlash(directory)
  if (!normalized || normalized === '.') return false
  const saved = readServerSavedDirectories(serverId)
  if (saved.some(d => isSameDirectory(d.path, normalized))) return false
  serverStorage.setJSONFor(
    SAVED_DIRECTORIES_KEY,
    [
      ...saved,
      {
        path: normalized,
        name: directory.split(/[\\/]/).pop() || normalized,
        addedAt: Date.now(),
      },
    ],
    serverId,
  )
  return true
}

/** 重排某服务器的工作区（写入 per-server saved-directories） */
export function reorderServerWorkspaces(serverId: string, draggedPath: string, targetPath: string): void {
  const saved = readServerSavedDirectories(serverId)
  const next = [...saved]
  const from = next.findIndex(d => isSameDirectory(d.path, draggedPath))
  const to = next.findIndex(d => isSameDirectory(d.path, targetPath))
  if (from === -1 || to === -1) return
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  serverStorage.setJSONFor(SAVED_DIRECTORIES_KEY, next, serverId)
}
