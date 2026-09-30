// ============================================
// 阶段 3a 冒烟测试（**需要真实 V2 服务**）
// ============================================
//
// ⚠️ 默认**跳过**：依赖一个活着的 opencode 服务。要跑它：
//
//   OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097
//   VITE_OPENCODE_SMOKE=1 npx vitest run src/api/phase3a.smoke.test.ts
//
// 可用环境变量（都必须带 VITE_ 前缀，Vite 才会注入 import.meta.env）：
//   VITE_OPENCODE_SMOKE=1            开关（不开则整组 skip）
//   VITE_OPENCODE_SMOKE_URL          默认 http://127.0.0.1:4097
//   VITE_OPENCODE_SMOKE_PASSWORD     默认 t1
//   VITE_OPENCODE_SMOKE_DIRECTORY    默认仓库目录
//
// 本阶段要证明的六件事（对应任务 10 的冒烟清单）：
//   ① 中止生成      `POST /api/session/{id}/interrupt` 能真的打断一轮执行
//   ② 回退三段式    `revert/stage` → `revert/commit` / `DELETE revert` 行为符合源码语义
//   ③ 权限回复      `POST .../permission/{rid}/reply`（`{decision}`）+ saved 规则列表
//   ④ 表单渲染      Form 的 create → list → reply → detail 全链路（渲染器另有单测）
//   ⑤ PTY           两步连接：connect-token 拿到 ticket（**不建真 WS**，避免测试依赖终端）
//   ⑥ MCP           `GET /api/mcp` + `GET /api/mcp/resource` + runtime add/remove
//
// ── 数据卫生（硬性要求）────────────────────────────────────────────────
// 冒烟会在仓库目录里建会话。**所有自己建的会话都在 afterAll 里删掉**，
// 不留残余（前几轮曾留下 72 个测试会话，别再犯）。
// 另外 `PUT /api/experimental/mcp/{server}` 只是「运行时添加，重启即失效」，
// 不写配置文件，且 afterAll 会 remove。
// ============================================

import { afterAll, describe, expect, it, vi } from 'vitest'

const BASE_URL = (import.meta.env.VITE_OPENCODE_SMOKE_URL as string | undefined) ?? 'http://127.0.0.1:4097'
const PASSWORD = (import.meta.env.VITE_OPENCODE_SMOKE_PASSWORD as string | undefined) ?? 't1'
const DIRECTORY =
  (import.meta.env.VITE_OPENCODE_SMOKE_DIRECTORY as string | undefined) ?? '/home/coder/project/OpenCodeUI'

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveBaseUrl: () => BASE_URL,
    getActiveAuth: () => ({ username: 'opencode', password: PASSWORD }),
    getServerBaseUrl: () => BASE_URL,
    getServerAuth: () => ({ username: 'opencode', password: PASSWORD }),
    getActiveServerId: () => 'local',
    onServerChange: () => () => {},
  },
  makeBasicAuthHeader: (auth: { username: string; password: string }) =>
    'Basic ' + btoa(`${auth.username}:${auth.password}`),
}))

vi.mock('../utils/tauri', () => ({ isTauri: () => false }))

const AUTH = { Authorization: 'Basic ' + btoa(`opencode:${PASSWORD}`) }

