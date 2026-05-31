import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSettings } from './ChatSettings'

const {
  useTranslationMock,
  usePathModeMock,
  useIsMobileMock,
  setModelLabelFormatMock,
  setStepFinishDisplayMock,
  setCompletedAtFormatMock,
  setCollapseUserMessagesMock,
  setOmoInputHistorySimplifyMock,
  setReasoningDisplayModeMock,
  setShowModelVariantMock,
} = vi.hoisted(() => ({
  useTranslationMock: vi.fn(),
  usePathModeMock: vi.fn(),
  useIsMobileMock: vi.fn(),
  setModelLabelFormatMock: vi.fn(),
  setStepFinishDisplayMock: vi.fn(),
  setCompletedAtFormatMock: vi.fn(),
  setCollapseUserMessagesMock: vi.fn(),
  setOmoInputHistorySimplifyMock: vi.fn(),
  setReasoningDisplayModeMock: vi.fn(),
  setShowModelVariantMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: useTranslationMock,
}))

vi.mock('../../../hooks', () => ({
  usePathMode: usePathModeMock,
  useIsMobile: useIsMobileMock,
}))

vi.mock('../../../store/themeStore', () => ({
  themeStore: {
    get stepFinishDisplay() {
      return stepFinishDisplayValue
    },
    get completedAtFormat() {
      return 'time'
    },
    get modelLabelFormat() {
      return modelLabelFormatValue
    },
    get collapseUserMessages() {
      return true
    },
    get omoInputHistorySimplify() {
      return omoInputHistorySimplifyValue
    },
    get reasoningDisplayMode() {
      return 'capsule' as const
    },
    get showModelVariant() {
      return showModelVariantValue
    },
    setStepFinishDisplay: setStepFinishDisplayMock,
    setCompletedAtFormat: setCompletedAtFormatMock,
    setModelLabelFormat: setModelLabelFormatMock,
    setCollapseUserMessages: setCollapseUserMessagesMock,
    setOmoInputHistorySimplify: setOmoInputHistorySimplifyMock,
    setReasoningDisplayMode: setReasoningDisplayModeMock,
    setShowModelVariant: setShowModelVariantMock,
  },
}))

let stepFinishDisplayValue = {
  agent: false,
  model: false,
  tokens: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
  completedAt: false,
}

let modelLabelFormatValue: 'code' | 'name' = 'code'

let omoInputHistorySimplifyValue = false

let showModelVariantValue = false

