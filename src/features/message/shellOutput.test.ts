import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followShellOutput, SHELL_OUTPUT_TAIL_BYTES } from './shellOutput'

const loadMock = vi.fn()
const notFoundMock = vi.fn()

vi.mock('../../api/shell', () => ({
  getShellOutput: (id: string, cursor: number) => loadMock(id, cursor),
}))

vi.mock('@opencode/client/promise', () => ({
  isShellNotFoundError: (cause: unknown) => notFoundMock(cause),
}))

const flush = () => new Promise(resolve => setTimeout(resolve, 20))

describe('followShellOutput（官方 shell-output.ts 同款）', () => {
  beforeEach(() => {
    loadMock.mockReset()
    notFoundMock.mockReset()
  })

  it('按游标增量追加输出（非存活时一次读完全部分页）', async () => {
    loadMock.mockImplementation(async (_id: string, cursor: number) => {
      if (cursor === 0) return { output: 'hello ', cursor: 6, size: 11, truncated: false }
      return { output: 'world', cursor: 11, size: 11, truncated: false }
    })
    const outputs: string[] = []
    // running=false：补读路径在一次调用里翻完所有页直到 complete
    const dispose = followShellOutput({ id: 'sh-1', running: false, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    expect(outputs.at(-1)).toBe('hello world')
    expect(loadMock).toHaveBeenCalledWith('sh-1', 0)
    expect(loadMock).toHaveBeenCalledWith('sh-1', 6)
  })

  it('存活期间每轮只读一页（官方：running 时 1s 轮询推进）', async () => {
    loadMock.mockImplementation(async (_id: string, cursor: number) => {
      if (cursor === 0) return { output: 'hello ', cursor: 6, size: 11, truncated: false }
      return { output: 'world', cursor: 11, size: 11, truncated: false }
    })
    const outputs: string[] = []
    const dispose = followShellOutput({ id: 'sh-live', running: true, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    // 首轮只读到第一页；第二页要等下一次 1s 轮询
    expect(outputs.at(-1)).toBe('hello ')
  })

  it('not found 的 shell 标记 missing 且不再请求', async () => {
    notFoundMock.mockReturnValue(true)
    loadMock.mockRejectedValue(new Error('Shell not found'))
    const outputs: string[] = []
    const dispose = followShellOutput({ id: 'sh-gone', running: true, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    const calls = loadMock.mock.calls.length
    // 再挂载一次：missing 状态直接短路，不再请求
    followShellOutput({ id: 'sh-gone', running: true, onOutput: () => {} })
    await flush()
    expect(loadMock.mock.calls.length).toBe(calls)
  })

  it('输出超过 64KB 时只保留尾部', async () => {
    const big = 'x'.repeat(SHELL_OUTPUT_TAIL_BYTES + 100)
    loadMock.mockResolvedValue({ output: big, cursor: big.length, size: big.length, truncated: false })
    const outputs: string[] = []
    const dispose = followShellOutput({ id: 'sh-big', running: true, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    expect(outputs.at(-1)?.length).toBe(SHELL_OUTPUT_TAIL_BYTES)
  })

  it('重挂载时从记忆的游标续读，不回零', async () => {
    loadMock.mockImplementation(async (_id: string, cursor: number) =>
      cursor === 0
        ? { output: 'chunk', cursor: 5, size: 100, truncated: false }
        : { output: '', cursor, size: 100, truncated: false },
    )
    const first = followShellOutput({ id: 'sh-resume', running: false, onOutput: () => {} })
    await flush()
    first()

    const outputs: string[] = []
    const second = followShellOutput({ id: 'sh-resume', running: false, onOutput: o => outputs.push(o) })
    await flush()
    second()
    // 有缓存输出直接回放；续读游标之后无新增，不重复
    expect(outputs[0]).toBe('chunk')
    expect(outputs.at(-1)).toBe('chunk')
    // 续读请求用的是记忆游标，不是 0
    expect(loadMock.mock.calls.at(-1)?.[1]).toBe(5)
  })
})
