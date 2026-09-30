// ============================================
// Command API - 命令列表和执行
// ============================================

import { getSDKClient } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { locationInput } from './v2Convert'
import { formatPathForApi } from '../utils/directoryUtils'
import { serverStore } from '../store/serverStore'
import i18n from '../i18n'

export interface Command {
  name: string
  description?: string
  keybind?: string
  source: 'frontend' | 'api'
}

type ApiCommand = Omit<Command, 'source'>

// Frontend-added slash commands that do not come from GET /command.
// These are executed locally or via dedicated session actions.
function getFrontendCommands(): Command[] {
  return [
    { name: 'new', description: i18n.t('commands:slashCommand.newSessionDesc'), source: 'frontend' },
    { name: 'compact', description: i18n.t('commands:slashCommand.compactDesc'), source: 'frontend' },
  ]
}

const COMMAND_CACHE_TTL_MS = 10_000

const commandCache = new Map<string, { data: Command[]; expiresAt: number }>()
const commandInflight = new Map<string, Promise<Command[]>>()

function getCommandCacheKey(directory?: string, serverId?: string): string {
  return `${serverId ?? serverStore.getActiveServerId()}::${i18n.resolvedLanguage || i18n.language}::${formatPathForApi(directory, serverId) ?? ''}`
}

async function fetchCommands(directory?: string, serverId?: string): Promise<Command[]> {
  let apiCommands: ApiCommand[] = []
  try {
    const sdk = getSDKClient(serverId)
    // V1: sdk.command.list({ directory })  → Command[]
    // V2: sdk.command.list({ location })   → { location, data: Command.Info[] }
    const result = await sdk.command.list(locationInput(directory, serverId, 'GET /api/command'))
    apiCommands = result.data
  } catch {
    // Backend unreachable — frontend commands still available
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
 * 执行斜杠命令
 *
 * V1: `POST /session/{id}/command` body `{ command, arguments }`
 * V2: `POST /api/session/{sessionID}/command`（SDK：`session.command`）
 *     body `{ name, text, files?, agents?, skills?, delivery? }`
 *
 * 字段映射：
 *   - `command` → **`name`**（命令名，服务端按名字在 Command 注册表里查）
 *   - `args`    → **`text`**（命令的参数文本）
 *     ⚠️ V2 的 `text` 是**必填**，所以无参数时传空串 `''`（不能省略）。
 *   - V2 新增 `files` / `agents` / `skills`（命令可携带附件与技能）/ `delivery`
 *     （投递语义，缺省走服务端默认）→ 本次不传，保持与 V1 的调用形态一致。
 *
 * ⚠️ 语义说明（**这是 V1→V2 最容易误解的一处**）：
 *   - V1：端点把命令**当成一条 prompt 消息**执行，并**同步返回**这一轮创建出来的
 *     assistant 消息（`{ info, parts }`）—— 调用方直接拿到回复。
 *   - V2：端点**按名字立即执行**命令（`Command.Service.execute`：查命令定义 →
 *     用 `text` 渲染模板 → 立刻跑起来），**返回 204 无内容**。
 *     也就是说「执行」这件事本身没变，但**不再同步返回消息** ——
 *     这一轮的进度/结果只能从事件流（`session.*` 事件）里看。
 *   错误也走这个链路：命令不存在 → `CommandNotFoundError`；执行失败 → `CommandExecutionError`。
 *
 * ⚠️ 目录参数：session 作用域端点**不接受**目录（目录由 session 行本身决定），
 *    所以 `directory` 这里用不上，保留位置只为不改签名（调用方 `useChatSession` 传了 5 个参数）。
 */
export async function executeCommand(
  sessionId: string,
  command: string,
  args: string = '',
  _directory?: string,
  serverId?: string,
): Promise<unknown> {
  // sessionId 可能是 `serverId::sessionId` 复合 key，先解析出目标服务器与裸 id
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)

  await sdk.session.command({
    sessionID: target.sessionId,
    name: command,
    text: args,
  })

  // V2 返回 204 无内容（V1 返回的是被创建的消息对象）；调用方不读返回值
  return undefined
}
