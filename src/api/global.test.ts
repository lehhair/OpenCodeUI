// ============================================
// global API 单元测试（阶段 3a）
// ============================================
//
// 这一组两个函数的去向**完全不同**，容易混：
//
//   - `disposeInstance(directory)` → **迁移**：`DELETE /api/debug/location`
//     （SDK `debug.location.evict`），语义是「把该 location 从服务端缓存里驱逐」，
//     下次用到它时冷启动。⚠️ 目录必须显式传，不传会驱逐服务端 cwd 那个 location。
//
//   - `disposeGlobal()` → **阶段 3b 已下架**：V2 删了 `POST /global/dispose`，
//     没有任何端点能一次性释放整个进程的资源（debug/location 一次只驱逐一个）。
//     本仓库零调用点，函数已删除。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeInstance } from './global'

const evictMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    debug: {
      location: {
        evict: (...args: unknown[]) => evictMock(...args),
      },
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'local',
  },
}))

describe('global（阶段 3a）', () => {
  beforeEach(() => {
    evictMock.mockReset().mockResolvedValue(undefined)
  })

  it('disposeInstance：走 debug.location.evict 并带上 location[directory]', async () => {
    const result = await disposeInstance('/data/wt/feature')

    expect(evictMock).toHaveBeenCalledTimes(1)
    expect(evictMock).toHaveBeenCalledWith({ location: { directory: '/data/wt/feature' } })
    // V2 返回 204 无内容 → 保持调用方的 boolean 约定
    expect(result).toBe(true)
  })

  it('disposeInstance：不传目录时 location 入参为 undefined（驱逐服务端 cwd 的 location）', async () => {
    await disposeInstance()

    expect(evictMock).toHaveBeenCalledWith(undefined)
  })

  it('disposeGlobal 已在阶段 3b 下架：模块不再导出它，且不产生网络调用', async () => {
    const mod = await import('./global')
    expect('disposeGlobal' in mod).toBe(false)
    expect(evictMock).not.toHaveBeenCalled()
  })
})
