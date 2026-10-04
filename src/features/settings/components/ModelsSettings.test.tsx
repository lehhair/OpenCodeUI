import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ModelsSettings } from './ModelsSettings'
import type { Model } from '../../../api'

const { useModelsMock, useHiddenModelKeysMock, setVisibleMock, setManyVisibleMock } = vi.hoisted(() => ({
  useModelsMock: vi.fn(),
  useHiddenModelKeysMock: vi.fn(),
  setVisibleMock: vi.fn(),
  setManyVisibleMock: vi.fn(),
}))

vi.mock('../../../hooks', () => ({
  useModels: useModelsMock,
}))

vi.mock('../../../store', () => ({
  modelVisibilityStore: {
    setVisible: setVisibleMock,
    setManyVisible: setManyVisibleMock,
  },
  useHiddenModelKeys: useHiddenModelKeysMock,
}))

vi.mock('../../../utils/modelUtils', () => ({
  getModelKey: (model: Model) => `${model.providerID}:${model.id}`,
  providerDisplayName: (_providers: unknown, providerID: string) => (providerID === 'openai' ? 'OpenAI' : providerID),
  groupModelsByProvider: (models: Model[]) => [
    {
      providerName: 'OpenAI',
      models,
    },
  ],
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
    variants: [],
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
    variants: [],
  },
] as unknown as Model[]

describe('ModelsSettings', () => {
  beforeEach(() => {
    useModelsMock.mockReturnValue({ models: MODELS, providers: [], isLoading: false })
    useHiddenModelKeysMock.mockReturnValue([])
    setVisibleMock.mockReset()
    setManyVisibleMock.mockReset()
  })

  it('renders model rows with semantic buttons and labeled switches', () => {
    render(<ModelsSettings />)

    const modelButton = screen.getByRole('button', { name: /GPT-4.1/i })
    const switches = screen.getAllByRole('switch')

    fireEvent.click(modelButton)

    expect(modelButton).toHaveAttribute('aria-pressed', 'true')
    expect(switches[0]).toHaveAttribute('aria-label', 'Hide GPT-4.1')
    expect(setVisibleMock).toHaveBeenCalledWith(MODELS[0], false)
  })

  it('keeps the whole model row clickable outside the text button and switch', () => {
    render(<ModelsSettings />)

    const modelButton = screen.getByRole('button', { name: /GPT-4.1/i })
    const modelRow = modelButton.parentElement

    expect(modelRow).not.toBeNull()

    fireEvent.click(modelRow!)

    expect(setVisibleMock).toHaveBeenCalledWith(MODELS[0], false)
  })

  it('reflects each model visibility state', () => {
    useHiddenModelKeysMock.mockReturnValue(['openai:gpt-4.1'])

    render(<ModelsSettings />)

    const switches = screen.getAllByRole('switch')

    expect(switches).toHaveLength(2)
    expect(switches[0]).toHaveAttribute('aria-checked', 'false')
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(setManyVisibleMock).toHaveBeenCalledWith(MODELS, true)
  })
})
