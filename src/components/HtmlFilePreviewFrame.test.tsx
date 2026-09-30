import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HtmlFilePreviewFrame } from './HtmlFilePreviewFrame'

const themeMock = vi.hoisted(() => ({ resolvedTheme: 'light' as 'light' | 'dark' }))
const resolveHtmlPreviewResources = vi.hoisted(() =>
  vi.fn(async (html: string, _path?: string, _directory?: string) => html),
)

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: themeMock.resolvedTheme }),
}))

vi.mock('./htmlPreviewResources', () => ({ resolveHtmlPreviewResources }))

describe('HtmlFilePreviewFrame', () => {
  beforeEach(() => {
    themeMock.resolvedTheme = 'light'
    resolveHtmlPreviewResources.mockReset()
    resolveHtmlPreviewResources.mockImplementation(async (html: string) => html)
  })

  it('renders a file as a script-enabled opaque-origin sandbox', () => {
    render(
      <HtmlFilePreviewFrame
        html={'<main>Preview</main><script>document.body.dataset.ready="yes"</script>'}
        title="index.html"
      />,
    )

    const frame = screen.getByTitle('index.html')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy')
    expect(frame.getAttribute('srcdoc')).toContain('name="viewport" content="width=device-width, initial-scale=1"')
    expect(frame.getAttribute('srcdoc')).toContain('<main>Preview</main>')
    expect(frame.getAttribute('srcdoc')).toContain('html{height:100%;width:100%;margin:0;overflow:hidden}')
    expect(frame.getAttribute('srcdoc')).toContain('body{height:100%;width:100%;margin:0;overflow:auto')
    expect(frame.getAttribute('srcdoc')).toContain('::-webkit-scrollbar-thumb')
    expect(frame.getAttribute('srcdoc')).toContain('rgba(100,100,100,.35)')
    expect(frame.getAttribute('srcdoc')).toContain('opencode-html-interaction')
  })

  it('preserves an existing document viewport instead of injecting a duplicate', () => {
    render(
      <HtmlFilePreviewFrame
        html={'<html><head><meta name="viewport" content="width=640"></head><body>Preview</body></html>'}
        title="custom-viewport.html"
      />,
    )

    const srcDoc = screen.getByTitle('custom-viewport.html').getAttribute('srcdoc') ?? ''
    expect(srcDoc.match(/name="viewport"/g)).toHaveLength(1)
    expect(srcDoc).toContain('name="viewport" content="width=640"')
  })

  it('updates theme without replacing the preview document', async () => {
    const view = render(<HtmlFilePreviewFrame html={'<main>Preview</main>'} title="index.html" />)
    const frame = screen.getByTitle('index.html') as HTMLIFrameElement
    const initialSrcDoc = frame.getAttribute('srcdoc')
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')

    themeMock.resolvedTheme = 'dark'
    view.rerender(<HtmlFilePreviewFrame html={'<main>Preview</main>'} title="index.html" />)

    await waitFor(() => {
      expect(frame).toHaveStyle({ colorScheme: 'dark' })
      expect(postMessage).toHaveBeenCalledWith({ type: 'opencode-html-theme', theme: 'dark' }, '*')
    })
    expect(screen.getByTitle('index.html')).toBe(frame)
    expect(frame.getAttribute('srcdoc')).toBe(initialSrcDoc)
  })

  it('does not capture pointer input while its panel is resizing', () => {
    render(<HtmlFilePreviewFrame html={'<main>Preview</main>'} title="index.html" isResizing />)

    expect(screen.getByTitle('index.html')).toHaveClass('pointer-events-none')
  })

  it('does not show a stale file while a newly selected file is resolving', async () => {
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    resolveHtmlPreviewResources.mockImplementation(
      (_html: string, path?: string) =>
        new Promise<string>(resolve => {
          if (path === 'first.html') resolveFirst = resolve
          else resolveSecond = resolve
        }),
    )
    const view = render(
      <HtmlFilePreviewFrame html={'<main>First source</main>'} title="first.html" filePath="first.html" />,
    )
    expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument()

    view.rerender(
      <HtmlFilePreviewFrame html={'<main>Second source</main>'} title="second.html" filePath="second.html" />,
    )
    await act(async () => {
      resolveFirst('<main>Resolved first</main>')
      await Promise.resolve()
    })
    expect(screen.queryByTitle('second.html')).not.toBeInTheDocument()

    await act(async () => {
      resolveSecond('<main>Resolved second</main>')
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTitle('second.html').getAttribute('srcdoc')).toContain('Resolved second'))
  })
})
