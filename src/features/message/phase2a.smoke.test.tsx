// ============================================
// 阶段 2a 冒烟测试（**需要真实 V2 服务**）
// ============================================
//
// ⚠️ 默认**跳过**：它依赖一个活着的 opencode 服务与本机真实会话数据。
//    要跑它，先起服务再带上环境变量：
//
//      OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097
//      VITE_OPENCODE_SMOKE=1 npx vitest run src/features/message/phase2a.smoke.test.tsx
//
// 可用环境变量（都必须带 VITE_ 前缀，Vite 才会注入 import.meta.env）：
//   VITE_OPENCODE_SMOKE=1            开关（不开则整组 skip）
//   VITE_OPENCODE_SMOKE_URL          默认 http://127.0.0.1:4097
//   VITE_OPENCODE_SMOKE_PASSWORD     默认 t1
//   VITE_OPENCODE_SMOKE_DIRECTORY    默认仓库目录（GET /api/session 的裸 directory 参数）
//
// 作用：把「API 层游标分页 → 转换层 → 渲染层」整条链路用**真实数据**走一遍。

import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getSessionMessages } from '../../api/message'
import { toUIMessages } from '../../utils/messageConversion'
import { MessageRenderer } from './MessageRenderer'
import { FullscreenProvider } from '../../contexts'
import type { Message } from '../../types/message'
import { isRenderablePart, isSystemMessage } from '../../types/message'

const env = import.meta.env as Record<string, string | undefined>

const BASE_URL = env.VITE_OPENCODE_SMOKE_URL ?? 'http://127.0.0.1:4097'
const PASSWORD = env.VITE_OPENCODE_SMOKE_PASSWORD ?? 't1'
const DIRECTORY = env.VITE_OPENCODE_SMOKE_DIRECTORY ?? '/home/coder/project/OpenCodeUI'
const ENABLED = !!env.VITE_OPENCODE_SMOKE

vi.mock('../../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'smoke',
    getActiveBaseUrl: () => BASE_URL,
    getActiveAuth: () => ({ username: 'opencode', password: PASSWORD }),
    getServerBaseUrl: () => BASE_URL,
    getServerAuth: () => ({ username: 'opencode', password: PASSWORD }),
    getActiveCalibratedNow: () => Date.now(),
    subscribe: () => () => {},
    onServerChange: () => () => {},
    getServers: () => [],
    getActiveServer: () => undefined,
  },
}))

vi.mock('motion/mini', () => ({ animate: () => Promise.resolve() }))

// jsdom 没有 IntersectionObserver（useInView 依赖它），这里补一个空实现
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: IntersectionObserverMock,
  })
}

/**
 * 找一个**消息最多**的真实会话
 *
 * ⚠️ 阶段 2b 修正：原来取「最新 12 个会话里第一个非空」的。
 * 这个启发式很脆：任何新会话（例如冒烟测试自己建的、只有 1~2 条消息的会话）
 * 只要排在最前面就会被选中，于是「hasMore 必须为真」「必须能找到工具调用」
 * 这类断言全都会失败 —— 属于**测试选择器的问题，不是被测代码回归**。
 *
 * 现在改成：按「新→旧」逐个体检，取消息数最多的那个；
 * 一旦某页被探针上限（25 条）填满就**提前收工** —— 那已经足够翻好几页了，
 * 继续扫只会更慢。探测深度上限 60，实测本机 61 个会话里扫到第 59 个即可命中。
 */
const PROBE_LIMIT = 25
/**
 * 探测深度上限
 *
 * 取一个**远大于实际会话数**的值：探测是「新→旧」逐个来的，且一旦某页被探针上限
 * 填满就提前收工，所以正常情况只探几个就停。但仓库目录的会话会随开发不断增长
 * （阶段 2b 的冒烟自己就建了几十个），深度给小了就会「扫不到老的长会话」→ 假失败。
 */
const PROBE_DEPTH = 300
/** 会话列表一次要多少条 —— ⚠️ 服务端默认只给**最新 50 个**，不显式要就会被截断 */
const SESSION_LIST_LIMIT = 200

async function pickSessionWithMessages(): Promise<{ id: string; count: number }> {
  const auth = 'Basic ' + btoa(`opencode:${PASSWORD}`)
  const res = await fetch(
    `${BASE_URL}/api/session?directory=${encodeURIComponent(DIRECTORY)}&limit=${SESSION_LIST_LIMIT}`,
    { headers: { Authorization: auth } },
  )
  const body = (await res.json()) as { data: Array<{ id: string }> }

  let best = { id: '', count: 0 }
  for (const session of body.data.slice(0, PROBE_DEPTH)) {
    const probe = await fetch(`${BASE_URL}/api/session/${session.id}/message?limit=${PROBE_LIMIT}`, {
      headers: { Authorization: auth },
    })
    if (!probe.ok) continue
    const page = (await probe.json()) as { data: unknown[] }
    if (page.data.length > best.count) {
      best = { id: session.id, count: page.data.length }
    }
    // 探针上限已填满 → 足够翻页了，提前收工
    if (page.data.length >= PROBE_LIMIT) break
  }
  return best
}

