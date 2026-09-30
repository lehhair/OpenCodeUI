// ============================================
// config API 单元测试（阶段 3a：写侧收敛）
// ============================================
//
// V2 的配置**写入口严重缩水**，这里锁住收敛后的边界：
//
//   - `PATCH /api/experimental/config` 的 payload（`Config.Patch`）**只有 `shell`**；
//   - 所以 `updateGlobalConfig({ shell })` 要能正常写入；
//   - 含其它字段（主题/模型/agents…）时必须**显式报错**，绝不能静默丢掉
//     —— 那是「以为保存了其实没保存」这类最难查的 bug；
//   - `updateConfig`（location 级写）在 V2 里**根本没有端点** → 阶段 3b 已整体下架
//     （配置编辑器同时降级为「只读 + 仅 shell 可写 + 复制 JSON」）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateGlobalConfig } from './config'
import type { Config } from '../types/api/config'

const locationGetMock = vi.fn()
const configGetMock = vi.fn()
const configUpdateMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    location: { get: (...args: unknown[]) => locationGetMock(...args) },
    config: {
      get: (...args: unknown[]) => configGetMock(...args),
      update: (...args: unknown[]) => configUpdateMock(...args),
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'local',
  },
}))

const LOCATION = {
  directory: '/repo',
  project: { id: 'proj_1', directory: '/repo', canonical: '/repo' },
}

/** 全局配置文档（位于 ~/.config/opencode/，不在 /repo 之下） */
const GLOBAL_ENTRY = {
  type: 'document' as const,
  path: '/home/u/.config/opencode/opencode.json',
  info: { shell: '/bin/zsh' },
}

describe('config 写侧（阶段 3a）', () => {
  beforeEach(() => {
    locationGetMock.mockReset().mockResolvedValue(LOCATION)
    configGetMock.mockReset().mockResolvedValue([GLOBAL_ENTRY])
    configUpdateMock.mockReset().mockResolvedValue(undefined)
  })

  it('updateConfig 已在阶段 3b 下架：模块不再导出它（V2 的 /api/config 只有 GET）', async () => {
    const mod = await import('./config')
    expect('updateConfig' in mod).toBe(false)
    expect(configUpdateMock).not.toHaveBeenCalled()
  })

  it('updateGlobalConfig({ shell })：正常写入唯一支持的字段', async () => {
    const saved = await updateGlobalConfig({ shell: '/bin/zsh' } as Config)

    expect(configUpdateMock).toHaveBeenCalledWith({ shell: '/bin/zsh' })
    // 写完回读一次（调用方约定「返回保存后的配置」）
    expect(locationGetMock).toHaveBeenCalled()
    expect(saved).toEqual({ shell: '/bin/zsh' })
  })

  it('updateGlobalConfig({})：shell 缺失时写 null（V2 的 shell 允许 null）', async () => {
    configGetMock.mockResolvedValue([
      { type: 'document' as const, path: '/home/u/.config/opencode/opencode.json', info: {} },
    ])

    await updateGlobalConfig({} as Config)

    expect(configUpdateMock).toHaveBeenCalledWith({ shell: null })
  })

  it('updateGlobalConfig 含其它字段：抛错且**一次都不写**', async () => {
    await expect(
      updateGlobalConfig({ shell: '/bin/zsh', theme: 'dark', model: 'x/y' } as unknown as Config),
    ).rejects.toThrow(/只接受 \{ shell \}/)

    // 报错要带上「是哪些字段写不进去」，否则用户不知道为什么保存失败
    await expect(updateGlobalConfig({ shell: '/bin/zsh', theme: 'dark' } as unknown as Config)).rejects.toThrow(/theme/)

    // 🔴 最关键的一条：不能「部分保存」—— 一个字段都不许落库
    expect(configUpdateMock).not.toHaveBeenCalled()
  })

  it('updateGlobalConfig：undefined 值的字段不算「不支持的字段」（表单里清空 ≠ 要写它）', async () => {
    configGetMock.mockResolvedValue([GLOBAL_ENTRY])

    await updateGlobalConfig({ shell: '/bin/sh', theme: undefined } as unknown as Config)

    expect(configUpdateMock).toHaveBeenCalledWith({ shell: '/bin/sh' })
  })
})
