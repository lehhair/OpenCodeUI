import type { SearchMenuItem } from '../settingsSearchCatalog'
import type { DrillEntry } from './configEditorDrillState'
import { KNOWN_ROOT_KEYS, SECTION_IDS, SECTION_META } from './configEditorMeta'
import type { JsonRecord, Lang, SectionID } from './configEditorTypes'
import { isRecord, tx } from './configEditorUtils'

export interface ConfigEditorSearchItem extends SearchMenuItem {
  section: SectionID
  segments: string[]
  stack: DrillEntry[]
  fieldKey?: string
  source: 'section' | 'field' | 'json'
}

const SENSITIVE_KEY =
  /(?:api.?key|access.?key|private.?key|auth|cookie|credential|pass(?:word)?|secret|session.?key|token)/i
const SENSITIVE_CONTAINER = /^(?:headers?|environment|env)$/i

const KNOWN_FIELD_PATHS = [
  ['model'],
  ['small_model'],
  ['default_agent'],
  ['subagent_depth'],
  ['shell'],
  ['username'],
  ['logLevel'],
  ['share'],
  ['autoupdate'],
  ['snapshot'],
  ['instructions'],
  ['disabled_providers'],
  ['enabled_providers'],
  ['server', 'port'],
  ['server', 'hostname'],
  ['server', 'mdns'],
  ['server', 'mdnsDomain'],
  ['server', 'cors'],
  ['skills', 'paths'],
  ['skills', 'urls'],
  ['attachment', 'image', 'auto_resize'],
  ['attachment', 'image', 'max_width'],
  ['attachment', 'image', 'max_height'],
  ['attachment', 'image', 'max_base64_bytes'],
  ['tool_output', 'max_lines'],
  ['tool_output', 'max_bytes'],
  ['compaction', 'auto'],
  ['compaction', 'prune'],
  ['compaction', 'tail_turns'],
  ['compaction', 'preserve_recent_tokens'],
  ['compaction', 'reserved'],
  ['watcher', 'ignore'],
  ['enterprise', 'url'],
  ['tools'],
  ['experimental', 'batch_tool'],
  ['experimental', 'openTelemetry'],
  ['experimental', 'disable_paste_summary'],
  ['experimental', 'continue_loop_on_deny'],
  ['experimental', 'mcp_timeout'],
  ['experimental', 'primary_tools'],
  ['experimental', 'policies'],
  ['$schema'],
  ['autoshare'],
  ['layout'],
  ['mode'],
]

export function sectionForConfigSegments(segments: string[]): SectionID {
  const root = segments[0]
  if (root === 'server') return 'server'
  if (root === 'command') return 'commands'
  if (root === 'skills' || root === 'references' || root === 'reference') return 'skills'
  if (root === 'plugin') return 'plugins'
  if (root === 'providers') return 'providers'
  if (root === 'agents') return 'agents'
  if (root === 'mcp') return 'mcp'
  if (root === 'permission') return 'permissions'
  if (root === 'formatter') return 'formatters'
  if (root === 'lsp') return 'lsp'
  if (root === 'attachment') return 'attachments'
  if (
    root === 'tool_output' ||
    root === 'compaction' ||
    root === 'watcher' ||
    root === 'enterprise' ||
    root === 'tools'
  )
    return 'runtime'
  if (root === 'experimental') return 'experimental'
  if (root === '$schema' || root === 'autoshare' || root === 'layout' || root === 'mode') return 'compatibility'
  if (root && !KNOWN_ROOT_KEYS.has(root)) return 'advanced'
  return 'general'
}

