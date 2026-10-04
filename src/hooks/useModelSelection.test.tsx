import { act, renderHook } from '@testing-library/react'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '../api'
import { STORAGE_KEY_SELECTED_MODEL } from '../constants'
import { useModelSelection } from './useModelSelection'

const storage = new Map<string, string>()
const variantPrefs = new Map<string, string | undefined>()
const sessionSelections = new Map<string, { modelKey: string; variant?: string }>()

vi.mock('../utils/perServerStorage', () => ({
  serverStorage: {
    get: (key: string) => storage.get(key) ?? null,
    set: (key: string, value: string) => {
      storage.set(key, value)
    },
    remove: (key: string) => {
      storage.delete(key)
    },
  },
}))

vi.mock('../utils/modelUtils', () => ({
  getModelKey: (model: Model) => `${model.providerID}:${model.id}`,
  findModelByKey: (models: Model[], key: string) => models.find(m => `${m.providerID}:${m.id}` === key),
  saveModelVariantPref: (key: string, value: string | undefined) => {
    variantPrefs.set(key, value)
  },
  getModelVariantPref: (key: string) => variantPrefs.get(key),
  getSessionModelSelection: (sessionId: string) => sessionSelections.get(sessionId),
  saveSessionModelSelection: (sessionId: string, modelKey: string, variant: string | undefined) => {
    sessionSelections.set(sessionId, variant ? { modelKey, variant } : { modelKey })
  },
}))

const MODELS: Model[] = [
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    providerID: 'openai',
    family: 'gpt',
    enabled: true,
    status: 'active',
    limit: { context: 128000, output: 32000 },
    capabilities: { input: ['text', 'image', 'pdf'], output: ['text'], tools: true },
    variants: [{ id: 'fast' }],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    providerID: 'openai',
    family: 'gpt',
    enabled: true,
    status: 'active',
    limit: { context: 128000, output: 16000 },
    capabilities: { input: ['text', 'image', 'pdf'], output: ['text'], tools: true },
    variants: [{ id: 'balanced' }],
  },
] as unknown as Model[]

describe('useModelSelection', () => {
  beforeEach(() => {
    storage.clear()
    variantPrefs.clear()
    sessionSelections.clear()
  })

  it('falls back to the first model when nothing is persisted', () => {
    const { result } = renderHook(() => useModelSelection({ models: MODELS }))

    expect(result.current.selectedModelKey).toBe('openai:gpt-4.1')
    expect(result.current.currentModel?.name).toBe('GPT-4.1')
  })

  it('restores variant preferences and updates selection', () => {
    storage.set(STORAGE_KEY_SELECTED_MODEL, 'openai:gpt-4o-mini')
    variantPrefs.set('openai:gpt-4o-mini', 'balanced')

    const { result } = renderHook(() => useModelSelection({ models: MODELS }))

    expect(result.current.selectedModelKey).toBe('openai:gpt-4o-mini')
    expect(result.current.selectedVariant).toBe('balanced')

    act(() => {
      result.current.handleVariantChange('fast')
    })

    expect(result.current.selectedVariant).toBe('fast')

    act(() => {
      result.current.handleModelChange('openai:gpt-4.1', MODELS[0])
    })

    expect(result.current.selectedModelKey).toBe('openai:gpt-4.1')
  })

  it('falls back to the first visible model when the persisted model disappears', () => {
    storage.set(STORAGE_KEY_SELECTED_MODEL, 'openai:gpt-4o-mini')

    const { result } = renderHook(() => useModelSelection({ models: [MODELS[0]] }))

    expect(result.current.selectedModelKey).toBe('openai:gpt-4.1')
    expect(storage.get(STORAGE_KEY_SELECTED_MODEL)).toBe('openai:gpt-4.1')
  })

  it('saves variant preference for the resolved fallback model before switching away', () => {
    storage.set(STORAGE_KEY_SELECTED_MODEL, 'openai:gpt-4o-mini')
    variantPrefs.set('openai:gpt-4.1', 'fast')
    variantPrefs.set('openai:gpt-4o-mini', 'balanced')

    const { result } = renderHook(() => useModelSelection({ models: [MODELS[0]] }))

    act(() => {
      result.current.handleModelChange('openai:gpt-4.1', MODELS[0])
    })

    expect(variantPrefs.get('openai:gpt-4.1')).toBe('fast')
    expect(variantPrefs.get('openai:gpt-4o-mini')).toBe('balanced')
  })

  it('persists restored session model to global and session storage', () => {
    storage.set(STORAGE_KEY_SELECTED_MODEL, 'openai:gpt-4o-mini')

    const { result } = renderHook(() => useModelSelection({ models: MODELS, sessionId: 'session-1' }))

    act(() => {
      result.current.restoreFromMessage({ providerID: 'openai', modelID: 'gpt-4.1' }, 'fast')
    })

    expect(result.current.selectedModelKey).toBe('openai:gpt-4.1')
    expect(result.current.selectedVariant).toBe('fast')
    expect(storage.get(STORAGE_KEY_SELECTED_MODEL)).toBe('openai:gpt-4.1')
    expect(sessionSelections.get('session-1')).toEqual({ modelKey: 'openai:gpt-4.1', variant: 'fast' })
  })

  it('restores the last picked model when revisiting a session', () => {
    const { result, rerender } = renderHook(({ sessionId }) => useModelSelection({ models: MODELS, sessionId }), {
      initialProps: { sessionId: 'session-1' as string | null },
    })

    act(() => {
      result.current.handleModelChange('openai:gpt-4o-mini', MODELS[1])
    })

    rerender({ sessionId: null })
    rerender({ sessionId: 'session-1' })

    expect(result.current.selectedModelKey).toBe('openai:gpt-4o-mini')
    expect(sessionSelections.get('session-1')).toEqual({ modelKey: 'openai:gpt-4o-mini' })
  })

  it('does not overwrite the target session storage with the previous session model during restore', () => {
    sessionSelections.set('session-2', { modelKey: 'openai:gpt-4o-mini' })

    const { rerender } = renderHook(({ sessionId }) => useModelSelection({ models: MODELS, sessionId }), {
      initialProps: { sessionId: 'session-1' as string | null },
    })

    rerender({ sessionId: 'session-2' })

    expect(sessionSelections.get('session-2')).toEqual({ modelKey: 'openai:gpt-4o-mini' })
  })

  it('restores the saved session model on the first mount for an existing session', () => {
    sessionSelections.set('session-1', { modelKey: 'openai:gpt-4o-mini' })

    const { result } = renderHook(() => useModelSelection({ models: MODELS, sessionId: 'session-1' }))

    expect(result.current.selectedModelKey).toBe('openai:gpt-4o-mini')
  })

  it('restores the saved session model after models load asynchronously', async () => {
    sessionSelections.set('session-1', { modelKey: 'openai:gpt-4o-mini' })

    const { result, rerender } = renderHook(({ models }) => useModelSelection({ models, sessionId: 'session-1' }), {
      initialProps: { models: [] as Model[] },
    })

    expect(result.current.selectedModelKey).toBeNull()

    rerender({ models: MODELS })

    await waitFor(() => expect(result.current.selectedModelKey).toBe('openai:gpt-4o-mini'))
  })
})
