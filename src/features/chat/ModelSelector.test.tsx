import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelSelector } from './ModelSelector'
import type { ModelInfo } from '../../api'

vi.mock('../../components/ui', () => ({
  DropdownMenu: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}))

vi.mock('../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false }),
}))

vi.mock('../../utils/modelUtils', () => ({
  getModelKey: (model: ModelInfo) => `${model.providerId}:${model.id}`,
  groupModelsByProvider: (models: ModelInfo[]) => [
    {
      providerId: 'openai',
      providerName: 'OpenAI',
      models,
    },
  ],
  getRecentModels: () => [],
  recordModelUsage: vi.fn(),
  getPinnedModels: () => [],
  isModelPinned: () => false,
  toggleModelPin: vi.fn(),
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
    variants: [],
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
    variants: [],
  },
]

describe('ModelSelector', () => {
  it('opens menu and selects a model', () => {
    const onSelect = vi.fn()

    render(<ModelSelector models={MODELS} selectedModelKey={'openai:gpt-4.1'} onSelect={onSelect} />)

    fireEvent.click(screen.getByTitle('GPT-4.1'))
    fireEvent.click(screen.getByText('GPT-4o Mini'))

    expect(onSelect).toHaveBeenCalledWith('openai:gpt-4o-mini', expect.objectContaining({ name: 'GPT-4o Mini' }))
  })

  it('exposes accessible combobox-like semantics for search and options', () => {
    render(<ModelSelector models={MODELS} selectedModelKey={'openai:gpt-4.1'} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByTitle('GPT-4.1'))

    const searchInput = screen.getByRole('textbox', { name: 'Search models...' })
    const listbox = screen.getByRole('listbox', { name: 'Search models...' })
    const selectedOption = screen.getByRole('option', { name: /GPT-4.1/i })
    const pinButtons = screen.getAllByRole('button', { name: /Pin to top|Unpin/ })

    expect(searchInput).toHaveAttribute('aria-controls', listbox.id)
    expect(searchInput).toHaveAttribute('aria-activedescendant')
    expect(selectedOption).toHaveAttribute('aria-selected', 'true')
    expect(pinButtons.length).toBeGreaterThan(0)
  })
})
