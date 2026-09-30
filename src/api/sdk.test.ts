import { beforeEach, describe, expect, it, vi } from 'vitest'

const { makeMock, getActiveBaseUrlMock, getActiveAuthMock, isTauriMock } = vi.hoisted(() => ({
  makeMock: vi.fn((config: unknown) => ({ config })),
  getActiveBaseUrlMock: vi.fn(() => 'http://127.0.0.1:4096'),
  getActiveAuthMock: vi.fn(() => null),
  isTauriMock: vi.fn(() => false),
}))

// OpenCode V2：包名从 @opencode-ai/sdk 换成 @opencode/client，工厂从
// createOpencodeClient() 换成 OpenCode.make()
vi.mock('@opencode/client', () => ({
  OpenCode: { make: makeMock },
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveBaseUrl: getActiveBaseUrlMock,
    getActiveAuth: getActiveAuthMock,
  },
}))

vi.mock('../utils/tauri', () => ({
  isTauri: isTauriMock,
}))

type MockClient = {
  config: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }
}

describe('sdk request lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    getActiveBaseUrlMock.mockReturnValue('http://127.0.0.1:4096')
    getActiveAuthMock.mockReturnValue(null)
    isTauriMock.mockReturnValue(false)
    const { abortInFlightApiRequests, invalidateSDKClient } = await import('./sdk')
    abortInFlightApiRequests('reset test state')
    invalidateSDKClient()
  })

  it('aborts in-flight SDK requests when the server endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    let signal: AbortSignal | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
      })
    })

    const client = getSDKClient() as unknown as MockClient
    const request = client.config.fetch('http://127.0.0.1:4096/api/location')

    abortInFlightApiRequests('Server endpoint changed')

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal?.aborted).toBe(true)
  })

  it('prevents stale SDK clients from starting new requests after endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    const client = getSDKClient() as unknown as MockClient
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    abortInFlightApiRequests('Server endpoint changed')

    await expect(client.config.fetch('http://127.0.0.1:4096/api/location')).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('creates the client through OpenCode.make with baseUrl and injected fetch', async () => {
    const { getSDKClient } = await import('./sdk')

    getSDKClient()

    expect(makeMock).toHaveBeenCalled()
    const options = makeMock.mock.calls.at(-1)?.[0] as { baseUrl: string; fetch: unknown }
    expect(options.baseUrl).toBe('http://127.0.0.1:4096')
    expect(typeof options.fetch).toBe('function')
  })

  it('always authenticates as the hard-coded "opencode" user', async () => {
    // V2 服务端把用户名硬编码为 "opencode"（packages/server/src/auth.ts:20），
    // 其他用户名一律 401 → 必须忽略 serverStore 里存的 username
    getActiveAuthMock.mockReturnValue({ username: 'someone-else', password: 'pw' } as never)
    const { getSDKClient } = await import('./sdk')

    getSDKClient()

    const options = makeMock.mock.calls.at(-1)?.[0] as { headers: Record<string, string> }
    // btoa('opencode:pw')
    expect(options.headers.Authorization).toBe('Basic ' + btoa('opencode:pw'))
  })
})
