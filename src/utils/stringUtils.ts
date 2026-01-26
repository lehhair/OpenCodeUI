export function getInitials(name: string): string {
  const clean = name.replace(/[-_]/g, ' ')
  const parts = clean.split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/**
 * 规范化目录路径用于比较
 * - 统一使用正斜杠
 * - 移除末尾斜杠
 * - 转小写（Windows 路径不区分大小写）
 */
export function normalizeDirectoryPath(dir: string | undefined | null): string {
  if (!dir) return ''
  return dir
    .replace(/\\/g, '/')  // 反斜杠 → 正斜杠
    .replace(/\/+$/, '')  // 移除末尾斜杠
    .toLowerCase()        // Windows 路径不区分大小写
}

/**
 * 比较两个目录路径是否相同
 */
export function isSameDirectory(dir1: string | undefined | null, dir2: string | undefined | null): boolean {
  return normalizeDirectoryPath(dir1) === normalizeDirectoryPath(dir2)
}
