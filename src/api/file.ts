// ============================================
// 文件系统 API Functions
// 基于 @opencode/client（OpenCode V2）: /api/fs/*、/api/vcs/status
// ============================================
//
// ── V2 端点对照 ────────────────────────────────────────────────────────
//
//   V1                        → V2                         状态
//   --------------------------+----------------------------+------------------
//   `GET /file`               → `GET /api/fs/list`         ✅ 阶段 3a
//   `GET /file/content`       → `GET /api/fs/read/*`       ✅ 阶段 3a
//   `GET /file/status`        → 🔴 删除；替代 `GET /api/vcs/status`  ✅ 阶段 3a
//   `GET /find/file`          → `GET /api/fs/find`         ✅ 阶段 2b
//   `GET /find/symbol`        → 🔴 已删除（V2 不再运行 LSP）→ 阶段 2b 移除
//   `GET /find`（内容搜索）    → 🔴 V2 无对应端点           → 阶段 2b 移除
//
// ⚠️ 上面三个已迁移端点都是 **location 作用域**：目录必须走 `locationInput()`（不要绕过）。
//    漏传**不会报错** —— 实测服务端静默回落到它自己的 `process.cwd()`
//    （用 `opencode serve` 的启动目录验证过），表现为「选了 A 目录却读到 B 目录」。
//
// ── 阶段 3a 的核心：把 V2 的瘦结构补回 V1 形状 ──────────────────────────
//
// V2 的 fs/vcs 端点返回的数据比 V1 **少了前端要用的字段**，而下游（FileExplorer 等）
// 仍按 V1 形状消费（本阶段禁止改 UI 组件）。所以转换全部集中在本文件：
//
//   FileSystemEntry `{path, type}`            → FileNode `{name, path, absolute, type}`（**无 ignored**）
//   裸 `Uint8Array`                           → FileContent `{type, content, mimeType, encoding?}`
//   Vcs.FileStatus `{file, additions, deletions, status}`
//                                             → FileStatusItem `{path, added, removed, status}`
//
// ============================================

import { getSDKClient } from './sdk'
import { locationInput } from './v2Convert'
import { formatPathForApi } from '../utils/directoryUtils'
import { serverStore } from '../store/serverStore'
import type { FileNode, FileContent, FileStatusItem } from './types'

/**
 * 搜索文件或目录（**只搜文件名/目录名**）
 *
 * V2: `GET /api/fs/find`（SDK：`file.find({ query, type, limit, location })`）
 *     description 原文：*"Find recursively ranked filesystem entries"*
 *
 * ⚠️ 目录参数用 `location[directory]` deepObject（`locationInput()`）——
 *    与 `GET /api/session` 的裸 `directory` 不同（见迁移文档 §3.3）。
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
    type: options.type,
    limit: options.limit,
    ...locationInput(options.directory, options.serverId, 'GET /api/fs/find'),
  })
  // ⚠️ V2 返回的是 `{ location, data: FileSystemEntry[] }`（**不是裸数组**）；
  //    本项目只需要路径字符串。
  return result.data.map(entry => entry.path)
}

// ============================================
// 列目录：V1 `GET /file` → V2 `GET /api/fs/list`
// ============================================

/**
 * 根目录结果的短命缓存（V1 就有的优化，迁移时**保留**）
 *
 * 为什么需要：`useChatSession` 会在会话加载时调用 `prefetchRootDirectory()` 预热，
 * 随后 `useFileExplorer` 挂载时再要一次同样的根目录。没有缓存的话预热就是白费一次请求。
 *
 * ⚠️ 行为副作用（V1 就有）：10 秒 TTL 内拿到的可能是缓存。
 *    阶段 3b 的处理：给 `listDirectory()` 增加 `options.force`，
 *    让「自动刷新」链路（`useFileExplorer.softRefresh`）**绕开缓存**强制重拉，
 *    否则 session idle / 窗口聚焦触发刷新时可能最多滞后 10 秒才看到新文件。
 *    预热（`prefetchRootDirectory`）与首次挂载仍走缓存/去重，保持原有的省请求收益。
 */
