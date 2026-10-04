import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueueBubbles } from './QueueBubbles'
import type { QueuedUserPrompt } from '../../store/inboxStore'

function makeItem(id: string, text: string): QueuedUserPrompt {
  return {
    id,
    type: 'user',
    delivery: 'queue',
    payload: { text },
  } as unknown as QueuedUserPrompt
}

describe('QueueBubbles（下轮队列虚线气泡）', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(<QueueBubbles items={[]} />)
    expect(container.querySelector('[data-message-queue]')).not.toBeInTheDocument()
  })

  it('renders one dashed bubble per queued item with the group label', () => {
    render(<QueueBubbles items={[makeItem('q1', '排队这条'), makeItem('q2', '再排一条')]} />)
    expect(screen.getByText('排队这条')).toBeInTheDocument()
    expect(screen.getByText('再排一条')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-message-queue="queued"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-message-queue="queued"] .border-dashed')).toHaveLength(2)
  })

  it('prefers metadata.displayText over payload.text（官方 queuedPromptText）', () => {
    const item = makeItem('q1', 'raw text')
    ;(item.payload as Record<string, unknown>).metadata = { displayText: '展示文本' }
    render(<QueueBubbles items={[item]} />)
    expect(screen.getByText('展示文本')).toBeInTheDocument()
    expect(screen.queryByText('raw text')).not.toBeInTheDocument()
  })

  it('fires steer / edit / remove callbacks with the item', () => {
    const onSteer = vi.fn()
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    const item = makeItem('q1', '排队这条')
    render(<QueueBubbles items={[item]} onSteer={onSteer} onEdit={onEdit} onRemove={onRemove} />)
    fireEvent.click(screen.getByTitle('Inject into current turn'))
    expect(onSteer).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByTitle('Retract to edit'))
    expect(onEdit).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByTitle('Remove from queue'))
    expect(onRemove).toHaveBeenCalledWith(item)
  })
})
