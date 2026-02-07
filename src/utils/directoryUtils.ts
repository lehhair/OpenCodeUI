// ============================================
// Directory Path Utilities
// 统一的目录路径处理工具
// ============================================
//
// 设计原则：
// 1. 前端内部存储：统一使用正斜杠 (URL友好，跨平台)
// 2. 后端 API 请求：根据 pathMode 决定用正斜杠还是反斜杠
// 3. 路径比较：统一规范化后比较（正斜杠 + 小写 + 无末尾斜杠）
//

// ============================================
// Path Mode Configuration
// ============================================

/**
 * 路径模式
 * - auto: 自动检测（根据后端响应判断）
 * - unix: 强制使用正斜杠 /
 * - windows: 强制使用反斜杠 \
 */
export type PathMode = 'auto' | 'unix' | 'windows'

/**
 * 检测到的实际路径风格
 */
export type DetectedPathStyle = 'unix' | 'windows'

const STORAGE_KEY_PATH_MODE = 'opencode-path-mode'
const STORAGE_KEY_DETECTED_STYLE = 'opencode-detected-path-style'

let _pathMode: PathMode | null = null
let _detectedStyle: DetectedPathStyle | null = null

// Path mode change listeners
type PathModeListener = (mode: PathMode, effectiveStyle: DetectedPathStyle) => void
const _listeners: Set<PathModeListener> = new Set()

/**
 * 订阅路径模式变化
 */
export function subscribePathMode(listener: PathModeListener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

/**
 * 通知所有监听器
 */
function notifyListeners(): void {
  const mode = getPathMode()
  const style = getEffectivePathStyle()
  _listeners.forEach(listener => listener(mode, style))
}

/**
 * 获取当前路径模式设置
 */
export function getPathMode(): PathMode {
  if (_pathMode === null) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PATH_MODE)
      if (saved === 'unix' || saved === 'windows') {
        _pathMode = saved
      } else {
        _pathMode = 'auto' // 默认自动检测
      }
    } catch {
      _pathMode = 'auto'
    }
  }
  return _pathMode
}

/**
 * 设置路径模式
 */
export function setPathMode(mode: PathMode): void {
  _pathMode = mode
  try {
    localStorage.setItem(STORAGE_KEY_PATH_MODE, mode)
  } catch {
    // ignore
  }
  notifyListeners()
}

/**
 * 获取检测到的路径风格
 */
export function getDetectedPathStyle(): DetectedPathStyle {
  if (_detectedStyle === null) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_DETECTED_STYLE)
      _detectedStyle = (saved === 'windows') ? 'windows' : 'unix'
    } catch {
      _detectedStyle = 'unix'
    }
  }
  return _detectedStyle
}

/**
 * 设置检测到的路径风格（由自动检测逻辑调用）
 */
export function setDetectedPathStyle(style: DetectedPathStyle): void {
  const previousStyle = _detectedStyle
  _detectedStyle = style
  try {
    localStorage.setItem(STORAGE_KEY_DETECTED_STYLE, style)
  } catch {
    // ignore
  }
  // 只在 auto 模式且风格变化时通知
  if (getPathMode() === 'auto' && previousStyle !== style) {
    notifyListeners()
  }
}

/**
 * 获取实际生效的路径风格
 * - 如果是 auto 模式，返回检测到的风格
 * - 否则返回用户设置的模式
 */
export function getEffectivePathStyle(): DetectedPathStyle {
  const mode = getPathMode()
  if (mode === 'auto') {
    return getDetectedPathStyle()
  }
  return mode
}

/**
 * 是否为 Windows 路径模式（实际生效的）
 */
export function isWindowsPathMode(): boolean {
  return getEffectivePathStyle() === 'windows'
}

/**
 * 根据当前模式格式化路径用于 API 请求
 * - unix 模式: 转正斜杠
 * - windows 模式: 转反斜杠
 */
