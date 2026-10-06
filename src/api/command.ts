// ============================================
// Command API — OpenCode v2 原生
//
// v1: `sdk.command.list({ directory })` → Command[]
// v2: `command.list({ location })`      → { location, data: CommandInfo[] }
//
// v1: `sdk.session.command({ sessionID, directory, command, arguments })`
// v2: `session.command({ sessionID, name, text })`
//     —— 字段改名：command → name，arguments → text
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import { resolveSessionTarget } from '../utils/sessionKey'
import { formatPathForApi } from '../utils/directoryUtils'
import { serverStore } from '../store/serverStore'
import i18n from '../i18n'
export interface Command {
  name: string
  description?: string
  keybind?: string
  source: 'frontend' | 'api'
}

// 前端本地补的斜杠命令，不来自 command.list。
// undo/redo/fork/export 对应官方客户端命令族（use-session-commands.tsx
// 的 session.undo/redo/fork/export）——它们不走后端 command 路由。
function getFrontendCommands(): Command[] {
  return [
    { name: 'new', description: i18n.t('commands:slashCommand.newSessionDesc'), source: 'frontend' },
    { name: 'compact', description: i18n.t('commands:slashCommand.compactDesc'), source: 'frontend' },
    { name: 'undo', description: i18n.t('commands:slashCommand.undoDesc'), source: 'frontend' },
    { name: 'redo', description: i18n.t('commands:slashCommand.redoDesc'), source: 'frontend' },
    { name: 'fork', description: i18n.t('commands:slashCommand.forkDesc'), source: 'frontend' },
    { name: 'export', description: i18n.t('commands:slashCommand.exportDesc'), source: 'frontend' },
    { name: 'btw', description: i18n.t('commands:slashCommand.btwDesc'), source: 'frontend' },
  ]
}

const COMMAND_CACHE_TTL_MS = 10_000

const commandCache = new Map<string, { data: Command[]; expiresAt: number }>()
const commandInflight = new Map<string, Promise<Command[]>>()

function getCommandCacheKey(directory?: string, serverId?: string): string {
  return `${serverId ?? serverStore.getActiveServerId()}::${i18n.resolvedLanguage || i18n.language}::${formatPathForApi(directory, serverId) ?? ''}`
}

async function fetchCommands(directory?: string, serverId?: string): Promise<Command[]> {
  let apiCommands: Array<{ name: string; description?: string }> = []
  try {
    const sdk = getSDKClient(serverId)
    const result = await sdk.command.list({ location: locationParam(directory, serverId) })
    apiCommands = result.data ?? []
  } catch {
    // 后端不可达时仍提供前端命令
  }
  const frontendCommands = getFrontendCommands()
  const commandsFromApi: Command[] = apiCommands.map(command => ({ ...command, source: 'api' }))
  const apiNames = new Set(commandsFromApi.map(c => c.name))
  return [...commandsFromApi, ...frontendCommands.filter(c => !apiNames.has(c.name))]
}

export async function getCommands(directory?: string, serverId?: string): Promise<Command[]> {
  const key = getCommandCacheKey(directory, serverId)
  const now = Date.now()
  const cached = commandCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  const inflight = commandInflight.get(key)
  if (inflight) {
    return inflight
  }

  const request = fetchCommands(directory, serverId)
    .then(data => {
      commandCache.set(key, { data, expiresAt: Date.now() + COMMAND_CACHE_TTL_MS })
      return data
    })
    .finally(() => {
      commandInflight.delete(key)
    })

  commandInflight.set(key, request)
  return request
}

export async function prefetchCommands(directory?: string, serverId?: string): Promise<void> {
  await getCommands(directory, serverId)
}

/**
 * 执行斜杠命令。
 *
 * v2 的 `session.command` 只按 sessionID 定位（不接受 location），
 * 返回 void（命令通过事件流反馈）。
 */
export async function executeCommand(
  sessionId: string,
  command: string,
  args: string = '',
  _directory?: string,
  serverId?: string,
): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.command({
    sessionID: target.sessionId,
    name: command,
    text: args,
  })
}
