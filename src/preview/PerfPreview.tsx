// ============================================
// Tool group perf harness（仅 dev，/perf.html）
//
// 目的：用生产组件复现「一条消息里几十上百个工具，展开工具组」的场景，
// 在 Chrome 里量 DOM 节点、堆、长任务和展开耗时。
//
//   /perf.html?tools=93&kb=20&wlines=120
//
// - tools:  bash 工具数量（默认 93）
// - kb:     每条命令输出的大致体积（默认 20KB）
// - wlines: 每个 write 工具的文件行数（默认 120）
//
// 页面上的按钮可以手动走一遍：运行中 → 完成 → 收起/展开。
// 自动化用 Playwright：点按钮 + 在页面里用 setTimeout 采样即可。
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageRenderer } from '../features/message/MessageRenderer'
import type { AssistantContent, SessionMessageInfo } from '../types/api/message'

const params = new URLSearchParams(window.location.search)
const TOOL_COUNT = Math.max(1, Math.min(500, Number(params.get('tools') ?? 93) || 93))
const OUTPUT_KB = Math.max(0, Math.min(512, Number(params.get('kb') ?? 20) || 20))
const WRITE_LINES = Math.max(10, Math.min(60000, Number(params.get('wlines') ?? 120) || 120))
const NOW = Date.now()

const FILE_PATHS = [
  'src/features/message/MessageRenderer.tsx',
  'src/features/message/parts/ToolPartView.tsx',
  'src/components/ContentBlock.tsx',
  'src/components/CodeMirrorReadonly.tsx',
]

/** 造一份像构建日志一样的输出，按体积凑够 kb */
function buildOutput(index: number, kb: number): string {
  if (kb <= 0) return ''
  const lines: string[] = []
  let bytes = 0
  let line = 0
  const target = kb * 1024
  while (bytes < target) {
    const stamp = new Date(NOW + index * 500 + line * 37).toISOString()
    const file = FILE_PATHS[line % FILE_PATHS.length]
    const text =
      line % 17 === 0
        ? `\u001b[32m✔\u001b[0m ${file}:${100 + (line % 400)} check passed in ${(line % 9) + 1}ms`
        : line % 23 === 0
          ? `\u001b[33m⚠\u001b[0m ${file}:${100 + (line % 400)} unused variable 'deps'`
          : `[${stamp}] step ${index}/${TOOL_COUNT} ${file}:${100 + (line % 400)} resolved module ${line % 97}`
    lines.push(text)
    bytes += text.length + 1
    line += 1
  }
  return lines.join('\n')
}

function buildTools(phase: 'running' | 'completed'): AssistantContent[] {
  const content: AssistantContent[] = []

  for (let index = 0; index < TOOL_COUNT; index += 1) {
    const created = NOW + index * 120
    content.push({
      type: 'tool',
      id: `perf-bash-${index}`,
      name: 'bash',
      state:
        phase === 'running'
          ? {
              status: 'running',
              input: { command: `bun run scripts/step-${index}.ts`, workdir: '/repo' },
              metadata: { title: `step-${index}.ts` },
            }
          : {
              status: 'completed',
              input: { command: `bun run scripts/step-${index}.ts`, workdir: '/repo' },
              metadata: { title: `step-${index}.ts`, exit: 0 },
              content: [{ type: 'text', text: buildOutput(index, OUTPUT_KB) }],
            },
      time: { created, ran: created + 90, completed: created + 120 },
    })
  }

  // 两个搜索
  for (let index = 0; index < 2; index += 1) {
    const created = NOW + TOOL_COUNT * 120 + index * 100
    content.push({
      type: 'tool',
      id: `perf-grep-${index}`,
      name: 'grep',
      state:
        phase === 'running'
          ? {
              status: 'running',
              input: { pattern: index === 0 ? 'useMemo' : 'requestAnimationFrame', path: 'src' },
              metadata: {},
            }
          : {
              status: 'completed',
              input: { pattern: index === 0 ? 'useMemo' : 'requestAnimationFrame', path: 'src' },
              metadata: { title: index === 0 ? 'useMemo' : 'requestAnimationFrame' },
              content: [
                {
                  type: 'text',
                  text: Array.from(
                    { length: 18 },
                    (_, i) =>
                      `src/features/message/MessageRenderer.tsx:${120 + i * 7}: ${index === 0 ? 'useMemo' : 'requestAnimationFrame'}(...)`,
                  ).join('\n'),
                },
              ],
            },
      time: { created, ran: created + 40, completed: created + 60 },
    })
  }

  // 四个写入，带整份文件内容（走 diff 渲染）
  for (let index = 0; index < 4; index += 1) {
    const created = NOW + TOOL_COUNT * 120 + 300 + index * 100
    const filePath = FILE_PATHS[index]
    const body = Array.from(
      { length: WRITE_LINES },
      (_, i) => `export const generated${i} = () => "${'x'.repeat(48)}" // ${filePath}:${i + 1}`,
    ).join('\n')
    content.push({
      type: 'tool',
      id: `perf-write-${index}`,
      name: 'write',
      state:
        phase === 'running'
          ? {
              status: 'running',
              input: { filePath, content: body },
              metadata: {},
            }
          : {
              status: 'completed',
              input: { filePath, content: body },
              metadata: { filepath: filePath, title: filePath.split('/').pop() ?? filePath },
              content: [{ type: 'text', text: 'Wrote file' }],
            },
      time: { created, ran: created + 60, completed: created + 80 },
    })
  }

  return content
}