describe('ChatSettings', () => {
  beforeEach(() => {
    useTranslationMock.mockReturnValue({
      t: (key: string) => key,
    })

    usePathModeMock.mockReturnValue({
      pathMode: 'auto' as const,
      setPathMode: vi.fn(),
      effectiveStyle: 'unix' as const,
      detectedStyle: null,
      isAutoMode: true,
    })

    useIsMobileMock.mockReturnValue(false)

    stepFinishDisplayValue = {
      agent: false,
      model: false,
      tokens: true,
      cache: true,
      cost: true,
      duration: true,
      turnDuration: true,
      completedAt: false,
    }

    modelLabelFormatValue = 'code'
    omoInputHistorySimplifyValue = false
    showModelVariantValue = false

    setModelLabelFormatMock.mockReset()
    setStepFinishDisplayMock.mockReset()
    setCompletedAtFormatMock.mockReset()
    setCollapseUserMessagesMock.mockReset()
    setOmoInputHistorySimplifyMock.mockReset()
    setReasoningDisplayModeMock.mockReset()
    setShowModelVariantMock.mockReset()
  })

  it('hides the model label format control when stepFinishDisplay.model is false', () => {
    render(<ChatSettings />)

    expect(screen.queryByRole('tab', { name: 'chat.modelLabelCode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'chat.modelLabelName' })).not.toBeInTheDocument()
  })

  it('shows the model label format control when stepFinishDisplay.model is true', () => {
    stepFinishDisplayValue = {
      ...stepFinishDisplayValue,
      model: true,
    }

    render(<ChatSettings />)

    expect(screen.getByRole('tab', { name: 'chat.modelLabelCode' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'chat.modelLabelName' })).toBeInTheDocument()
  })

  it('reflects the selected model label format and updates both state and store on interaction', () => {
    stepFinishDisplayValue = {
      ...stepFinishDisplayValue,
      model: true,
    }

    render(<ChatSettings />)

    const codeTab = screen.getByRole('tab', { name: 'chat.modelLabelCode' })
    const nameTab = screen.getByRole('tab', { name: 'chat.modelLabelName' })

    expect(codeTab).toHaveAttribute('aria-selected', 'true')
    expect(nameTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(nameTab)

    expect(setModelLabelFormatMock).toHaveBeenCalledWith('name')

    fireEvent.click(codeTab)

    expect(setModelLabelFormatMock).toHaveBeenCalledWith('code')
  })

  it('shows omo input history simplify after collapse long messages and before thinking display', () => {
    render(<ChatSettings />)

    const section = screen.getByRole('heading', { name: 'chat.conversationExperience' }).closest('section')
    expect(section).not.toBeNull()

    const html = section!.innerHTML
    const collapseIndex = html.indexOf('chat.collapseLongMessages')
    const omoIndex = html.indexOf('chat.omoInputHistorySimplify')
    const thinkingIndex = html.indexOf('chat.thinkingDisplay')

    expect(omoIndex).toBeGreaterThan(collapseIndex)
    expect(omoIndex).toBeLessThan(thinkingIndex)
  })

  it('reflects the omo input history simplify state and updates both state and store on interaction', () => {
    omoInputHistorySimplifyValue = false

    render(<ChatSettings />)

    const toggle = screen.getByRole('switch', { name: 'chat.omoInputHistorySimplify' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)

    expect(setOmoInputHistorySimplifyMock).toHaveBeenCalledWith(true)
  })

  it('shows model label format directly below the Model row and before completed-at format when both toggles are on', () => {
    stepFinishDisplayValue = {
      ...stepFinishDisplayValue,
      model: true,
      completedAt: true,
    }

    render(<ChatSettings />)

    const section = screen.getByRole('heading', { name: 'chat.stepFinishInfo' }).closest('section')
    expect(section).not.toBeNull()

    const html = section!.innerHTML
    const modelDescIndex = html.indexOf('chat.showModel')
    const modelLabelFormatIndex = html.indexOf('chat.modelLabelFormat')
    const showModelVariantIndex = html.indexOf('chat.showModelVariant')
    const tokensDescIndex = html.indexOf('chat.showTokenUsage')
    const completedAtFormatIndex = html.indexOf('chat.completedAtFormat')

    expect(modelLabelFormatIndex).toBeGreaterThan(modelDescIndex)
    expect(showModelVariantIndex).toBeGreaterThan(modelLabelFormatIndex)
    expect(showModelVariantIndex).toBeLessThan(tokensDescIndex)
    expect(completedAtFormatIndex).toBeGreaterThan(showModelVariantIndex)
  })

  it('hides the show model variant toggle when stepFinishDisplay.model is false', () => {
    render(<ChatSettings />)

    expect(screen.queryByRole('switch', { name: 'chat.showModelVariant' })).not.toBeInTheDocument()
  })

  it('shows the show model variant toggle when stepFinishDisplay.model is true', () => {
    stepFinishDisplayValue = {
      ...stepFinishDisplayValue,
      model: true,
    }

    render(<ChatSettings />)

    expect(screen.getByRole('switch', { name: 'chat.showModelVariant' })).toBeInTheDocument()
  })

  it('reflects the show model variant state and updates both state and store on interaction', () => {
    stepFinishDisplayValue = {
      ...stepFinishDisplayValue,
      model: true,
    }
    showModelVariantValue = false

    render(<ChatSettings />)

    const toggle = screen.getByRole('switch', { name: 'chat.showModelVariant' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)

    expect(setShowModelVariantMock).toHaveBeenCalledWith(true)
  })
})