const ROOT_DIRECTORY_CACHE_TTL_MS = 10_000

const rootDirectoryCache = new Map<string, { data: FileNode[]; expiresAt: number }>()
/** 同一根目录的并发请求合并（去重），避免同时挂载多个面板时打多次 */
const rootDirectoryInflight = new Map<string, Promise<FileNode[]>>()

/** 空串 / `.` / `./` 都表示「location 目录本身」（V1 的约定，V2 同样成立） */
function isRootDirectoryPath(path: string): boolean {
  return path === '' || path === '.' || path === './'
}

/**
 * 根目录缓存键：**必须带上 serverId**，否则多服务器模式下两台服务器的
 * 「未指定目录」会共用同一条缓存（V1 用的是 `serverId ?? 活动服务器`）。
 */
function getRootDirectoryCacheKey(directory?: string, serverId?: string): string {
  return `${serverId ?? serverStore.getActiveServerId()}::${formatPathForApi(directory, serverId) ?? ''}`
}

/** 清空根目录缓存（测试用；也适用于「已知目录内容变了」时主动失效） */
export function clearDirectoryCache(): void {
  rootDirectoryCache.clear()
  rootDirectoryInflight.clear()
}

/**
 * 列出目录内容
 *
 * V2: `GET /api/fs/list`（SDK：`file.list({ path, location })`）
 *     返回 `{ location, data: FileSystemEntry[] }`，entry = `{ path, type: 'file' | 'directory' }`
 *
 * @param path      绝对路径，或**相对 location 的路径**（`''` / `.` 表示 location 根）
 * @param directory location 目录（会话工作区）
 * @param options   `force: true` 时忽略根目录缓存（仍保留并发去重）—— 供「自动刷新」使用
 *
 * ⚠️ 实测（v2.0.19）三件事：
 *   ① `path=''`、`path='.'`、不传 `path` **三者等价**，都返回 location 根目录 ——
 *      所以上游传空串是安全的，不需要改写（这点与迁移文档的担心相反，已在报告里注明）。
 *   ② **目录条目的 `path` 带尾斜杠**（`'src/'`、`'.git/'`），文件条目不带。
 *      必须剥掉，否则：`node.name` 会变成空串（UI 上目录名消失）、
 *      且 `node.path` 与 `fileStatus` 的键（来自 `/api/vcs/status` 的裸文件路径）对不上，
 *      改动状态颜色会整片失效。
 *   ③ 绝对路径 + 未指定 location 时，V1 的做法是「把该绝对路径当成 location，列它的根」
 *      （`ProjectDialog` 靠这个从文件系统里挑项目目录）。V2 沿用同一手法。
 */
export async function listDirectory(
  path: string,
  directory?: string,
  serverId?: string,
  options?: { force?: boolean },
): Promise<FileNode[]> {
  if (!isRootDirectoryPath(path)) {
    return fetchDirectory(path, directory, serverId)
  }

  const key = getRootDirectoryCacheKey(directory, serverId)

  // force（自动刷新链路）跳过 TTL 判定，但仍复用进行中的请求，避免同时打多次
  if (!options?.force) {
    const cached = rootDirectoryCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data
    }
  }

  const inflight = rootDirectoryInflight.get(key)
  if (inflight) {
    return inflight
  }

  const request = fetchDirectory(path, directory, serverId)
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