export function navigationForConfigSegments(segments: string[]) {
  const section = sectionForConfigSegments(segments)
  const stack: DrillEntry[] = []
  const push = (id: string | undefined, title?: string) => {
    if (id) stack.push({ id, title: title ?? id })
  }
  let fieldKey: string | undefined
  const [root, id, third, fourth, fifth, sixth, seventh] = segments

  if (root === 'server') fieldKey = id
  else if (root === 'command') {
    push(id ? `command:${id}` : undefined, id)
    fieldKey = third
  } else if (root === 'references' || root === 'reference') {
    push(
      id ? `${root === 'references' ? 'reference' : 'legacy-reference'}:${id}` : undefined,
      id ? `@${id}` : undefined,
    )
    fieldKey = third
  } else if (root === 'skills') fieldKey = segments.slice(0, 2).join('.')
  else if (root === 'plugin') {
    push(id ? `plugin:${id}` : undefined, 'plugin')
    if (third === '1') {
      push('options', 'options')
      fieldKey = 'options'
    } else fieldKey = 'name'
  } else if (root === 'providers') {
    push(id ? `provider:${id}` : undefined, id)
    if (third === 'options') {
      push('options', 'options')
      if (fourth === 'headers') push('headers', 'headers')
      fieldKey = fourth === 'headers' ? 'headers' : (fourth ?? 'options')
    } else if (third === 'models') {
      push('models', 'models')
      push(fourth ? `model:${fourth}` : undefined, fourth)
      if (fifth === 'variants') {
        push('variants', 'variants')
        push(sixth ? `variant:${sixth}` : undefined, sixth)
        fieldKey = seventh ?? 'disabled'
      } else if (['provider', 'headers', 'options'].includes(fifth)) {
        push(fifth, fifth)
        fieldKey = fifth === 'provider' ? (sixth ?? 'provider') : fifth
      } else fieldKey = fifth
    } else fieldKey = third
  } else if (root === 'agents') {
    push(id ? `agent:${id}` : undefined, id)
    if (['permission', 'tools', 'options'].includes(third)) push(third, third)
    fieldKey = third
  } else if (root === 'mcp') {
    push(id ? `mcp:${id}` : undefined, id)
    if (['environment', 'headers', 'oauth'].includes(third)) push(third, third)
    fieldKey = third
  } else if (root === 'formatter') {
    push(id ? `formatter:${id}` : undefined, id)
    if (third === 'environment') push('environment', 'environment')
    fieldKey = third
  } else if (root === 'lsp') {
    push(id ? `lsp:${id}` : undefined, id)
    if (third === 'env' || third === 'initialization') push(third, third)
    fieldKey = third
  } else if (root === 'attachment') fieldKey = segments[2]
  else if (section === 'runtime') fieldKey = root === 'tools' ? 'tools' : segments.slice(0, 2).join('.')
  else if (root === 'experimental') fieldKey = id
  else if (root === 'mode') {
    push('mode', 'mode')
    push(id ? `mode-agent:${id}` : undefined, id)
    if (['permission', 'tools', 'options'].includes(third)) push(third, third)
    fieldKey = third ?? 'mode'
  } else if (section === 'general' || section === 'compatibility') fieldKey = root

  return { section, stack, fieldKey }
}

function formatConfigPath(segments: string[]) {
  return segments.reduce((path, segment, index) => {
    if (/^\d+$/.test(segment)) return `${path}[${segment}]`
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) return index === 0 ? segment : `${path}.${segment}`
    return `${path}[${JSON.stringify(segment)}]`
  }, '')
}

function previewJsonValue(value: unknown, segments: string[], lang: Lang) {
  if (isSensitivePath(segments)) return tx('[sensitive value hidden]', '[敏感值已隐藏]', lang)
  if (Array.isArray(value)) return tx(`[${value.length} items]`, `[${value.length} 项]`, lang)
  if (isRecord(value)) return tx(`{${Object.keys(value).length} keys}`, `{${Object.keys(value).length} 个字段}`, lang)
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return String(value)
  return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized
}

function isSensitivePath(segments: string[]) {
  return segments.some(segment => SENSITIVE_KEY.test(segment) || SENSITIVE_CONTAINER.test(segment))
}

