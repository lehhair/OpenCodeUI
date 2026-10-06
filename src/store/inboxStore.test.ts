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

  it('setItems 合并快照期间到达的事件增量（官方 pendingUpdates 同款）', () => {
    inboxStore.setItems('s1', [userItem('a'), userItem('b')])
    inboxStore.beginSnapshot('s1')
    // 快照拉取期间：a 被投递、c 新入队、b 改 steer
    inboxStore.removeItem('s1', 'a')
    inboxStore.upsertItem('s1', userItem('c'))
    inboxStore.updateDelivery('s1', 'b', 'steer')

    // 旧快照（拉取时点：a、b 都在，无 c，b 还是 queue）
    inboxStore.setItems('s1', [userItem('a'), userItem('b')])

    const items = inboxStore.getItems('s1')
    expect(items.map(i => i.id)).toEqual(['b', 'c']) // a 不得复活
    expect(items.find(i => i.id === 'b')?.delivery).toBe('steer') // 事件覆盖快照
    expect(items.find(i => i.id === 'c')).toBeDefined() // 新入队不丢
  })

  it('setItems 保留 keepIf 命中的在途乐观条目（官方 inflight 同款）', () => {
    // 本地乐观 admit（回声未到）
    inboxStore.upsertItem('s1', userItem('local-1'))
    // 快照不含 local-1（早于 admit 发出），但含服务端已有的 srv-1
    inboxStore.setItems('s1', [userItem('srv-1')], { keepIf: id => id === 'local-1' })

    expect(inboxStore.getItems('s1').map(i => i.id).sort()).toEqual(['local-1', 'srv-1'])
  })

  it('setItems 不保留 keepIf 未命中的条目', () => {
    inboxStore.upsertItem('s1', userItem('local-1'))
    inboxStore.setItems('s1', [userItem('srv-1')], { keepIf: () => false })
    expect(inboxStore.getItems('s1').map(i => i.id)).toEqual(['srv-1'])
  })

  it('endSnapshot 丢弃记账，事件不再影响后续快照', () => {
    inboxStore.setItems('s1', [userItem('a')])
    inboxStore.beginSnapshot('s1')
    inboxStore.removeItem('s1', 'a')
    inboxStore.endSnapshot('s1')
    // 失败后重新拉：旧快照里的 a 不再被"记账的出队"影响（a 现在不在 store 里，
    // 但快照语义上 a 是服务端状态，应照快照呈现）
    inboxStore.setItems('s1', [userItem('a')])
    expect(inboxStore.getItems('s1').map(i => i.id)).toEqual(['a'])
  })
})
