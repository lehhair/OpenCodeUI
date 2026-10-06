import { beforeEach, describe, expect, it } from 'vitest'
import { notificationCoordinator } from './notificationCoordinator'

describe('notificationCoordinator（官方 coordinator.once 同款跨标签去重）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('同一事件 id 只认领一次（内存 Set）', async () => {
    const runs: string[] = []
    await notificationCoordinator.once('evt_1', () => runs.push('a'))
    await notificationCoordinator.once('evt_1', () => runs.push('b'))
    expect(runs).toEqual(['a'])
  })

  it('localStorage 清单跨「标签页」（本测试进程内等效）认领', async () => {
    localStorage.setItem('opencode:notification-sound', JSON.stringify(['evt_9']))
    const runs: string[] = []
    await notificationCoordinator.once('evt_9', () => runs.push('x'))
    expect(runs).toEqual([])
  })

  it('无事件 id → 直接执行（无从对账保持原行为）', async () => {
    const runs: string[] = []
    await notificationCoordinator.once(undefined, () => runs.push('a'))
    expect(runs).toEqual(['a'])
  })

  it('认领后写入 localStorage 清单', async () => {
    await notificationCoordinator.once('evt_new', () => undefined)
    const claimed = JSON.parse(localStorage.getItem('opencode:notification-sound') ?? '[]')
    expect(claimed).toContain('evt_new')
  })
})
