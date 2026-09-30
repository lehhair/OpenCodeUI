// ============================================
// PTY API 单测（阶段 3a）
// ============================================
//
// 覆盖范围：5 个 REST 端点 + V2 两步连接协议的票据申请 + URL 拼装。
// 这里把 SDK 全部 mock 掉，只验证「参数怎么传、信封怎么解」——
// 「打真实 V2 服务能不能拿到对的数据」由人工/冒烟脚本验证（见交付报告）。
//
// 关键断言（都是踩过的坑，别随手删）：
//   1. REST 端点返回 `{ location, data }`，必须解 `.data`
//   2. 每个 location 作用域端点都必须带 `location: { directory }`
//      （缺了服务端会静默回落到 process.cwd()，不报错但连错目录）
//   3. connect-token **必须**带 `x-opencode-ticket: '1'`（固定字面量 CSRF 标记，
//      不是票据本身；openapi 标 optional，实际必填，漏了 403）
//   4. connect-token 返回的是完整信封，`{ticket, expires_in}` 在 `.data` 里
//   5. WS URL 必须同时带 `ticket` 与 `location[directory]`
//      （裸 `directory=` 会被服务端静默忽略 → 404）
// ============================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPtyConnectTicket,
  createPtySession,
  getPtyConnectUrl,
  getPtySession,
  listPtySessions,
  removePtySession,
  updatePtySession,
} from './pty'

const listMock = vi.fn()
const createMock = vi.fn()
const getMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const connectTokenMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    pty: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      get: (...args: unknown[]) => getMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      remove: (...args: unknown[]) => removeMock(...args),
      connect: {
        token: (...args: unknown[]) => connectTokenMock(...args),
      },
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
    getActiveBaseUrl: () => 'http://127.0.0.1:4096',
    getActiveAuth: () => ({ username: 'opencode', password: 'pw' }),
    getServerBaseUrl: () => 'http://127.0.0.1:4096',
    getServerAuth: () => ({ username: 'opencode', password: 'pw' }),
  },
}))

const DIR = '/proj'

const samplePty = {
  id: 'pty_abc',
  title: 'Terminal abc',
  command: '/usr/bin/bash',
  args: ['-l'],
  cwd: DIR,
  status: 'running' as const,
  pid: 1234,
}

beforeEach(() => {
  listMock.mockReset()
  createMock.mockReset()
  getMock.mockReset()
  updateMock.mockReset()
  removeMock.mockReset()
  connectTokenMock.mockReset()
})

describe('listPtySessions', () => {
  it('解开 { location, data } 信封并传 location', async () => {
    listMock.mockResolvedValue({ location: { directory: DIR }, data: [samplePty] })

    const sessions = await listPtySessions(DIR)

    expect(listMock).toHaveBeenCalledTimes(1)
    expect(listMock.mock.calls[0][0]).toEqual({ location: { directory: DIR } })
    // 只返回 data 数组，不带信封
    expect(sessions).toEqual([samplePty])
    expect(sessions[0].status).toBe('running')
  })

  it('目录末尾斜杠会被归一化后再传给服务端', async () => {
    listMock.mockResolvedValue({ location: { directory: DIR }, data: [] })

    await listPtySessions('/proj/')

    expect(listMock.mock.calls[0][0]).toEqual({ location: { directory: DIR } })
  })

  it('未指定目录时不传 location（服务端回落到自己的 cwd）', async () => {
    listMock.mockResolvedValue({ location: { directory: DIR }, data: [] })

    await listPtySessions(undefined)

    expect(listMock.mock.calls[0][0]).toBeUndefined()
  })
})

describe('createPtySession', () => {
  it('把创建参数与 location 平铺成一个入参并解开 data', async () => {
    createMock.mockResolvedValue({ location: { directory: DIR }, data: samplePty })

    const pty = await createPtySession({ cwd: DIR }, DIR)

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock.mock.calls[0][0]).toEqual({ cwd: DIR, location: { directory: DIR } })
    expect(pty).toEqual(samplePty)
  })

  it('command / args / title / env 原样透传（V1 与 V2 字段同名同形状）', async () => {
    createMock.mockResolvedValue({ location: { directory: DIR }, data: samplePty })

    await createPtySession({ command: 'bash', args: ['-l'], cwd: DIR, title: 'T', env: { FOO: 'bar' } }, DIR)

    expect(createMock.mock.calls[0][0]).toEqual({
      command: 'bash',
      args: ['-l'],
      cwd: DIR,
      title: 'T',
      env: { FOO: 'bar' },
      location: { directory: DIR },
    })
  })
})

describe('getPtySession', () => {
  it('传 ptyID + location 并解开 data', async () => {
    getMock.mockResolvedValue({ location: { directory: DIR }, data: samplePty })

    const pty = await getPtySession('pty_abc', DIR)

    expect(getMock.mock.calls[0][0]).toEqual({ ptyID: 'pty_abc', location: { directory: DIR } })
    expect(pty).toEqual(samplePty)
  })
})

