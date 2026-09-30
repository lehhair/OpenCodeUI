// ============================================
// MCP API 单元测试（阶段 3a：V1 → V2 迁移）
// ============================================
//
// 锁住的约定（一旦写错，症状都很难查）：
//
//   1. `getMcpStatus()`：V2 返回的是**数组** `{location, data: Mcp.Server[]}`，
//      不是 V1 的 `Record<name, status>`。这里断言映射后的内部形状，
//      并断言 `integrationID` 被带出来（OAuth 全靠它）。
//   2. `getMcpResources()`：V2 返回 `{location, data: {resources, templates}}`，
//      要**解包 data**，不能把 `{location, data}` 整包交给 UI。
//   3. `addMcpServer()`：V2 body 是 `{config}` 包一层 + 路径参数 server，
//      即 `sdk.mcp.add({ server, config, location })`。
//   4. OAuth 三步走：`mcp.list` 找 integrationID → `integration.get` 找 oauth method
//      → `oauth.connect` 拿 attempt。`startMcpAuth` 返回 `{url}` 且把
//      `{integrationID, attemptID}` 记进模块级 Map，`completeMcpAuth` 才能提交。
//   5. 缺 `integrationID` / 缺 oauth method / 没有待完成 attempt 时，
//      必须抛**可读的中文错误**（而不是静默失败或 404）。
//   6. `removeMcpAuth()`：走 `integration.get` → connections 里的 credential
//      → `sdk.credential.remove({credentialID})`（**没有** location 参数）。
//
// 注意：`pendingOAuthAttempts` 是模块级 Map，测试之间不会自动清空，
// 所以每个用例用**不同的服务器名**，避免互相污染。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addMcpServer,
  authenticateMcp,
  completeMcpAuth,
  connectMcpServer,
  disconnectMcpServer,
  getMcpResources,
  getMcpStatus,
  removeMcpAuth,
  startMcpAuth,
} from './mcp'

const mcpListMock = vi.fn()
const mcpAddMock = vi.fn()
const mcpConnectMock = vi.fn()
const mcpDisconnectMock = vi.fn()
const resourceCatalogMock = vi.fn()
const integrationGetMock = vi.fn()
const oauthConnectMock = vi.fn()
const oauthStatusMock = vi.fn()
const oauthCompleteMock = vi.fn()
const credentialRemoveMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    mcp: {
      list: (...args: unknown[]) => mcpListMock(...args),
      add: (...args: unknown[]) => mcpAddMock(...args),
      connect: (...args: unknown[]) => mcpConnectMock(...args),
      disconnect: (...args: unknown[]) => mcpDisconnectMock(...args),
      resource: {
        catalog: (...args: unknown[]) => resourceCatalogMock(...args),
      },
    },
    integration: {
      get: (...args: unknown[]) => integrationGetMock(...args),
      oauth: {
        connect: (...args: unknown[]) => oauthConnectMock(...args),
        status: (...args: unknown[]) => oauthStatusMock(...args),
        complete: (...args: unknown[]) => oauthCompleteMock(...args),
      },
    },
    credential: {
      remove: (...args: unknown[]) => credentialRemoveMock(...args),
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
  },
}))

const LOCATION = { location: { directory: '/workspace/demo' } }

/** V2 `GET /api/mcp` 的返回：数组 + integrationID */
function mcpListResult(servers: Array<{ name: string; status: unknown; integrationID?: string }>) {
  return { location: { directory: '/workspace/demo' }, data: servers }
}

/** V2 `GET /api/integration/{id}` 的返回 */
function integrationInfo(methods: unknown[], connections: unknown[] = []) {
  return { location: { directory: '/workspace/demo' }, data: { id: 'int_1', name: 'GitHub', methods, connections } }
}

const OAUTH_METHOD = { id: 'oauth-main', type: 'oauth', label: 'OAuth' }

/** 一个 OAuth attempt（mode 可选 auto / code） */
function oauthAttempt(overrides: Record<string, unknown> = {}) {
  return {
    location: { directory: '/workspace/demo' },
    data: {
      attemptID: 'attempt_1',
      url: 'https://example.com/oauth/authorize',
      instructions: '在浏览器中完成授权',
      mode: 'auto',
      time: { created: 1, expires: 2 },
      ...overrides,
    },
  }
}

describe('getMcpStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('把 V2 数组映射成内部 MCPServer[]，并带出 integrationID', async () => {
    mcpListMock.mockResolvedValue(
      mcpListResult([
        { name: 'github', status: { status: 'connected' } },
        { name: 'notion', status: { status: 'needs_auth', error: 'missing scope' }, integrationID: 'int_notion' },
      ]),
    )

    const result = await getMcpStatus('/workspace/demo')

    // 目录参数必须走 locationInput（location 作用域端点）
    expect(mcpListMock).toHaveBeenCalledWith(LOCATION)
    expect(result).toEqual([
      { name: 'github', status: { status: 'connected' }, integrationID: undefined },
      { name: 'notion', status: { status: 'needs_auth', error: 'missing scope' }, integrationID: 'int_notion' },
    ])
  })

  it('无目录时 location 传 undefined（服务端回落 process.cwd）', async () => {
    mcpListMock.mockResolvedValue(mcpListResult([]))

    await getMcpStatus()

    expect(mcpListMock).toHaveBeenCalledWith(undefined)
  })
})

