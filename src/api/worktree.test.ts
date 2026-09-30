// ============================================
// worktree API 单元测试（阶段 3a）
// ============================================
//
// 这里锁住三件「写错不会报错、只会**静默失效**」的事：
//
//   1. **V2 的作用域参数从 `directory` 改成了 `projectID`** ——
//      必须先用 `location.get` 把目录解析成 `location.project.id`；
//      而且解析时必须带上 `location[directory]`，否则服务端会静默回落到
//      自己的 `process.cwd()`，把**别的项目**的 worktree 列出来（HTTP 全 200）。
//
//   2. **入参形状**：list 只认 `{projectID}`；remove 的三个字段（projectID /
//      directory / force）在 V2 里**全是必填**，所以 force 必须有默认值。
//
//   3. `resetWorktree` 已在阶段 3b **随 UI 一起下架**（V2 删了端点、没有替代能力）
//      → 相关用例已删除；现在连编译期都拦得住（函数不存在了）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorktree, listWorktrees, removeWorktree } from './worktree'

const locationGetMock = vi.fn()
const listMock = vi.fn()
const createMock = vi.fn()
const removeMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    location: { get: (...args: unknown[]) => locationGetMock(...args) },
    worktree: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      remove: (...args: unknown[]) => removeMock(...args),
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'local',
  },
}))

/** `GET /api/location` 的响应（Location.PublicInfo） */
const LOCATION = {
  directory: '/repo',
  project: { id: 'proj_1', directory: '/repo', canonical: '/repo' },
}

describe('worktree（V2：作用域从 directory 改为 projectID）', () => {
  beforeEach(() => {
    locationGetMock.mockReset().mockResolvedValue(LOCATION)
    listMock.mockReset()
    createMock.mockReset()
    removeMock.mockReset()
  })

  it('listWorktrees：先按目录解析 projectID，再按 projectID 拉列表，只返回目录字符串', async () => {
    listMock.mockResolvedValue([{ directory: '/repo' }, { directory: '/data/wt/feature', strategy: 'git' }])

    const result = await listWorktrees('/repo')

    // ① 目录必须显式传（locationInput → { location: { directory } }）
    expect(locationGetMock).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    // ② 列表端点只认 projectID（V2 契约：query 参数 projectID 必填）
    expect(listMock).toHaveBeenCalledWith({ projectID: 'proj_1' })
    // ③ 返回类型仍是 string[]：strategy 字段被丢弃（UI 只用目录）
    expect(result).toEqual(['/repo', '/data/wt/feature'])
  })

  it('listWorktrees：不传目录时不构造 location 入参（由服务端回落，交由 locationInput 处理）', async () => {
    listMock.mockResolvedValue([])

    await listWorktrees()

    expect(locationGetMock).toHaveBeenCalledWith(undefined)
    expect(listMock).toHaveBeenCalledWith({ projectID: 'proj_1' })
  })

  it('createWorktree：透传 name，位置参数只当作用域（不当作 V2 的父目录）', async () => {
    createMock.mockResolvedValue({ directory: '/data/wt/feature' })

    const created = await createWorktree({ name: 'feature' }, '/repo')

    expect(locationGetMock).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    // ⚠️ 关键：第二个位置参数（作用域）**不能**被当成 V2 的 `directory`（父目录）传下去，
    //    否则 worktree 会被建到项目根目录里面（V1 是建到服务端数据目录）
    expect(createMock).toHaveBeenCalledWith({ projectID: 'proj_1', name: 'feature' })
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('directory')
    expect(created).toEqual({ directory: '/data/wt/feature' })
  })

  it('createWorktree：params 已带 projectID 时跳过 location 往返', async () => {
    createMock.mockResolvedValue({ directory: '/data/wt/x' })

    await createWorktree({ projectID: 'proj_9', name: 'x' })

    expect(locationGetMock).not.toHaveBeenCalled()
    expect(createMock).toHaveBeenCalledWith({ projectID: 'proj_9', name: 'x' })
  })

  it('createWorktree：params 里的 directory 是 V2 的「父目录」，原样透传', async () => {
    createMock.mockResolvedValue({ directory: '/tmp/wt/x' })

    await createWorktree({ name: 'x', directory: '/tmp/wt' }, '/repo')

    expect(createMock).toHaveBeenCalledWith({ projectID: 'proj_1', name: 'x', directory: '/tmp/wt' })
  })

  it('removeWorktree：三个字段都补齐，force 默认 true（与 V1 固定 --force 行为一致）', async () => {
    removeMock.mockResolvedValue(undefined)

    const removed = await removeWorktree({ directory: '/data/wt/feature' }, '/repo')

    expect(locationGetMock).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    expect(removeMock).toHaveBeenCalledWith({
      projectID: 'proj_1',
      directory: '/data/wt/feature',
      force: true,
    })
    expect(removed).toBe(true)
  })

  it('removeWorktree：显式 force=false 时透传 false（V2 会在工作区脏时拒绝并报 forceRequired）', async () => {
    removeMock.mockResolvedValue(undefined)

    await removeWorktree({ directory: '/data/wt/feature', force: false }, '/repo')

    expect(removeMock).toHaveBeenCalledWith({
      projectID: 'proj_1',
      directory: '/data/wt/feature',
      force: false,
    })
  })

  it('removeWorktree：params 已带 projectID 时跳过 location 往返', async () => {
    removeMock.mockResolvedValue(undefined)

    await removeWorktree({ projectID: 'proj_9', directory: '/x' })

    expect(locationGetMock).not.toHaveBeenCalled()
    expect(removeMock).toHaveBeenCalledWith({ projectID: 'proj_9', directory: '/x', force: true })
  })

  it('resetWorktree 已在阶段 3b 下架：模块不再导出它', async () => {
    const mod = await import('./worktree')
    expect('resetWorktree' in mod).toBe(false)
  })
})
