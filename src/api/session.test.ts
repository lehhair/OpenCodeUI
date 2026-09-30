import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abortSession,
  clearRevert,
  commitRevert,
  deleteSession,
  forkSession,
  getLastTurnDiff,
  getSessionChildren,
  getSessionDiff,
  stageRevert,
  summarizeSession,
  updateSession,
} from './session'

const sessionMock = {
  interrupt: vi.fn(),
  revert: { stage: vi.fn(), commit: vi.fn(), clear: vi.fn() },
  remove: vi.fn(),
  fork: vi.fn(),
  compact: vi.fn(),
  list: vi.fn(),
  diff: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
}
const messageListMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    session: {
      interrupt: (...args: unknown[]) => sessionMock.interrupt(...args),
      revert: {
        stage: (...args: unknown[]) => sessionMock.revert.stage(...args),
        commit: (...args: unknown[]) => sessionMock.revert.commit(...args),
        clear: (...args: unknown[]) => sessionMock.revert.clear(...args),
      },
      remove: (...args: unknown[]) => sessionMock.remove(...args),
      fork: (...args: unknown[]) => sessionMock.fork(...args),
      compact: (...args: unknown[]) => sessionMock.compact(...args),
      list: (...args: unknown[]) => sessionMock.list(...args),
      diff: (...args: unknown[]) => sessionMock.diff(...args),
      update: (...args: unknown[]) => sessionMock.update(...args),
      get: (...args: unknown[]) => sessionMock.get(...args),
    },
    message: {
      list: (...args: unknown[]) => messageListMock(...args),
    },
  }),
}))

beforeEach(() => {
  sessionMock.interrupt.mockReset()
  sessionMock.revert.stage.mockReset()
  sessionMock.revert.commit.mockReset()
  sessionMock.revert.clear.mockReset()
  sessionMock.remove.mockReset()
  sessionMock.fork.mockReset()
  sessionMock.compact.mockReset()
  sessionMock.list.mockReset()
  sessionMock.diff.mockReset()
  sessionMock.update.mockReset()
  sessionMock.get.mockReset()
  messageListMock.mockReset()
})

// ============================================
// 中止：abort → interrupt
// ============================================

describe('abortSession', () => {
  it('走 POST /api/session/{id}/interrupt，返回 interrupted 标志', async () => {
    sessionMock.interrupt.mockResolvedValue({ interrupted: true })

    await expect(abortSession('ses_1', '/workspace', 'local')).resolves.toBe(true)
    expect(sessionMock.interrupt).toHaveBeenCalledWith({ sessionID: 'ses_1' })
  })

  it('会话本来就空闲时 interrupted=false，且**不算错误**', async () => {
    sessionMock.interrupt.mockResolvedValue({ interrupted: false })

    await expect(abortSession('ses_1')).resolves.toBe(false)
  })
})

// ============================================
// 回退三段式：stage → commit → clear
// ============================================

