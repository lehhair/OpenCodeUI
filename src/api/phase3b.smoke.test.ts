// ============================================
// 阶段 3b 冒烟测试（**需要真实 V2 服务**）
// ============================================
//
// ⚠️ 默认**跳过**：依赖一个活着的 opencode 服务。要跑它：
//
//   mkdir -p /tmp/opencode/p3b/ws /tmp/opencode/p3b/config
//   cd /tmp/opencode/p3b/ws && OPENCODE_SERVER_PASSWORD=t1 \
//     XDG_CONFIG_HOME=/tmp/opencode/p3b/config \
//     opencode --log-level warn serve --hostname 127.0.0.1 --port 4097
//   VITE_OPENCODE_SMOKE=1 VITE_OPENCODE_SMOKE_DIRECTORY=/tmp/opencode/p3b/ws \
//     npx vitest run src/api/phase3b.smoke.test.ts
//
// 🔴 **`XDG_CONFIG_HOME` 不是可选项，是硬要求！**
//    `PATCH /api/experimental/config` 写的是「**最高优先级的全局配置文档**」，
//    默认落在 `$XDG_CONFIG_HOME/opencode/opencode.jsonc`（即 `~/.config/opencode/opencode.jsonc`）
//    —— 那是**用户自己的配置文件**。本文件会做真实写入（②③ 两项），
//    不隔离就等于改用户配置。
//    ⚠️ 本文件的第一次运行**真的踩到了这个坑**（把 `shell` 写进了用户全局配置，
//       已按用户许可恢复）→ 所以这里把 `XDG_CONFIG_HOME` 写成**运行前置条件**。
//    另：v2.0.19 也读 `OPENCODE_CONFIG`（单文件路径），两种隔离方式都行。
//
// 可用环境变量（都必须带 VITE_ 前缀，Vite 才会注入 import.meta.env）：
//   VITE_OPENCODE_SMOKE=1            开关（不开则整组 skip）
//   VITE_OPENCODE_SMOKE_URL          默认 http://127.0.0.1:4097
//   VITE_OPENCODE_SMOKE_PASSWORD     默认 t1
//   VITE_OPENCODE_SMOKE_DIRECTORY    默认 /tmp/opencode/p3b/ws（**不要指向真实项目目录**）
//
// ── 本阶段要证明的事 ──────────────────────────────────────────────────
//
//   ① **配置读**：`GET /api/config` 的 `Config.Entry[]` 合并视图可用（只读展示的数据源）
//   ② **配置写**：`updateGlobalConfig({ shell })` 走 `PATCH /api/experimental/config` 真的落库
//   ③ 🔴 **「传其它字段被静默丢弃」的实证**：裸 REST 用 `{shell, theme}` 打同一端点 →
//      **HTTP 2xx**、shell 生效、theme **不生效**、且**没有任何报错**
//      —— 这正是「配置编辑器必须降级为只读」的硬证据（比报错更害人）
//   ④ **客户端防线**：`updateGlobalConfig({shell, theme})` 在**前端就抛错**、且**一次都不写**
//   ⑤ **已下架的 API 确实不存在**（编译期 + 运行时双证）
//
// ── 数据卫生（硬性要求）────────────────────────────────────────────────
//   1. 冒烟在 `VITE_OPENCODE_SMOKE_DIRECTORY`（默认 `/tmp/opencode/p3b/ws` 专用 scratch 目录）里建会话，
//      **所有自己建的会话都在 afterAll 里删掉**，不留残余（前几轮曾留下 72 个测试会话，别再犯）。
//   2. **全局配置必须被 `XDG_CONFIG_HOME` 隔离到 scratch 目录**（见上方红字），
//      否则 `PATCH /api/experimental/config` 会改到用户自己的 `~/.config/opencode/opencode.jsonc`。
//      本文件在 afterAll 里会把 shell 恢复成运行前的值，但这**只能兜住「值」兜不住「文件被写过」**。
// ============================================

import { afterAll, describe, expect, it, vi } from 'vitest'

const BASE_URL = (import.meta.env.VITE_OPENCODE_SMOKE_URL as string | undefined) ?? 'http://127.0.0.1:4097'
const PASSWORD = (import.meta.env.VITE_OPENCODE_SMOKE_PASSWORD as string | undefined) ?? 't1'
const DIRECTORY = (import.meta.env.VITE_OPENCODE_SMOKE_DIRECTORY as string | undefined) ?? '/tmp/opencode/p3b/ws'

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

