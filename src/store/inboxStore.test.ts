import { beforeEach, describe, expect, it } from 'vitest'
import { inboxStore } from './inboxStore'
import type { SessionInboxInfo } from '@opencode/client/promise'

function userItem(id: string, delivery: 'queue' | 'steer' = 'queue'): SessionInboxInfo {
  return {
    id,
    sessionID: 'ses-1',
    time: { created: Date.now() },
    type: 'user',
    payload: { text: `text-${id}` },
    delivery,
  } as SessionInboxInfo
}

describe('inboxStore', () => {
  beforeEach(() => {
    inboxStore.reset()
  })

  it('setItems 快照打底，空数组清除会话', () => {
    inboxStore.setItems('s1', [userItem('a'), userItem('b')])
    expect(inboxStore.getItems('s1').map(i => i.id)).toEqual(['a', 'b'])

    inboxStore.setItems('s1', [])
    expect(inboxStore.getItems('s1')).toEqual([])
  })

  it('upsertItem 同 id 覆盖（enqueued 回声对账）', () => {
    inboxStore.upsertItem('s1', userItem('a'))
    inboxStore.upsertItem('s1', { ...userItem('a'), delivery: 'steer' })
    expect(inboxStore.getItems('s1')).toHaveLength(1)
    expect(inboxStore.getItems('s1')[0].delivery).toBe('steer')
  })

  it('removeItem 出队，最后一个删除会话键', () => {
    inboxStore.setItems('s1', [userItem('a')])
    inboxStore.removeItem('s1', 'a')
    expect(inboxStore.getItems('s1')).toEqual([])
    // 不存在的 id 不应报错
    inboxStore.removeItem('s1', 'missing')
  })

  it('updateDelivery 只改投递方式', () => {
    inboxStore.setItems('s1', [userItem('a'), userItem('b')])
    inboxStore.updateDelivery('s1', 'a', 'steer')
    const items = inboxStore.getItems('s1')
    expect(items[0].delivery).toBe('steer')
    expect(items[1].delivery).toBe('queue')
  })

  it('clearSession 只清目标会话', () => {
    inboxStore.setItems('s1', [userItem('a')])
    inboxStore.setItems('s2', [userItem('b')])
    inboxStore.clearSession('s1')
    expect(inboxStore.getItems('s1')).toEqual([])
    expect(inboxStore.getItems('s2')).toHaveLength(1)
  })
})
