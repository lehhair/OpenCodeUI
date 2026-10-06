import { describe, expect, it } from 'vitest'
import { projectQueueItems, queueMutationSettled } from './queueProjection'
import type { QueuedUserPrompt } from '../../store/inboxStore'

function item(id: string, text = `text-${id}`): QueuedUserPrompt {
  return {
    id,
    sessionID: 'ses-1',
    time: { created: Date.now() },
    type: 'user',
    delivery: 'queue',
    payload: { text },
  } as unknown as QueuedUserPrompt
}

describe('queueProjection（官方 rows() 投影同款）', () => {
  it('无 mutation 原样透传', () => {
    const items = [item('a'), item('b')]
    expect(projectQueueItems(items, null).map(r => r.item.id)).toEqual(['a', 'b'])
  })

  it('编辑：数量恒定——替换到达前占位显示新文本，落地后无缝', () => {
    // 编辑「原文」→「编辑后」，期望序列 [编辑后, 保留]
    const mutation = { expected: ['编辑后', '保留'] }
    // 编辑开始前（原样）
    let rows = projectQueueItems([item('a', '原文'), item('b', '保留')], mutation)
    expect(rows.map(r => r.item.payload.text)).toEqual(['编辑后', '保留']) // 占位显示期望文本
    // admit 先到达（多了一条）→ 数量仍恒定
    rows = projectQueueItems([item('a', '原文'), item('b', '保留'), item('new', '编辑后')], mutation)
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.item.payload.text)).toEqual(['编辑后', '保留'])
    // cancel 落地 → 与期望一致
    rows = projectQueueItems([item('b', '保留'), item('new', '编辑后')], mutation)
    expect(rows).toHaveLength(2)
  })

  it('重排：rewrite 过渡态（新旧并存/尾部重写）数量恒定', () => {
    // [AAA,BBB,CCC] 拖到 [BBB,CCC,AAA]；rewrite 途中 6 条并存
    const mutation = { expected: ['BBB', 'CCC', 'AAA'] }
    const rows = projectQueueItems(
      [item('a', 'AAA'), item('b', 'BBB'), item('c', 'CCC'), item('b2', 'BBB'), item('c2', 'CCC'), item('a2', 'AAA')],
      mutation,
    )
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.item.payload.text)).toEqual(['BBB', 'CCC', 'AAA'])
  })

  it('settled 判定：文本序列与期望一致即落地', () => {
    const mutation = { expected: ['编辑后', '保留'] }
    expect(queueMutationSettled([item('new', '编辑后'), item('b', '保留')], mutation)).toBe(true)
    expect(queueMutationSettled([item('b', '保留'), item('new', '编辑后')], mutation)).toBe(false)
    expect(queueMutationSettled([item('new', '编辑后')], mutation)).toBe(false)
  })

  it('同文本多条按到达顺序消费', () => {
    const mutation = { expected: ['同', '同'] }
    const rows = projectQueueItems([item('a', '同'), item('b', '同')], mutation)
    expect(rows.map(r => r.item.id)).toEqual(['a', 'b'])
  })
})
