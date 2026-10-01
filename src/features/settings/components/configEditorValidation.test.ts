import { describe, expect, it } from 'vitest'
import type { Config } from '../../../types/api/config'
import { validateConfig, validationDrillTargetForError } from './configEditorValidation'

describe('config editor validation', () => {
  it('blocks git/local reference shape changes that deep merge cannot remove', () => {
    const original = { references: { docs: { repository: 'owner/repo', branch: 'main' } } } as unknown as Config
    const next = { references: { docs: { path: './docs' } } } as unknown as Config

    expect(validateConfig(next, 'en', original)).toContainEqual(expect.objectContaining({
      path: 'references.docs.type',
      segments: ['references', 'docs', 'type'],
    }))
  })

  it('allows a custom LSP without extensions when command is configured', () => {
    const config = { lsp: { custom: { command: ['custom-lsp'] } } } as unknown as Config

    expect(validateConfig(config, 'en')).toEqual([])
  })

  it('uses structured segments for ids containing dots', () => {
    const errors = validateConfig({ command: { 'release.prod': {} } } as unknown as Config, 'en')
    const target = validationDrillTargetForError(errors[0])

    expect(errors[0].segments).toEqual(['command', 'release.prod', 'template'])
    expect(target.stack[0]).toEqual({ id: 'command:release.prod', title: 'release.prod' })
  })

  it('routes unknown official schema fields to Advanced', () => {
    const target = validationDrillTargetForError({ path: 'future_option', segments: ['future_option'], message: 'unknown field' })

    expect(target.section).toBe('advanced')
  })

  it('keeps dotted provider ids intact in local validation errors', () => {
    const errors = validateConfig({ providers: { 'acme.prod': { options: { timeout: 0 } } } } as unknown as Config, 'en')
    const target = validationDrillTargetForError(errors[0])

    expect(errors[0].segments).toEqual(['providers', 'acme.prod', 'options', 'timeout'])
    expect(target.stack[0]).toEqual({ id: 'provider:acme.prod', title: 'acme.prod' })
  })

  it('rejects an empty custom formatter or LSP mode created from a scalar', () => {
    const original = { formatter: false, lsp: true } as unknown as Config
    const next = { formatter: {}, lsp: {} } as unknown as Config
    const errors = validateConfig(next, 'en', original)

    expect(errors.map(error => error.path)).toEqual(expect.arrayContaining(['formatter', 'lsp']))
  })
})
