import { describe, it, expect } from 'vitest'
import { projectQueueEchoes } from './chatAreaVisibility'
import type { SessionMessageInfo } from '../../types/api/message'

function msg(id: string): SessionMessageInfo {
  return { id, type: 'user' } as unknown as SessionMessageInfo
}

function inbox(id: string, delivery: 'queue' | 'steer') {
  return { id, type: 'user', delivery }
}

describe('projectQueueEchoes（官方 visibleTimelineMessages 同款）', () => {
  it('returns messages unchanged when the inbox is empty', () => {
    const messages = [msg('a'), msg('b')]
    expect(projectQueueEchoes(messages, [])).toBe(messages)
  })

  it('hides queue echoes from the transcript（队列气泡是唯一展示位）', () => {
    const messages = [msg('a'), msg('q1'), msg('b')]
    const result = projectQueueEchoes(messages, [inbox('q1', 'queue')])
    expect(result.map(m => m.id)).toEqual(['a', 'b'])
  })

  it('keeps steer echoes but moves them to the end（投递前不占位 assistant 工作）', () => {
    const messages = [msg('a'), msg('s1'), msg('b')]
    const result = projectQueueEchoes(messages, [inbox('s1', 'steer')])
    expect(result.map(m => m.id)).toEqual(['a', 'b', 's1'])
  })

  it('handles queue + steer together', () => {
    const messages = [msg('a'), msg('s1'), msg('q1'), msg('b'), msg('s2')]
    const result = projectQueueEchoes(messages, [inbox('q1', 'queue'), inbox('s1', 'steer'), inbox('s2', 'steer')])
    expect(result.map(m => m.id)).toEqual(['a', 'b', 's1', 's2'])
  })

  it('ignores non-user inbox items', () => {
    const messages = [msg('a'), msg('b')]
    const result = projectQueueEchoes(messages, [{ id: 'b', type: 'compaction', delivery: 'queue' }])
    expect(result.map(m => m.id)).toEqual(['a', 'b'])
  })
})