function searchableJsonValue(value: unknown, segments: string[]) {
  if (isSensitivePath(segments)) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return JSON.stringify(value)
  if (Array.isArray(value) && value.every(item => !isRecord(item) && !Array.isArray(item))) return JSON.stringify(value)
  return ''
}

export function buildConfigEditorSearchItems(config: JsonRecord, lang: Lang): ConfigEditorSearchItem[] {
  const sectionItems = SECTION_IDS.map(section => {
    const meta = SECTION_META[section]
    return {
      id: `section:${section}`,
      label: tx(meta.en, meta.zh, lang),
      description: tx(meta.descEn, meta.descZh, lang),
      tabLabel: tx('Section', '分区', lang),
      section,
      segments: [],
      stack: [],
      source: 'section' as const,
    }
  })
  const itemsByDestination = new Map<string, ConfigEditorSearchItem>()
  const searchTermsByDestination = new Map<string, string[]>()
  const pending: { value: unknown; segments: string[]; parent?: unknown }[] = [{ value: config, segments: [] }]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    const { value, segments, parent } = current
    if (segments.length > 0) {
      const navigation = navigationForConfigSegments(segments)
      if (
        (segments[0] === 'references' || segments[0] === 'reference') &&
        segments.length === 2 &&
        typeof value === 'string'
      ) {
        navigation.fieldKey = 'value'
      }
      if (
        segments[0] === 'lsp' &&
        segments[2] === 'disabled' &&
        isRecord(parent) &&
        parent.disabled === true &&
        !('command' in parent)
      ) {
        navigation.fieldKey = 'mode'
      }
      const destination = JSON.stringify([
        navigation.section,
        navigation.stack.map(entry => entry.id),
        navigation.fieldKey ?? '',
      ])
      const path = formatConfigPath(segments)
      const searchValue = searchableJsonValue(value, segments)
      const existing = itemsByDestination.get(destination)
      if (existing) {
        searchTermsByDestination.get(destination)?.push(path, searchValue)
      } else {
        itemsByDestination.set(destination, {
          id: `json:${JSON.stringify(segments)}`,
          label: path,
          description: previewJsonValue(value, segments, lang),
          tabLabel: tx(SECTION_META[navigation.section].en, SECTION_META[navigation.section].zh, lang),
          section: navigation.section,
          segments,
          stack: navigation.stack,
          fieldKey: navigation.fieldKey,
          source: 'json',
        })
        searchTermsByDestination.set(destination, [searchValue])
      }
    }

    if (Array.isArray(value)) {
      if (value.every(item => !isRecord(item) && !Array.isArray(item))) continue
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: value[index], segments: [...segments, String(index)], parent: value })
      }
    } else if (isRecord(value)) {
      const entries = Object.entries(value)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index]
        pending.push({ value: child, segments: [...segments, key], parent: value })
      }
    }
  }

  const configuredItems = Array.from(itemsByDestination.entries()).map(([destination, item]) => ({
    ...item,
    searchText: searchTermsByDestination.get(destination)?.filter(Boolean).join(' '),
  }))
  const configuredDestinations = new Set(
    configuredItems.map(item => JSON.stringify([item.section, item.stack.map(entry => entry.id), item.fieldKey ?? ''])),
  )
  const availableItems = KNOWN_FIELD_PATHS.flatMap(segments => {
    const navigation = navigationForConfigSegments(segments)
    const destination = JSON.stringify([
      navigation.section,
      navigation.stack.map(entry => entry.id),
      navigation.fieldKey ?? '',
    ])
    if (configuredDestinations.has(destination)) return []
    const path = formatConfigPath(segments)
    return [
      {
        id: `field:${path}`,
        label: path,
        description: tx('Available field', '可配置字段', lang),
        tabLabel: tx(SECTION_META[navigation.section].en, SECTION_META[navigation.section].zh, lang),
        section: navigation.section,
        segments,
        stack: navigation.stack,
        fieldKey: navigation.fieldKey,
        source: 'field' as const,
      },
    ]
  })

  return [...sectionItems, ...configuredItems, ...availableItems]
}