export function formatPathForApi(dir: string | undefined | null): string | undefined {
  if (!dir) return undefined
  
  const trimmed = dir.replace(/[/\\]+$/, '') // 移除末尾斜杠
  
  if (isWindowsPathMode()) {
    return trimmed.replace(/\//g, '\\')
  } else {
    return trimmed.replace(/\\/g, '/')
  }
}

/**
 * 从后端响应中检测路径风格
 * 分析路径字符串，判断后端使用的是哪种斜杠风格
 */
export function detectPathStyleFromResponse(path: string | undefined | null): DetectedPathStyle | null {
  if (!path) return null
  
  const backslashCount = (path.match(/\\/g) || []).length
  const forwardSlashCount = (path.match(/\//g) || []).length
  
  // 如果有反斜杠且多于正斜杠，判定为 Windows 风格
  if (backslashCount > 0 && backslashCount >= forwardSlashCount) {
    return 'windows'
  }
  // 如果有正斜杠，判定为 Unix 风格
  if (forwardSlashCount > 0) {
    return 'unix'
  }
  
  return null
}

/**
 * 自动检测并更新路径风格
 * 调用此函数时传入后端返回的路径，会自动更新检测结果
 */
export function autoDetectPathStyle(path: string | undefined | null): void {
  const detected = detectPathStyleFromResponse(path)
  if (detected) {
    setDetectedPathStyle(detected)
  }
}

// ============================================
// Path Normalization (Internal Use)
// ============================================

/**
 * 规范化目录路径为正斜杠格式
 * 用于前端内部存储和 URL
 * 
 * @example
 * normalizeToForwardSlash('E:\\dev\\project') // 'E:/dev/project'
 * normalizeToForwardSlash('E:/dev/project/') // 'E:/dev/project'
 */
export function normalizeToForwardSlash(dir: string | undefined | null): string {
  if (!dir) return ''
  return dir
    .replace(/\\/g, '/')    // 反斜杠 → 正斜杠
    .replace(/\/+$/, '')    // 移除末尾斜杠
}

/**
 * 规范化目录路径用于比较
 * - 统一使用正斜杠
 * - 移除末尾斜杠
 * - 转小写（Windows 路径不区分大小写）
 * 
 * @example
 * normalizeForComparison('E:\\Dev\\Project') // 'e:/dev/project'
 */
export function normalizeForComparison(dir: string | undefined | null): string {
  if (!dir) return ''
  return dir
    .replace(/\\/g, '/')    // 反斜杠 → 正斜杠
    .replace(/\/+$/, '')    // 移除末尾斜杠
    .toLowerCase()          // Windows 路径不区分大小写
}

/**
 * 比较两个目录路径是否相同
 * 处理斜杠、大小写差异
 * 
 * @example
 * isSameDirectory('E:\\dev\\project', 'E:/dev/project') // true
 * isSameDirectory('E:/Dev/Project', 'e:/dev/project') // true
 */
export function isSameDirectory(
  dir1: string | undefined | null, 
  dir2: string | undefined | null
): boolean {
  return normalizeForComparison(dir1) === normalizeForComparison(dir2)
}

/**
 * 从路径中提取目录名（最后一个部分）
 * 
 * @example
 * getDirectoryName('E:/dev/my-project') // 'my-project'
 * getDirectoryName('E:\\dev\\my-project\\') // 'my-project'
 */
export function getDirectoryName(dir: string | undefined | null): string {
  if (!dir) return ''
  const normalized = normalizeToForwardSlash(dir)
  const parts = normalized.split('/').filter(Boolean)
  const name = parts[parts.length - 1] || normalized
  // 解码 URL 编码的中文等字符
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * 检查路径是否是 Windows 绝对路径
 * 
 * @example
 * isWindowsAbsolutePath('E:/dev') // true
 * isWindowsAbsolutePath('/home/user') // false
 */
export function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:/.test(path)
}

/**
 * 检查路径是否是绝对路径（Windows 或 Unix）
 */
export function isAbsolutePath(path: string): boolean {
  return isWindowsAbsolutePath(path) || path.startsWith('/')
}

// ============================================
// Re-export from stringUtils for compatibility
// ============================================

// 保持向后兼容，逐步废弃 stringUtils 中的目录函数
export { normalizeForComparison as normalizeDirectoryPath }
