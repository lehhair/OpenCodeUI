import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompactionPartView } from './SystemPartViews'
import type { SessionMessageCompaction } from '@opencode/client/promise'

function compaction(overrides: Record<string, unknown>): SessionMessageCompaction {
  return {
    id: 'msg-c1',
    type: 'compaction',
    reason: 'manual',
    time: { created: Date.now() },
    ...overrides,
  } as unknown as SessionMessageCompaction
}

describe('CompactionPartView（官方 SessionCompactionMessage 同款）', () => {
  it('running：started 分隔线 + 流式摘要 + 进行中指示', () => {
    render(<CompactionPartView message={compaction({ status: 'running', summary: '正在总结前半段…', recent: '' })} />)
    expect(screen.getByText('Compacting context', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('正在总结前半段…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Compacting context…')
  })

  it('completed：结果分隔线 + token 用量（含 cache）', () => {
    render(
      <CompactionPartView
        message={compaction({
          status: 'completed',
          summary: '压缩完成',
          recent: '',
          tokens: { input: 1000, output: 200, reasoning: 100, cache: { read: 2000, write: 500 } },
        })}
      />,
    )
    // input = 1000+2000+500=3500 → 3.5K；output = 200+100=300
    expect(screen.getByText(/History compacted · 3\.5K in · 300 out/)).toBeInTheDocument()
    expect(screen.getByText('压缩完成')).toBeInTheDocument()
  })

  it('completed + providerContext → 服务商压缩标签', () => {
    render(
      <CompactionPartView
        message={compaction({
          status: 'completed',
          summary: 'x',
          recent: '',
          providerContext: { version: 1, provenance: {}, messages: [] },
        })}
      />,
    )
    expect(screen.getByText('Provider compaction')).toBeInTheDocument()
  })

  it('failed：失败标签 + 错误详情，不显示摘要', () => {
    render(
      <CompactionPartView
        message={compaction({
          status: 'failed',
          error: { type: 'compaction.failed', message: 'provider 503' },
        })}
      />,
    )
    expect(screen.getByText(/Compaction failed/)).toBeInTheDocument()
    expect(screen.getByText('provider 503')).toBeInTheDocument()
  })

  it('failed + aborted → 已取消且不显示错误详情', () => {
    render(
      <CompactionPartView
        message={compaction({
          status: 'failed',
          error: { type: 'aborted', message: 'user cancelled' },
        })}
      />,
    )
    expect(screen.getByText('Compaction cancelled')).toBeInTheDocument()
    expect(screen.queryByText('user cancelled')).not.toBeInTheDocument()
  })

  it('failed + interrupted → 被中断标签', () => {
    render(
      <CompactionPartView
        message={compaction({
          status: 'failed',
          error: { type: 'compaction.interrupted', message: 'interrupted' },
        })}
      />,
    )
    expect(screen.getByText('Compaction interrupted')).toBeInTheDocument()
  })
})
