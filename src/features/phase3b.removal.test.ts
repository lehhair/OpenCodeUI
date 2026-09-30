// ============================================
// 阶段 3b 裁撤守卫（静态断言）
// ============================================
//
// 目的：把「**V2 已删除的能力不得重新出现在代码里**」变成**自动化可回归**的断言。
//
// 为什么需要它：
//   阶段 3b 的成果是「删掉一堆入口」。这类改动最怕的是**以后被无意加回来**
//   （例如从旧分支拷贝代码、或按记忆补一个「看起来该有」的按钮）。
//   单测只能覆盖「已存在的组件」，而这里要断言的是「**不存在**」——
//   所以直接扫源码文本。
//
// 本文件**不依赖真实服务**，也不渲染任何组件，跑得很快。
//
// ⚠️ 断言的都是「V2 服务端根本没有这个能力」的项（不是「我们还没做」）。
//    每一条的 V2 依据都写在注释里。
// ============================================

import { describe, expect, it } from 'vitest'

// ⚠️ 用 Vite 的 `import.meta.glob(?raw)` 读源码，而不是 `node:fs`：
//    本项目的 `tsconfig.app.json` 的 `types` 只有 `["vite/client"]`（没有 @types/node），
//    直接用 `node:fs` 会 tsc 报错；而 `import.meta.glob` 是 Vite 原生能力，零新依赖。
//    eager: true → 构建期就把内容打进测试 bundle，运行时同步可用。
const RAW_SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** 收集 src 下所有非测试源码（不含测试文件本身，避免自我命中） */
function collectSourceFiles(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, content] of Object.entries(RAW_SOURCES)) {
    if (/\.test\.(ts|tsx)$/.test(path)) continue
    if (path.endsWith('/phase3b.removal.test.ts')) continue
    out[path] = content
  }
  return out
}

const CONTENTS_RAW = collectSourceFiles()
const FILES = Object.keys(CONTENTS_RAW)

/**
 * 剥掉注释后再搜索。
 *
 * ⚠️ 必须这么做：阶段 3b 的代码里到处是「⛔ 阶段 3b 已删除 xxx」这类说明注释，
 *    它们**故意提到**被删掉的名字（否则后来者看不懂为什么这里空了一块）。
 *    如果不剥注释，守卫会把这些说明文字误判成「代码里又出现了」。
 */
