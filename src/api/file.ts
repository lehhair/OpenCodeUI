// ============================================
// File API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - 列目录：v1 返回树形 `FileNode[]`（含 children）；
//     v2 `file.list` 返回 `{ location, data: FileSystemEntry[] }`，
//     元素只有 `{ path, type }` —— **扁平列表**，树形由 UI 构建。
//   - 读文件：v2 `file.read` 返回 **`Uint8Array`**（原始字节），
//     不再是带 patch/hunks 的 JSON。文本解码由调用方做。
//   - 写文件：v2 `file.write({ path, payload: Uint8Array })`。
//   - **搜索**：v2 删除了 `find.*`：
//       `find.files`   → `file.find`（返回条目数组，不是 path 字符串数组）
//       `find.symbols` → **已移除**（符号搜索在 v2 不存在）
//       `find.text`    → **已移除**（无全文检索端点）
//   - 文件 git 状态：v1 `file.status` → v2 `vcs.status`
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { FileContent, FileNode, FileStatusItem } from './types'
import { serverStore } from '../store/serverStore'

const ROOT_DIRECTORY_CACHE_TTL_MS = 10_000

const rootDirectoryCache = new Map<string, { data: FileNode[]; expiresAt: number }>()
const rootDirectoryInflight = new Map<string, Promise<FileNode[]>>()

function isRootDirectoryPath(path: string): boolean {
  return path === '' || path === '.' || path === './'
}

function getRootDirectoryCacheKey(directory?: string, serverId?: string): string {
  return `${serverId ?? serverStore.getActiveServerId()}::${directory ?? ''}`
}

async function fetchDirectory(path: string, directory?: string, serverId?: string): Promise<FileNode[]> {
  const sdk = getSDKClient(serverId)
  const isAbsolute = /^[a-zA-Z]:/.test(path) || path.startsWith('/')

  const result = await sdk.file.list({
    location: locationParam(directory, serverId),
    path: isAbsolute ? path : path,
  })
  return result.data
}

/**
 * 列出目录内容。
 *
 * v2 返回扁平条目（path + type），UI 侧负责组织成树。
 */
export async function listDirectory(path: string, directory?: string, serverId?: string): Promise<FileNode[]> {
  if (!isRootDirectoryPath(path)) {
    return fetchDirectory(path, directory, serverId)
  }

  const key = getRootDirectoryCacheKey(directory, serverId)
  const now = Date.now()
  const cached = rootDirectoryCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  const inflight = rootDirectoryInflight.get(key)
  if (inflight) {
    return inflight
  }

  const request = fetchDirectory('.', directory, serverId)
    .then(data => {
      rootDirectoryCache.set(key, { data, expiresAt: Date.now() + ROOT_DIRECTORY_CACHE_TTL_MS })
      return data
    })
    .finally(() => {
      rootDirectoryInflight.delete(key)
    })

  rootDirectoryInflight.set(key, request)
  return request
}

export async function prefetchRootDirectory(directory?: string, serverId?: string): Promise<void> {
  await listDirectory('.', directory, serverId)
}

/**
 * 搜索文件 / 目录。
 *
 * v1 的 `find.files` 返回 path 字符串数组；v2 的 `file.find` 返回条目数组，
 * 这里投影成 path 数组，保持调用点不变。
 */
export async function searchFiles(
  query: string,
  options: {
    directory?: string
    type?: 'file' | 'directory'
    limit?: number
    serverId?: string
  } = {},
): Promise<string[]> {
  const sdk = getSDKClient(options.serverId)
  const result = await sdk.file.find({
    query,
    location: locationParam(options.directory, options.serverId),
    type: options.type,
    limit: options.limit,
  })
  return result.data.map(entry => entry.path)
}

/**
 * 搜索目录（便捷方法）
 */
export async function searchDirectories(query: string, baseDirectory?: string, limit: number = 50): Promise<string[]> {
  return searchFiles(query, {
    directory: baseDirectory,
    type: 'directory',
    limit,
  })
}

/**
 * 读取文件原始字节。
 */
export async function getFileBytes(path: string, directory?: string, serverId?: string): Promise<Uint8Array> {
  const sdk = getSDKClient(serverId)
  return await sdk.file.read({ path, location: locationParam(directory, serverId) })
}

/**
 * 读取文件内容（文本）。
 *
 * v2 的 `file.read` 返回原始字节，这里解码为文本，
 * 并用 TextDecoder 的 fatal 模式判断是否为二进制。
 */
export async function getFileContent(path: string, directory?: string, serverId?: string): Promise<FileContent> {
  const bytes = await getFileBytes(path, directory, serverId)

  let isBinary = false
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    isBinary = true
  }

  return {
    path,
    content: text,
    isBinary,
    size: bytes.byteLength,
  }
}

/**
 * 写入文件原始字节。
 */
export async function writeFileBytes(
  path: string,
  payload: Uint8Array,
  directory?: string,
  serverId?: string,
): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.file.write({ path, payload, location: locationParam(directory, serverId) })
}

/**
 * 获取文件的版本控制状态。
 *
 * v1 的 `file.status` 在 v2 由 `vcs.status` 提供。
 */
export async function getFileStatus(directory?: string, serverId?: string): Promise<FileStatusItem[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.vcs.status({ location: locationParam(directory, serverId) })
  return result.data
}
