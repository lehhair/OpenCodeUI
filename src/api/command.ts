// ============================================
// Command API - 命令列表
// ============================================

import { get } from './http'
import { formatPathForApi } from '../utils/directoryUtils'

export interface Command {
  name: string
  description?: string
  keybind?: string
}

/**
 * 获取可用命令列表
 */
export async function getCommands(directory?: string): Promise<Command[]> {
  return get<Command[]>('/command', { directory: formatPathForApi(directory) })
}