function stripComments(text: string): string {
  // 块注释（含 JSDoc）：`/* ... */` 非贪婪跨行
  let s = text.replace(/\/\*[\s\S]*?\*\//g, '')
  // 行注释：只处理「不在字符串里」的 `//`（用引号奇偶做廉价判定）
  s = s
    .split('\n')
    .map(line => {
      const idx = line.indexOf('//')
      if (idx === -1) return line
      const before = line.slice(0, idx)
      const quotes =
        (before.match(/'/g) ?? []).length + (before.match(/"/g) ?? []).length + (before.match(/`/g) ?? []).length
      return quotes % 2 === 1 ? line : before
    })
    .join('\n')
  return s
}

const CONTENTS = new Map(Object.entries(CONTENTS_RAW).map(([f, raw]) => [f, stripComments(raw)]))

/** 某个源码文件是否存在（基于 glob 的 key 集合，替代 node:fs 的 existsSync） */
function fileExists(relFromRepoRoot: string): boolean {
  return Object.keys(RAW_SOURCES).includes('/' + relFromRepoRoot)
}

/** 在全部源码（**已剥注释**）里找包含 needle 的位置（返回「src 下的相对路径:行号」列表） */
function findInSource(needle: string): string[] {
  const hits: string[] = []
  for (const [file, text] of CONTENTS) {
    const short = file.replace(/^\/src\//, '')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (line.includes(needle)) hits.push(`${short}:${i + 1}`)
    })
  }
  return hits
}

describe('阶段 3b 裁撤守卫 · 扫描器自检（防止「断言恒真」的空跑）', () => {
  it('扫描器能扫到 src 下的源码文件', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('扫描器能命中「确实存在」的符号（否则下面所有 toEqual([]) 都是假通过）', () => {
    // 这几个是阶段 3b **保留**的东西，必须能扫到
    expect(findInSource('findPermissionRequestForTool').length).toBeGreaterThan(0)
    expect(findInSource('QuestionRenderer').length).toBeGreaterThan(0)
    expect(findInSource('TodoRenderer').length).toBeGreaterThan(0)
  })

  it('扫描器确实剥掉了注释（被注释掉的标识符不算命中）', () => {
    // `api/session.ts` 的文件头注释里写了 shareSession，但代码里没有 → 不应命中
    const hits = findInSource('shareSession')
    expect(hits.filter(h => h.startsWith('api/session.ts'))).toEqual([])
  })
})

describe('阶段 3b 裁撤守卫：迁移占位符已清零', () => {
  it('`removedInV2(` 全仓库 0 命中（定义与调用都清掉）', () => {
    expect(findInSource('removedInV2(')).toEqual([])
  })

  it('`notMigratedYet(` 全仓库 0 命中', () => {
    expect(findInSource('notMigratedYet(')).toEqual([])
  })

  it('`src/api/notMigrated.ts` 已删除（两种占位符都退役了）', () => {
    expect(fileExists('src/api/notMigrated.ts')).toBe(false)
  })
})

describe('阶段 3b 裁撤守卫：V2 已删除的能力不再有 UI 入口', () => {
  it('会话分享：ShareDialog / 分享按钮 / setShareUrl 全部消失', () => {
    // V2 删除了 POST|DELETE /session/{id}/share（配置层只留 share:"auto" 策略，无 API）
    expect(fileExists('src/features/chat/ShareDialog.tsx')).toBe(false)
    expect(findInSource('ShareDialog')).toEqual([])
    expect(findInSource('shareSession')).toEqual([])
    expect(findInSource('unshareSession')).toEqual([])
    expect(findInSource('setShareUrl')).toEqual([])
    expect(findInSource('shareChat')).toEqual([])
  })

  it('会话归档：命令面板 / 快捷键 / 控制器动作全部消失', () => {
    // V2 删除了 time.archived（PATCH /api/session/{id} 只接受 title/metadata/permissions）。
    // 官方 V2 app 同样挂起：packages/app/src/home/sessions/controller.tsx:325 的 TODO。
    expect(findInSource('handleArchiveSession')).toEqual([])
    expect(findInSource('archiveSession')).toEqual([])
    expect(findInSource("'Alt+Backspace'")).toEqual([])
  })

  it('待办：会话级待办面板 / todoStore / getSessionTodos 全部消失', () => {
    // V2 没有待办端点、没有 todo.updated 事件、没有 todo 工具
    expect(fileExists('src/api/todo.ts')).toBe(false)
    expect(fileExists('src/types/api/todo.ts')).toBe(false)
    expect(fileExists('src/store/todoStore.ts')).toBe(false)
    expect(findInSource('getSessionTodos')).toEqual([])
    expect(findInSource('todoStore')).toEqual([])
    expect(findInSource('useTodos')).toEqual([])
  })

  it('⚠️ 但 TodoRenderer 必须保留（历史 todowrite 工具卡片仍要渲染）', () => {
    // 本地库有 328 条 todowrite 调用，且所在会话都在 session_v2 里（V2 可见）
    expect(fileExists('src/features/message/tools/renderers/TodoRenderer.tsx')).toBe(true)
    expect(findInSource('TodoRenderer').length).toBeGreaterThan(0)
  })

  it('worktree 重置：API / 按钮 / 确认弹窗全部消失', () => {
    // V2 删除了 POST /experimental/worktree/reset，且无替代能力
    expect(findInSource('resetWorktree')).toEqual([])
    expect(findInSource('WorktreeResetInput')).toEqual([])
    expect(findInSource('resetConfirm')).toEqual([])
  })

  it('初始化 git：API / 按钮全部消失', () => {
    // V2 删除了 POST /project/git/init（改为 location 首次使用时自动初始化）
    expect(findInSource('initGitProject')).toEqual([])
    expect(findInSource('initializingGit')).toEqual([])
    expect(findInSource('handleInitGit')).toEqual([])
  })

  it('LSP / 格式化器状态：两个文件整体删除（零调用点）', () => {
    // V2 不再运行语言服务器（GET /lsp、GET /formatter 已删）
    expect(fileExists('src/api/lsp.ts')).toBe(false)
    expect(findInSource('getLspStatus')).toEqual([])
    expect(findInSource('getFormatterStatus')).toEqual([])
  })

  it('tool 端点：两个文件整体删除（零调用点）', () => {
    // V2 删除了 /experimental/tool 与 /experimental/tool/ids
    expect(fileExists('src/api/tool.ts')).toBe(false)
    expect(fileExists('src/types/api/tool.ts')).toBe(false)
    expect(findInSource('getToolIds')).toEqual([])
  })

  it('disposeGlobal：V2 无等价物，函数删除', () => {
    expect(findInSource('disposeGlobal')).toEqual([])
  })

  it('配置写入：location 级写入口删除；只保留 shell 一道防线', () => {
    // V2 的 /api/config 只有 GET；PATCH /api/experimental/config 只接受 { shell }
    expect(findInSource('updateConfig(')).toEqual([])
    expect(findInSource('只接受 { shell }')).not.toEqual([])
  })

  it('question 内联交互通道：InlineQuestion / QuestionDialog / pendingQuestions 全部消失', () => {
    // V2 的提问走 Form 体系，表单统一由底部 FormDialog 渲染与回复
    expect(fileExists('src/features/chat/InlineQuestion.tsx')).toBe(false)
    expect(fileExists('src/features/chat/QuestionDialog.tsx')).toBe(false)
    expect(findInSource('InlineQuestion')).toEqual([])
    expect(findInSource('QuestionDialog')).toEqual([])
    expect(findInSource('findQuestionRequestForTool')).toEqual([])
    expect(findInSource('pendingQuestions')).toEqual([])
  })

  it('⚠️ 但 QuestionRenderer 必须保留（V2 的 question 工具还在，本地库 54 条真实调用）', () => {
    expect(fileExists('src/features/message/tools/renderers/QuestionRenderer.tsx')).toBe(true)
    expect(findInSource('QuestionRenderer').length).toBeGreaterThan(0)
  })

  it('MCP needs_client_registration 分支：类型与展示分支全部消失', () => {
    // V2 的 Mcp.Status 只有 connected / pending / disabled / failed / needs_auth
    expect(findInSource('needs_client_registration')).toEqual([])
    expect(findInSource('MCPStatusNeedsClientRegistration')).toEqual([])
  })

  it('gitignore 灰显：ignored 字段与 opacity-50 灰显逻辑全部消失', () => {
    // V2 的 fs/list 不返回 ignored 标记（且会原样列出 gitignore 命中项）
    expect(findInSource('node.ignored')).toEqual([])
    expect(findInSource('ignored: false')).toEqual([])
    expect(findInSource("'ignored'")).toEqual([])
  })

  it('零消费点的 useRevertState 已删除', () => {
    expect(fileExists('src/hooks/useRevertState.ts')).toBe(false)
    expect(findInSource('useRevertState')).toEqual([])
  })
})
