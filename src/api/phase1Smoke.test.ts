// ============================================
// 阶段 1 冒烟测试：真实 opencode V2 服务 + 真实迁移代码
// ============================================
//
// 目的：用**迁移后的 src/api/** 打一个**真实运行的 opencode V2 服务**，
// 验证阶段 1 的三条验收标准：**会话列表 / 模型列表 / 配置读取**。
//
// 与普通单测的区别：普通单测把 SDK 全 mock 掉了（见 sdk.test.ts），
// 只能验证「代码能编译、能调用」；本文件验证「打 V2 端点真的能拿到对的数据」。
//
// ▶ 怎么跑（需要先起服务）：
//
//   mkdir -p /tmp/opencode/v2test/cwd /tmp/opencode/v2test/dirA /tmp/opencode/v2test/dirB
//   echo '{ "username": "MARK_FROM_DIR_A" }' > /tmp/opencode/v2test/dirA/opencode.json
//   echo '{ "username": "MARK_FROM_DIR_B" }' > /tmp/opencode/v2test/dirB/opencode.json
//   mkdir -p /tmp/opencode/v2test/dirA/.opencode/agent /tmp/opencode/v2test/dirB/.opencode/agent
//   printf -- '---\ndescription: Agent only visible in dirA\nmode: subagent\n---\nA\n' \
//     > /tmp/opencode/v2test/dirA/.opencode/agent/probe-a.md
//   printf -- '---\ndescription: Agent only visible in dirB\nmode: subagent\n---\nB\n' \
//     > /tmp/opencode/v2test/dirB/.opencode/agent/probe-b.md
//
//   # ⑨ 命令用例需要这两个文件（命令名取自文件名）
//   mkdir -p /tmp/opencode/v2test/dirA/.opencode/command /tmp/opencode/v2test/dirB/.opencode/command
//   printf -- '---\ndescription: Command only in dirA\n---\nA\n' \
//     > /tmp/opencode/v2test/dirA/.opencode/command/probe-a.md
//   printf -- '---\ndescription: Command only in dirB\n---\nB\n' \
//     > /tmp/opencode/v2test/dirB/.opencode/command/probe-b.md
//
//   # ⑦ skill 用例需要这两个文件（skill 名取自 frontmatter 的 name）
//   mkdir -p /tmp/opencode/v2test/dirA/.opencode/skill/probe-dirA /tmp/opencode/v2test/dirB/.opencode/skill/probe-dirB
//   printf -- '---\nname: probe-dirA\ndescription: Skill only in dirA\n---\nA\n' \
//     > /tmp/opencode/v2test/dirA/.opencode/skill/probe-dirA/SKILL.md
//   printf -- '---\nname: probe-dirB\ndescription: Skill only in dirB\n---\nB\n' \
//     > /tmp/opencode/v2test/dirB/.opencode/skill/probe-dirB/SKILL.md
//
//   # 🔴 全局配置**必须隔离**（阶段 4 新增的硬要求）：
//   #    本套件虽只读配置，但 ⑤ 要断言「全局配置里的 providers 被合并进目录视图」，
//   #    而**用户真实**的 ~/.config/opencode 里未必有 providers（新机器/CI 上必然没有）。
//   #    → 隔离到 scratch 目录，并写入下面这个 providers 探针（⑤ 依赖它）。
//   mkdir -p /tmp/opencode/v2test/config/opencode
//   cat > /tmp/opencode/v2test/config/opencode/opencode.jsonc <<'EOF'
//   {
//     "$schema": "https://opencode.ai/config.json",
//     "providers": {
//       "smoke-probe": {
//         "package": "aisdk:@ai-sdk/openai",
//         "name": "Smoke Probe",
//         "settings": { "baseURL": "http://127.0.0.1:1/v1" }
//       }
//     }
//   }
//   EOF
//
//   cd /tmp/opencode/v2test/cwd && \
//     OPENCODE_SERVER_PASSWORD=t1 XDG_CONFIG_HOME=/tmp/opencode/v2test/config \
//     opencode --log-level info serve --hostname 127.0.0.1 --port 4097
//
//   npx vitest run src/api/phase1Smoke.test.ts --reporter=verbose
//
// 服务不可达时整个套件**跳过**（不是失败），所以 `npm test` 在没有服务的环境下依然是绿的。
// 可用环境变量覆盖目标（需 VITE_ 前缀，Vite/vitest 才会注入）：
//   VITE_OPENCODE_SMOKE_URL / VITE_OPENCODE_SMOKE_PASSWORD
// ============================================

