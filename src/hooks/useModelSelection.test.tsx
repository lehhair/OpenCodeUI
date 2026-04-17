import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '../api'
import { STORAGE_KEY_SELECTED_MODEL } from '../constants'
import { useModelSelection } from './useModelSelection'

const storage = new Map<string, string>()
const variantPrefs = new Map<string, string | undefined>()

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
  getModelKey: (model: ModelInfo) => `${model.providerId}:${model.id}`,
  findModelByKey: (models: ModelInfo[], key: string) => models.find(m => `${m.providerId}:${m.id}` === key),
  saveModelVariantPref: (key: string, value: string | undefined) => {
    variantPrefs.set(key, value)
  },
  getModelVariantPref: (key: string) => variantPrefs.get(key),
}))

const MODELS: ModelInfo[] = [
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    providerId: 'openai',
    providerName: 'OpenAI',
    family: 'gpt',
    contextLimit: 128000,
    outputLimit: 32000,
    supportsReasoning: true,
    supportsImages: true,
    supportsPdf: true,
    supportsAudio: false,
    supportsVideo: false,
    supportsToolcall: true,
    variants: ['fast'],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    providerId: 'openai',
    providerName: 'OpenAI',
    family: 'gpt',
    contextLimit: 128000,
    outputLimit: 16000,
    supportsReasoning: false,
    supportsImages: true,
    supportsPdf: true,
    supportsAudio: false,
    supportsVideo: false,
    supportsToolcall: true,
    variants: ['balanced'],
  },
]

describe('useModelSelection', () => {
  beforeEach(() => {
    storage.clear()
    variantPrefs.clear()
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
})
