// ============================================
// Command API - 命令列表和执行
// ============================================

import { get, post } from './http'
import { formatPathForApi } from '../utils/directoryUtils'

export interface Command {
  name: string
  description?: string
  keybind?: string
}

/**
 * GET /command - 拉取后端（插件/自定义）命令列表。
 * 不含内置命令（compact、new 等），内置命令由 useBuiltinCommands hook 管理。
 */
export async function getRemoteCommands(directory?: string): Promise<Command[]> {
  return get<Command[]>('/command', { directory: formatPathForApi(directory) })
}

export async function executeCommand(
  sessionId: string,
  command: string,
  args: string = '',
  directory?: string,
): Promise<unknown> {
  return post(
    `/session/${sessionId}/command`,
    { directory: formatPathForApi(directory) },
    { command, arguments: args },
  )
}