import { afterAll, describe, expect, it, vi } from 'vitest'

const BASE_URL = (import.meta.env.VITE_OPENCODE_SMOKE_URL as string | undefined) ?? 'http://127.0.0.1:4097'
const PASSWORD = (import.meta.env.VITE_OPENCODE_SMOKE_PASSWORD as string | undefined) ?? 't1'
const DIR_A = '/tmp/opencode/v2test/dirA'
const DIR_B = '/tmp/opencode/v2test/dirB'

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

/** 探测服务是否可达（1 秒超时，避免无服务时挂住） */
async function probeServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/info`, {
      headers: { authorization: 'Basic ' + btoa(`opencode:${PASSWORD}`) },
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

const reachable = await probeServer()
if (!reachable) {
  console.info(`[phase1Smoke] 跳过：${BASE_URL} 上没有运行中的 opencode V2 服务。` + `启动方式见本文件头部注释。`)
}

// ============================================
// 夹具自给自足（阶段 3a 补）
// ============================================
//
// ②/③ 断言「按目录过滤能拿到会话」，但 dirA / dirB 里**未必还有会话**
// （历史运行清过库）。以前这些用例只在没有服务时才 skip，一旦有服务就会
// 因为「目录里没会话」而假失败。
// → 这里在需要时**自己建一个会话**，并在 afterAll 里删掉，不污染用户数据。

/** 本文件自己建的会话（afterAll 清理） */
const createdSessionIds: string[] = []

/**
 * 保证目录下至少有一个会话，返回该目录下的会话列表
 */
async function ensureSessionIn(directory: string): Promise<Array<{ id: string; directory: string }>> {
  const { getSessions, createSession } = await import('./session')
  let sessions = await getSessions({ directory })
  if (sessions.length === 0) {
    const created = await createSession({ directory, title: '[phase1-smoke] fixture' })
    createdSessionIds.push(created.id)
    sessions = await getSessions({ directory })
  }
  return sessions
}

// ============================================
// 全局配置探针（阶段 4 新增：让 ⑤ 的「全局合并」断言在任何环境下都成立）
// ============================================
//
// 🔴 阶段 4 实测发现的**隐性环境依赖**：
//    ⑤ 原来断言 `expect(configA).toHaveProperty('providers')`，前提是「全局配置里有 providers」。
//    这条断言**只在跑在用户真实的 ~/.config/opencode 上时**才成立 ——
//    一旦按安全要求把 `XDG_CONFIG_HOME` 隔离到 scratch 目录（阶段 3b 事故后的硬要求），
//    全局配置是空的，断言必然失败。**这不是迁移回归，是用例本身耦合了环境。**
//
// 处理：把探针文件写进**隔离出来的**全局配置目录（见本文件头部的启动命令），
//    本文件只**读**不写 —— 原因见下。
//
// ⚠️ 为什么不在测试里写文件（虽然更「自给自足」）：
//    `tsconfig.app.json` 的 `types` 只有 `["vite/client"]`，`src/**` 里**不能** import
//    `node:fs`（会直接 tsc 报错，全仓库没有一处这么用）。而用 `fetch` 写文件只能走
//    `POST /api/fs/write`，那是 location 作用域的端点，写全局配置目录属于越界用法。
//    → 所以走「启动前准备好夹具」这条老路（与 dirA/dirB 的其它夹具一致），
//      并在缺失时**明确失败并打印补救命令**，绝不静默跳过。

/** 探针 provider 名（⑤ 断言它出现在合并视图里） */
const GLOBAL_PROBE_PROVIDER = 'smoke-probe'

/** 隔离闸门：全局配置目录必须落在 scratch 下（仅用于给出清晰报错，本文件不写文件） */
const SCRATCH_PREFIX = '/tmp/opencode/'

/**
 * 校验「隔离出来的全局配置里有 providers 探针」。
 *
 * 缺失时抛错并打印补救命令 —— **不静默跳过**（静默跳过就是「断言恒真」）。
 */