describe('getMcpResources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('解包 {location,data} 并保留 resources + templates', async () => {
    resourceCatalogMock.mockResolvedValue({
      location: { directory: '/workspace/demo' },
      data: {
        resources: [{ server: 'github', name: 'README', uri: 'file:///README.md', mimeType: 'text/markdown' }],
        templates: [{ server: 'github', name: 'File', uriTemplate: 'file:///{path}' }],
      },
    })

    const result = await getMcpResources('/workspace/demo')

    expect(resourceCatalogMock).toHaveBeenCalledWith(LOCATION)
    expect(result).toEqual({
      resources: [{ server: 'github', name: 'README', uri: 'file:///README.md', mimeType: 'text/markdown' }],
      templates: [{ server: 'github', name: 'File', uriTemplate: 'file:///{path}' }],
    })
  })
})

describe('addMcpServer / connect / disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('addMcpServer 传 {server, config, location}（config 用 V2 字段）', async () => {
    mcpAddMock.mockResolvedValue(undefined)

    const config = {
      type: 'local' as const,
      command: ['npx', '-y', '@modelcontextprotocol/server-github'],
      environment: { GITHUB_TOKEN: 'x' },
      disabled: false,
    }
    await addMcpServer('github', config, '/workspace/demo')

    expect(mcpAddMock).toHaveBeenCalledWith({
      server: 'github',
      config,
      location: { directory: '/workspace/demo' },
    })
  })

  it('connect / disconnect 传 {server, location}', async () => {
    mcpConnectMock.mockResolvedValue(undefined)
    mcpDisconnectMock.mockResolvedValue(undefined)

    await connectMcpServer('github', '/workspace/demo')
    await disconnectMcpServer('github', '/workspace/demo')

    expect(mcpConnectMock).toHaveBeenCalledWith({ server: 'github', location: { directory: '/workspace/demo' } })
    expect(mcpDisconnectMock).toHaveBeenCalledWith({ server: 'github', location: { directory: '/workspace/demo' } })
  })
})