/** 真正打请求 + 把 V2 的瘦结构补成 V1 的 `FileNode` */
async function fetchDirectory(path: string, directory?: string, serverId?: string): Promise<FileNode[]> {
  const sdk = getSDKClient(serverId)
  const isAbsolute = /^[a-zA-Z]:/.test(path) || path.startsWith('/')

  // V1 行为：给了绝对路径又没给 location → 把该绝对路径本身当成 location 来列
  if (isAbsolute && !directory) {
    const result = await sdk.file.list({
      path: '',
      ...locationInput(path, serverId, 'GET /api/fs/list'),
    })
    return toFileNodes(result.data, path, serverId)
  }

  const result = await sdk.file.list({
    path,
    ...locationInput(directory, serverId, 'GET /api/fs/list'),
  })
  return toFileNodes(result.data, directory, serverId)
}

/**
 * V2 `FileSystemEntry[]` → 内部 `FileNode[]`（V1 形状）
 *
 * 字段差异（V2 只给 `path` + `type`，其余都是前端补的）：
 *   | 字段 | 来源 |
 *   |---|---|
 *   | `name`     | `path` 的最后一段（剥掉目录的尾斜杠后取） |
 *   | `path`     | 原样（相对 location 的路径），仅剥掉目录的尾斜杠 |
 *   | `absolute` | **前端拼接**：location 目录 + `/` + path（V2 不返回绝对路径） |
 *   | `type`     | 原样 |
 *
 * ⛔ **阶段 3b 删除了 `ignored` 字段**（V1 有、V2 没有）：
 *    V1 把 gitignore 命中的条目标成 `ignored: true`，UI 用 `opacity-50` 灰显；
 *    V2 的 `fs/list` 实测**原样列出** gitignore 命中的条目（`.gitignore`、`secret.log`、
 *    `ignored-dir/`、`.git/` 都在列表里），**也没有任何 ignored 标记字段**。
 *    → 决策（KISS，阶段 3b 任务 E-4）：**接受能力丢失**，删掉灰显逻辑与这个字段，
 *      不自己在前端实现 .gitignore 解析（规则复杂度远高于收益）。
 */
function toFileNodes(
  entries: Array<{ path: string; type: 'file' | 'directory' }>,
  directory: string | undefined,
  serverId?: string,
): FileNode[] {
  // location 目录（已按服务器的路径风格格式化、已去尾斜杠、根路径会保留 `/`）
  const base = formatPathForApi(directory, serverId)

  return entries.map(entry => {
    const relativePath = stripTrailingSeparators(entry.path)
    return {
      name: fileNameOf(relativePath),
      path: relativePath,
      absolute: buildAbsolutePath(base, relativePath),
      type: entry.type,
    }
  })
}

/** 剥掉目录条目末尾的分隔符（V2 的目录 `path` 形如 `src/`、`.git/`） */
function stripTrailingSeparators(value: string): string {
  return value.replace(/[/\\]+$/, '')
}

/** 取路径最后一段作为显示名；`.`（location 根自身）没有最后一段，就返回 `.` */
function fileNameOf(relativePath: string): string {
  return relativePath.split(/[/\\]/).pop() || '.'
}

/**
 * 拼接绝对路径（**纯前端行为**：V2 的 `fs/list` 只返回相对路径）
 *
 * 规则：
 *   - 条目本身已经是绝对路径（V2 允许 `path` 传绝对路径，此时条目会原样返回绝对路径）→ 直接用
 *   - 相对路径是 `.` / 空 → 就是 location 目录本身
 *   - 没有 location（服务端会回落到自己的 cwd）→ 前端**无从得知**绝对路径，只能退回相对路径
 *   - 其余 → `location + '/' + 相对路径`
 *
 * ⚠️ 分隔符统一成 `/`：`directory` 可能是 Windows 风格（`C:\repo`），
 *    而下游 `FileExplorer` 的 `toAbsolutePath()` 兜底与 `InputBox` 的 `toFileUrl()`
 *    都按正斜杠处理（`C:/repo/src/a.ts` → `file:///C:/repo/src/a.ts`）。
 */