describe('updatePtySession', () => {
  it('走 pty.update（V2 方法从 PATCH 改成 PUT，由 SDK 内部处理）', async () => {
    updateMock.mockResolvedValue({ location: { directory: DIR }, data: samplePty })

    const pty = await updatePtySession('pty_abc', { size: { cols: 100, rows: 30 } }, DIR)

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][0]).toEqual({
      ptyID: 'pty_abc',
      size: { cols: 100, rows: 30 },
      location: { directory: DIR },
    })
    expect(pty).toEqual(samplePty)
  })

  it('只改标题时不带 size', async () => {
    updateMock.mockResolvedValue({ location: { directory: DIR }, data: samplePty })

    await updatePtySession('pty_abc', { title: 'New title' }, DIR)

    expect(updateMock.mock.calls[0][0]).toEqual({
      ptyID: 'pty_abc',
      title: 'New title',
      location: { directory: DIR },
    })
  })
})

describe('removePtySession', () => {
  it('走 pty.remove（V2 返回 204 空体）并返回 true', async () => {
    removeMock.mockResolvedValue(undefined)

    const ok = await removePtySession('pty_abc', DIR)

    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock.mock.calls[0][0]).toEqual({ ptyID: 'pty_abc', location: { directory: DIR } })
    expect(ok).toBe(true)
  })
})

describe('createPtyConnectTicket', () => {
  it('解开 { location, data: { ticket, expires_in } } → { ticket, expiresIn }', async () => {
    connectTokenMock.mockResolvedValue({
      location: { directory: DIR },
      data: { ticket: 'tk_123', expires_in: 60 },
    })

    const result = await createPtyConnectTicket('pty_abc', DIR)

    expect(result).toEqual({ ticket: 'tk_123', expiresIn: 60 })
  })

  it('必须带 x-opencode-ticket: "1" 与 location（漏了服务端直接 403）', async () => {
    connectTokenMock.mockResolvedValue({
      location: { directory: DIR },
      data: { ticket: 'tk_123', expires_in: 60 },
    })

    await createPtyConnectTicket('pty_abc', DIR)

    expect(connectTokenMock).toHaveBeenCalledTimes(1)
    expect(connectTokenMock.mock.calls[0][0]).toEqual({
      ptyID: 'pty_abc',
      location: { directory: DIR },
      // 固定字面量 "1"，不是票据本身
      'x-opencode-ticket': '1',
    })
  })
})

describe('getPtyConnectUrl', () => {
  it('URL 带 ticket、location[directory] 与 cursor', () => {
    const url = getPtyConnectUrl('pty_abc', 'tk_123', DIR, { cursor: 42 })

    // 注意：跨域时会带 userinfo（ws://user:pass@host/...），所以只断言路径与 query。
    // ⚠️ 路径必须带 /api 前缀（getApiBaseUrl() 返回裸地址，不含 /api）
    expect(url).toMatch(/^ws:\/\/.*127\.0\.0\.1:4096\/api\/pty\/pty_abc\/connect\?/)
    expect(url).toContain('ticket=tk_123')
    expect(url).toContain('cursor=42')
    // V2 只认 location[directory]；裸 directory= 会被服务端静默忽略
    expect(url).toContain('location%5Bdirectory%5D=%2Fproj')
    expect(url).not.toContain('directory=%2Fproj&')
  })

  it('includeAuthInUrl: false（Tauri bridge）时依然必须带 ticket', () => {
    const url = getPtyConnectUrl('pty_abc', 'tk_123', DIR, { includeAuthInUrl: false, cursor: 7 })

    expect(url).toContain('ws://127.0.0.1:4096/api/pty/pty_abc/connect?')
    expect(url).toContain('ticket=tk_123')
    expect(url).toContain('cursor=7')
    expect(url).toContain('location%5Bdirectory%5D=%2Fproj')
    // 不放认证（认证走 Rust 侧 header）
    expect(url).not.toContain('auth_token=')
    expect(url).not.toContain('@')
  })

  it('浏览器路径跨域时附 auth_token 兜底（ticket 仍在）', () => {
    const url = getPtyConnectUrl('pty_abc', 'tk_123', DIR, { cursor: 0 })

    expect(url).toContain('ticket=tk_123')
    expect(url).toContain('auth_token=')
    expect(url).toContain('cursor=0')
  })

  it('非法 cursor 不下发（保持与 V1 相同的安全校验）', () => {
    const url = getPtyConnectUrl('pty_abc', 'tk_123', DIR, { cursor: -1 })

    expect(url).not.toContain('cursor=')
    expect(url).toContain('ticket=tk_123')
  })

  it('未指定目录时不带 location[directory]（服务端回落到自己的 cwd）', () => {
    const url = getPtyConnectUrl('pty_abc', 'tk_123', undefined, { cursor: 1 })

    expect(url).not.toContain('location%5Bdirectory%5D')
    expect(url).toContain('ticket=tk_123')
  })

  it('每次调用都是新 URL（票据一次性 → 不能缓存复用）', () => {
    const first = getPtyConnectUrl('pty_abc', 'tk_1', DIR, { cursor: 0 })
    const second = getPtyConnectUrl('pty_abc', 'tk_2', DIR, { cursor: 0 })

    expect(first).not.toBe(second)
    expect(first).toContain('ticket=tk_1')
    expect(second).toContain('ticket=tk_2')
  })
})
