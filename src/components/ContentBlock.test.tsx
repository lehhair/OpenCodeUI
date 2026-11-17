import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContentBlock } from './ContentBlock'
import { INLINE_MAX_CHARS } from '../utils/contentBudget'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./CodePreview', () => ({
  CodePreview: ({ code, layoutVersion }: { code: string; layoutVersion?: number }) => (
    <pre data-testid="code-preview" data-layout-version={layoutVersion}>
      {code}
    </pre>
  ),
}))

vi.mock('../contexts', () => ({
  useFullscreenLayer: () => ({ isOpen: false, open: vi.fn() }),
}))

describe('ContentBlock', () => {
  it('remeasures expanded content after its layout transition without paint containment', () => {
    const { container } = render(
      <ContentBlock label="Output" content="tool output" defaultCollapsed stateKey="content-block-transition-test" />,
    )

    const block = screen.getByText('Output').closest('.rounded-md')
    expect(block).not.toHaveClass('contain-content')

    fireEvent.click(screen.getByText('Output'))
    expect(screen.getByTestId('code-preview')).toHaveAttribute('data-layout-version', '0')

    const body = container.querySelector('[data-content-block-body]')
    expect(body).not.toBeNull()
    fireEvent.transitionEnd(body!)

    expect(screen.getByTestId('code-preview')).toHaveAttribute('data-layout-version', '1')
  })

  it('超大内容内联只铺头尾，并给出省略提示', () => {
    const huge = Array.from({ length: 3000 }, (_, index) => `line-${index}-${'x'.repeat(48)}`).join('\n')
    render(<ContentBlock label="Output" content={huge} stateKey="content-block-crop-test" />)

    const preview = screen.getByTestId('code-preview')
    expect((preview.textContent ?? '').length).toBeLessThan(INLINE_MAX_CHARS + 200)
    expect(preview.textContent).toContain('…')
    expect(preview.textContent).toContain('line-0-')
    expect(preview.textContent).toContain('line-2999-')
    expect(screen.getByText('contentBlock.truncated')).toBeInTheDocument()
  })

  it('小内容不裁剪、不显示提示', () => {
    render(<ContentBlock label="Output" content="short output" stateKey="content-block-no-crop-test" />)
    expect(screen.getByTestId('code-preview').textContent).toBe('short output')
    expect(screen.queryByText('contentBlock.truncated')).toBeNull()
  })
})