async function assertGlobalProviderProbe(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/config`, {
    headers: { authorization: 'Basic ' + btoa(`opencode:${PASSWORD}`) },
  })
  if (!res.ok) throw new Error(`[phase1Smoke] GET /api/config 失败：HTTP ${res.status}`)

  // 注意：`GET /api/config` 返回的是**裸数组** `Config.Entry[]`（不是 `{data:[…]}` 信封）
  const entries = (await res.json()) as Array<{
    type?: string
    path?: string
    info?: Record<string, unknown>
  }>
  const globalDoc = entries.find(
    e => e.type === 'document' && !!e.path && !e.path.startsWith(DIR_A) && !e.path.startsWith(DIR_B),
  )
  const providers = globalDoc?.info?.providers as Record<string, unknown> | undefined
  if (providers && GLOBAL_PROBE_PROVIDER in providers) return

  const globalDir = globalDoc?.path ?? '(未找到全局配置文档)'
  const isolated = globalDir.startsWith(SCRATCH_PREFIX)
  throw new Error(
    `[phase1Smoke] ⑤ 需要「全局配置里有 providers.${GLOBAL_PROBE_PROVIDER}」这个探针，但没有找到。\n` +
      `  当前全局配置文档：${globalDir}\n` +
      (isolated
        ? `  该目录已隔离 ✅，请按本文件头部写入探针后重跑：\n` +
          `    mkdir -p "$(dirname ${globalDir})"\n` +
          `    cat > ${globalDir} <<'EOF'\n` +
          `    { "\\$schema": "https://opencode.ai/config.json",\n` +
          `      "providers": { "${GLOBAL_PROBE_PROVIDER}": {\n` +
          `        "package": "aisdk:@ai-sdk/openai", "name": "Smoke Probe",\n` +
          `        "settings": { "baseURL": "http://127.0.0.1:1/v1" } } } }\n` +
          `    EOF\n`
        : `  🔒 该目录**没有**被隔离到 ${SCRATCH_PREFIX}… —— 请带 XDG_CONFIG_HOME 重启服务端\n` +
          `     （本文件不会去写用户的真实 ~/.config/opencode，见头部说明）。\n`),
  )
}

afterAll(async () => {
  if (!reachable) return
  for (const id of createdSessionIds) {
    try {
      await fetch(`${BASE_URL}/api/session/${id}`, {
        method: 'DELETE',
        headers: { authorization: 'Basic ' + btoa(`opencode:${PASSWORD}`) },
      })
    } catch {
      // 清理失败不阻塞结论（已尽力）
    }
  }
})

describe.skipIf(!reachable)('阶段 1 冒烟：真实 V2 服务', () => {
  it('① 健康检查：getHealth() 走 /api/info 并拿到 version', async () => {
    const { getHealth } = await import('./global')
    const info = await getHealth()
    expect(typeof info.version).toBe('string')
    expect(info.version.length).toBeGreaterThan(0)
    expect(Array.isArray(info.urls)).toBe(true)
  })

  it('② 会话列表：getSessions() 按目录正确过滤', async () => {
    const { getSessions } = await import('./session')

    // 夹具自给自足：目录里没会话时先建一个（afterAll 会清理）
    const sessionsA = await ensureSessionIn(DIR_A)
    const sessionsB = await ensureSessionIn(DIR_B)
    void getSessions

    expect(sessionsA.length).toBeGreaterThan(0)
    expect(sessionsB.length).toBeGreaterThan(0)
    // 关键断言：目录过滤真的生效（V2 的裸 directory 参数）
    expect(sessionsA.every(s => s.directory === DIR_A)).toBe(true)
    expect(sessionsB.every(s => s.directory === DIR_B)).toBe(true)
    // 两个目录拿到的不是同一批（若参数被静默忽略，会拿到全局所有会话）
    expect(sessionsA.map(s => s.id)).not.toEqual(sessionsB.map(s => s.id))
  })

  it('③ 会话详情：getSession() 返回正确的 location', async () => {
    const { getSession } = await import('./session')
    const [first] = await ensureSessionIn(DIR_B)
    const detail = await getSession(first.id)
    expect(detail.id).toBe(first.id)
    expect(detail.directory).toBe(DIR_B)
  })

  it('④ 模型列表：getActiveModels() 拿到带 provider 名称的模型', async () => {
    const { getActiveModels } = await import('./client')

    // 🔴 阶段 1 实测发现的 V2 行为：**location 首次被访问时，
    //    GET /api/model 与 /api/provider 可能返回空数组**（location 的
    //    provider 目录是惰性加载的），第二次请求才稳定。
    //    实测：全新目录 dirC/dirD/dirE/dirF 的第一次请求都拿到 `data: []`，
    //    紧接着的第二次请求就恢复正常（15 条）。
    //    这里先做一次预热，让断言只检验「迁移后的代码能正确 join 两个列表」，
    //    不把 V2 的惰性初始化算成迁移失败。
    //    ⚠️ 该行为对产品的影响已记入阶段 0.5 报告 §5 ⑩（UI 需要重试或等 location 就绪）。
    if ((await getActiveModels(DIR_A)).length === 0) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    const models = await getActiveModels(DIR_A)
    expect(models.length).toBeGreaterThan(0)
    expect(models.every(m => m.providerId && m.id && m.name)).toBe(true)
    // provider 名称来自 /api/provider 的 join，不应当退化成 providerID
    expect(models.some(m => m.providerName !== m.providerId)).toBe(true)
  })

  it('⑤ 配置读取：getConfig() 按目录合并 Config.Entry[]', async () => {
    const { getConfig } = await import('./config')

    // 校验隔离出来的全局配置里有 providers 探针（⑤ 的合并断言需要它）。
    // 缺失时**明确失败并打印补救命令**，不静默跳过 —— 见上方「全局配置探针」说明。
    await assertGlobalProviderProbe()

    const configA = await getConfig(DIR_A)
    const configB = await getConfig(DIR_B)
    const configCwd = await getConfig()

    // ⚠️ 标记必须用 **V2 schema 里存在的字段**：实测 V2 的 Config.Entry.info 是
    //    schema 归一化后的视图，**未知字段会被静默丢弃**（用 "theme" 会拿到空对象）
    expect((configA as { username?: string }).username).toBe('MARK_FROM_DIR_A')
    expect((configB as { username?: string }).username).toBe('MARK_FROM_DIR_B')
    // 不带目录时回落到服务进程 cwd（那里没有 opencode.json，所以没有该标记）
    expect((configCwd as { username?: string }).username).toBeUndefined()
    // 全局配置里的 providers 应当被合并进来（探针由启动前的夹具写入，见上方「全局配置探针」）
    expect(configA).toHaveProperty('providers')
    expect(Object.keys((configA as { providers: Record<string, unknown> }).providers)).toContain(GLOBAL_PROBE_PROVIDER)
  })

  it('⑥ Agent 列表：getAgents() 按目录拿到目录内定义的 agent', async () => {
    const { getAgents } = await import('./agent')
    const readNames = async (dir: string) => (await getAgents(dir)).map(a => a.name)

    // 🔴 与 ④/⑦ 同一类 V2 行为：**location 首次被访问时目录扫描可能还没完成**。
    //    ⚠️ 阶段 4 实测复现：本用例此前**偶发失败**（第一次跑 ⑥ 红、重跑绿）——
    //    dirB 的第一次请求只返回内置 agent（没有 probe-b），第二次请求才带出目录内的 agent。
    //    （此前没暴露，是因为它对「location 缓存是否已热」敏感，而缓存又受前面用例的执行顺序影响。）
    //    这里按 ⑦ 的既有写法预热一次，让断言只检验「迁移后的代码能正确按目录过滤」，
    //    不把 V2 的惰性初始化算成迁移失败。
    let namesA = await readNames(DIR_A)
    let namesB = await readNames(DIR_B)
    if (!namesA.includes('probe-a') || !namesB.includes('probe-b')) {
      await new Promise(resolve => setTimeout(resolve, 300))
      namesA = await readNames(DIR_A)
      namesB = await readNames(DIR_B)
    }

    expect(namesA).toContain('probe-a')
    expect(namesB).toContain('probe-b')
    expect(namesA).not.toContain('probe-b')
  })

  it('⑦ Skill 列表：getSkills() 按目录过滤', async () => {
    const { getSkills } = await import('./skill')
    const readNames = async (dir: string) => (await getSkills(dir)).map(s => s.name)

    // 🔴 与 ④ 同一类 V2 行为：**location 首次被访问时目录扫描可能还没完成**。
    //    实测：dirB 的第一次请求只返回全局 skill（没有 probe-dirB），
    //    紧接着的第二次请求才带出目录内的 skill。
    //    这里先预热一次，让断言只检验「迁移后的代码能正确按目录过滤」，
    //    不把 V2 的惰性初始化算成迁移失败。
    let namesA = await readNames(DIR_A)
    let namesB = await readNames(DIR_B)
    if (!namesA.includes('probe-dirA') || !namesB.includes('probe-dirB')) {
      await new Promise(resolve => setTimeout(resolve, 300))
      namesA = await readNames(DIR_A)
      namesB = await readNames(DIR_B)
    }

    expect(namesA).toContain('probe-dirA')
    expect(namesB).toContain('probe-dirB')
  })

  it('⑧ 命令列表：getCommands() 按目录过滤', async () => {
    const { getCommands } = await import('./command')
    const readNames = async (dir: string) => (await getCommands(dir)).map(c => c.name)

    // 同 ④/⑥/⑦：location 首次访问时目录扫描可能未完成 → 预热一次
    let namesA = await readNames(DIR_A)
    let namesB = await readNames(DIR_B)
    if (!namesA.includes('probe-a') || !namesB.includes('probe-b')) {
      await new Promise(resolve => setTimeout(resolve, 300))
      namesA = await readNames(DIR_A)
      namesB = await readNames(DIR_B)
    }

    expect(namesA).toContain('probe-a')
    expect(namesB).toContain('probe-b')
  })

  it('⑨ 项目 / 路径：getCurrentProject() 与 getPath() 可用', async () => {
    const { getCurrentProject, getPath, getProjects } = await import('./client')

    const project = await getCurrentProject(DIR_A)
    const path = await getPath()
    const all = await getProjects()

    expect(project.id).toBeTruthy()
    // V2 的 project.canonical 映射到内部的 worktree
    expect(project.worktree).toBe(DIR_A)
    expect(path.directory).toBeTruthy()
    expect(all.length).toBeGreaterThan(0)
  })

  it('⑩ Shell 列表：listAvailableShells() 走 /api/config/shell', async () => {
    const { listAvailableShells } = await import('./pty')
    const shells = await listAvailableShells()
    expect(Array.isArray(shells)).toBe(true)
    expect(shells.length).toBeGreaterThan(0)
    expect(shells[0]).toHaveProperty('path')
    expect(shells[0]).toHaveProperty('name')
    expect(shells[0]).toHaveProperty('acceptable')
  })

  it('⑪ 会话状态：getSessionStatus() 走 /api/session/active', async () => {
    const { getSessionStatus } = await import('./session')
    const status = await getSessionStatus()
    expect(typeof status).toBe('object')
  })

  // ⚠️ 阶段 2b 移除：内容搜索（`searchText`）与符号搜索（`searchSymbols`）已删除。
  //    V2 的 115 个端点里**没有任何内容搜索端点**（`GET /api/fs/find` 只匹配文件名/目录名），
  //    按迁移文档 §9.5「决策 1 = A：移除 UI」整体移除（函数 + FileExplorer 的搜索分支）。
  //    符号搜索同因 V2 删除 `GET /find/symbol`（不再运行语言服务器）而删除。
  //    因此这里不再有这两个函数的报错断言 —— 函数本身已不存在，编译期就会拦住调用。
  // ⚠️ 阶段 3b 更新：**两种占位符都已清零** ——
  //    `notMigratedYet` 在阶段 3a 清零；`removedInV2` 在阶段 3b 随 UI 一起清零
  //    （`src/api/notMigrated.ts` 整个文件已删除）。
  //    → 原来的 ⑫ 用例（断言 `getSessionTodos` 抛 `阶段 3b 待移除`）已无对象可断言：
  //      「V2 已删能力」现在**在编译期就被拦住**（函数本身不存在了），
  //      这正是 3b 想要的结果 —— 运行时不再有任何迁移占位符。
  it('⑫ V2 已删能力不再有运行时占位符（编译期即拦截）', async () => {
    const sessionModule = await import('./session')
    // 这些名字必须**不存在**于导出里；一旦有人把它们加回来，本用例会失败
    for (const removed of ['shareSession', 'unshareSession', 'getSessionTodos']) {
      expect(removed in sessionModule).toBe(false)
    }
  })

  it('⑬ 文件名搜索：searchFiles() 走 /api/fs/find 并拿到命中路径', async () => {
    const { searchFiles } = await import('./file')

    // 🔴 与 ④/⑦ 同一类惰性初始化：location 首次被访问时文件索引可能还没建好，
    //    第一次请求会返回空数组。先预热一次，让断言只检验「迁移后的代码能拿到路径」。
    let hits = await searchFiles('opencode.json', { directory: DIR_A })
    if (hits.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 300))
      hits = await searchFiles('opencode.json', { directory: DIR_A })
    }

    // V2 返回的是 `{ location, data: FileSystemEntry[] }`（不是裸数组），
    // 本模块只取 `entry.path`（实测是**相对 location 的路径**）。
    // 这里只锁「文件名能命中」，不锁相对/绝对，避免把 V2 的路径风格写死。
    expect(hits.some(path => path.endsWith('opencode.json'))).toBe(true)
  })
})