function buildAbsolutePath(base: string | undefined, relativePath: string): string {
  // 相对路径里的分隔符也统一成正斜杠（Windows 下服务端可能返回 `src\a.ts`）
  const normalizedRelative = relativePath.replace(/\\/g, '/')

  if (/^[a-zA-Z]:\//.test(normalizedRelative) || normalizedRelative.startsWith('/')) {
    return normalizedRelative
  }
  if (!base) return normalizedRelative
  if (normalizedRelative === '.' || normalizedRelative === '') return base.replace(/\\/g, '/')

  const normalizedBase = base.replace(/\\/g, '/')
  if (normalizedBase === '/') return `/${normalizedRelative}`
  return `${normalizedBase.replace(/\/+$/, '')}/${normalizedRelative}`
}

/** 预热根目录（会话加载时调用；命中 `listDirectory` 的根目录缓存） */
export async function prefetchRootDirectory(directory?: string, serverId?: string): Promise<void> {
  await listDirectory('.', directory, serverId)
}

// ============================================
// 读文件：V1 `GET /file/content` → V2 `GET /api/fs/read/*`
// ============================================

/**
 * 单文件预览的大小上限（50 MB）
 *
 * ⚠️ **为什么需要**：V2 的 `fs/read` **没有分块/流式**，SDK 会把整个文件读成
 *    一个 `Uint8Array`；二进制还要再 `encodeBase64()` 一次（内存约 ×1.33），
 *    然后塞进 React state 与预览面板。对超大文件（日志、视频、磁盘镜像）
 *    这会让页面直接卡死甚至 OOM，而且**没有任何报错**。
 *
 * ⚠️ **为什么只能「读完后」判断**：`fs/list` 不返回文件大小，V2 也没有
 *    `stat`/HEAD 之类的端点 → 拿不到「读之前」的大小。所以这里退一步：
 *    读完立刻判断，超限就丢弃并抛出**友好的中文提示**（避免 base64 与渲染这两步的放大）。
 *
 * 下游行为：`useFileExplorer.loadPreview()` 的 `catch` 会把 `e.message` 原样
 *    显示在预览面板的错误区，所以用户看到的是这条中文提示，而不是白屏。
 */
const MAX_FILE_PREVIEW_BYTES = 50 * 1024 * 1024

/** 把字节数格式化成人类可读的 MB（保留 1 位小数） */
function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 读取文件内容
 *
 * V2: `GET /api/fs/read/*`（SDK：`file.read({ path, location })`）
 *     🔴 返回的是**裸字节流**（SDK 内部 `new Uint8Array(await response.arrayBuffer())`），
 *     **不是** V1 那种 `{ type, content, mimeType }` JSON。
 *     所以「文本 or 二进制」「要不要 base64」「mimeType 是什么」全部改由前端判断。
 *
 * @param path      相对 location 的路径（实测绝对路径会 500 —— 服务端只服务 location 内的文件）
 * @param directory location 目录
 *
 * 保留 V1 的 `FileContent` 形状（下游零改动）：
 *   文本 → `{ type:'text',   content: 解码后的字符串, mimeType }`
 *   二进制 → `{ type:'binary', content: base64, encoding:'base64', mimeType }`
 *
 * ⛔ 阶段 3b 已把 V1 的 `diff` / `patch` 两个可选字段从 `FileContent` 类型里删掉：
 *    V2 的 `fs/read` 只给原始字节，改动内容要另走 `/api/vcs/diff`。
 */
export async function getFileContent(path: string, directory?: string, serverId?: string): Promise<FileContent> {
  const sdk = getSDKClient(serverId)
  const bytes = await sdk.file.read({
    path,
    ...locationInput(directory, serverId, 'GET /api/fs/read/*'),
  })

  // 超大文件保护：见 MAX_FILE_PREVIEW_BYTES 的说明（V2 只能读完再判断）
  if (bytes.byteLength > MAX_FILE_PREVIEW_BYTES) {
    throw new Error(
      `文件过大，无法预览：${path}（${formatMegabytes(bytes.byteLength)}，` +
        `上限 ${formatMegabytes(MAX_FILE_PREVIEW_BYTES)}）。` +
        '请用系统默认程序打开，或改用终端查看。',
    )
  }

  return toFileContent(bytes, path)
}

