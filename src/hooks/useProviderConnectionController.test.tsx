import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationInfo } from '@opencode/client/promise'

const {
  getIntegrationMock,
  connectKeyMock,
  oauthConnectMock,
  oauthStatusMock,
  oauthCompleteMock,
  oauthCancelMock,
  refreshModelsMock,
  openExternalUrlMock,
} = vi.hoisted(() => ({
  getIntegrationMock: vi.fn(),
  connectKeyMock: vi.fn(),
  oauthConnectMock: vi.fn(),
  oauthStatusMock: vi.fn(),
  oauthCompleteMock: vi.fn(),
  oauthCancelMock: vi.fn(),
  refreshModelsMock: vi.fn(() => Promise.resolve()),
  openExternalUrlMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('../api', () => ({
  getIntegration: getIntegrationMock,
  connectIntegrationKey: connectKeyMock,
  connectIntegrationOauth: oauthConnectMock,
  getIntegrationOauthStatus: oauthStatusMock,
  completeIntegrationOauth: oauthCompleteMock,
  cancelIntegrationOauth: oauthCancelMock,
}))

vi.mock('./useModels', () => ({
  refreshModels: refreshModelsMock,
}))

vi.mock('../utils/externalUrl', () => ({
  openExternalUrl: openExternalUrlMock,
}))

import { useProviderConnectionController } from './useProviderConnectionController'

function integration(methods: IntegrationInfo['methods']): IntegrationInfo {
  return { id: 'anthropic', name: 'Anthropic', methods, connections: [] } as IntegrationInfo
}

function render(provider = 'anthropic', onComplete = vi.fn()) {
  return {
    onComplete,
    ...renderHook(() =>
      useProviderConnectionController({ provider, onComplete }),
    ),
  }
}

describe('useProviderConnectionController（官方 controller.ts 同款状态机）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    oauthConnectMock.mockResolvedValue({ attemptID: 'att-1', url: 'https://auth.example', mode: 'auto' })
    oauthStatusMock.mockResolvedValue({ status: 'complete' })
    oauthCompleteMock.mockResolvedValue(undefined)
    oauthCancelMock.mockResolvedValue(undefined)
    connectKeyMock.mockResolvedValue(undefined)
    getIntegrationMock.mockResolvedValue(integration([{ type: 'key', label: 'API key' }]))
  })

  it('methods 过滤 key/oauth；无方法时退化为单个 API key 方法', async () => {
    getIntegrationMock.mockResolvedValue(
      integration([
        { type: 'env', label: 'env' } as never,
        { type: 'oauth', id: 'oauth', label: 'Sign in' } as never,
      ]),
    )
    const { result } = render()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.methods.map(m => m.type)).toEqual(['oauth'])

    getIntegrationMock.mockResolvedValue(integration([]))
    const empty = renderHook(() => useProviderConnectionController({ provider: 'x', onComplete: vi.fn() }))
    await waitFor(() => expect(empty.result.current.loading).toBe(false))
    expect(empty.result.current.methods).toHaveLength(1)
    expect(empty.result.current.methods[0].type).toBe('key')
  })

  it('单方法自动选中（官方 autoIndex 同款）', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.methodIndex).toBe(0))
  })

  it('key 方法：connectKey 走 connect.key 并 finish（重拉 models + onComplete）', async () => {
    const onComplete = vi.fn()
    const { result } = render('anthropic', onComplete)
    await waitFor(() => expect(result.current.methodIndex).toBe(0))

    await act(async () => {
      await result.current.connectKey('sk-test')
    })

    expect(connectKeyMock).toHaveBeenCalledWith('anthropic', 'sk-test', undefined, undefined, undefined)
    expect(refreshModelsMock).toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalled()
  })

  it('oauth 方法：connect → 拉起浏览器 → auto 轮询直到 complete', async () => {
    getIntegrationMock.mockResolvedValue(integration([{ type: 'oauth', id: 'oauth', label: 'Sign in' } as never]))
    oauthConnectMock.mockResolvedValue({ attemptID: 'att-1', url: 'https://auth.example', mode: 'auto' })
    oauthStatusMock.mockResolvedValue({ status: 'complete' })
    const onComplete = vi.fn()

    const { result } = render('anthropic', onComplete)
    await waitFor(() => expect(result.current.methodIndex).toBe(0))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(oauthConnectMock).toHaveBeenCalledWith('anthropic', 'oauth', undefined, undefined, undefined)
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://auth.example')
    expect(oauthStatusMock).toHaveBeenCalledWith('anthropic', 'att-1', undefined, undefined)
    expect(refreshModelsMock).toHaveBeenCalled()
  })

  it('oauth 轮询失败/过期 → error 状态，可 retry', async () => {
    getIntegrationMock.mockResolvedValue(integration([{ type: 'oauth', id: 'oauth', label: 'Sign in' } as never]))
    oauthConnectMock.mockResolvedValue({ attemptID: 'att-1', url: 'https://auth.example', mode: 'auto' })
    oauthStatusMock.mockResolvedValue({ status: 'failed', message: 'denied' })

    const { result } = render()
    // 状态与错误文案在同一条件里等待：状态机异步链路中可能出现
    // 中间渲染帧，单等其中一个会在负载高时偶发错位
    try {
      await waitFor(() => expect(result.current.state === 'error' && result.current.error === 'denied').toBe(true), {
        timeout: 3000,
      })
    } catch (error) {
      console.log('[trace] waitFor failed:', `state=${String(result.current.state)}`, `error=${JSON.stringify(result.current.error)}`, `connect=${oauthConnectMock.mock.calls.length}`, `status=${oauthStatusMock.mock.calls.length}`)
      throw error
    }
  })

  it('reset 取消进行中的授权尝试（官方 cancelAttempt 同款）', async () => {
    getIntegrationMock.mockResolvedValue(
      integration([
        { type: 'key', label: 'API key' } as never,
        { type: 'oauth', id: 'oauth', label: 'Sign in' } as never,
      ]),
    )
    oauthConnectMock.mockResolvedValue({ attemptID: 'att-9', url: 'https://auth.example', mode: 'code' })

    const { result } = render()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.select(1)
    })
    expect(result.current.authorization?.attemptID).toBe('att-9')

    act(() => {
      result.current.reset()
    })
    expect(oauthCancelMock).toHaveBeenCalledWith('anthropic', 'att-9', undefined, undefined)
    expect(result.current.methodIndex).toBeUndefined()
  })

  it('completeCode：成功走 complete 端点并 finish；失败返回错误消息', async () => {
    getIntegrationMock.mockResolvedValue(integration([{ type: 'oauth', id: 'oauth', label: 'Sign in' } as never]))
    oauthConnectMock.mockResolvedValue({ attemptID: 'att-1', url: 'https://auth.example', mode: 'code' })
    const onComplete = vi.fn()

    const { result } = render('anthropic', onComplete)
    await waitFor(() => expect(result.current.authorization?.attemptID).toBe('att-1'))

    oauthCompleteMock.mockRejectedValueOnce(new Error('bad code'))
    let message: string | undefined
    await act(async () => {
      message = await result.current.completeCode('wrong')
    })
    expect(message).toBe('bad code')

    oauthCompleteMock.mockResolvedValueOnce(undefined)
    await act(async () => {
      message = await result.current.completeCode('right')
    })
    expect(message).toBeUndefined()
    expect(oauthCompleteMock).toHaveBeenCalledWith('anthropic', 'att-1', 'right', undefined, undefined)
    expect(onComplete).toHaveBeenCalled()
  })

  it('有可见表单字段时先进入 form 态，答案随 select 传递', async () => {
    getIntegrationMock.mockResolvedValue(
      integration([
        {
          type: 'oauth',
          id: 'oauth',
          label: 'Sign in',
          form: [{ type: 'string', key: 'region', title: 'Region', hidden: false }],
        } as never,
      ]),
    )
    oauthConnectMock.mockResolvedValue({ attemptID: 'att-1', url: 'https://auth.example', mode: 'code' })

    const { result } = render()
    await waitFor(() => expect(result.current.methodIndex).toBe(0))
    expect(result.current.state).toBe('form')

    await act(async () => {
      await result.current.select(0, { region: 'us' })
    })
    expect(oauthConnectMock).toHaveBeenCalledWith('anthropic', 'oauth', { region: 'us' }, undefined, undefined)
  })
})
