import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeCommand, getCommands } from './command'

const listMock = vi.fn()
const sessionCommandMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    command: {
      list: (...args: unknown[]) => listMock(...args),
    },
    session: {
      command: (...args: unknown[]) => sessionCommandMock(...args),
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
    ])
  })

  it('keeps API commands as api commands even if names overlap frontend commands', async () => {
    listMock.mockResolvedValue({ data: [{ name: 'compact', description: 'Native compact command' }] })

    const commands = await getCommands('/workspace/project-overlap')

    expect(commands).toEqual([
      { name: 'compact', description: 'Native compact command', source: 'api' },
      { name: 'new', description: 'Create a new chat session', source: 'frontend' },
    ])
  })
})

// ============================================
// executeCommand（阶段 3a：V1 的 {command, arguments} → V2 的 {name, text}）
// ============================================
//
// 字段改名容易漏，而且漏了**不会报错**（命令名传成 undefined 时服务端只会说
// 「命令不存在」），所以这里把映射关系钉死：
//   command → name、args → text（V2 的 text 必填，无参数时必须传空串）
// 另外确认「目录参数不再下传」—— session 作用域端点不接受目录。
describe('executeCommand（V2 session.command）', () => {
  beforeEach(() => {
    sessionCommandMock.mockReset()
    sessionCommandMock.mockResolvedValue(undefined)
  })

  it('把 command/args 映射成 V2 的 name/text，并按裸 sessionID 调用', async () => {
    await executeCommand('ses_1', 'review', 'src/App.tsx', '/workspace/demo', 'local')

    expect(sessionCommandMock).toHaveBeenCalledTimes(1)
    expect(sessionCommandMock).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      name: 'review',
      text: 'src/App.tsx',
    })
  })

  it('无参数时 text 传空串（V2 的 text 是必填，不能省略）', async () => {
    await executeCommand('ses_1', 'compact')

    expect(sessionCommandMock).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      name: 'compact',
      text: '',
    })
  })

  it('复合 key（serverId::sessionId）解析出裸 id；显式 serverId 缺省时用 key 里的 serverId', async () => {
    await executeCommand('remote-1::ses_2', 'init')

    expect(sessionCommandMock).toHaveBeenCalledWith({
      sessionID: 'ses_2',
      name: 'init',
      text: '',
    })
  })

  it('不下传目录（session 作用域端点由 session 行本身决定目录）', async () => {
    await executeCommand('ses_1', 'review', 'x', '/workspace/demo', 'local')

    const payload = sessionCommandMock.mock.calls[0][0]
    expect(payload).not.toHaveProperty('directory')
    expect(payload).not.toHaveProperty('location')
  })

  it('返回 undefined（V2 的 command 是即时执行，返回 204 无内容）', async () => {
    await expect(executeCommand('ses_1', 'review')).resolves.toBeUndefined()
  })
})