/** 探测服务是否可达（1 秒超时，避免无服务时挂住） */
async function probeServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/info`, { headers: AUTH, signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}

// 双重开关：既要显式打开（VITE_OPENCODE_SMOKE=1），也要服务真的可达。
// ⚠️ 与 `phase2a/2b.smoke` 保持同一约定 —— 它们需要**真实 LLM 回合**（中断、回退都要跑一轮），
//    不该让 `npm test` 的结果依赖「本机恰好有服务 + provider 可用」。
const ENABLED = !!import.meta.env.VITE_OPENCODE_SMOKE
const reachable = ENABLED && (await probeServer())
if (!ENABLED) {
  console.info('[phase3aSmoke] 跳过：未设置 VITE_OPENCODE_SMOKE=1。启动方式见本文件头部注释。')
} else if (!reachable) {
  console.info(`[phase3aSmoke] 跳过：${BASE_URL} 上没有运行中的 opencode V2 服务。启动方式见本文件头部注释。`)
}

/** 本次运行自己建的会话，afterAll 清理（只删自己建的，不碰任何既有会话） */
const createdSessionIds: string[] = []
/** 本次运行自己加的 MCP 服务器名，afterAll 清理 */
const createdMcpServers: string[] = []

async function createTrackedSession(title: string): Promise<string> {
  const { createSession } = await import('./session')
  const session = await createSession({ directory: DIRECTORY, title })
  createdSessionIds.push(session.id)
  return session.id
}

/** 给会话塞一条用户消息（非阻塞），并返回 messageID */
async function promptOnce(sessionId: string, text: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`prompt 失败：${res.status} ${await res.text()}`)
}

/**
 * 读取 `/api/session/active` 的活跃会话表（裸 REST）
 *
 * 🔴 **线缆上是 `{data: {...}}` 信封**：`GET /api/session/active` 返回
 *    `{"data":{"ses_xxx":{"type":"running"}}}`。
 *    SDK 的 `session.active()` 会**自动解包**（声明类型是裸 Record），
 *    但裸 fetch 必须自己取 `.data` —— 直接读顶层会永远读到空表（本冒烟实测踩到）。
 */
async function fetchActiveSessions(): Promise<Record<string, { type?: string }>> {
  const res = await fetch(`${BASE_URL}/api/session/active`, { headers: AUTH })
  if (!res.ok) return {}
  const body = (await res.json()) as { data?: Record<string, { type?: string }> }
  return body.data ?? {}
}

/**
 * 等会话进入「已开始执行」状态
 *
 * ⚠️ 有两个坑（本冒烟实测踩到）：
 *   1. `prompt` 是**非阻塞入队**：刚发完 prompt 时 `/api/session/active` 可能还是空的
 *      （execution 尚未被唤醒）→ 直接 `waitForIdle` 会立刻返回 true，然后 stage 就撞上
 *      `SessionBusyError`。所以必须先确认它**真的忙起来**。
 *   2. 首次调用某个 provider 时握手较慢，执行可能十几秒才开始 → 超时给足。
 *      极短的回合仍可能来不及观察 → 返回 false 让调用方退化处理。
 */
async function waitForBusy(sessionId: string, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const active = await fetchActiveSessions()
    if (active[sessionId]?.type === 'running') return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

/**
 * 等会话「真正空闲」：先等到它忙起来（若能在超时内观察到），再等它从 active 里消失。
 *
 * 用途：`revert/stage` 会返回 `SessionBusyError`，所以调用前必须确保执行已结束。
 */
async function waitForSettled(sessionId: string, timeoutMs = 120000): Promise<void> {
  await waitForBusy(sessionId)
  await waitForIdle(sessionId, timeoutMs)
}

/** 等会话变成 idle（`/api/session/active` 里消失） */
async function waitForIdle(sessionId: string, timeoutMs = 120000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const active = await fetchActiveSessions()
    if (!active[sessionId]) return true
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  return false
}

/** 直接读消息列表（原始 REST，用来独立核对 API 层的行为） */
async function rawMessages(sessionId: string, query = ''): Promise<Array<{ id: string; type: string }>> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/message?limit=200${query}`, { headers: AUTH })
  if (!res.ok) throw new Error(`读消息失败：${res.status}`)
  const body = (await res.json()) as { data: Array<{ id: string; type: string }> }
  return body.data
}

afterAll(async () => {
  if (!reachable) return
  // 清会话
  for (const id of createdSessionIds) {
    try {
      await fetch(`${BASE_URL}/api/session/${id}`, { method: 'DELETE', headers: AUTH })
    } catch {
      // 清理失败不阻塞测试结论（已尽力）
    }
  }
  // 清 MCP 运行时服务器
  for (const name of createdMcpServers) {
    try {
      await fetch(`${BASE_URL}/api/experimental/mcp/${encodeURIComponent(name)}`, { method: 'DELETE', headers: AUTH })
    } catch {
      // 同上
    }
  }
})

