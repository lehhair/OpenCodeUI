import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { AssistantMessage, SessionMessageInfo, UserMessage } from '../../types/api/message'
import type { ProcessTimelineItem } from './chatPageModel'
import {
  buildCachedSizeMap,
  clearTimelineSessionCache,
  estimateMessageHeight,
  estimateTimelineItemSize,
  estimateTimelineTotalHeight,
  readSessionMeasurements,
  restoreMeasurements,
  sessionCacheKey,
  writeSessionMeasurements,
} from './timelineMetrics'

function user(id: string, text: string): UserMessage {
  return { id, type: 'user', text, time: { created: 1 } }
}

function assistant(id: string, content: AssistantMessage['content']): AssistantMessage {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
    time: { created: 1, completed: 2 },
  }
}

function messageItem(message: SessionMessageInfo): ProcessTimelineItem {
  return { kind: 'message', key: message.id, message }
}

function measurement(key: string, size: number, index = 0): VirtualItem {
  return { key, index, size, start: 0, end: size, lane: 0 }
}

describe('高度估算', () => {
  it('折叠的 reasoning 不按全文高度估算', () => {
    const longReasoning = assistant('a', [{ type: 'reasoning', text: 'x'.repeat(20_000) }])
    const longText = assistant('b', [{ type: 'text', text: 'x'.repeat(20_000) }])

    expect(estimateMessageHeight(longReasoning)).toBeLessThan(200)
    expect(estimateMessageHeight(longText)).toBeGreaterThan(estimateMessageHeight(longReasoning))
  })

  it('用户长消息按折叠预览给上限', () => {
    const short = user('u1', 'hi')
    const long = user('u2', 'x'.repeat(10_000))
    expect(estimateMessageHeight(long)).toBeGreaterThan(estimateMessageHeight(short))
    expect(estimateMessageHeight(long)).toBeLessThan(400)
  })

  it('过程壳展开时计入子消息，折叠时只计入最终回答', () => {
    const child = assistant('child', [{ type: 'text', text: 'x'.repeat(2000) }])
    const final = assistant('final', [{ type: 'text', text: 'x'.repeat(400) }])
    const active: ProcessTimelineItem = {
      kind: 'process-shell',
      key: 'shell',
      userMessageId: 'u1',
      isActive: true,
      children: [{ message: child, processContentScope: 'process' }],
    }
    const collapsed: ProcessTimelineItem = {
      kind: 'process-shell',
      key: 'shell',
      userMessageId: 'u1',
      isActive: false,
      children: [{ message: child, processContentScope: 'process' }],
      finalMessage: final,
    }

    expect(estimateTimelineItemSize(active)).toBeGreaterThan(estimateTimelineItemSize(collapsed))
  })
})

describe('会话测量缓存', () => {
  it('cache key 区分过程折叠模式', () => {
    expect(sessionCacheKey('s1', true)).not.toBe(sessionCacheKey('s1', false))
  })

  it('恢复时只取当前 timeline 仍存在的 key，并重算 index/start/end', () => {
    const items = [messageItem(user('a', 'a')), messageItem(user('c', 'c'))]
    const restored = restoreMeasurements([measurement('a', 100), measurement('b', 200), measurement('c', 300)], items)

    expect(restored?.map(item => item.key)).toEqual(['a', 'c'])
    expect(restored?.map(item => item.index)).toEqual([0, 1])
    expect(restored?.[1]).toMatchObject({ start: 100, size: 300, end: 400 })
  })

  it('没有匹配 key 时不返回缓存', () => {
    expect(restoreMeasurements([measurement('gone', 100)], [messageItem(user('a', 'a'))])).toBeUndefined()
    expect(buildCachedSizeMap(undefined)).toBeNull()
  })

  it('总高度对新消息使用估算值', () => {
    const items = [messageItem(user('a', 'a')), messageItem(user('b', 'b'))]
    const total = estimateTimelineTotalHeight(items, new Map([['a', 100]]))

    expect(total).toBeGreaterThan(100)
    expect(total).toBe(100 + estimateTimelineItemSize(items[1]))
  })

  it('写回时只保留靠底部的一段并走 LRU', () => {
    clearTimelineSessionCache()
    const snapshot = Array.from({ length: 3005 }, (_unused, index) => measurement(`k${index}`, 10, index))
    writeSessionMeasurements('s1', snapshot)

    const restored = readSessionMeasurements('s1')
    expect(restored).toHaveLength(3000)
    expect(restored?.[0]?.key).toBe('k5')
    expect(restored?.at(-1)?.key).toBe('k3004')
  })
})
