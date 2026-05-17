import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ModelsSettings } from './ModelsSettings'
import type { ModelInfo } from '../../../api'

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
  getModelKey: (model: ModelInfo) => `${model.providerId}:${model.id}`,
  groupModelsByProvider: (models: ModelInfo[]) => [
    {
      providerName: 'OpenAI',
      models,
    },
  ],
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

describe('ModelsSettings', () => {
  beforeEach(() => {
    useModelsMock.mockReturnValue({ models: MODELS, isLoading: false })
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
    expect(switches[0]).toHaveAttribute('aria-label', 'Model Visibility: OpenAI')
    expect(switches[1]).toHaveAttribute('aria-label', 'Model Visibility: GPT-4.1')
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

  it('keeps the provider switch enabled when only some models are hidden', () => {
    useHiddenModelKeysMock.mockReturnValue(['openai:gpt-4.1'])

    render(<ModelsSettings />)

    const switches = screen.getAllByRole('switch')

    expect(switches[0]).toHaveAttribute('aria-label', 'Model Visibility: OpenAI')
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
    expect(switches[1]).toHaveAttribute('aria-checked', 'false')
    expect(switches[2]).toHaveAttribute('aria-checked', 'true')
  })
})