describe('MCP OAuth（/api/integration/* 体系）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('startMcpAuth 返回 {url}，并记录 attempt 供 completeMcpAuth 使用', async () => {
    mcpListMock.mockResolvedValue(
      mcpListResult([{ name: 'oauth-start', status: { status: 'needs_auth', error: '' }, integrationID: 'int_1' }]),
    )
    integrationGetMock.mockResolvedValue(integrationInfo([OAUTH_METHOD]))
    oauthConnectMock.mockResolvedValue(oauthAttempt({ mode: 'code' }))
    oauthCompleteMock.mockResolvedValue(undefined)

    const result = await startMcpAuth('oauth-start', '/workspace/demo')

    expect(result).toEqual({ url: 'https://example.com/oauth/authorize' })
    // 发起时用的是 integrationID + OAuth method id
    expect(oauthConnectMock).toHaveBeenCalledWith({
      integrationID: 'int_1',
      methodID: 'oauth-main',
      location: { directory: '/workspace/demo' },
    })

    // 提交 code：integrationID / attemptID 来自上面记录的 Map
    await completeMcpAuth('oauth-start', 'the-code', '/workspace/demo')
    expect(oauthCompleteMock).toHaveBeenCalledWith({
      integrationID: 'int_1',
      attemptID: 'attempt_1',
      code: 'the-code',
      location: { directory: '/workspace/demo' },
    })
  })

  it('completeMcpAuth 在没有先发起 attempt 时抛中文错误', async () => {
    await expect(completeMcpAuth('never-started', 'code')).rejects.toThrow(
      /没有找到服务器 "never-started" 的待完成 OAuth attempt/,
    )
    expect(oauthCompleteMock).not.toHaveBeenCalled()
  })

  it('服务器缺 integrationID 时抛清晰中文错误（不支持 OAuth）', async () => {
    mcpListMock.mockResolvedValue(mcpListResult([{ name: 'no-integration', status: { status: 'connected' } }]))

    await expect(startMcpAuth('no-integration')).rejects.toThrow(/没有 integrationID/)
    expect(oauthConnectMock).not.toHaveBeenCalled()
  })

  it('服务器不存在时抛中文错误', async () => {
    mcpListMock.mockResolvedValue(mcpListResult([]))

    await expect(startMcpAuth('missing-server')).rejects.toThrow(/未找到名为 "missing-server" 的 MCP 服务器/)
  })

  it('removeMcpAuth 在服务器缺 integrationID 时也抛中文错误', async () => {
    mcpListMock.mockResolvedValue(mcpListResult([{ name: 'remove-no-integration', status: { status: 'connected' } }]))

    await expect(removeMcpAuth('remove-no-integration')).rejects.toThrow(/没有 integrationID/)
    expect(credentialRemoveMock).not.toHaveBeenCalled()
  })

  it('integration 没有 oauth 方法时抛中文错误（列出已有方法类型）', async () => {
    mcpListMock.mockResolvedValue(
      mcpListResult([{ name: 'key-only', status: { status: 'needs_auth', error: '' }, integrationID: 'int_1' }]),
    )
    integrationGetMock.mockResolvedValue(integrationInfo([{ type: 'key', label: 'API Key' }]))

    await expect(startMcpAuth('key-only')).rejects.toThrow(/没有可用的 OAuth 认证方法.*key/s)
    expect(oauthConnectMock).not.toHaveBeenCalled()
  })

  it('authenticateMcp 在 mode=code 时不轮询，抛错并提示改用 startMcpAuth/completeMcpAuth', async () => {
    mcpListMock.mockResolvedValue(
      mcpListResult([{ name: 'code-mode', status: { status: 'needs_auth', error: '' }, integrationID: 'int_1' }]),
    )
    integrationGetMock.mockResolvedValue(integrationInfo([OAUTH_METHOD]))
    oauthConnectMock.mockResolvedValue(oauthAttempt({ mode: 'code' }))

    await expect(authenticateMcp('code-mode')).rejects.toThrow(/授权码模式（mode=code）/)
    // 关键：不能进入轮询（否则 UI 会静默卡住）
    expect(oauthStatusMock).not.toHaveBeenCalled()
  })

  it('authenticateMcp 在 mode=auto 时轮询到 complete 才返回', async () => {
    vi.useFakeTimers()
    try {
      mcpListMock.mockResolvedValue(
        mcpListResult([{ name: 'auto-mode', status: { status: 'needs_auth', error: '' }, integrationID: 'int_1' }]),
      )
      integrationGetMock.mockResolvedValue(integrationInfo([OAUTH_METHOD]))
      oauthConnectMock.mockResolvedValue(oauthAttempt({ mode: 'auto' }))
      oauthStatusMock
        .mockResolvedValueOnce({ data: { status: 'pending', time: { created: 1, expires: 2 } } })
        .mockResolvedValueOnce({ data: { status: 'complete', time: { created: 1, expires: 2 } } })

      const promise = authenticateMcp('auto-mode')
      // 第一次 status 是 pending → 等 1s 后第二次拿到 complete
      await vi.advanceTimersByTimeAsync(1_000)

      await expect(promise).resolves.toBeUndefined()
      expect(oauthStatusMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('authenticateMcp 在 attempt failed 时抛出服务端给出的失败原因', async () => {
    mcpListMock.mockResolvedValue(
      mcpListResult([{ name: 'auto-failed', status: { status: 'needs_auth', error: '' }, integrationID: 'int_1' }]),
    )
    integrationGetMock.mockResolvedValue(integrationInfo([OAUTH_METHOD]))
    oauthConnectMock.mockResolvedValue(oauthAttempt({ mode: 'auto' }))
    oauthStatusMock.mockResolvedValue({
      data: { status: 'failed', message: 'invalid_client', time: { created: 1, expires: 2 } },
    })

    await expect(authenticateMcp('auto-failed')).rejects.toThrow(/OAuth 认证失败：invalid_client/)
  })

  it('removeMcpAuth 走凭证删除（credential.remove，无 location 参数）', async () => {
    mcpListMock.mockResolvedValue(
      mcpListResult([{ name: 'oauth-remove', status: { status: 'needs_auth', error: '' }, integrationID: 'int_1' }]),
    )
    integrationGetMock.mockResolvedValue(
      integrationInfo([OAUTH_METHOD], [{ type: 'credential', id: 'cred_1', label: 'GitHub', method: 'oauth' }]),
    )
    credentialRemoveMock.mockResolvedValue(undefined)

    await removeMcpAuth('oauth-remove', '/workspace/demo')

    expect(credentialRemoveMock).toHaveBeenCalledWith({ credentialID: 'cred_1' })
  })

  it('removeMcpAuth 没有凭证时抛中文错误', async () => {
    mcpListMock.mockResolvedValue(
      mcpListResult([{ name: 'oauth-no-cred', status: { status: 'connected' }, integrationID: 'int_1' }]),
    )
    integrationGetMock.mockResolvedValue(integrationInfo([OAUTH_METHOD], []))

    await expect(removeMcpAuth('oauth-no-cred')).rejects.toThrow(/没有任何已保存的凭证/)
    expect(credentialRemoveMock).not.toHaveBeenCalled()
  })
})
