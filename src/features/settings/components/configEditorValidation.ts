import type { Config } from '../../../types/api/config'
import { KNOWN_ROOT_KEYS, MODEL_STATUS, PERMISSION_ACTIONS } from './configEditorMeta'
import type { JsonRecord, SectionID } from './configEditorTypes'

export type ValidationError = { path: string; segments?: string[]; message: string }
export type ValidationDrillTarget = { section: SectionID; stack: { id: string; title: string }[]; key: string }

export function validateConfig(config: Config, lang: string, original?: Config): ValidationError[] {
  const errors: ValidationError[] = []
  const root = config as JsonRecord
  const originalRoot = (original ?? {}) as JsonRecord
  const add = (path: string, en: string, zh: string, segments?: string[]) => errors.push({ path, segments, message: tx(en, zh, lang) })
  const requireString = (path: string, value: unknown, segments?: string[]) => {
    if (typeof value !== 'string') add(path, 'must be a string', '必须是字符串', segments)
  }
  const requireStringArray = (path: string, value: unknown, segments?: string[]) => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) add(path, 'must be an array of strings', '必须是字符串数组', segments)
  }
  const requireStringMap = (path: string, value: unknown, segments?: string[]) => {
    if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string')) add(path, 'must be an object with string values', '必须是字符串值对象', segments)
  }
  const requireBooleanMap = (path: string, value: unknown) => {
    if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'boolean')) add(path, 'must be an object with boolean values', '必须是布尔值对象')
  }
  const requireAction = (path: string, value: unknown) => {
    if (!PERMISSION_ACTIONS.includes(String(value))) add(path, 'must be ask, allow, or deny', '必须是 ask、allow 或 deny')
  }

  if (root.logLevel !== undefined && !['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(String(root.logLevel))) add('logLevel', 'must be DEBUG, INFO, WARN, or ERROR', '必须是 DEBUG、INFO、WARN 或 ERROR')
  if (root.share !== undefined && !['manual', 'auto', 'disabled'].includes(String(root.share))) add('share', 'must be manual, auto, or disabled', '必须是 manual、auto 或 disabled')
  if (root.autoupdate !== undefined && typeof root.autoupdate !== 'boolean' && root.autoupdate !== 'notify') add('autoupdate', 'must be true, false, or notify', '必须是 true、false 或 notify')
  for (const key of ['instructions', 'disabled_providers', 'enabled_providers']) if (root[key] !== undefined) requireStringArray(key, root[key])
  if (root.tools !== undefined) requireBooleanMap('tools', root.tools)
  if (root.subagent_depth !== undefined && !isNonNegativeInteger(root.subagent_depth)) add('subagent_depth', 'must be a non-negative integer', '必须是非负整数')

  const server = getObject(config, 'server')
  if (server.port !== undefined && (!isPositiveInteger(server.port) || Number(server.port) > 65535)) add('server.port', 'must be an integer from 1 to 65535', '必须是 1 到 65535 的整数')
  if (server.cors !== undefined) requireStringArray('server.cors', server.cors)

  const skills = getObject(config, 'skills')
  if (skills.paths !== undefined) requireStringArray('skills.paths', skills.paths)
  if (skills.urls !== undefined) requireStringArray('skills.urls', skills.urls)

  const watcher = getObject(config, 'watcher')
  if (watcher.ignore !== undefined) requireStringArray('watcher.ignore', watcher.ignore)

  const positiveIntegerPaths: [string, unknown][] = [
    ['tool_output.max_lines', getObject(root, 'tool_output').max_lines],
    ['tool_output.max_bytes', getObject(root, 'tool_output').max_bytes],
    ['attachment.image.max_width', getObject(getObject(root, 'attachment'), 'image').max_width],
    ['attachment.image.max_height', getObject(getObject(root, 'attachment'), 'image').max_height],
    ['attachment.image.max_base64_bytes', getObject(getObject(root, 'attachment'), 'image').max_base64_bytes],
    ['experimental.mcp_timeout', getObject(root, 'experimental').mcp_timeout],
  ]
  for (const [path, value] of positiveIntegerPaths) if (value !== undefined && !isPositiveInteger(value)) add(path, 'must be a positive integer', '必须是正整数')

  const compaction = getObject(root, 'compaction')
  for (const key of ['tail_turns', 'preserve_recent_tokens', 'reserved']) {
    if (compaction[key] !== undefined && !isNonNegativeInteger(compaction[key])) add(`compaction.${key}`, 'must be a non-negative integer', '必须是非负整数')
  }

  const commands = getObject(config, 'command')
  for (const [commandID, commandValue] of Object.entries(commands)) {
    const command = isRecord(commandValue) ? commandValue : {}
    if (typeof command.template !== 'string') add(`command.${commandID}.template`, 'must be a string', '必须是字符串', ['command', commandID, 'template'])
  }

  for (const referenceKey of ['references', 'reference']) {
    const references = getObject(root, referenceKey)
    const originalReferences = getObject(originalRoot, referenceKey)
    for (const [alias, entry] of Object.entries(references)) {
      const previous = originalReferences[alias]
      const previousType = isRecord(previous) ? ('path' in previous ? 'local' : 'git') : 'string'
      const nextType = isRecord(entry) ? ('path' in entry ? 'local' : 'git') : 'string'
      if (isRecord(previous) && isRecord(entry) && previousType !== nextType) {
        add(`${referenceKey}.${alias}.type`, 'cannot switch a saved git/local reference shape through the merge API; add a new alias instead', '不能通过 merge API 切换已保存的 git/local 引用形态；请改用新的 alias', [referenceKey, alias, 'type'])
      }
    }
  }

  const permission = root.permission
  if (typeof permission === 'string') requireAction('permission', permission)
  else if (isRecord(permission)) {
    for (const [tool, value] of Object.entries(permission)) {
      if (typeof value === 'string') {
        if (!PERMISSION_ACTIONS.includes(value)) add(`permission.${tool}`, 'must be ask, allow, or deny', '必须是 ask、allow 或 deny', ['permission', tool])
      } else if (isRecord(value)) {
        for (const [pattern, action] of Object.entries(value)) if (!PERMISSION_ACTIONS.includes(String(action))) add(`permission.${tool}.${pattern}`, 'must be ask, allow, or deny', '必须是 ask、allow 或 deny', ['permission', tool, pattern])
      } else add(`permission.${tool}`, 'must be an action or pattern map', '必须是动作或 pattern map', ['permission', tool])
    }
  }

  const providers = getObject(config, 'providers')
  for (const [providerID, providerValue] of Object.entries(providers)) {
    const providerPath = ['providers', providerID]
    const provider = isRecord(providerValue) ? providerValue : {}
    for (const key of ['env', 'whitelist', 'blacklist']) if (provider[key] !== undefined) requireStringArray(`provider.${providerID}.${key}`, provider[key], [...providerPath, key])
    const options = getObject(provider, 'options')
    if (options.headers !== undefined) requireStringMap(`provider.${providerID}.options.headers`, options.headers, [...providerPath, 'options', 'headers'])
    for (const key of ['timeout', 'headerTimeout']) {
      const value = options[key]
      if (value !== undefined && value !== false && !isPositiveInteger(value)) add(`provider.${providerID}.options.${key}`, 'must be a positive integer or false', '必须是正整数或 false', [...providerPath, 'options', key])
    }
    if (options.chunkTimeout !== undefined && !isPositiveInteger(options.chunkTimeout)) add(`provider.${providerID}.options.chunkTimeout`, 'must be a positive integer', '必须是正整数', [...providerPath, 'options', 'chunkTimeout'])
    const models = getObject(provider, 'models')
    for (const [modelID, modelValue] of Object.entries(models)) {
      const modelPath = [...providerPath, 'models', modelID]
      const model = isRecord(modelValue) ? modelValue : {}
      if (model.status !== undefined && !MODEL_STATUS.includes(String(model.status))) add(`provider.${providerID}.models.${modelID}.status`, 'must be active, alpha, beta, or deprecated', '必须是 active、alpha、beta 或 deprecated', [...modelPath, 'status'])
      const cost = getObject(model, 'cost')
      if ('cost' in model) {
        for (const key of ['input', 'output']) if (cost[key] === undefined) add(`provider.${providerID}.models.${modelID}.cost.${key}`, 'is required', '必填', [...modelPath, 'cost', key])
        for (const key of ['input', 'output', 'cache_read', 'cache_write']) if (cost[key] !== undefined && !isFiniteNumber(cost[key])) add(`provider.${providerID}.models.${modelID}.cost.${key}`, 'must be a number', '必须是数字', [...modelPath, 'cost', key])
        const over = getObject(cost, 'context_over_200k')
        if ('context_over_200k' in cost) {
          for (const key of ['input', 'output']) if (over[key] === undefined) add(`provider.${providerID}.models.${modelID}.cost.context_over_200k.${key}`, 'is required', '必填', [...modelPath, 'cost', 'context_over_200k', key])
          for (const key of ['input', 'output', 'cache_read', 'cache_write']) if (over[key] !== undefined && !isFiniteNumber(over[key])) add(`provider.${providerID}.models.${modelID}.cost.context_over_200k.${key}`, 'must be a number', '必须是数字', [...modelPath, 'cost', 'context_over_200k', key])
        }
      }
      const limit = getObject(model, 'limit')
      if ('limit' in model) {
        for (const key of ['context', 'output']) if (limit[key] === undefined) add(`provider.${providerID}.models.${modelID}.limit.${key}`, 'is required', '必填', [...modelPath, 'limit', key])
        for (const key of ['context', 'input', 'output']) if (limit[key] !== undefined && !isFiniteNumber(limit[key])) add(`provider.${providerID}.models.${modelID}.limit.${key}`, 'must be a number', '必须是数字', [...modelPath, 'limit', key])
      }
      if (model.headers !== undefined) requireStringMap(`provider.${providerID}.models.${modelID}.headers`, model.headers, [...modelPath, 'headers'])
    }
  }

  const mcps = getObject(config, 'mcp')
  const originalMcps = getObject(originalRoot, 'mcp')
  for (const [name, value] of Object.entries(mcps)) {
    const mcpPath = ['mcp', name]
    const mcp = isRecord(value) ? value : {}
    const originalMcp = isRecord(originalMcps[name]) ? (originalMcps[name] as JsonRecord) : {}
    const originalType = typeof originalMcp.type === 'string' ? originalMcp.type : 'enabled-only'
    const nextType = typeof mcp.type === 'string' ? mcp.type : 'enabled-only'
    if (Object.prototype.hasOwnProperty.call(originalMcps, name) && originalType !== nextType) add(`mcp.${name}.type`, 'cannot switch saved MCP entry shape through the merge API; add a new entry or reset before saving', '不能通过 merge API 切换已保存 MCP 条目形态；请新增条目或保存前 Reset', ['mcp', name, 'type'])
    if (mcp.enabled !== undefined && typeof mcp.enabled !== 'boolean') add(`mcp.${name}.enabled`, 'must be a boolean', '必须是布尔值', [...mcpPath, 'enabled'])
    if ('enabled' in mcp && !('type' in mcp)) continue
    if (mcp.type === 'local') requireStringArray(`mcp.${name}.command`, mcp.command, [...mcpPath, 'command'])
    else if (mcp.type === 'remote') requireString(`mcp.${name}.url`, mcp.url, [...mcpPath, 'url'])
    else add(`mcp.${name}.type`, 'must be local or remote, or use enabled-only shape', '必须是 local 或 remote，或使用 enabled-only 形态', [...mcpPath, 'type'])
    if (mcp.environment !== undefined) requireStringMap(`mcp.${name}.environment`, mcp.environment, [...mcpPath, 'environment'])
    if (mcp.cwd !== undefined && typeof mcp.cwd !== 'string') add(`mcp.${name}.cwd`, 'must be a string', '必须是字符串', ['mcp', name, 'cwd'])
    if (mcp.headers !== undefined) requireStringMap(`mcp.${name}.headers`, mcp.headers, [...mcpPath, 'headers'])
    if (mcp.timeout !== undefined && !isPositiveInteger(mcp.timeout)) add(`mcp.${name}.timeout`, 'must be a positive integer', '必须是正整数', [...mcpPath, 'timeout'])
  }

  const formatter = root.formatter
  if (isRecord(formatter)) {
    if (Object.keys(formatter).length === 0 && !isRecord(originalRoot.formatter)) add('formatter', 'custom mode requires at least one formatter entry', 'custom 模式至少需要一个 formatter 条目')
    for (const [name, value] of Object.entries(formatter)) {
      const formatterPath = ['formatter', name]
      const entry = isRecord(value) ? value : {}
      if (entry.command !== undefined) requireStringArray(`formatter.${name}.command`, entry.command, [...formatterPath, 'command'])
      if (entry.extensions !== undefined) requireStringArray(`formatter.${name}.extensions`, entry.extensions, [...formatterPath, 'extensions'])
      if (entry.environment !== undefined) requireStringMap(`formatter.${name}.environment`, entry.environment, [...formatterPath, 'environment'])
      if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') add(`formatter.${name}.disabled`, 'must be a boolean', '必须是布尔值', [...formatterPath, 'disabled'])
    }
  }

  const lsp = root.lsp
  const originalLsp = getObject(originalRoot, 'lsp')
  if (isRecord(lsp)) {
    if (Object.keys(lsp).length === 0 && !isRecord(originalRoot.lsp)) add('lsp', 'custom mode requires at least one LSP entry', 'custom 模式至少需要一个 LSP 条目')
    for (const [name, value] of Object.entries(lsp)) {
      const lspPath = ['lsp', name]
      const entry = isRecord(value) ? value : {}
      const originalEntry = isRecord(originalLsp[name]) ? (originalLsp[name] as JsonRecord) : {}
      if ('command' in originalEntry && entry.disabled === true && !('command' in entry)) add(`lsp.${name}.mode`, 'cannot switch a saved custom LSP entry to disabled-only through the merge API; set disabled=true in custom mode instead', '不能通过 merge API 把已保存 custom LSP 切成 disabled-only；请在 custom 模式下设置 disabled=true', [...lspPath, 'mode'])
      if (originalEntry.disabled === true && 'command' in entry && entry.disabled !== false) add(`lsp.${name}.disabled`, 'must be false when switching a saved disabled-only LSP entry to custom command', '已保存 disabled-only LSP 切到 custom command 时必须显式为 false', [...lspPath, 'disabled'])
      if (entry.disabled === true) continue
      requireStringArray(`lsp.${name}.command`, entry.command, [...lspPath, 'command'])
      if (entry.extensions !== undefined) requireStringArray(`lsp.${name}.extensions`, entry.extensions, [...lspPath, 'extensions'])
      if (entry.env !== undefined) requireStringMap(`lsp.${name}.env`, entry.env, [...lspPath, 'env'])
    }
  }
  return errors
}

export function validationDrillTargetForError(error: ValidationError): Omit<ValidationDrillTarget, 'key'> {
  const segments = error.segments?.length ? error.segments : error.path === '$' ? [] : error.path.split('.')
  const section = sectionForValidationPath(error.path, segments)
  const stack: { id: string; title: string }[] = []
  const push = (id: string | undefined, title?: string) => {
    if (!id) return
    stack.push({ id, title: title ?? id })
  }

  if (segments[0] === 'command') push(segments[1] ? `command:${segments[1]}` : undefined, segments[1])
  else if (segments[0] === 'reference') push(segments[1] ? `legacy-reference:${segments[1]}` : undefined, segments[1] ? `@${segments[1]}` : undefined)
  else if (segments[0] === 'references') push(segments[1] ? `reference:${segments[1]}` : undefined, segments[1] ? `@${segments[1]}` : undefined)
  else if (segments[0] === 'plugin' && segments[1]) push(`plugin:${segments[1]}`, 'plugin')
  else if (segments[0] === 'providers' && segments[1]) {
    push(`provider:${segments[1]}`, segments[1])
    const modelIndex = segments.indexOf('models')
    if (modelIndex >= 0) {
      push('models', 'models')
      const modelID = segments[modelIndex + 1]
      push(modelID ? `model:${modelID}` : undefined, modelID)
      const variantIndex = segments.indexOf('variants')
      if (variantIndex >= 0) {
        push('variants', 'variants')
        const variantID = segments[variantIndex + 1]
        push(variantID ? `variant:${variantID}` : undefined, variantID)
      } else if (segments[modelIndex + 2]) push(segments[modelIndex + 2], segments[modelIndex + 2])
    } else if (segments[2]) push(segments[2], segments[2])
  } else if (segments[0] === 'agent') {
    push(segments[1] ? `agent:${segments[1]}` : undefined, segments[1])
    if (segments[2]) push(segments[2], segments[2])
  } else if (segments[0] === 'mcp') {
    push(segments[1] ? `mcp:${segments[1]}` : undefined, segments[1])
    if (['environment', 'headers', 'oauth'].includes(segments[2])) push(segments[2], segments[2])
  }
  else if (segments[0] === 'permission' && segments[1] && segments.length > 2) push(`permission-patterns:${segments[1]}`, `${segments[1]}.patterns`)
  else if (segments[0] === 'formatter') {
    push(segments[1] ? `formatter:${segments[1]}` : undefined, segments[1])
    if (segments[2] === 'environment') push('environment', 'environment')
  } else if (segments[0] === 'lsp') {
    push(segments[1] ? `lsp:${segments[1]}` : undefined, segments[1])
    if (segments[2] === 'env' || segments[2] === 'initialization') push(segments[2], segments[2])
  }
  else if (segments[0] === 'mode') push(segments[1] ? `mode-agent:${segments[1]}` : undefined, segments[1])

  return { section, stack }
}

function sectionForValidationPath(path: string, segments: string[]): SectionID {
  if (path.startsWith('server.')) return 'server'
  if (path.startsWith('command.')) return 'commands'
  if (path.startsWith('provider.')) return 'providers'
  if (path.startsWith('agent.')) return 'agents'
  if (path.startsWith('mcp.')) return 'mcp'
  if (path.startsWith('permission.')) return 'permissions'
  if (path.startsWith('formatter.')) return 'formatters'
  if (path.startsWith('lsp.')) return 'lsp'
  if (path.startsWith('attachment.')) return 'attachments'
  if (path.startsWith('tool_output.') || path.startsWith('compaction.') || path.startsWith('watcher.') || path.startsWith('enterprise.')) return 'runtime'
  if (path.startsWith('experimental.')) return 'experimental'
  if (path.startsWith('reference.') || path.startsWith('references.') || path.startsWith('skills.')) return 'skills'
  if (path === '$schema' || path === 'autoshare' || path === 'layout' || path.startsWith('mode.')) return 'compatibility'
  if (segments[0] && !KNOWN_ROOT_KEYS.has(segments[0])) return 'advanced'
  return 'general'
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getObject(record: unknown, key: string): JsonRecord {
  if (!isRecord(record)) return {}
  const value = record[key]
  return isRecord(value) ? value : {}
}

function isPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function tx(en: string, zh: string, lang: string) {
  return lang.startsWith('zh') ? zh : en
}
