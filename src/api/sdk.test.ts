import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// SDK 客户端请求生命周期测试（OpenCode v2）
//
// v2 用 `OpenCode.make({ baseUrl, headers, fetch })` 建客户端；
// 我们注入的 fetch 承担两件事：
//   1. 在 Tauri 下换成 plugin-http 的 fetch
//   2. 记录在途请求，服务器端点变化时统一中断
//
// 这里直接测注入进去的那个 fetch，从而验证上述行为。
// ============================================

const { makeMock, getActiveBaseUrlMock, getActiveAuthMock, isTauriMock } = vi.hoisted(() => ({
  makeMock: vi.fn((options: { fetch?: typeof globalThis.fetch }) => ({
    __fetch: options.fetch,
    __options: options,
  })),
  getActiveBaseUrlMock: vi.fn(() => 'http://127.0.0.1:4096'),
  getActiveAuthMock: vi.fn(() => null),
  isTauriMock: vi.fn(() => false),
}))

vi.mock('@opencode/client/promise', () => ({
  OpenCode: { make: makeMock },
}))

vi.mock('../store/serverStore', () => ({
  makeBasicAuthHeader: vi.fn(() => 'Basic token'),
  serverStore: {
    getActiveBaseUrl: getActiveBaseUrlMock,
    getActiveAuth: getActiveAuthMock,
  },
}))

vi.mock('../utils/tauri', () => ({
  isTauri: isTauriMock,
}))

type MockClient = {
  __fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  __options: { baseUrl: string; headers?: Record<string, string> }
}

describe('v2 client request lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    makeMock.mockClear()
    getActiveBaseUrlMock.mockReturnValue('http://127.0.0.1:4096')
    getActiveAuthMock.mockReturnValue(null)
    isTauriMock.mockReturnValue(false)
    const { abortInFlightApiRequests, invalidateSDKClient } = await import('./sdk')
    abortInFlightApiRequests('reset test state')
    invalidateSDKClient()
  })

  it('builds the client from the active server base URL', async () => {
    const { getSDKClient } = await import('./sdk')
    const client = getSDKClient() as unknown as MockClient

    expect(makeMock).toHaveBeenCalledTimes(1)
    expect(client.__options.baseUrl).toBe('http://127.0.0.1:4096')
  })

  it('aborts in-flight requests when the server endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    const client = getSDKClient() as unknown as MockClient
    let signal: AbortSignal | undefined

    // 用注入的 fetch（不是全局 fetch）发起一个永不 resolve 的请求
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
      })
    })

    const request = client.__fetch('http://127.0.0.1:4096/api/session')

    abortInFlightApiRequests('Server endpoint changed')

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal?.aborted).toBe(true)
  })

  it('prevents stale clients from starting new requests after endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    const client = getSDKClient() as unknown as MockClient
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    abortInFlightApiRequests('Server endpoint changed')

    // 旧客户端（代次落后）必须在起飞前就失败，不能真的发出请求
    await expect(client.__fetch('http://127.0.0.1:4096/api/session')).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rebuilds the client when the server changes', async () => {
    const { getSDKClient, invalidateSDKClient } = await import('./sdk')

    const first = getSDKClient() as unknown as MockClient
    expect(first.__options.baseUrl).toBe('http://127.0.0.1:4096')

    // 同 key 命中缓存
    expect(getSDKClient()).toBe(first)

    getActiveBaseUrlMock.mockReturnValue('http://127.0.0.1:5000')
    invalidateSDKClient()

    const second = getSDKClient() as unknown as MockClient
    expect(second.__options.baseUrl).toBe('http://127.0.0.1:5000')
    expect(second).not.toBe(first)
  })
})
