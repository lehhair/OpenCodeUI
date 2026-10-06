import { beforeEach, describe, expect, it } from 'vitest'
import { sendAdmission, outboxAdd, outboxConfirm, outboxTryRollback, resetSendAdmission } from './sendAdmission'

describe('sendAdmission（官方 sending 链 + outbox 同款）', () => {
  beforeEach(() => {
    resetSendAdmission()
  })

  it('同会话的发送按提交顺序执行（后者等前者落定）', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const first = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const p1 = sendAdmission('s1', async () => {
      await first
      order.push('first')
    })
    const p2 = sendAdmission('s1', async () => {
      order.push('second')
    })

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(order).toEqual([]) // first 未落定，second 不得先行
    releaseFirst()
    await Promise.all([p1, p2])
    expect(order).toEqual(['first', 'second'])
  })

  it('一次失败不阻塞下一次发送', async () => {
    const first = sendAdmission('s1', async () => {
      throw new Error('boom')
    })
    await expect(first).rejects.toThrow('boom')

    const second = sendAdmission('s1', async () => 'ok')
    await expect(second).resolves.toBe('ok')
  })

  it('不同会话互不阻塞', async () => {
    const order: string[] = []
    let releaseA!: () => void
    const gateA = new Promise<void>(resolve => {
      releaseA = resolve
    })
    const pa = sendAdmission('sa', async () => {
      await gateA
      order.push('a')
    })
    const pb = sendAdmission('sb', async () => {
      order.push('b')
    })
    await pb
    expect(order).toEqual(['b'])
    releaseA()
    await pa
    expect(order).toEqual(['b', 'a'])
  })

  it('outbox：回声确认后不得回滚，未确认才允许', () => {
    outboxAdd('msg-1')
    // 回声到达 → 确认
    outboxConfirm('msg-1')
    expect(outboxTryRollback('msg-1')).toBe(false)

    outboxAdd('msg-2')
    // 无回声 → 允许回滚一次
    expect(outboxTryRollback('msg-2')).toBe(true)
    // 第二次不得再放行
    expect(outboxTryRollback('msg-2')).toBe(false)
  })
})
