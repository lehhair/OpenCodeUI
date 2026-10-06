import { describe, expect, it } from 'vitest'
import { arrayMoveId, computeDragTargetIndex } from './QueueBubbles'

describe('QueueBubbles 拖拽重排工具函数', () => {
  const rects = [
    { top: 0, height: 100 },
    { top: 110, height: 100 },
    { top: 220, height: 100 },
  ]

  it('指针在条目上半部 → 落在该条目前', () => {
    expect(computeDragTargetIndex(rects, 20)).toBe(0)
    expect(computeDragTargetIndex(rects, 130)).toBe(1)
    expect(computeDragTargetIndex(rects, 240)).toBe(2)
  })

  it('指针越过条目中线 → 进入下一槽位', () => {
    expect(computeDragTargetIndex(rects, 60)).toBe(1)
    expect(computeDragTargetIndex(rects, 175)).toBe(2)
  })

  it('指针越过最后一个中线 → 落到最后', () => {
    expect(computeDragTargetIndex(rects, 500)).toBe(2)
  })

  it('空列表 → 0', () => {
    expect(computeDragTargetIndex([], 100)).toBe(0)
  })

  it('arrayMoveId：把元素移到目标槽位', () => {
    expect(arrayMoveId(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(arrayMoveId(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(arrayMoveId(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })
})
