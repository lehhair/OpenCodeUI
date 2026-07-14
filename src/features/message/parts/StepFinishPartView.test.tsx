import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepFinishPartView } from './StepFinishPartView'
import type { StepFinishPart } from '../../../types/message'

let mockStepFinishDisplay = {
  tokens: true,
  tps: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
  agent: true,
  model: true,
  completedAt: true,
  ttft: true,
}

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    stepFinishDisplay: mockStepFinishDisplay,
    completedAtFormat: 'time' as const,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'stepFinish.inputTokens') return `Input: ${opts?.input}`
      if (key === 'stepFinish.outputTokens') return `Output: ${opts?.output}`
      if (key === 'stepFinish.reasoningTokens') return `Reasoning: ${opts?.reasoning}`
      if (key === 'stepFinish.cacheRead') return `Cache read: ${opts?.read}`
      if (key === 'stepFinish.cacheWrite') return `Cache write: ${opts?.write}`
      if (key === 'stepFinish.cached') return `${opts?.count} cached`
      if (key === 'stepFinish.totalDuration') return `${opts?.duration} total`
      if (key === 'tokens') return 'tokens'
      return key
    },
  }),
}))

function createStepFinishPart(overrides?: Partial<StepFinishPart>): StepFinishPart {
  return {
    id: 'step-finish-1',
    sessionID: 'session-1',
    messageID: 'msg-1',
    type: 'step-finish',
    reason: 'stop',
    cost: 0,
    tokens: {
      input: 100,
      output: 200,
      reasoning: 50,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  }
}

describe('StepFinishPartView', () => {
  it('renders TPS when data is available', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        completedAt={20000}
        created={5000}
        firstPartStart={6000}
      />,
    )
    // created=5000, completedAt=20000, firstPartStart=6000
    // genTime = 20000 - 6000 = 14000ms = 14s
    // genTokens = 200 + 50 = 250
    // tps = Math.round(250 / 14) = Math.round(17.857) = 18
    expect(screen.getByText('18 tps')).toBeInTheDocument()
  })

  it('renders TTFT when data is available', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        completedAt={20000}
        created={5000}
        firstPartStart={6000}
      />,
    )
    // ttft = 6000 - 5000 = 1000ms
    expect(screen.getByText(/TTFT/)).toBeInTheDocument()
    expect(screen.getByText(/1\.0s/)).toBeInTheDocument()
  })

  it('does not render TPS when no firstPartStart', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        completedAt={20000}
      />,
    )
    expect(screen.queryByText(/tps/)).toBeNull()
  })

  it('does not render TTFT when no firstPartStart', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        completedAt={20000}
      />,
    )
    expect(screen.queryByText(/TTFT/)).toBeNull()
  })

  it('does not render TTFT/TPS when toggled off in settings', () => {
    mockStepFinishDisplay = {
      tokens: true,
      tps: false,
      cache: true,
      cost: true,
      duration: true,
      turnDuration: true,
      agent: true,
      model: true,
      completedAt: false,
      ttft: false,
    }

    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        completedAt={20000}
        created={5000}
        firstPartStart={6000}
      />,
    )
    expect(screen.queryByText(/tps/)).toBeNull()
    expect(screen.queryByText(/TTFT/)).toBeNull()
  })
})