const ENABLED = !!import.meta.env.VITE_OPENCODE_SMOKE
const reachable = ENABLED && (await probeServer())
if (!ENABLED) {
  console.info('[phase3bSmoke] 跳过：未设置 VITE_OPENCODE_SMOKE=1。启动方式见本文件头部注释。')
} else if (!reachable) {
  console.info(`[phase3bSmoke] 跳过：${BASE_URL} 上没有运行中的 opencode V2 服务。启动方式见本文件头部注释。`)
}

/** 本次运行自己建的会话，afterAll 清理（只删自己建的，不碰任何既有会话） */
const createdSessionIds: string[] = []
/** 冒烟开始前的 shell 原值，afterAll 恢复（不污染用户配置） */
let originalShell: string | null | undefined
let shellCaptured = false

/** 裸 REST 打 PATCH /api/experimental/config（用于证明「其它字段被静默丢弃」） */
async function patchExperimentalConfig(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/experimental/config`, {
    method: 'PATCH',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * 读回「全局配置文档里的 shell」
 *
 * 🔴 **线缆形状实测（阶段 3b 补记）**：`GET /api/config` 返回的是**裸数组** `Config.Entry[]`，
 *    **不是** `{data: [...]}` 信封 —— 与 `GET /api/session/active`（是 `{data:{...}}`）
 *    相反。又一次印证「SDK 是否解包是逐端点决定的」（见主文档 §3.3）。
 *    本文件第一次写这里时按信封解析，于是永远读到 `undefined`（踩过）。
 */
async function readConfigEntries(): Promise<Array<{ type?: string; path?: string; info?: Record<string, unknown> }>> {
  const res = await fetch(`${BASE_URL}/api/config`, { headers: AUTH })
  if (!res.ok) return []
  return (await res.json()) as Array<{ type?: string; path?: string; info?: Record<string, unknown> }>
}

/** 全局文档 = 不在本目录下的那条（`src/api/config.ts` 的 getGlobalConfig 用同样思路） */
async function readGlobalShell(): Promise<string | null | undefined> {
  const entries = await readConfigEntries()
  const global = entries.find(e => e.type === 'document' && (!e.path || !e.path.startsWith(DIRECTORY)))
  return global?.info?.shell as string | null | undefined
}

/**
 * 轮询等待「全局配置里的 shell」变成期望值
 *
 * 🔴 **为什么必须轮询**（阶段 3b 实测）：`PATCH /api/experimental/config` 写完后，
 *    紧接着的 `GET /api/config` **可能仍是旧值** —— 服务端要等配置文件被 watcher 重新读入
 *    才会在 `info` 里体现（实测：写完立刻读是 `{}`，约 1 秒后再读才是 `{shell: '/bin/sh'}`）。
 *    `POST /api/location/reload` 也**不能**立刻修好（实测同样滞后）。
 *    → 这条对 UI 也有意义：配置编辑器保存 shell 后立刻回读，可能读到旧值（见报告）。
 */
async function waitForGlobalShell(expected: string | null, timeoutMs = 5000): Promise<string | null | undefined> {
  const deadline = Date.now() + timeoutMs
  let last: string | null | undefined
  for (;;) {
    last = await readGlobalShell()
    if (last === expected) return last
    if (Date.now() > deadline) return last
    await new Promise(r => setTimeout(r, 150))
  }
}

afterAll(async () => {
  if (!reachable) return
  // 恢复 shell 原值（不污染用户配置）
  if (shellCaptured) {
    try {
      await patchExperimentalConfig({ shell: originalShell ?? null })
    } catch {
      // 恢复失败不阻塞测试结论（已尽力）
    }
  }
  // 清会话
  for (const id of createdSessionIds) {
    try {
      await fetch(`${BASE_URL}/api/session/${id}`, { method: 'DELETE', headers: AUTH })
    } catch {
      // 清理失败不阻塞测试结论（已尽力）
    }
  }
})

describe.skipIf(!reachable)('阶段 3b 冒烟：配置只读 + shell 唯一可写', () => {
  it('① 配置读：GET /api/config 的 Entry[] 能合并出可用配置（只读展示的数据源）', async () => {
    const { getConfig, getGlobalConfig } = await import('./config')

    const effective = await getConfig(DIRECTORY)
    expect(typeof effective).toBe('object')
    expect(effective).not.toBeNull()

    const global = await getGlobalConfig()
    expect(typeof global).toBe('object')

    // ⚠️ 这里**不能**断言「至少有一条 document」：
    //    用 `XDG_CONFIG_HOME` 隔离出来的全新 scratch 全局配置目录里**还没有** opencode.jsonc，
    //    所以此刻 Entry[] 里只有 `type:'directory'` 的发现来源标记（实测）。
    //    该 document 由 ② 的写入创建 —— 断言它「不存在」反而是隔离生效的证据。
    const entries = await readConfigEntries()
    expect(Array.isArray(entries)).toBe(true)
    expect(entries.some(e => e.type === 'directory')).toBe(true)
    // 隔离检查：全局配置目录必须落在 scratch 里，**绝不能**是用户真实的 ~/.config/opencode
    const dirEntry = entries.find(e => e.type === 'directory')
    expect(dirEntry?.path ?? '').toContain('/tmp/opencode/p3b/')
  }, 30000)

  it('② 配置写（唯一可用路径）：updateGlobalConfig({ shell }) 真的落库', async () => {
    const { updateGlobalConfig } = await import('./config')

    // 先记下原值，afterAll 恢复
    originalShell = await readGlobalShell()
    shellCaptured = true

    const target = originalShell === '/bin/sh' ? '/bin/bash' : '/bin/sh'
    const saved = await updateGlobalConfig({ shell: target } as never)

    // 裸 REST 复核：服务端真的写进去了（轮询等 watcher 把文件读回来）
    expect(await waitForGlobalShell(target)).toBe(target)

    // ⚠️ 如实记录：`updateGlobalConfig()` 内部的「回读」用的是 `getGlobalConfig()`，
    //    与上面同一个滞后源 → 返回值里的 shell 可能是**旧值**。
    //    这里不断言它等于 target，只断言它是个对象（滞后属 V2 服务端行为，不是本层 bug）。
    expect(typeof saved).toBe('object')
  }, 30000)

  it('③ 🔴 实证：裸 REST 传 { shell, theme } → HTTP 2xx，shell 生效、theme 被静默丢弃', async () => {
    // 这是「配置编辑器必须降级」的硬证据：传其它字段**不报错**，只是不生效
    const before = await readGlobalShell()
    const target = before === '/bin/sh' ? '/bin/bash' : '/bin/sh'

    const res = await patchExperimentalConfig({ shell: target, theme: 'phase3b-smoke-should-be-dropped' })
    expect(res.ok).toBe(true) // ← 关键：**没有报错**

    // shell 生效（轮询等 watcher）
    expect(await waitForGlobalShell(target)).toBe(target)

    // theme 被丢弃（连字段都不该出现）—— 等一拍再确认，避免「还没读回来」被误当成「已丢弃」
    await new Promise(r => setTimeout(r, 500))
    const entries = await readConfigEntries()
    expect(entries.some(e => e.info?.theme === 'phase3b-smoke-should-be-dropped')).toBe(false)
    expect(entries.some(e => e.info?.theme !== undefined)).toBe(false)
  }, 30000)

  it('④ 客户端防线：updateGlobalConfig 含其它字段时**前端就抛错**，且一次都不写', async () => {
    const { updateGlobalConfig } = await import('./config')

    const before = await readGlobalShell()

    await expect(updateGlobalConfig({ shell: '/bin/sh', theme: 'x' } as unknown as never)).rejects.toThrow(
      /只接受 \{ shell \}/,
    )

    // 关键：不能「部分保存」—— 服务端的 shell 必须**没被动过**
    expect(await readGlobalShell()).toBe(before)
  }, 30000)

  it('⑤ 已下架的 API 确实不存在（运行时复核编译期结论）', async () => {
    const sessionMod = await import('./session')
    for (const removed of ['shareSession', 'unshareSession', 'getSessionTodos']) {
      expect(removed in sessionMod).toBe(false)
    }

    const configMod = await import('./config')
    for (const removed of ['updateConfig', 'getProviderConfigs']) {
      expect(removed in configMod).toBe(false)
    }

    const worktreeMod = await import('./worktree')
    expect('resetWorktree' in worktreeMod).toBe(false)

    const globalMod = await import('./global')
    expect('disposeGlobal' in globalMod).toBe(false)

    const clientMod = await import('./client')
    expect('initGitProject' in clientMod).toBe(false)
  }, 30000)

  it('⑥ 数据卫生：本文件建的会话能被创建并删除（证明清理路径可用）', async () => {
    const { createSession, deleteSession } = await import('./session')

    const session = await createSession({ directory: DIRECTORY, title: '[phase3b-smoke] hygiene' })
    expect(session.id).toBeTruthy()
    createdSessionIds.push(session.id)

    await expect(deleteSession(session.id, DIRECTORY, 'local')).resolves.toBe(true)
    // 已删，afterAll 不必再删
    createdSessionIds.length = 0
  }, 30000)
})
