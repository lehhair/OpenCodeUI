// ============================================
// LSP / Formatter API — OpenCode v2
//
// ## v2 已移除运行时状态查询
//
// v1 有 `lsp.status()` 与 `formatter.status()`，返回运行中的语言服务器
// 与格式化器清单。**v2 不存在这两个端点**：
//   - 整个 v2 客户端没有 `lsp` / `formatter` 命名空间
//   - `lsp` / `formatter` 只作为**配置字段**存在于 ConfigInfo
//     （`lsp?: boolean | {...}`、`formatter?: boolean | {...}`）
//   - 因此 UI 无法再显示「LSP 已连接 / 格式化器可用」这类运行时状态
//
// 本文件保留同名导出以免调用点悬空，但一律返回「无运行时信息」。
// UI 若需要表达 LSP/格式化器的开启情况，应读取配置而非调用这些函数。
// ============================================

export interface LSPStatus {
  running: boolean
  language?: string
  capabilities?: string[]
}

export interface FormatterStatus {
  available: boolean
  name?: string
}

/**
 * v2 无 LSP 运行时状态端点；恒为未运行。
 */
export async function getLspStatus(_directory?: string, _serverId?: string): Promise<LSPStatus> {
  return { running: false }
}

/**
 * v2 无格式化器运行时状态端点；恒为不可用。
 */
export async function getFormatterStatus(_directory?: string, _serverId?: string): Promise<FormatterStatus> {
  return { available: false }
}
