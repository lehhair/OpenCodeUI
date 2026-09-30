// ============================================
// client API 单元测试（阶段 3a：project 写侧）
// ============================================
//
// 只覆盖本阶段改动的函数：
//
//   - `updateProject` → **迁移**：`PATCH /api/project/{projectID}`，
//     注意路径参数从 `directory` 换成了 **projectID**，body 是
//     `{ canonical?, name?, icon?, commands? }`，返回**完整 Project**
//     → 必须用 `toInternalProject()` 转回内部形状
//     （最容易漏的是 `canonical` → `worktree` 的改名）。
//
//   - `initGitProject` → **阶段 3b 已下架**：V2 删了 `POST /project/git/init`，
//     UI 的「初始化 git」按钮同时移除。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateProject } from './client'

const projectUpdateMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    project: {
      update: (...args: unknown[]) => projectUpdateMock(...args),
    },
  }),
}))

// ⚠️ 为什么要把一堆兄弟模块 stub 掉：
//    `./client` 是个「桶文件」——它会 `export * from './session' | './message' |
//    './permission' | './file' | './vcs' | './mcp' | './pty' …`，等于把整个 api 层
//    拖进本测试的模块图。而本测试只关心 project 写侧（updateProject），
//    这些模块对它毫无影响，却会因为**并行开发期间的瞬时语法/类型错误**把本套件带崩
//    （实测：别人正在改 src/api/session.ts 时，本文件连 transform 都过不去）。
//    → 把与本测试无关的模块 stub 成空对象，让测试只对被测代码负责。
vi.mock('./session', () => ({}))
vi.mock('./message', () => ({}))
vi.mock('./permission', () => ({}))
vi.mock('./file', () => ({}))
vi.mock('./agent', () => ({}))
vi.mock('./skill', () => ({}))
vi.mock('./events', () => ({}))
vi.mock('./vcs', () => ({}))
vi.mock('./mcp', () => ({}))
vi.mock('./pty', () => ({}))

// 这些模块在加载期会读 serverStore，所以 mock 要给足方法，
// 否则会「TypeError: serverStore.onServerChange is not a function」这类加载期崩溃。
vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'local',
    getActiveBaseUrl: () => 'http://127.0.0.1:4096',
    getActiveAuth: () => undefined,
    getServerBaseUrl: () => 'http://127.0.0.1:4096',
    getServerAuth: () => undefined,
    getServer: () => undefined,
    onServerChange: () => () => {},
  },
  makeBasicAuthHeader: () => 'Basic test',
}))

/** V2 的 Project（注意：项目根目录字段叫 canonical，V1 叫 worktree） */
const V2_PROJECT = {
  id: 'proj_1',
  canonical: '/repo',
  vcs: 'git',
  name: 'demo',
  icon: { url: 'https://example.com/i.png' },
  commands: { start: 'bun dev' },
  time: { created: 1, updated: 2 },
  sandboxes: ['/data/wt/feature'],
}

describe('project 写侧（阶段 3a）', () => {
  beforeEach(() => {
    projectUpdateMock.mockReset().mockResolvedValue(V2_PROJECT)
  })

  it('updateProject：按 projectID 传参，并把 canonical 映射回内部的 worktree', async () => {
    const updated = await updateProject('proj_1', { name: 'demo2', icon: { url: 'u' } })

    expect(projectUpdateMock).toHaveBeenCalledWith({
      projectID: 'proj_1',
      name: 'demo2',
      icon: { url: 'u' },
    })
    // 内部形状：worktree ← canonical，其余字段透传
    expect(updated).toEqual({
      id: 'proj_1',
      worktree: '/repo',
      vcs: 'git',
      name: 'demo',
      icon: { url: 'https://example.com/i.png' },
      commands: { start: 'bun dev' },
      time: { created: 1, updated: 2 },
      sandboxes: ['/data/wt/feature'],
    })
  })

  it('updateProject：V2 的 canonical / commands 字段原样透传', async () => {
    await updateProject('proj_1', { canonical: '/repo2', commands: { start: 'npm run dev' } })

    expect(projectUpdateMock).toHaveBeenCalledWith({
      projectID: 'proj_1',
      canonical: '/repo2',
      commands: { start: 'npm run dev' },
    })
  })

  it('updateProject：目录参数不再下传（V2 用 projectID 定位，不看目录）', async () => {
    await updateProject('proj_1', { name: 'x' }, '/repo')

    const payload = projectUpdateMock.mock.calls[0][0]
    expect(payload).not.toHaveProperty('directory')
  })

  it('initGitProject 已在阶段 3b 下架：模块不再导出它，且不产生网络调用', async () => {
    const mod = await import('./client')
    expect('initGitProject' in mod).toBe(false)
    expect(projectUpdateMock).not.toHaveBeenCalled()
  })
})