function buildMessage(phase: 'running' | 'completed'): SessionMessageInfo {
  return {
    id: 'perf-assistant',
    type: 'assistant',
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
    content: [
      {
        type: 'text',
        text: 'I’ll start by measuring where frames go, before changing anything: the CSS cost drivers and the shell’s observers and per-frame work.',
      },
      ...buildTools(phase),
    ],
    cost: 0.42,
    tokens: { input: 186_300, output: 4_200, reasoning: 0, cache: { read: 182_000, write: 0 } },
    finish: phase === 'running' ? undefined : 'stop',
    time: { created: NOW - 7_200_000, completed: phase === 'running' ? undefined : NOW },
  }
}

type Snapshot = {
  nodes: number
  spans: number
  textChars: number
  height: number
  heapMB: number
}

function snapshot(): Snapshot {
  const root = document.getElementById('transcript')!
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return {
    nodes: root.getElementsByTagName('*').length,
    spans: root.getElementsByTagName('span').length,
    textChars: root.textContent?.length ?? 0,
    height: root.scrollHeight,
    heapMB: memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : -1,
  }
}

function findGroupButton(): HTMLButtonElement | undefined {
  return document.querySelector<HTMLButtonElement>('#transcript button') ?? undefined
}

export function PerfPreview() {
  const [phase, setPhase] = useState<'running' | 'completed'>('running')
  const [stats, setStats] = useState<Snapshot | null>(null)
  const message = useMemo(() => buildMessage(phase), [phase])

  const refresh = useCallback(() => setStats(snapshot()), [])

  // 阶段切换后刷新面板数字（动作用按钮时也能看到）
  useEffect(() => {
    const timer = window.setTimeout(refresh, 500)
    return () => window.clearTimeout(timer)
  }, [phase, refresh])

  return (
    <div className="min-h-screen bg-bg-100 px-4 py-6 text-text-100">
      <div className="mx-auto flex max-w-[min(100%,var(--oc-chat-column-width,42rem))] flex-col gap-4">
        <div className="rounded-lg border border-border-200/60 bg-bg-200/40 p-3 text-[12px]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <strong>Tool group perf harness</strong>
            <span className="text-text-500">
              tools={TOOL_COUNT} · output≈{OUTPUT_KB}KB · phase={phase}
            </span>
            <button
              type="button"
              data-perf="complete"
              className="ml-auto rounded border border-border-200/70 px-2 py-1 hover:bg-bg-300/50"
              onClick={() => setPhase(phase === 'running' ? 'completed' : 'running')}
            >
              {phase === 'running' ? '完成这一轮' : '回到运行中'}
            </button>
            <button
              type="button"
              data-perf="collapse"
              className="rounded border border-border-200/70 px-2 py-1 hover:bg-bg-300/50"
              onClick={() => findGroupButton()?.click()}
            >
              收起 / 展开组
            </button>
            <button
              type="button"
              className="rounded border border-border-200/70 px-2 py-1 hover:bg-bg-300/50"
              onClick={() => window.location.reload()}
            >
              重置
            </button>
          </div>
          {stats && (
            <div
              data-perf="metrics"
              data-value={JSON.stringify(stats)}
              className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] text-text-400 sm:grid-cols-5"
            >
              <span>nodes {stats.nodes}</span>
              <span>spans {stats.spans}</span>
              <span>text {Math.round(stats.textChars / 1024)}KB</span>
              <span>height {Math.round(stats.height / 100) / 10}k px</span>
              <span>heap {stats.heapMB}MB</span>
            </div>
          )}
        </div>

        <div id="transcript" className="rounded-lg border border-border-200/60 px-3 py-4">
          <MessageRenderer message={message} sessionId="perf" allowStreamingLayoutAnimation={false} />
        </div>
      </div>
    </div>
  )
}