describe.skipIf(!reachable)('阶段 3a 冒烟：真实 V2 服务', () => {
  // ============================================
  // ① 中止生成
  // ============================================

  it('① 中止：interrupt 能打断进行中的执行，且空闲会话返回 false（不是错误）', async () => {
    const { abortSession } = await import('./session')

    // 空闲会话：interrupted === false，且**不能抛错**
    const idleSession = await createTrackedSession('[phase3a-smoke] idle-interrupt')
    await expect(abortSession(idleSession, DIRECTORY, 'local')).resolves.toBe(false)

    // 跑一轮，然后在 busy 时打断
    const busySession = await createTrackedSession('[phase3a-smoke] busy-interrupt')
    await promptOnce(busySession, '请从 1 数到 200，每个数字单独一行。')

    const becameBusy = await waitForBusy(busySession)
    // 极快的回合可能来不及观察到 busy —— 那就退化成「空闲时 interrupt 不报错」的断言
    if (!becameBusy) {
      console.info('[phase3aSmoke] 未观察到 busy（回合太快），退化为空闲断言')
      await expect(abortSession(busySession, DIRECTORY, 'local')).resolves.toBe(false)
      return
    }

    // 真的打断了（服务端返回 interrupted=true）
    await expect(abortSession(busySession, DIRECTORY, 'local')).resolves.toBe(true)
    console.info('[phase3aSmoke] 已观察到 busy 并成功 interrupt（interrupted=true）')
    // 打断后必须回到 idle（服务端 execution.interrupted 语义）
    await expect(waitForIdle(busySession)).resolves.toBe(true)
  }, 120000)

  // ============================================
  // ② 回退三段式
  // ============================================

  it('② 回退三段式：stage 只写标记不删消息；clear 撤销；commit 才真删', async () => {
    const { stageRevert, clearRevert, commitRevert, getSession } = await import('./session')

    const sessionId = await createTrackedSession('[phase3a-smoke] revert')
    await promptOnce(sessionId, '只回复一个词：alpha')
    // ⚠️ 必须等执行真正结束：`revert/stage` 对 busy 会话会抛 SessionBusyError（实测踩到）
    await waitForSettled(sessionId)

    const before = await rawMessages(sessionId)
    const firstUser = before.find(m => m.type === 'user')
    expect(firstUser).toBeDefined()
    const boundary = firstUser!.id

    // ---- stage：写入 revert 标记，但**消息还在**（V2 与 V1 最大的语义差异）----
    //
    // ⚠️ 这里刻意**不比较消息条数**：服务端会在执行结束后补一条 `idle` 标记消息，
    //    它的落库时刻可能晚于 `/api/session/active` 变空闲（实测踩到），
    //    比较条数会偶发假失败。改为断言「边界消息仍然存在」—— 这才是要证明的语义。
    const staged = await stageRevert(sessionId, boundary, {}, DIRECTORY, 'local')
    expect(staged.messageID).toBe(boundary)

    const sessionAfterStage = await getSession(sessionId, DIRECTORY, 'local')
    expect(sessionAfterStage.revert?.messageID).toBe(boundary)

    const afterStage = await rawMessages(sessionId)
    expect(afterStage.some(m => m.id === boundary)).toBe(true) // ← stage **不删消息**

    // ---- clear：撤销暂存（等价 V1 的 unrevert）----
    await clearRevert(sessionId, DIRECTORY, 'local')
    const sessionAfterClear = await getSession(sessionId, DIRECTORY, 'local')
    expect(sessionAfterClear.revert).toBeUndefined()
    expect((await rawMessages(sessionId)).some(m => m.id === boundary)).toBe(true)

    // ---- 再 stage 一次，然后 commit：**真删**边界及其之后的消息 ----
    await stageRevert(sessionId, boundary, {}, DIRECTORY, 'local')
    await commitRevert(sessionId, DIRECTORY, 'local')

    const sessionAfterCommit = await getSession(sessionId, DIRECTORY, 'local')
    expect(sessionAfterCommit.revert).toBeUndefined()
    const afterCommit = await rawMessages(sessionId)
    expect(afterCommit.some(m => m.id === boundary)).toBe(false)
  }, 180000)

  // ============================================
  // ③ 权限回复
  // ============================================

  it('③ 权限：request 列表 / reply({decision}) / saved 规则列表', async () => {
    const { getPendingPermissions, replyPermission, listSavedPermissions } = await import('./permission')

    // ⚠️ 必须让这个会话**强制走审批**，否则 `POST .../permission` 会直接返回
    //    `{effect:'allow'}` 而**不产生 pending 请求**（实测踩到）。
    //    手段：创建会话时带 `permissions: [{action:'bash', resource:'*', effect:'ask'}]`。
    const createdSessionRes = await fetch(`${BASE_URL}/api/session`, {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '[phase3a-smoke] permission',
        location: { directory: DIRECTORY },
        permissions: [{ action: 'bash', resource: '*', effect: 'ask' }],
      }),
    })
    expect(createdSessionRes.ok).toBe(true)
    const sessionId = ((await createdSessionRes.json()) as { data: { id: string } }).data.id
    createdSessionIds.push(sessionId)

    // 用 `POST /api/session/{id}/permission` **主动造**一个权限请求，
    // 避免依赖「某个工具恰好要审批」这种不确定条件。
    const created = await fetch(`${BASE_URL}/api/session/${sessionId}/permission`, {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'bash', resources: ['echo phase3a-smoke'], save: ['echo phase3a-smoke'] }),
    })
    expect(created.ok).toBe(true)
    const createdBody = (await created.json()) as { data: { id: string; effect: string } }
    const requestId = createdBody.data.id

    // 列表里能看到它，且 V2 的 action/resources 已被映射成内部的 permission/patterns
    const pending = await getPendingPermissions(undefined, DIRECTORY, 'local')
    const mine = pending.find(p => p.id === requestId)
    expect(mine).toBeDefined()
    expect(mine!.sessionID).toBe(sessionId)
    expect(mine!.permission).toBe('bash')
    expect(mine!.patterns).toEqual(['echo phase3a-smoke'])

    // 回复 `reject`（最安全：不会把规则写进 saved）
    await expect(replyPermission(requestId, 'reject', undefined, DIRECTORY, sessionId, 'local')).resolves.toBe(true)

    // 回复后应从 pending 列表消失
    const after = await getPendingPermissions(undefined, DIRECTORY, 'local')
    expect(after.some(p => p.id === requestId)).toBe(false)

    // saved 规则列表可读（形状正确即可；用 reject 时不应新增规则）
    const saved = await listSavedPermissions()
    expect(Array.isArray(saved)).toBe(true)
    for (const rule of saved) {
      expect(typeof rule.id).toBe('string')
      expect(typeof rule.action).toBe('string')
      expect(typeof rule.resource).toBe('string')
    }
  }, 120000)

  // ============================================
  // ④ 表单（Form）
  // ============================================

  it('④ 表单：create → list（会话级 + 位置级）→ reply → detail.state=answered', async () => {
    const { createForm, listSessionForms, listPendingForms, replyForm, getFormDetail, cancelForm } =
      await import('./form')

    const sessionId = await createTrackedSession('[phase3a-smoke] form')

    // 六种字段类型各来一个，顺带验证「服务端接受这些字段形状」
    const created = await createForm(sessionId, {
      title: '[phase3a-smoke] 六种字段',
      fields: [
        { key: 's', type: 'string', title: '字符串', placeholder: 'type here' },
        { key: 'n', type: 'number', title: '数字' },
        { key: 'i', type: 'integer', title: '整数' },
        { key: 'b', type: 'boolean', title: '布尔' },
        { key: 'm', type: 'multiselect', title: '多选', options: [{ value: 'a', label: 'A' }] },
        { key: 'x', type: 'external', url: 'https://opencode.ai/v2/docs/' },
      ],
    })
    expect(created.id).toMatch(/^frm_/)

    // 会话级列表能看到
    const sessionForms = await listSessionForms(sessionId, DIRECTORY, 'local')
    expect(sessionForms.some(f => f.id === created.id)).toBe(true)

    // 位置级列表也能看到（`GET /api/form`，location 作用域）
    const pendingForms = await listPendingForms(DIRECTORY, 'local')
    expect(pendingForms.some(f => f.id === created.id)).toBe(true)

    // 回复：值类型必须与字段类型匹配（服务端会校验）
    // 🔴 注意 `x: true` —— `external` 字段**必须被确认为 true**，否则服务端回
    //    `FormInvalidAnswerError: External form field must be acknowledged`
    //    （这条是本次冒烟实测发现的硬性语义，渲染器已按它实现确认位）
    await replyForm(sessionId, created.id, { s: 'hello', n: 1.5, i: 2, b: true, m: ['a'], x: true }, DIRECTORY, 'local')

    const detail = await getFormDetail(sessionId, created.id, DIRECTORY, 'local')
    expect(detail.state.status).toBe('answered')

    // 再建一张并**取消**（DELETE 分支）
    const second = await createForm(sessionId, {
      title: '[phase3a-smoke] 取消',
      fields: [{ key: 'only', type: 'string' }],
    })
    await cancelForm(sessionId, second.id, DIRECTORY, 'local')
    const secondDetail = await getFormDetail(sessionId, second.id, DIRECTORY, 'local')
    expect(secondDetail.state.status).toBe('cancelled')
  }, 120000)

  // ============================================
  // ⑤ PTY（两步连接的第一步）
  // ============================================

  it('⑤ PTY：create → list（V2 status 形状）→ connect-token 拿到 ticket → remove', async () => {
    const { createPtySession, listPtySessions, createPtyConnectTicket, removePtySession } = await import('./pty')

    const pty = await createPtySession({ cwd: DIRECTORY }, DIRECTORY, 'local')
    expect(pty.id).toMatch(/^pty/)
    // V2 的 Pty 用 status 而不是 V1 的 running
    expect(['running', 'exited']).toContain(pty.status)

    const list = await listPtySessions(DIRECTORY, 'local')
    expect(list.some(p => p.id === pty.id)).toBe(true)

    // 两步流程的**第一步**：换一次性 ticket
    const token = await createPtyConnectTicket(pty.id, DIRECTORY, 'local')
    expect(typeof token.ticket).toBe('string')
    expect(token.ticket.length).toBeGreaterThan(0)
    expect(token.expiresIn).toBeGreaterThan(0)

    // ⚠️ 不建真 WebSocket：终端握手需要交互式会话，不适合放进单测。
    //    ticket 的可用性由 `src/api/pty.test.ts` 的 URL 构造断言 + 阶段 3a 报告里的
    //    真机 101 握手记录覆盖。
    await expect(removePtySession(pty.id, DIRECTORY, 'local')).resolves.toBe(true)
  }, 120000)

  // ============================================
  // ⑥ MCP
  // ============================================

  it('⑥ MCP：list（V2 数组形状）→ resource catalog → runtime add/remove', async () => {
    const { getMcpStatus, getMcpResources, addMcpServer, connectMcpServer } = await import('./mcp')

    // 列表：V2 是数组（`{name, status:{status}, integrationID?}`）
    const servers = await getMcpStatus(DIRECTORY)
    expect(Array.isArray(servers)).toBe(true)
    for (const server of servers) {
      expect(typeof server.name).toBe('string')
      expect(typeof server.status.status).toBe('string')
    }

    // 资源目录：`{resources, templates}`
    const resources = await getMcpResources(DIRECTORY)
    expect(Array.isArray(resources.resources)).toBe(true)
    expect(Array.isArray(resources.templates)).toBe(true)

    // runtime add（**只影响运行时，不写配置**；afterAll 会 remove）
    const name = `phase3a-smoke-${Date.now()}`
    createdMcpServers.push(name)
    await addMcpServer(name, { type: 'local', command: ['echo', 'phase3a-smoke'] }, DIRECTORY)

    const afterAdd = await getMcpStatus(DIRECTORY)
    const mine = afterAdd.find(s => s.name === name)
    expect(mine).toBeDefined()

    // connect 是幂等触发（真实连接可能失败 —— 那也只是 status 变成 failed，不抛错）
    await expect(connectMcpServer(name, DIRECTORY)).resolves.toBeUndefined()

    // ⚠️ `src/api/mcp.ts` **没有**封装 `mcp.remove`（V1 本项目也没有删除服务器的 API/UI），
    //    所以这里用裸 REST 清理。是否补一个 `removeMcpServer()` 由阶段 3b 决定。
    // ⚠️ runtime MCP 服务器是 **location 作用域**的：DELETE 也必须带 `location[directory]`，
    //    否则会落到服务进程的 cwd、拿 404（实测踩到）。
    const removed = await fetch(
      `${BASE_URL}/api/experimental/mcp/${encodeURIComponent(name)}?location[directory]=${encodeURIComponent(DIRECTORY)}`,
      { method: 'DELETE', headers: AUTH },
    )
    expect(removed.ok).toBe(true)
    const afterRemove = await getMcpStatus(DIRECTORY)
    expect(afterRemove.some(s => s.name === name)).toBe(false)
    // 已 remove，afterAll 不必再删
    createdMcpServers.length = 0
  }, 120000)
})