/**
 * 裸字节 → 内部 `FileContent`
 *
 * 判定顺序（**不能只看扩展名**）：
 *   ① 扩展名在「文本表」里 → 文本（`json` / `xml` / `svg` 的 mime 不带 `text/` 前缀，但内容是文本）
 *   ② 扩展名在「二进制表」里 → 二进制
 *   ③ 扩展名未知 → **嗅探前 8KB 是否含 NUL 字节**（含 → 二进制）。
 *      理由：无扩展名的脚本、`Dockerfile`、`.gitignore` 这类文件没有可靠扩展名；
 *      而「含 NUL 字节」是判断「不是 UTF-8 文本」的经典廉价启发式。
 *      没有这一步的话，所有未知类型都会被当成二进制丢给 base64，预览直接变成空白。
 *
 * ⚠️ 未知扩展名的 `mimeType` 统一是 `application/octet-stream`（即使嗅探结果是文本）——
 *    这是刻意的：`mimeType` 只用于「能不能渲染成图片/音视频」与下载时的 blob 类型，
 *    而「文本 vs 二进制」由 `type` / `encoding` 表达。`FileExplorer` 也是先看 `encoding`
 *    再看 `mimeType` 的，所以不会因为 mime 是 octet-stream 就拒绝按文本显示。
 */
function toFileContent(bytes: Uint8Array, path: string): FileContent {
  const extension = extensionOf(path)
  const textMime = TEXT_MIME_BY_EXTENSION[extension]
  const binaryMime = BINARY_MIME_BY_EXTENSION[extension]
  const mimeType = textMime ?? binaryMime ?? UNKNOWN_MIME_TYPE

  const isBinary = textMime ? false : binaryMime ? true : containsNulByte(bytes)

  if (!isBinary) {
    // fatal:false —— 遇到非法 UTF-8 字节用 U+FFFD 替换而不是抛错
    //（V1 服务端同样是宽松解码，不能因为文件里有一个坏字节就让整个预览失败）
    return {
      type: 'text',
      content: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      mimeType,
    }
  }

  return {
    type: 'binary',
    content: encodeBase64(bytes),
    encoding: 'base64',
    mimeType,
  }
}

