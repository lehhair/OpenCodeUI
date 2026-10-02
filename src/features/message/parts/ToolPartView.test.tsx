import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolPartView } from './ToolPartView'
import type { ToolViewPart } from '../tools'

const { getActiveCalibratedNowMock } = vi.hoisted(() => ({
  getActiveCalibratedNowMock: vi.fn<() => number | undefined>(() => undefined),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'toolPart.running') return 'Running'
      if (key === 'toolPart.failed') return 'Failed'
      return key
    },
  }),
}))

vi.mock('../../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
  useCompositorExpand: (open: boolean) => ({
    contentRef: { current: null },
    layoutOpen: open,
    keepMounted: open,
    panelClassName: 'transition-[grid-template-rows] duration-300 ease-in-out',
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    inlineToolRequests: false,
    immersiveMode: false,
    compactInlinePermission: false,
  }),
}))

vi.mock('../../../store/serverStore', () => ({
  serverStore: {
    getActiveCalibratedNow: getActiveCalibratedNowMock,
  },
}))

vi.mock('../../chat/InlineToolRequestContext', () => ({
  useInlineToolRequests: () => ({
    serverId: 'local',
    pendingPermissions: [],
    pendingQuestions: [],
    onPermissionReply: vi.fn(),
    onQuestionReply: vi.fn(),
    onQuestionReject: vi.fn(),
    isReplying: false,
  }),
  findPermissionRequestForTool: () => undefined,
  findQuestionRequestForTool: () => undefined,
}))

vi.mock('../../chat/InlinePermission', () => ({
  InlinePermission: () => null,
}))

vi.mock('../../chat/InlineQuestion', () => ({
  InlineQuestion: () => null,
}))

vi.mock('../tools', () => ({
  getToolIcon: () => <span data-testid="tool-icon">icon</span>,
  extractToolData: () => ({}),
  getToolConfig: () => undefined,
  DefaultRenderer: () => null,
  // v2 删除了 TodoRenderer / hasTodos（todo 能力整体移除）
  TaskRenderer: () => null,
}))

/** v2 原生工具条目：state 里没有起止时间，计时靠所属消息的 context */
function createRunningToolPart(): ToolViewPart {
  return {
    type: 'tool',
    id: 'tool-1',
    name: 'bash',
    messageID: 'message-1',
    state: {
      status: 'running',
      input: { command: 'npm run build' },
      metadata: { title: 'npm run build' },
    },
    time: { created: 7_500 },
  }
}

const MESSAGE_CONTEXT = { messageID: 'message-1', created: 7_500 }

describe('ToolPartView running duration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    getActiveCalibratedNowMock.mockReset()
    getActiveCalibratedNowMock.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('falls back to local wall clock when calibration is unavailable', () => {
    render(<ToolPartView part={createRunningToolPart()} context={MESSAGE_CONTEXT} />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('2.5s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText('3.0s')).toBeInTheDocument()
  })

  it('uses calibrated server time for running tools when available', () => {
    getActiveCalibratedNowMock.mockReturnValue(11_000)

    render(<ToolPartView part={createRunningToolPart()} context={MESSAGE_CONTEXT} />)

    expect(screen.getByText('3.5s')).toBeInTheDocument()
  })

  it('clamps running duration to zero when calibrated time is earlier than start', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_000)

    render(<ToolPartView part={createRunningToolPart()} context={MESSAGE_CONTEXT} />)

    expect(screen.getByText('0ms')).toBeInTheDocument()
  })

  it('rounds calibrated sub-second durations before rendering', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_623.456)

    render(<ToolPartView part={createRunningToolPart()} context={MESSAGE_CONTEXT} />)

    expect(screen.getByText('123ms')).toBeInTheDocument()
  })

  it('uses shared item spacing on compact and descriptive roots', () => {
    const part = createRunningToolPart()
    const { container, rerender } = render(<ToolPartView part={part} context={MESSAGE_CONTEXT} compact />)
    expect(container.firstElementChild?.className).toContain('pt-1')

    rerender(<ToolPartView part={part} context={MESSAGE_CONTEXT} descriptive />)
    expect(container.firstElementChild?.className).toContain('pt-1')
  })
})
