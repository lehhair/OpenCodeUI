import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCommands } from './command'

const listMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    command: {
      list: (...args: unknown[]) => listMock(...args),
    },
  }),
  unwrap: (result: { data?: unknown }) => result.data,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
  },
}))

describe('getCommands', () => {
  beforeEach(() => {
    listMock.mockReset()
  })

  it('marks frontend and api commands with stable sources', async () => {
    listMock.mockResolvedValue({ data: [{ name: 'review', description: 'Run project review' }] })

    const commands = await getCommands('/workspace/project')

    expect(commands).toEqual([
      { name: 'review', description: 'Run project review', source: 'api' },
      { name: 'new', description: 'Create a new chat session', source: 'frontend' },
      { name: 'compact', description: 'Compact session by summarizing conversation history', source: 'frontend' },
      { name: 'undo', description: 'Undo the last change (back to the previous user message)', source: 'frontend' },
      { name: 'redo', description: 'Redo the undone change', source: 'frontend' },
      { name: 'fork', description: 'Fork the current session into a new one', source: 'frontend' },
      { name: 'export', description: 'Export the session transcript as a JSON file', source: 'frontend' },
      { name: 'btw', description: 'Ask a one-off side question about this conversation (no tool calls)', source: 'frontend' },
    ])
  })

  it('keeps API commands as api commands even if names overlap frontend commands', async () => {
    listMock.mockResolvedValue({ data: [{ name: 'compact', description: 'Native compact command' }] })

    const commands = await getCommands('/workspace/project-overlap')

    expect(commands).toEqual([
      { name: 'compact', description: 'Native compact command', source: 'api' },
      { name: 'new', description: 'Create a new chat session', source: 'frontend' },
      { name: 'undo', description: 'Undo the last change (back to the previous user message)', source: 'frontend' },
      { name: 'redo', description: 'Redo the undone change', source: 'frontend' },
      { name: 'fork', description: 'Fork the current session into a new one', source: 'frontend' },
      { name: 'export', description: 'Export the session transcript as a JSON file', source: 'frontend' },
      { name: 'btw', description: 'Ask a one-off side question about this conversation (no tool calls)', source: 'frontend' },
    ])
  })
})
