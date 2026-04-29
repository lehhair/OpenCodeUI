import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
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
    const selectedOption = document.getElementById('ms-item-1') as HTMLButtonElement | null
    const pinButtons = screen.getAllByRole('button', { name: /Pin to top|Unpin/ })

    expect(selectedOption).not.toBeNull()
    expect(selectedOption).not.toContainElement(pinButtons[0])
    expect(pinButtons.length).toBeGreaterThan(0)

    fireEvent.change(searchInput, { target: { value: 'nope' } })

    expect(screen.getByRole('status')).toHaveTextContent('No models found')
  })

  it('opens from ArrowUp at the last model and allows tabbing to pin controls', async () => {
    render(<ModelSelector models={MODELS} selectedModelKey={'openai:gpt-4.1'} onSelect={vi.fn()} />)

    const trigger = screen.getByTitle('GPT-4.1')
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })

    const lastOption = document.getElementById('ms-item-2') as HTMLButtonElement | null
    await waitFor(() => expect(lastOption).toHaveFocus())

    fireEvent.keyDown(lastOption!, { key: 'Escape' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const selectedOption = document.getElementById('ms-item-1') as HTMLButtonElement | null
    const firstPinButton = screen.getByRole('button', { name: /Pin to top: GPT-4.1/i })

    await waitFor(() => expect(selectedOption).toHaveFocus())

    fireEvent.keyDown(selectedOption!, { key: 'Tab' })

    await waitFor(() => expect(firstPinButton).toHaveFocus())
  })

  it('returns focus to the toolbar input after selecting a model', async () => {
    const onSelect = vi.fn()

    function ToolbarSelectorHarness() {
      const containerRef = useRef<HTMLDivElement>(null)

      return (
        <div ref={containerRef}>
          <textarea aria-label="Chat input" />
          <ModelSelector
            models={MODELS}
            selectedModelKey={'openai:gpt-4.1'}
            onSelect={onSelect}
            trigger="toolbar"
            constrainToRef={containerRef}
          />
        </div>
      )
    }

    render(<ToolbarSelectorHarness />)

    fireEvent.click(screen.getByTitle('GPT-4.1'))
    fireEvent.click(screen.getByText('GPT-4o Mini'))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat input' })).toHaveFocus())
    expect(onSelect).toHaveBeenCalledWith('openai:gpt-4o-mini', expect.objectContaining({ name: 'GPT-4o Mini' }))
  })

  it('does not keep mouse-clicked pin controls focused', () => {
    render(<ModelSelector models={MODELS} selectedModelKey={'openai:gpt-4.1'} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByTitle('GPT-4.1'))

    const pinButton = screen.getByRole('button', { name: /Pin to top: GPT-4.1/i })
    fireEvent.click(pinButton, { detail: 1 })

    expect(pinButton).not.toHaveFocus()
  })
})
