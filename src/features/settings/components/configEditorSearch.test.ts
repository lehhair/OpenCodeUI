import { describe, expect, it } from 'vitest'
import { filterSettingsSearchItems } from '../settingsSearchCatalog'
import { buildConfigEditorSearchItems, navigationForConfigSegments, sectionForConfigSegments } from './configEditorSearch'

describe('config editor search', () => {
  it('indexes raw JSON paths and non-sensitive values', () => {
    const items = buildConfigEditorSearchItems({
      // v2 的配置顶层键是 providers（复数）
      providers: {
        'openai.custom': {
          options: {
            apiKey: 'top-secret-value',
            baseURL: 'https://gateway.example.com',
            headers: {
              Cookie: 'session-cookie-value',
              'X-Auth': 'private-header-value',
            },
          },
          models: {
            'gpt.4': { reasoning: true },
          },
        },
      },
    }, 'en')

    expect(items.some(item => item.label === 'providers["openai.custom"].options.baseURL')).toBe(true)
    expect(filterSettingsSearchItems(items, 'gateway.example.com')).toHaveLength(1)
    expect(filterSettingsSearchItems(items, 'top-secret-value')).toHaveLength(0)
    expect(filterSettingsSearchItems(items, 'session-cookie-value')).toHaveLength(0)
    expect(filterSettingsSearchItems(items, 'private-header-value')).toHaveLength(0)
    expect(items.find(item => item.label.endsWith('.apiKey'))?.description).toBe('[sensitive value hidden]')
  })

  it('keeps dotted dynamic ids intact when restoring drill paths', () => {
    expect(navigationForConfigSegments(['providers', 'openai.custom', 'models', 'gpt.4', 'reasoning'])).toEqual({
      section: 'providers',
      stack: [
        { id: 'provider:openai.custom', title: 'openai.custom' },
        { id: 'models', title: 'models' },
        { id: 'model:gpt.4', title: 'gpt.4' },
      ],
      fieldKey: 'reasoning',
    })
  })

  it('maps compatibility mode and unknown JSON fields to reachable sections', () => {
    expect(navigationForConfigSegments(['mode', 'legacy.agent', 'model'])).toEqual({
      section: 'compatibility',
      stack: [
        { id: 'mode', title: 'mode' },
        { id: 'mode-agent:legacy.agent', title: 'legacy.agent' },
      ],
      fieldKey: 'model',
    })
    expect(sectionForConfigSegments(['future_option'])).toBe('advanced')
  })

  it('maps plugin tuples and disabled-only LSP entries to rendered controls', () => {
    expect(navigationForConfigSegments(['plugin', '0', '0'])).toEqual({
      section: 'plugins',
      stack: [{ id: 'plugin:0', title: 'plugin' }],
      fieldKey: 'name',
    })
    expect(navigationForConfigSegments(['plugin', '0', '1', 'custom'])).toEqual({
      section: 'plugins',
      stack: [{ id: 'plugin:0', title: 'plugin' }, { id: 'options', title: 'options' }],
      fieldKey: 'options',
    })

    const items = buildConfigEditorSearchItems({ lsp: { eslint: { disabled: true } } }, 'en')
    expect(items.find(item => item.label === 'lsp.eslint.disabled')?.fieldKey).toBe('mode')
  })

  it('maps attachment and scalar reference values to their local field keys', () => {
    expect(navigationForConfigSegments(['attachment', 'image', 'max_width']).fieldKey).toBe('max_width')
    const items = buildConfigEditorSearchItems({ references: { docs: 'https://example.com/docs' } }, 'en')
    expect(items.find(item => item.label === 'references.docs')?.fieldKey).toBe('value')
  })

  it('matches complete long and deeply nested raw JSON values', () => {
    const longValue = `${'x'.repeat(200)}-searchable-suffix`
    const config: Record<string, unknown> = {}
    let cursor = config
    for (let depth = 0; depth < 16; depth += 1) {
      const next: Record<string, unknown> = {}
      cursor[`level${depth}`] = next
      cursor = next
    }
    cursor.value = longValue

    const items = buildConfigEditorSearchItems(config, 'en')
    expect(filterSettingsSearchItems(items, 'searchable-suffix')).toHaveLength(1)
  })

  it('always includes all config sections in search results', () => {
    const items = buildConfigEditorSearchItems({}, 'zh-CN')
    const sections = items.filter(item => item.source === 'section')
    expect(sections).toHaveLength(16)
    expect(sections.some(item => item.label === '渠道与模型')).toBe(true)
    expect(items.some(item => item.label === 'autoupdate' && item.source === 'field')).toBe(true)
  })
})