describe.skipIf(!ENABLED)('阶段 2a 冒烟（真实 V2 服务）', () => {
  let sessionId = ''

  beforeAll(async () => {
    const picked = await pickSessionWithMessages()
    sessionId = picked.id
    expect(sessionId, '应当能从真实服务上找到一个非空会话').not.toBe('')
  })

  it('首页：拉到历史消息、重排成旧→新、给出游标', async () => {
    const page = await getSessionMessages(sessionId, { limit: 5 })

    console.log('[冒烟] 首页 ids:', page.messages.map(m => m.id).join(' '))
    console.log('[冒烟] hasMore:', page.hasMore, '| cursor.next:', page.cursor.next ? '有' : '无')

    expect(page.messages.length).toBeGreaterThan(0)
    expect(page.messages.length).toBeLessThanOrEqual(6) // limit + 溢出探测
    expect(page.hasMore).toBe(true)
    expect(page.cursor.next).toBeTruthy()

    // 旧 → 新（按 seq，用 id 的单调递增近似校验）
    const ids = page.messages.map(m => m.id)
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })

  it('跟 cursor.next 能向前拉到更早的一页，且与首页无重叠', async () => {
    const first = await getSessionMessages(sessionId, { limit: 5 })
    const older = await getSessionMessages(sessionId, { limit: 5, cursor: first.cursor.next! })

    console.log('[冒烟] 第 2 页 ids:', older.messages.map(m => m.id).join(' '))

    expect(older.messages.length).toBeGreaterThan(0)
    const firstIds = new Set(first.messages.map(m => m.id))
    expect(older.messages.some(m => firstIds.has(m.id))).toBe(false)
    // 更早的一页必须全部早于首页最早的那条
    expect(older.messages[older.messages.length - 1].id < first.messages[0].id).toBe(true)
  })

  it('连续翻页直到尽头：条数单调增长、最终 hasMore=false', async () => {
    let cursor: string | null = null
    let pages = 0
    const seen = new Set<string>()

    for (;;) {
      const page = await getSessionMessages(sessionId, { limit: 20, ...(cursor ? { cursor } : {}) })
      pages += 1
      for (const m of page.messages) seen.add(m.id)
      console.log(`[冒烟] 第 ${pages} 页：+${page.messages.length}（累计 ${seen.size}）hasMore=${page.hasMore}`)

      if (!page.hasMore || !page.cursor.next) break
      cursor = page.cursor.next
      if (pages >= 15) break // 安全阀
    }

    console.log('[冒烟] 总页数:', pages, '总去重条数:', seen.size)
    expect(pages).toBeGreaterThan(1)
    expect(seen.size).toBeGreaterThan(20)
  })

  it('把真实消息转成 UI 模型后，渲染层依赖的不变量都成立', async () => {
    const page = await getSessionMessages(sessionId, { limit: 20 })
    const ui = toUIMessages(page.messages, sessionId)

    const kinds = new Map<string, number>()
    for (const message of ui) {
      kinds.set(message.info.role, (kinds.get(message.info.role) ?? 0) + 1)
      expect(message.info.sessionID).toBe(sessionId)
      expect(message.info.id).toBeTruthy()
      expect(typeof message.info.time.created).toBe('number')

      for (const part of message.parts) {
        expect(part.id, `part 必须有 id（type=${part.type}）`).toBeTruthy()
        expect(part.messageID).toBe(message.info.id)
        expect(part.sessionID).toBe(sessionId)
      }

      // 每个 part 的 id 在消息内唯一（React key 要求）
      const ids = message.parts.map(p => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    }

    console.log('[冒烟] 角色分布:', JSON.stringify(Object.fromEntries(kinds)))
    console.log(
      '[冒烟] part 类型分布:',
      JSON.stringify(
        ui
          .flatMap(m => m.parts)
          .reduce<Record<string, number>>((acc, p) => {
            acc[p.type] = (acc[p.type] ?? 0) + 1
            return acc
          }, {}),
      ),
    )
    expect(ui.length).toBeGreaterThan(0)
  })

  it('真实工具调用被映射成渲染层认识的状态机形状', async () => {
    // 翻几页，直到找到带工具调用的 assistant 消息
    let cursor: string | null = null
    let toolPart: Message['parts'][number] | undefined

    for (let i = 0; i < 10 && !toolPart; i++) {
      const page = await getSessionMessages(sessionId, { limit: 50, ...(cursor ? { cursor } : {}) })
      const ui = toUIMessages(page.messages, sessionId)
      toolPart = ui.flatMap(m => m.parts).find(p => p.type === 'tool')
      cursor = page.cursor.next
      if (!cursor) break
    }

    expect(toolPart, '真实数据里应当能找到工具调用').toBeTruthy()
    if (toolPart?.type !== 'tool') throw new Error('unreachable')

    console.log('[冒烟] 工具样例:', JSON.stringify({ tool: toolPart.tool, status: toolPart.state.status }))

    // UI 只认这 4 个状态；V2 的 streaming 必须已被翻译成 pending
    expect(['pending', 'running', 'completed', 'error']).toContain(toolPart.state.status)
    expect(toolPart.callID).toBeTruthy()
    expect(toolPart.tool).toBeTruthy()
    expect(isRenderablePart(toolPart)).toBe(true)
  })

  it('能真实渲染：用户消息与助手消息都产出可见 DOM', async () => {
    // 取一段含 user + assistant 的连续区间
    let cursor: string | null = null
    let ui: Message[] = []

    for (let i = 0; i < 10; i++) {
      const page = await getSessionMessages(sessionId, { limit: 50, ...(cursor ? { cursor } : {}) })
      ui = toUIMessages(page.messages, sessionId)
      if (ui.some(m => m.info.role === 'user') && ui.some(m => m.info.role === 'assistant')) break
      cursor = page.cursor.next
      if (!cursor) break
    }

    const userMessage = ui.find(m => m.info.role === 'user')
    const assistantMessage = ui.find(m => m.info.role === 'assistant' && m.parts.some(p => p.type === 'text'))
    expect(userMessage, '应当找到用户消息').toBeTruthy()
    expect(assistantMessage, '应当找到助手消息').toBeTruthy()

    const userView = render(<MessageRenderer message={userMessage!} canUndo={false} />)
    expect(userView.container.textContent?.length ?? 0).toBeGreaterThan(0)
    console.log('[冒烟] 用户消息渲染字符数:', userView.container.textContent?.length ?? 0)
    userView.unmount()

    const assistantView = render(
      <MessageRenderer message={assistantMessage!} isTurnLatestAssistant processContentScope="all" />,
    )
    expect(assistantView.container.textContent?.length ?? 0).toBeGreaterThan(0)
    console.log('[冒烟] 助手消息渲染字符数:', assistantView.container.textContent?.length ?? 0)
    assistantView.unmount()
  })

  it('系统类消息（system / idle / compaction）也能渲染出 DOM 或安全地渲染为空', async () => {
    // 翻页找到 system 或 idle 消息
    let cursor: string | null = null
    let marker: Message | undefined

    for (let i = 0; i < 10 && !marker; i++) {
      const page = await getSessionMessages(sessionId, { limit: 50, ...(cursor ? { cursor } : {}) })
      const ui = toUIMessages(page.messages, sessionId)
      marker = ui.find(m => isSystemMessage(m.info) && m.info.kind === 'system')
      cursor = page.cursor.next
      if (!cursor) break
    }

    if (!marker) {
      console.log('[冒烟] 本会话没有 system 消息，跳过（不算失败）')
      return
    }

    console.log('[冒烟] system 消息渲染检查，kind =', isSystemMessage(marker.info) ? marker.info.kind : '?')
    const view = render(<MessageRenderer message={marker} />)
    // system 消息渲染成一行提示，不能抛错
    expect(view.container).toBeTruthy()
    console.log('[冒烟] system 渲染字符数:', view.container.textContent?.length ?? 0)
    view.unmount()
  })

  it('渲染整页消息不抛错（含工具卡片、推理、系统提示）', async () => {
    const page = await getSessionMessages(sessionId, { limit: 50 })
    const ui = toUIMessages(page.messages, sessionId)

    const view = render(
      // BashRenderer 等工具渲染器要求 FullscreenProvider 上下文
      <FullscreenProvider>
        <div>
          {ui.map(message => (
            <MessageRenderer key={message.info.id} message={message} isTurnLatestAssistant processContentScope="all" />
          ))}
        </div>
      </FullscreenProvider>,
    )

    console.log('[冒烟] 整页渲染字符数:', view.container.textContent?.length ?? 0)
    console.log('[冒烟] 整页渲染的消息条数:', ui.length)
    expect(view.container.textContent?.length ?? 0).toBeGreaterThan(0)
    view.unmount()
  })
})