/** 取小写扩展名；无扩展名或点开头的文件（`.gitignore`）返回空串 → 走嗅探分支 */
function extensionOf(path: string): string {
  const fileName = path.split(/[/\\]/).pop() ?? ''
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

/** 嗅探窗口：前 8KB（够用且不会因为大文件而多拷贝） */
const SNIFF_BYTES = 8192

/** 前 8KB 里是否出现 NUL 字节 —— 是则判定为二进制 */
function containsNulByte(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, SNIFF_BYTES)
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/** base64 分块大小：32 KiB —— 每块单独调用 `String.fromCharCode` */
const BASE64_CHUNK_SIZE = 0x8000

/**
 * `Uint8Array` → base64
 *
 * ⚠️ **不能**用 `String.fromCharCode(...bytes)` 一次性展开：
 *    超过约 6 万个参数就会抛 `RangeError: Maximum call stack size exceeded`，
 *    而这里的调用方会读任意大小的文件（实测构造 200KB 就足以触发）。
 *    所以按 32 KiB 分块，逐块转字符串再拼接，最后 `btoa` 一次。
 *
 * `btoa` 在浏览器与 Tauri webview 里都是全局可用的（jsdom / Node 18+ 也有），
 * 所以不需要按环境分叉。
 */
function encodeBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/**
 * 「扩展名 → mimeType」表（文本类）
 *
 * ⚠️ 有些条目的 mime **不以 `text/` 开头**（`json` / `xml` / `svg`），
 *    但它们的内容确实是 UTF-8 文本，必须走「解码成字符串」而不是 base64。
 *    用「表」而不是 `mime.startsWith('text/')` 判断，就是为了把这一点写明确。
 *
 * ⚠️ `.ts` 特意映射成 `text/typescript`：V2 服务端自己的 content-type 推断会把
 *    `.ts` 认成 **`video/mp2t`**（MPEG 传输流，实测确认）——但 SDK 的 `file.read`
 *    只回 `Uint8Array`、把 content-type 丢掉了，所以这里必须自己写对，
 *    否则 `.ts` 会被当成视频走媒体预览分支。
 */
const TEXT_MIME_BY_EXTENSION: Record<string, string> = {
  // 纯文本 / 配置
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  lock: 'text/plain',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  properties: 'text/plain',
  env: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  // 文档
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/mdx',
  // 数据 / 标记
  json: 'application/json',
  jsonc: 'application/json',
  json5: 'application/json',
  map: 'application/json',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  toml: 'text/toml',
  xml: 'application/xml',
  plist: 'application/xml',
  svg: 'image/svg+xml', // 文本型媒体：FileExplorer 会同时提供「渲染」和「源码」两种视图
  // 前端 / 样式
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  vue: 'text/html',
  svelte: 'text/html',
  astro: 'text/html',
  css: 'text/css',
  scss: 'text/x-scss',
  sass: 'text/x-sass',
  less: 'text/x-less',
  styl: 'text/x-stylus',
  // JS / TS
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/jsx',
  ts: 'text/typescript',
  mts: 'text/typescript',
  cts: 'text/typescript',
  tsx: 'text/tsx',
  // 其它语言
  py: 'text/x-python',
  pyi: 'text/x-python',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  kt: 'text/x-kotlin',
  kts: 'text/x-kotlin',
  scala: 'text/x-scala',
  groovy: 'text/x-groovy',
  gradle: 'text/x-groovy',
  c: 'text/x-c',
  h: 'text/x-c',
  cc: 'text/x-c++',
  cpp: 'text/x-c++',
  cxx: 'text/x-c++',
  hpp: 'text/x-c++',
  hh: 'text/x-c++',
  cs: 'text/x-csharp',
  m: 'text/x-objective-c',
  mm: 'text/x-objective-c++',
  swift: 'text/x-swift',
  dart: 'text/x-dart',
  lua: 'text/x-lua',
  pl: 'text/x-perl',
  pm: 'text/x-perl',
  r: 'text/x-r',
  jl: 'text/x-julia',
  ex: 'text/x-elixir',
  exs: 'text/x-elixir',
  erl: 'text/x-erlang',
  hrl: 'text/x-erlang',
  hs: 'text/x-haskell',
  clj: 'text/x-clojure',
  cljs: 'text/x-clojure',
  fs: 'text/x-fsharp',
  fsx: 'text/x-fsharp',
  vb: 'text/x-vb',
  zig: 'text/x-zig',
  nim: 'text/x-nim',
  sol: 'text/x-solidity',
  // Shell / 构建
  sh: 'text/x-sh',
  bash: 'text/x-sh',
  zsh: 'text/x-sh',
  fish: 'text/x-sh',
  ps1: 'text/x-powershell',
  psm1: 'text/x-powershell',
  bat: 'text/plain',
  cmd: 'text/plain',
  vim: 'text/x-vim',
  tf: 'text/x-terraform',
  tfvars: 'text/x-terraform',
  proto: 'text/x-protobuf',
  graphql: 'text/x-graphql',
  gql: 'text/x-graphql',
  prisma: 'text/x-prisma',
  sql: 'application/sql',
  // 补丁 / diff
  patch: 'text/x-diff',
  diff: 'text/x-diff',
}

/** 「扩展名 → mimeType」表（二进制类）—— 命中即按二进制走 base64 */
const BINARY_MIME_BY_EXTENSION: Record<string, string> = {
  // 图片（svg 是文本，在文本表里）
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  icns: 'image/x-icns',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  // 音频
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wma: 'audio/x-ms-wma',
  mid: 'audio/midi',
  midi: 'audio/midi',
  // 视频
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  // 文档 / 字体
  pdf: 'application/pdf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  // 压缩包 / 安装包
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  tar: 'application/x-tar',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  jar: 'application/java-archive',
  war: 'application/java-archive',
  apk: 'application/vnd.android.package-archive',
  deb: 'application/vnd.debian.binary-package',
  rpm: 'application/x-rpm',
  dmg: 'application/x-apple-diskimage',
  iso: 'application/x-iso9660-image',
  // 可执行 / 目标文件
  exe: 'application/vnd.microsoft.portable-executable',
  dll: 'application/vnd.microsoft.portable-executable',
  so: 'application/x-sharedlib',
  dylib: 'application/x-sharedlib',
  bin: 'application/octet-stream',
  class: 'application/java-vm',
  pyc: 'application/x-python-code',
  pyo: 'application/x-python-code',
  o: 'application/x-object',
  a: 'application/x-archive',
  obj: 'application/x-object',
  wasm: 'application/wasm',
  // 数据库 / 设计稿
  db: 'application/vnd.sqlite3',
  sqlite: 'application/vnd.sqlite3',
  sqlite3: 'application/vnd.sqlite3',
  psd: 'image/vnd.adobe.photoshop',
  blend: 'application/x-blender',
}

/** 扩展名未知时的兜底 mime */
const UNKNOWN_MIME_TYPE = 'application/octet-stream'

// ============================================
// 文件改动状态：V1 `GET /file/status` → V2 `GET /api/vcs/status`
// ============================================

/**
 * 获取文件 git 状态
 *
 * 🔴 V1 的 `GET /file/status` 在 V2 **已删除**，替代品是 `GET /api/vcs/status`。
 *
 * V2: `sdk.vcs.status({ location })` → `{ location, data: Vcs.FileStatus[] }`
 *     item = `{ file, additions, deletions, status: 'added'|'deleted'|'modified' }`
 *     → 映射回 V1 的 `FileStatusItem` = `{ path, added, removed, status }`
 *
 * 字段名映射（**下游按 V1 名字读，不能改**）：
 *   `file` → `path`、`additions` → `added`、`deletions` → `removed`、`status` 原样
 *
 * ⚠️ 实测（v2.0.19）确认的语义：
 *   - `status` 枚举与 V1 完全一致（`added | deleted | modified`），不需要转换
 *   - **未跟踪文件（untracked）会被归为 `added`**，路径**不带**尾斜杠 ——
 *     这正是 `FileExplorer` 用 `node.path` 直接查 `fileStatus` 的前提
 *   - 非 git 目录返回 200 + `data: []`（不报错）
 */
export async function getFileStatus(directory?: string, serverId?: string): Promise<FileStatusItem[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.vcs.status({
    ...locationInput(directory, serverId, 'GET /api/vcs/status'),
  })

  return result.data.map(item => ({
    path: item.file,
    added: item.additions,
    removed: item.deletions,
    status: item.status,
  }))
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

// ============================================
// 阶段 2b 已移除的两个搜索函数
// ============================================
//
//   searchSymbols(query, directory, serverId)
//     → V2 删除了 `GET /find/symbol`（不再运行语言服务器）；
//       且本仓库**没有任何 UI 使用它** → 直接删除，不留报错占位。
//
//   searchText(pattern, directory, serverId)
//     → V2 **没有内容搜索端点**（`GET /api/fs/find` 只搜文件名）；
//       按迁移文档 §9.5「决策 1 = A：移除 UI」处理 → 函数删除，
//       `FileExplorer` 的内容搜索分支与 UI 一并移除。
