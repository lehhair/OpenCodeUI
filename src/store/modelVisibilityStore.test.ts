import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '../types/api'

function model(providerID: string, id: string): Model {
  return {
    id,
    name: id,
    providerID,
  } as Model
}

function readHiddenKeys(): string[] {
  const key = Object.keys(localStorage).find(k => k.endsWith(':hidden-model-keys'))
  if (!key) return []
  const raw = localStorage.getItem(key)
  if (!raw) return []
  return JSON.parse(raw) as string[]
}

describe('modelVisibilityStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('writes the current hidden keys on every hide, not the previous snapshot', async () => {
    const { modelVisibilityStore } = await import('./modelVisibilityStore')
    const a = model('openai', 'gpt-4')
    const b = model('openai', 'gpt-4o')

    modelVisibilityStore.setVisible(a, false)
    expect(readHiddenKeys()).toEqual(['openai:gpt-4'])
    expect(modelVisibilityStore.isVisible(a)).toBe(false)

    modelVisibilityStore.setVisible(b, false)
    expect(readHiddenKeys()).toEqual(['openai:gpt-4', 'openai:gpt-4o'])
  })

  it('keeps re-enabled models visible after a full store reload', async () => {
    const { modelVisibilityStore } = await import('./modelVisibilityStore')
    const a = model('openai', 'gpt-4')
    const b = model('openai', 'gpt-4o')

    modelVisibilityStore.setManyVisible([a, b], false)
    modelVisibilityStore.setVisible(a, true)
    expect(readHiddenKeys()).toEqual(['openai:gpt-4o'])

    vi.resetModules()
    const reloaded = await import('./modelVisibilityStore')
    expect(reloaded.modelVisibilityStore.isVisible(a)).toBe(true)
    expect(reloaded.modelVisibilityStore.isVisible(b)).toBe(false)
    expect(reloaded.modelVisibilityStore.getSnapshot()).toEqual(['openai:gpt-4o'])
  })

  it('stays silent when a non-active server endpoint changes', async () => {
    const { serverStore } = await import('./serverStore')
    const { modelVisibilityStore } = await import('./modelVisibilityStore')

    modelVisibilityStore.setVisible(model('openai', 'gpt-4'), false)

    const notify = vi.fn()
    const off = modelVisibilityStore.subscribe(notify)

    // server-runtime-updated 对任意服务器无条件广播（含非 active 注册/换端点）：
    // 可见性集合按 serverId 分片跟随 active，无关事件不得 reload + emit 产生新快照引用
    serverStore.upsertServer({ id: 'wsl:ubuntu', name: 'WSL', url: 'http://127.0.0.1:59001' })
    serverStore.upsertServer({ id: 'wsl:ubuntu', name: 'WSL', url: 'http://127.0.0.1:59002' })
    expect(notify).not.toHaveBeenCalled()
    expect(modelVisibilityStore.isVisible(model('openai', 'gpt-4'))).toBe(false)

    // active 切换仍须重载新服务器数据并通知订阅方
    serverStore.setActiveServer('wsl:ubuntu')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(modelVisibilityStore.isVisible(model('openai', 'gpt-4'))).toBe(true)

    off()
  })

  it('persists consecutive channel toggles through reload', async () => {
    const { modelVisibilityStore } = await import('./modelVisibilityStore')
    const models = [model('anthropic', 'claude-3'), model('anthropic', 'claude-4')]

    modelVisibilityStore.setManyVisible(models, false)
    modelVisibilityStore.setManyVisible(models, true)
    expect(readHiddenKeys()).toEqual([])

    vi.resetModules()
    const reloaded = await import('./modelVisibilityStore')
    expect(reloaded.modelVisibilityStore.isVisible(models[0])).toBe(true)
    expect(reloaded.modelVisibilityStore.isVisible(models[1])).toBe(true)
    expect(reloaded.modelVisibilityStore.getSnapshot()).toEqual([])
  })
})
