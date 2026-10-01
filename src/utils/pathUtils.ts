// ============================================
// 路径工具
//
// v2 的文件条目只有 `{ path, type }`，没有 v1 的 `name` / `absolute`，
// 因此展示名与绝对路径需要由调用方派生。
//
// 放在 utils 而不是 api 层：这些是纯函数，不该经由 api 桶文件导出，
// 否则任何 mock 了 api 模块的测试都会拿到 undefined。
// ============================================

/** 从路径取 basename（兼容 / 与 \） */
export function fileBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

/** 把（根相对的）条目路径拼成绝对路径 */
export function toAbsoluteFilePath(path: string, directory?: string): string {
  if (!directory) return path
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path
  const separator = directory.includes('\\') ? '\\' : '/'
  const base = directory.replace(/[\\/]+$/, '')
  return `${base}${separator}${path.replace(/\//g, separator)}`
}

/** 统一分隔符为 /，去掉前导 ./ */
export function normalizePathSeparators(path: string): string {
  let result = path.replace(/\\/g, '/')
  if (result.startsWith('./')) result = result.slice(2)
  return result
}