describe('回退三段式（V2）', () => {
  it('stageRevert 走 POST .../revert/stage，并把 V2 的 files 映射进内部 revert', async () => {
    sessionMock.revert.stage.mockResolvedValue({
      messageID: 'msg_2',
      snapshot: 'snap_1',
      files: [{ file: 'a.ts', patch: '@@', additions: 1, deletions: 0, status: 'modified' }],
    })

    const revert = await stageRevert('ses_1', 'msg_2', {}, '/workspace', 'local')

    expect(sessionMock.revert.stage).toHaveBeenCalledWith({ sessionID: 'ses_1', messageID: 'msg_2' })
    expect(revert.messageID).toBe('msg_2')
    expect(revert.files).toHaveLength(1)
    // V1 的 diff（补丁文本）在 V2 没有对应物 → 恒 undefined，不强行映射
    expect(revert.diff).toBeUndefined()
  })

  it('stageRevert 支持 files:false（只挪边界、不动磁盘文件）', async () => {
    sessionMock.revert.stage.mockResolvedValue({ messageID: 'msg_3' })

    await stageRevert('ses_1', 'msg_3', { files: false })

    expect(sessionMock.revert.stage).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      messageID: 'msg_3',
      files: false,
    })
  })

  it('commitRevert 走 POST .../revert/commit（不可逆，真正删消息）', async () => {
    sessionMock.revert.commit.mockResolvedValue(undefined)

    await commitRevert('ses_1')

    expect(sessionMock.revert.commit).toHaveBeenCalledWith({ sessionID: 'ses_1' })
  })

  it('clearRevert 走 DELETE .../revert（等价 V1 的 unrevert）', async () => {
    sessionMock.revert.clear.mockResolvedValue(undefined)

    await clearRevert('ses_1')

    expect(sessionMock.revert.clear).toHaveBeenCalledWith({ sessionID: 'ses_1' })
  })

  it('三段式全部使用裸 sessionID（复合 key 会被解析）', async () => {
    sessionMock.revert.stage.mockResolvedValue({ messageID: 'm' })
    sessionMock.revert.commit.mockResolvedValue(undefined)
    sessionMock.revert.clear.mockResolvedValue(undefined)

    await stageRevert('remote::ses_7', 'm')
    await commitRevert('remote::ses_7')
    await clearRevert('remote::ses_7')

    expect(sessionMock.revert.stage).toHaveBeenCalledWith({ sessionID: 'ses_7', messageID: 'm' })
    expect(sessionMock.revert.commit).toHaveBeenCalledWith({ sessionID: 'ses_7' })
    expect(sessionMock.revert.clear).toHaveBeenCalledWith({ sessionID: 'ses_7' })
  })
})

// ============================================
// diff：V2 是「按轮次」的，语义与 V1 不同
// ============================================

describe('getLastTurnDiff', () => {
  it('不传 from → 服务端返回「最新一条 user 消息所在轮次」的 diff', async () => {
    sessionMock.diff.mockResolvedValue([
      { file: 'a.ts', patch: '@@', additions: 1, deletions: 2, status: 'modified' },
      { patch: 'no file', additions: 0, deletions: 0, status: 'modified' },
    ])

    const diffs = await getLastTurnDiff('ses_1', '/workspace', 'local')

    expect(sessionMock.diff).toHaveBeenCalledWith({ sessionID: 'ses_1' })
    // 缺少 file 的异常项被 normalizeFileDiffs 过滤
    expect(diffs).toHaveLength(1)
    expect(diffs[0].file).toBe('a.ts')
  })
})

describe('getSessionDiff（全量：显式传 from/to）', () => {
  it('先查最早/最新 user 消息，再用它们当 from/to 覆盖整段历史', async () => {
    messageListMock.mockImplementation((input: { order?: string }) =>
      Promise.resolve({ data: [{ id: input.order === 'asc' ? 'msg_first' : 'msg_last' }], cursor: {} }),
    )
    sessionMock.diff.mockResolvedValue([])

    await getSessionDiff('ses_1')

    expect(messageListMock).toHaveBeenCalledWith({ sessionID: 'ses_1', limit: 1, type: 'user', order: 'asc' })
    expect(messageListMock).toHaveBeenCalledWith({ sessionID: 'ses_1', limit: 1, type: 'user', order: 'desc' })
    expect(sessionMock.diff).toHaveBeenCalledWith({ sessionID: 'ses_1', from: 'msg_first', to: 'msg_last' })
  })

  it('只有一个用户回合时不传 to（from === to 无意义）', async () => {
    messageListMock.mockResolvedValue({ data: [{ id: 'msg_only' }], cursor: {} })
    sessionMock.diff.mockResolvedValue([])

    await getSessionDiff('ses_1')

    expect(sessionMock.diff).toHaveBeenCalledWith({ sessionID: 'ses_1', from: 'msg_only' })
  })

  it('拿不到 user 消息边界时退化为 V2 默认（最新一轮），不报错', async () => {
    messageListMock.mockRejectedValue(new Error('boom'))
    sessionMock.diff.mockResolvedValue([])

    await expect(getSessionDiff('ses_1')).resolves.toEqual([])
    expect(sessionMock.diff).toHaveBeenCalledWith({ sessionID: 'ses_1' })
  })
})

