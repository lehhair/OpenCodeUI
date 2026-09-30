// ============================================
// src/api/vcs.ts 单元测试（阶段 3a）
// ============================================
//
// 锁定的关键点：
//   1. `getVcsInfo` 的 V1 形状映射（branch.current → branch，branch.default → default_branch）
//   2. **「VCS 不可用 → null」的两条路径都要覆盖**：
//      ① 非 git 目录实测是 **HTTP 200 + `{branch:{}}`**（不抛异常！）
//      ② 4xx/5xx → SDK 抛错 → catch 成 null
//      —— 只测其中一条会让另一种形态悄悄漏成「有 VCS 但分支为空」
//   3. `getVcsDiff` 解包 `data` 并走 `normalizeFileDiffs()`
//   4. mode 必须是 V2 的枚举（`working|branch|committed`），`git` 传下去就是 400

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getVcsDiff, getVcsInfo, toVcsDiffMode } from './vcs'

const getMock = vi.fn()
const diffMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    vcs: {
      get: (...args: unknown[]) => getMock(...args),
      diff: (...args: unknown[]) => diffMock(...args),
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
  },
}))

describe('getVcsInfo（V2 `GET /api/vcs` → V1 VcsInfo | null）', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('把 branch.current / branch.default 映射回 branch / default_branch', async () => {
    getMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: { provider: 'git', branch: { current: 'feature/x', default: 'main' } },
    })

    const info = await getVcsInfo('/repo')

    expect(getMock).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    expect(info).toEqual({ branch: 'feature/x', default_branch: 'main' })
    // V1 形状里没有 provider
    expect(info).not.toHaveProperty('provider')
  })

  it('只有 current、没有 default 时也返回（detached / 无默认分支）', async () => {
    getMock.mockResolvedValue({ location: { directory: '/repo' }, data: { branch: { current: 'wip' } } })

    await expect(getVcsInfo('/repo')).resolves.toEqual({ branch: 'wip', default_branch: undefined })
  })

  it('非 git 目录：HTTP 200 + `{branch:{}}` 也要收敛成 null（不会抛异常，必须显式判空）', async () => {
    getMock.mockResolvedValue({ location: { directory: '/nogit' }, data: { branch: {} } })

    await expect(getVcsInfo('/nogit')).resolves.toBeNull()
  })

  it('branch 字段整体缺失时也返回 null（防御）', async () => {
    getMock.mockResolvedValue({ location: { directory: '/nogit' }, data: {} })

    await expect(getVcsInfo('/nogit')).resolves.toBeNull()
  })

  it('4xx/5xx（SDK 抛错）→ null，保留 V1 的 try/catch 语义', async () => {
    getMock.mockRejectedValue(new Error('UnauthorizedError'))

    await expect(getVcsInfo('/repo')).resolves.toBeNull()
  })

  it('未指定目录时 location 缺省', async () => {
    getMock.mockResolvedValue({ location: { directory: '/cwd' }, data: { branch: { current: 'main' } } })

    await getVcsInfo()

    expect(getMock).toHaveBeenCalledWith(undefined)
  })
})

describe('toVcsDiffMode（UI 变更范围 → V2 Vcs.Mode）', () => {
  it('UI 的 git 翻译成 V2 的 working（枚举值不兼容，传错直接 400）', () => {
    expect(toVcsDiffMode('git')).toBe('working')
  })

  it('branch 两边同名', () => {
    expect(toVcsDiffMode('branch')).toBe('branch')
  })
})

describe('getVcsDiff（V2 `GET /api/vcs/diff` → FileDiff[]）', () => {
  beforeEach(() => {
    diffMock.mockReset()
  })

  it('解包 data 并透传 mode / location', async () => {
    diffMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        {
          file: 'src/a.ts',
          patch: 'diff --git a/src/a.ts b/src/a.ts\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
        },
      ],
    })

    const diffs = await getVcsDiff('working', '/repo')

    expect(diffMock).toHaveBeenCalledWith({ mode: 'working', location: { directory: '/repo' } })
    expect(diffs).toEqual([
      {
        file: 'src/a.ts',
        patch: 'diff --git a/src/a.ts b/src/a.ts\n',
        additions: 1,
        deletions: 1,
        status: 'modified',
      },
    ])
  })

  it('走 normalizeFileDiffs：file 为空的条目被丢掉', async () => {
    diffMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { file: '', patch: '', additions: 0, deletions: 0, status: 'modified' },
        { file: 'src/b.ts', patch: '', additions: 0, deletions: 1, status: 'deleted' },
      ],
    })

    const diffs = await getVcsDiff('branch', '/repo')

    expect(diffs.map(d => d.file)).toEqual(['src/b.ts'])
  })

  it('非 git 目录（200 + 空数组）返回空数组而不是报错', async () => {
    diffMock.mockResolvedValue({ location: { directory: '/nogit' }, data: [] })

    await expect(getVcsDiff('working', '/nogit')).resolves.toEqual([])
  })

  it('未指定目录时 location 缺省（服务端回落 cwd）', async () => {
    diffMock.mockResolvedValue({ location: { directory: '/cwd' }, data: [] })

    await getVcsDiff('committed')

    expect(diffMock).toHaveBeenCalledWith({ mode: 'committed' })
  })
})
