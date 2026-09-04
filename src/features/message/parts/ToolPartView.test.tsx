import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolPartView } from './ToolPartView'
import type { ToolPart } from '../../../types/message'

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
  TodoRenderer: () => null,
  TaskRenderer: () => null,
  hasTodos: () => false,
}))

vi.mock('./AttachmentPartViews', () => ({
  FilePartView: ({ part, defaultExpanded }: { part: { filename?: string }; defaultExpanded?: boolean }) => (
    <span data-testid="file-part-view">
      file:{part.filename}:{String(!!defaultExpanded)}
    </span>
  ),
}))

function createRunningToolPart(): ToolPart {
  return {
    id: 'tool-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'bash',
    state: {
      status: 'running',
      title: 'npm run build',
      time: { start: 7_500 },
    },
  }
}

function createAttachedToolPart(): ToolPart {
  return {
    id: 'tool-2',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-2',
    tool: 'attach_file',
    state: {
      status: 'completed',
      title: 'Attach File',
      time: { start: 7_500 },
      attachments: [
        {
          id: 'att-1',
          sessionID: 'session-1',
          messageID: 'message-1',
          type: 'file',
          filename: 'image.png',
          url: 'data:image/png;base64,iVBORw0KGgo=',
          mime: 'image/png',
        },
      ],
    },
  }
}

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
    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('2.5s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText('3.0s')).toBeInTheDocument()
  })

  it('uses calibrated server time for running tools when available', () => {
    getActiveCalibratedNowMock.mockReturnValue(11_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('3.5s')).toBeInTheDocument()
  })

  it('clamps running duration to zero when calibrated time is earlier than start', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('0ms')).toBeInTheDocument()
  })

  it('rounds calibrated sub-second durations before rendering', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_623.456)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('123ms')).toBeInTheDocument()
  })

  it('uses shared item spacing on compact and descriptive roots', () => {
    const part = createRunningToolPart()
    const { container, rerender } = render(<ToolPartView part={part} compact />)
    expect(container.firstElementChild?.className).toContain('pt-1')

    rerender(<ToolPartView part={part} descriptive />)
    expect(container.firstElementChild?.className).toContain('pt-1')
  })

  it('renders state.attachments via FilePartView with defaultExpanded', () => {
    render(<ToolPartView part={createAttachedToolPart()} />)
    expect(screen.getByTestId('file-part-view')).toHaveTextContent('file:image.png:true')
  })

  it('does not render attachments when state has none', () => {
    render(<ToolPartView part={createRunningToolPart()} />)
    expect(screen.queryByTestId('file-part-view')).toBeNull()
  })
})