// ============================================
// 更新 / 删除 / fork / compact / 子会话
// ============================================

describe('updateSession', () => {
  const sessionInfo = {
    id: 'ses_1',
    projectID: 'prj_1',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    location: { directory: '/workspace' },
    title: 'New',
  }

  it('改名后回读一次（V2 的 update 返回 void，调用方需要更新后的会话）', async () => {
    sessionMock.update.mockResolvedValue(undefined)
    sessionMock.get.mockResolvedValue(sessionInfo)

    const updated = await updateSession('ses_1', { title: 'New' })

    expect(sessionMock.update).toHaveBeenCalledWith({ sessionID: 'ses_1', title: 'New' })
    expect(sessionMock.get).toHaveBeenCalledWith({ sessionID: 'ses_1' })
    expect(updated.title).toBe('New')
    expect(updated.directory).toBe('/workspace')
  })

  // ⛔ 阶段 3b：「归档会话」用例已删除 —— 该能力整体下架
  //    （V2 无归档 API，`updateSession` 的 `time` 入参已移除；传 `time` 现在连编译都过不了）。
})

describe('deleteSession', () => {
  it('走 SDK 的 session.remove（V1 叫 delete）', async () => {
    sessionMock.remove.mockResolvedValue(undefined)

    await expect(deleteSession('ses_1')).resolves.toBe(true)
    expect(sessionMock.remove).toHaveBeenCalledWith({ sessionID: 'ses_1' })
  })
})

describe('forkSession', () => {
  it('V2 的 body 字段是 before（不是 V1 的 messageID），语义都是「不含该消息」', async () => {
    sessionMock.fork.mockResolvedValue({
      id: 'ses_fork',
      projectID: 'prj_1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: '/workspace' },
    })

    const forked = await forkSession('ses_1', 'msg_5')

    expect(sessionMock.fork).toHaveBeenCalledWith({ sessionID: 'ses_1', before: 'msg_5' })
    expect(forked.id).toBe('ses_fork')
  })

  it('不传 messageID → 不传 before（= 复制完整历史）', async () => {
    sessionMock.fork.mockResolvedValue({
      id: 'ses_fork2',
      projectID: 'prj_1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: '/workspace' },
    })

    await forkSession('ses_1')

    expect(sessionMock.fork).toHaveBeenCalledWith({ sessionID: 'ses_1' })
  })
})

describe('summarizeSession', () => {
  it('迁移到 session.compact，且**忽略**模型参数（V2 的 compact 不接受模型）', async () => {
    sessionMock.compact.mockResolvedValue(undefined)

    await expect(summarizeSession('ses_1', { providerID: 'p', modelID: 'm' })).resolves.toBe(true)
    expect(sessionMock.compact).toHaveBeenCalledWith({ sessionID: 'ses_1' })
  })
})

describe('getSessionChildren', () => {
  it('用 GET /api/session?parentID= 取代已删除的 /children', async () => {
    sessionMock.list.mockResolvedValue({
      data: [
        {
          id: 'ses_child',
          projectID: 'prj_1',
          parentID: 'ses_1',
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          location: { directory: '/workspace' },
        },
      ],
      cursor: {},
    })

    const children = await getSessionChildren('ses_1', '/workspace', 'local')

    expect(sessionMock.list).toHaveBeenCalledWith({ parentID: 'ses_1', directory: '/workspace' })
    expect(children).toHaveLength(1)
    expect(children[0].id).toBe('ses_child')
  })
})

// ============================================
// 阶段 3b 移除项：已整体下架（不再是「运行时抛错」而是「编译期不存在」）
// ============================================

describe('V2 已删除的能力（阶段 3b 已下架）', () => {
  it('shareSession / unshareSession / getSessionTodos 不再被导出', async () => {
    const mod = await import('./session')
    for (const removed of ['shareSession', 'unshareSession', 'getSessionTodos']) {
      expect(removed in mod).toBe(false)
    }
  })
})
