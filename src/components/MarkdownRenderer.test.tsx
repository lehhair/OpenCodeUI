import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'
import { clearMermaidRenderCache } from './mermaidRenderCache'

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg><title>Diagram</title></svg>' })),
}))
const useInputCapabilitiesMock = vi.hoisted(() =>
  vi.fn(() => ({
    canHover: true,
    hasCoarsePointer: false,
    hasTouch: false,
    preferTouchUi: false,
  })),
)
const themeMock = vi.hoisted(() => ({ resolvedTheme: 'light' as 'light' | 'dark' }))

vi.mock('./CodeBlock', () => ({
  CodeBlock: ({
    code,
    language,
    variant,
    deferHighlight,
    forceHighlight,
    streamingHighlight,
    headerActions,
  }: {
    code: string
    language?: string
    variant?: string
    deferHighlight?: boolean
    forceHighlight?: boolean
    streamingHighlight?: boolean
    headerActions?: React.ReactNode
  }) => (
    <div
      data-testid="code-block"
      data-variant={variant ?? 'default'}
      data-defer-highlight={String(!!deferHighlight)}
      data-force-highlight={String(!!forceHighlight)}
      data-streaming-highlight={String(!!streamingHighlight)}
    >
      {language}
      {headerActions}
      {`${language ?? 'text'}:${code}`}
    </div>
  ),
}))

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: themeMock.resolvedTheme }),
}))

vi.mock('../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => useInputCapabilitiesMock(),
}))

vi.mock('mermaid', () => ({
  default: mermaidMocks,
}))

vi.mock('./ui', () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy-button" aria-label="Copy to clipboard">
      {text.slice(0, 20)}
    </button>
  ),
}))

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    themeMock.resolvedTheme = 'light'
    clearMermaidRenderCache()
    useInputCapabilitiesMock.mockReset()
    useInputCapabilitiesMock.mockReturnValue({
      canHover: true,
      hasCoarsePointer: false,
      hasTouch: false,
      preferTouchUi: false,
    })
    mermaidMocks.initialize.mockClear()
    mermaidMocks.render.mockClear()
    mermaidMocks.render.mockResolvedValue({ svg: '<svg><title>Diagram</title></svg>' })
  })

  it('renders headings and inline code', () => {
    render(<MarkdownRenderer content={'# Title\n\nUse `pnpm`'} />)

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    const codeEl = screen.getByText('pnpm')
    expect(codeEl).toBeInTheDocument()
    expect(codeEl.tagName).toBe('CODE')
  })

  it('renders inline code with accent text styling (no border/bg)', () => {
    render(<MarkdownRenderer content={'Use `code` here'} />)

    const codeEl = screen.getByText('code')
    expect(codeEl.className).not.toMatch(/border/)
    expect(codeEl.className).not.toMatch(/bg-accent-main/)
    expect(codeEl.className).toMatch(/font-mono/)
    expect(codeEl.className).toMatch(/text-accent-main-100/)
  })

  it('renders inline code inside list items as code elements', () => {
    const { container } = render(<MarkdownRenderer content={'- `单行代码`'} />)

    const codeEl = container.querySelector('li code')
    expect(codeEl).toBeInTheDocument()
    expect(codeEl).toHaveTextContent('单行代码')
    expect(codeEl).toHaveClass('font-mono')
    expect(codeEl).toHaveClass('text-accent-main-100')
  })

  it('keeps inline emphasis styles on the markdown path', () => {
    render(<MarkdownRenderer content={'**bold** *em* ~~gone~~'} />)

    expect(screen.getByText('bold').className).toMatch(/text-text-100/)
    expect(screen.getByText('em').className).toMatch(/text-text-200/)
    expect(screen.getByText('gone').className).toMatch(/text-text-400/)
  })

  it('renders common markdown extension inline styles', () => {
    const { container } = render(<MarkdownRenderer content={'H~2~O X^2^ ==mark=='} />)

    expect(container.querySelector('sub')).toHaveTextContent('2')
    expect(container.querySelector('sup')).toHaveTextContent('2')
    expect(container.querySelector('mark')).toHaveTextContent('mark')
  })

  it('keeps tilde number ranges literal instead of strikethrough or subscript', () => {
    const cases = [
      '范围 1~2~3 之间',
      '大约 3~5个，7~9个',
      '用时 1~2小时，约 3~5公里',
      '温度 1~2度，湿度 3~4%',
      '版本 1.0~2.0 已发布',
    ]
    for (const content of cases) {
      const { container } = render(<MarkdownRenderer content={content} />)
      const paragraph = container.querySelector('p')
      expect(paragraph).toHaveTextContent(content)
      expect(paragraph?.querySelector('del')).toBeNull()
      expect(paragraph?.querySelector('sub')).toBeNull()
    }
  })

  it('still renders chemical subscripts while keeping digit ranges literal in the same line', () => {
    const { container } = render(<MarkdownRenderer content={'H~2~O 的沸点约 90~100度，CO~2~ 浓度 400~500ppm'} />)

    expect(container.querySelectorAll('sub')).toHaveLength(2)
    expect(container.querySelectorAll('del')).toHaveLength(0)
    expect(container.querySelector('p')).toHaveTextContent('H2O 的沸点约 90~100度，CO2 浓度 400~500ppm')
  })

  it('keeps ~~double tilde~~ strikethrough working', () => {
    const { container } = render(<MarkdownRenderer content={'这是 ~~删除的内容~~ 测试'} />)

    expect(container.querySelector('del')).toHaveTextContent('删除的内容')
  })

  it('renders backslash-paren LaTeX inline math delimiters', () => {
    const { container } = render(
      <MarkdownRenderer content={String.raw`公式 \(E = mc^2\) 很棒，还有 \(x^2 + y^2 = z^2\)`} />,
    )

    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('.katex')).not.toHaveTextContent('\\(')
  })

  it('renders backslash-bracket LaTeX display math delimiters', () => {
    const { container } = render(<MarkdownRenderer content={String.raw`\[E = mc^2\]`} />)

    expect(container.querySelector('.katex-display')).toBeInTheDocument()
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
  })

  it('renders multi-line backslash-bracket display math with = lines (issue #152)', () => {
    const content = String.raw`\[
\mathcal R_{\mathrm{final}}
=
\mathcal R_{\mathrm{Stage\,2}}
\cup
\mathcal E_{\mathrm{verified}}.
\]`
    const { container } = render(<MarkdownRenderer content={content} />)

    // `=` 单独成行是 markdown 的 Setext 标题语法，块级数学扩展必须抢在它之前把公式整体吃下
    expect(container.querySelector('h1')).not.toBeInTheDocument()
    expect(container.querySelector('.katex-display')).toBeInTheDocument()
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
  })

  it('renders multi-line dollar display math embedded in a document', () => {
    const content = String.raw`根据公式
$$
x + y = z
$$
可得`
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelector('.katex-display')).toBeInTheDocument()
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
  })

  it('renders math inside table cells', () => {
    const content = String.raw`| a | b |
|---|---|
| $x_i$ | \(y^2\) |`
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelectorAll('.katex')).toHaveLength(2)
  })

  it('keeps escaped parentheses and brackets literal when they are not math', () => {
    const { container } = render(<MarkdownRenderer content={String.raw`\(注意\) 这里 \[0\] 是索引，(a) 是文本`} />)

    expect(container.querySelector('.katex')).not.toBeInTheDocument()
    expect(container.querySelector('p')).toHaveTextContent('(注意) 这里 [0] 是索引，(a) 是文本')
  })

  it('renders footnote references and definitions', () => {
    const content =
      '这是一段需要说明的文字[^ref1]。这里还有另一个引用[^ref2]。\n\n[^ref2]: 第二个脚注，来自某文献第 42 页。'
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelector('#fnref-ref1')).toHaveTextContent('ref1')
    expect(container.querySelector('#fnref-ref2')).toHaveTextContent('ref2')
    expect(container.querySelector('#fn-ref2')).toHaveTextContent('第二个脚注，来自某文献第 42 页。')
  })

  it('keeps task checkboxes on the markdown path', () => {
    const { container } = render(<MarkdownRenderer content={'- [x] done'} />)

    const checkbox = container.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeInTheDocument()
  })

  it('renders fenced code blocks via CodeBlock', () => {
    render(<MarkdownRenderer content={'```ts\nconst x = 1\n```'} />)

    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
  })

  it('renders consecutive fenced code blocks via CodeBlock', () => {
    const fence = '```'
    const content = [
      `${fence}python`,
      'print("py")',
      fence,
      '',
      `${fence}javascript`,
      'console.log("js")',
      fence,
      '',
      `${fence}rust`,
      'fn main() {}',
      fence,
      '',
      `${fence}go`,
      'package main',
      fence,
      '',
      `${fence}sql`,
      'SELECT 1;',
      fence,
      '',
      `${fence}json`,
      '{"name":"test"}',
      fence,
      '',
      `${fence}bash`,
      'echo ok',
      fence,
    ].join('\n')

    render(<MarkdownRenderer content={content} />)

    expect(screen.getAllByTestId('code-block')).toHaveLength(7)
  })

  it('renders the comprehensive markdown fixture core elements', () => {
    const fence = '```'
    const content = [
      '# Markdown 综合性能测试文档',
      '',
      '> 用于测试 Markdown 解析器的流式渲染性能。',
      '',
      '**粗体** · *斜体* · ~~删除线~~ · `行内代码` · H~2~O · X^2^ · ==高亮==',
      '',
      '## 三、代码块',
      '',
      `${fence}python`,
      'def quicksort(arr):',
      '    if len(arr) <= 1:',
      '        return arr',
      fence,
      '',
      `${fence}javascript`,
      'async function fetchData(url) {',
      '    const resp = await fetch(url);',
      '    return resp.json();',
      '}',
      fence,
      '',
      `${fence}rust`,
      'fn main() {',
      '    println!("ok");',
      '}',
      fence,
      '',
      `${fence}go`,
      'package main',
      'import "fmt"',
      fence,
      '',
      `${fence}sql`,
      'SELECT u.name, COUNT(o.id) AS order_count',
      'FROM users u',
      'GROUP BY u.id, u.name;',
      fence,
      '',
      `${fence}json`,
      '{',
      '  "name": "测试"',
      '}',
      fence,
      '',
      `${fence}bash`,
      '#!/bin/bash',
      'for f in *.py; do',
      '    python3 "$f"',
      'done',
      fence,
      '',
      '## 四、表格',
      '',
      '| 语言 | 类型 | 速度 |',
      '|:---|:---:|:---:|',
      '| Rust | 静态 | ★★★★★ |',
      '| Go | 静态 | ★★★★ |',
      '',
      '| 服务 | QPS | 状态 |',
      '|:---|---:|:---:|',
      '| api-gateway | 45000 | ✅ |',
      '| notification | 5200 | ⚠️ |',
      '',
      '## 五、列表',
      '',
      '- 容器化',
      '  - [x] Docker',
      '  - [ ] Podman',
      '',
      '## 六、数学公式',
      '',
      '行内：$e^{i\\pi} + 1 = 0$ · $\\nabla \\times \\vec{E} = -\\partial\\vec{B}/\\partial t$',
      '',
      '$$',
      '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
      '$$',
      '',
      '$$',
      '\\begin{pmatrix}',
      '1 & 0 & 0 \\\\',
      '0 & 1 & 0 \\\\',
      '0 & 0 & 1',
      '\\end{pmatrix}',
      '$$',
      '',
      '$$',
      '\\begin{aligned}',
      '\\nabla \\cdot \\vec{E} &= \\rho / \\varepsilon_0 \\\\',
      '\\nabla \\cdot \\vec{B} &= 0',
      '\\end{aligned}',
      '$$',
      '',
      '## 八、HTML 组件',
      '',
      '<progress value="72" max="100" style="width:100%;height:20px"></progress> 72%',
      '',
      '<details>',
      '<summary>项目结构</summary>',
      '<div><pre>src/</pre></div>',
      '</details>',
      '',
      '## 九、脚注',
      '',
      '这是一段需要说明的文字[^ref1]。这里还有另一个引用[^ref2]。',
      '',
      '[^ref1]: 这是第一个脚注的内容，可以写很长。',
      '[^ref2]: 第二个脚注，来自某文献第 42 页。',
    ].join('\n')

    const { container } = render(<MarkdownRenderer content={content} />)

    expect(screen.getAllByTestId('code-block')).toHaveLength(7)
    expect(container.querySelectorAll('table')).toHaveLength(2)
    expect(screen.getAllByTestId('copy-button')).toHaveLength(2)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(3)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5)
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('progress')).toBeInTheDocument()
    expect(container.querySelector('details')).toBeInTheDocument()
    expect(container.querySelector('sub')).toHaveTextContent('2')
    expect(container.querySelector('sup')).toHaveTextContent('2')
    expect(container.querySelector('mark')).toHaveTextContent('高亮')
    expect(container.querySelector('#fnref-ref1')).toBeInTheDocument()
    expect(container.querySelector('#fn-ref2')).toHaveTextContent('第二个脚注')
  })

  it('accepts isStreaming prop without crashing', () => {
    render(<MarkdownRenderer content={'Hello **world**'} isStreaming={true} />)

    expect(screen.getByRole('paragraph')).toHaveTextContent('Hello world')
  })

  it('keeps streaming plain-text appends and settles without losing content', async () => {
    const view = render(<MarkdownRenderer content={'你好'} isStreaming />)
    expect(screen.getByRole('paragraph')).toHaveTextContent('你好')

    view.rerender(<MarkdownRenderer content={'你好世界'} isStreaming />)
    await waitFor(() => {
      expect(screen.getByRole('paragraph')).toHaveTextContent('你好世界')
    })

    view.rerender(<MarkdownRenderer content={'你好世界'} />)
    await waitFor(() => {
      expect(screen.getByRole('paragraph')).toHaveTextContent('你好世界')
    })
  })

  it('does not leak trailing stream text into emphasis markup', async () => {
    const view = render(<MarkdownRenderer content={'**粗体**'} isStreaming />)
    expect(screen.getByRole('paragraph').querySelector('strong')).toHaveTextContent('粗体')

    view.rerender(<MarkdownRenderer content={'**粗体** 后续'} isStreaming />)
    await waitFor(() => {
      const paragraph = screen.getByRole('paragraph')
      expect(paragraph).toHaveTextContent('粗体 后续')
      expect(paragraph.querySelector('strong')).toHaveTextContent('粗体')
      expect(paragraph.querySelector('strong')).not.toHaveTextContent('后续')
    })
  })

  it('renders streaming inline math through the markdown renderer', () => {
    const { container } = render(<MarkdownRenderer content={'Inline $x + y$ math'} isStreaming />)

    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders sanitized streaming raw HTML through the markdown renderer', () => {
    render(<MarkdownRenderer content={'<div><span>Python</span></div>'} isStreaming />)

    expect(screen.getByText('Python')).toBeInTheDocument()
  })

  it('blocks unsafe streaming markdown links through the markdown renderer', () => {
    render(<MarkdownRenderer content={'[bad](javascript:alert(1))'} isStreaming />)

    expect(screen.getByText('bad [blocked]')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument()
  })

  it('renders with reasoning variant using subdued styles', () => {
    render(<MarkdownRenderer content={'# Heading\n\nSome text with `code`'} variant="reasoning" />)

    const heading = screen.getByRole('heading', { name: 'Heading' })
    expect(heading.className).toMatch(/text-text-300/)

    const paragraph = screen.getByRole('paragraph')
    expect(paragraph.className).toMatch(/text-text-400/)

    const codeEl = screen.getByText('code')
    expect(codeEl.className).not.toMatch(/border/)
    expect(codeEl.className).not.toMatch(/bg-accent/)
  })

  it('passes reasoning variant to CodeBlock', () => {
    render(<MarkdownRenderer content={'```js\nlet a = 1\n```'} variant="reasoning" />)

    const block = screen.getByTestId('code-block')
    expect(block.dataset.variant).toBe('reasoning')
  })

  it('passes default variant to CodeBlock by default', () => {
    render(<MarkdownRenderer content={'```js\nlet a = 1\n```'} />)

    const block = screen.getByTestId('code-block')
    expect(block.dataset.variant).toBe('default')
  })

  it('uses incremental code block highlighting while content is streaming', () => {
    // 未闭合 fence 才走流式高亮；已闭合的稳定 code 块 isStreaming 收窄为 false 以冻 memo
    render(<MarkdownRenderer content={'```ts\nconst x = 1'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveAttribute('data-defer-highlight', 'false')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-force-highlight', 'true')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-streaming-highlight', 'true')
  })

  it('only uses streaming code highlighting for the live markdown block', () => {
    render(<MarkdownRenderer content={'```ts\nconst stable = 1\n```\n\nlive tail'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveAttribute('data-force-highlight', 'false')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-streaming-highlight', 'false')
  })

  it('keeps the declared language for an incomplete streaming code fence', () => {
    render(<MarkdownRenderer content={'```ts\nconst x = 1'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-streaming-highlight', 'true')
  })

  it('reserves enough marker space for large ordered list numbers', () => {
    const { container } = render(<MarkdownRenderer content={'998. Alpha\n999. Beta\n1000. Gamma'} />)

    expect(container.querySelector('ol')).toHaveStyle({ paddingInlineStart: '6ch' })
  })

  it('renders single-dollar inline math', () => {
    const { container } = render(<MarkdownRenderer content={'Inline $x + y$ math'} />)

    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders inline dollar math whose content contains underscores and backslashes', () => {
    const content = String.raw`公式 $E = mc^2$ 和 $\mathcal{R}_{\mathrm{final}} = \mathcal{R}_{\mathrm{Stage\,2}} \cup \mathcal{E}_{\mathrm{verified}}$。`
    const { container } = render(<MarkdownRenderer content={content} />)

    // `_` / `\` 会被 marked 的 emStrong / escape 拆散，数学必须由 marked 扩展在它们之前拦截
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
  })

  it('keeps escaped dollar signs literal', () => {
    const { container } = render(<MarkdownRenderer content={'价格 \\$5 和 \\$10 元'} />)

    expect(container.querySelector('.katex')).not.toBeInTheDocument()
    expect(container.querySelector('p')).toHaveTextContent('价格 $5 和 $10 元')
  })

  it('keeps unpaired dollar delimiters literal', () => {
    const { container } = render(<MarkdownRenderer content={'空公式 $$ 和 $ 不渲染，成本约 5 元'} />)

    expect(container.querySelector('.katex')).not.toBeInTheDocument()
    expect(container.querySelector('p')).toHaveTextContent('空公式 $$ 和 $ 不渲染，成本约 5 元')
  })

  it('renders multiline display math blocks', () => {
    const content = String.raw`$$
\begin{aligned}
\nabla \cdot \vec{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \vec{B} &= 0 \\
\nabla \times \vec{E} &= -\frac{\partial\vec{B}}{\partial t}
\end{aligned}
$$`
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelector('.katex-display')).toBeInTheDocument()
    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('renders multiple one-line display math blocks', () => {
    const content = String.raw`$$ \begin{pmatrix} 1 & 0 & 0 \ 0 & 1 & 0 \ 0 & 0 & 1 \end{pmatrix} $$

$$ \begin{aligned} \nabla \cdot \vec{E} &= \rho / \varepsilon_0 \ \nabla \cdot \vec{B} &= 0 \ \nabla \times \vec{E} &= -\partial\vec{B}/\partial t \ \nabla \times \vec{B} &= \mu_0\vec{J} + \mu_0\varepsilon_0\partial\vec{E}/\partial t \end{aligned} $$`

    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.katex-display')[1]?.querySelectorAll('mtr')).toHaveLength(4)
  })

  it('renders multiple one-line display math blocks while streaming', () => {
    const content = String.raw`$$ \begin{pmatrix} 1 & 0 & 0 \ 0 & 1 & 0 \ 0 & 0 & 1 \end{pmatrix} $$

$$ \begin{aligned} \nabla \cdot \vec{E} &= \rho / \varepsilon_0 \ \nabla \cdot \vec{B} &= 0 \ \nabla \times \vec{E} &= -\partial\vec{B}/\partial t \ \nabla \times \vec{B} &= \mu_0\vec{J} + \mu_0\varepsilon_0\partial\vec{E}/\partial t \end{aligned} $$`

    const { container } = render(<MarkdownRenderer content={content} isStreaming />)

    expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.katex-display')[1]?.querySelectorAll('mtr')).toHaveLength(4)
  })

  it('repairs collapsed row separators in a one-line aligned formula', () => {
    const content = String.raw`$$ \begin{aligned} \nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \ \nabla \times \mathbf{H} &= \mathbf{J} + \frac{\partial \mathbf{D}}{\partial t} \end{aligned} $$`
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.katex-display mtr')).toHaveLength(2)
  })

  it('keeps aligned display math intact when the document has reference links', () => {
    const content = String.raw`[GitHub][1]

[1]: https://github.com

$$
\begin{aligned}
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{H} &= \mathbf{J} + \frac{\partial \mathbf{D}}{\partial t}
\end{aligned}
$$`
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com')
    expect(container.querySelector('.katex-error')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.katex-display mtr')).toHaveLength(2)
  })

  it('renders GitHub-style markdown alerts separately from blockquotes', () => {
    const content = [
      '> [!NOTE]',
      '> Note body with **formatting**.',
      '',
      '> [!TIP]',
      '> Tip body.',
      '',
      '> [!IMPORTANT]',
      '> Important body.',
      '',
      '> [!WARNING]',
      '> Warning body.',
      '',
      '> [!CAUTION]',
      '> Caution body.',
      '',
      '> Plain quote.',
    ].join('\n')
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(container.querySelectorAll('[data-markdown-alert]')).toHaveLength(5)
    expect(container.querySelector('[data-markdown-alert="note"]')).toHaveTextContent('Note body with formatting.')
    expect(container.querySelector('[data-markdown-alert="warning"]')).toHaveClass('border-l-warning-100')
    expect(container.querySelector('[data-markdown-alert="caution"]')).toHaveClass('border-l-danger-100')
    expect(container.querySelectorAll('blockquote')).toHaveLength(1)
    expect(container.querySelector('blockquote')).toHaveTextContent('Plain quote.')
  })

  it('renders sanitized raw HTML content', () => {
    render(<MarkdownRenderer content={'<div><span>Python</span></div>'} />)

    expect(screen.getByText('Python')).toBeInTheDocument()
  })

  it('sanitizes unsafe raw HTML attributes and URLs', () => {
    const { container } = render(
      <MarkdownRenderer content={'<a href="javascript:alert(1)" onclick="alert(1)">bad</a>'} />,
    )

    const link = container.querySelector('a')
    expect(link).not.toBeInTheDocument()
    expect(screen.getByText(/bad\s+\[blocked\]/)).toBeInTheDocument()
  })

  it('rewrites raw HTML Windows path links to local file links', () => {
    const filePath = 'C:/Users/test/project/file.ts'
    render(<MarkdownRenderer content={`<a href="${filePath}">file.ts</a>`} />)

    const link = screen.getByRole('link', { name: 'file.ts' })
    expect(link).toHaveAttribute('href', `#opencode-local-file:${encodeURIComponent(filePath)}`)
    expect(link).toHaveAttribute('title', filePath)
  })

  it('keeps inline HTML structure inside markdown paragraphs', () => {
    const { container } = render(<MarkdownRenderer content={'Press <kbd>Ctrl</kbd> and **enter**'} />)

    const kbd = container.querySelector('kbd')
    expect(kbd).toHaveTextContent('Ctrl')
    expect(screen.getByText('enter').tagName).toBe('STRONG')
  })

  it('removes unsafe CSS URLs from raw HTML styles', () => {
    render(<MarkdownRenderer content={'<div style="background: url(javascript:alert(1)); color: red">bad</div>'} />)

    const style = screen.getByText('bad').getAttribute('style') ?? ''
    expect(style).not.toMatch(/url/i)
    expect(style).toMatch(/color:\s*red/i)
  })

  it('preserves safe inline styles in raw HTML', () => {
    render(<MarkdownRenderer content={'<div style="color:red;font-weight:bold">styled</div>'} />)

    const element = screen.getByText('styled')
    expect(element).toHaveAttribute('style')
    expect(element.getAttribute('style')).toMatch(/color:\s*red/i)
  })

  it('removes overlay-capable styles while retaining safe declarations', () => {
    render(
      <MarkdownRenderer
        content={
          '<div style="position:fixed;inset:0;z-index:99999;transform:scale(2);margin-top:-400px;opacity:0;color:blue">safe</div>'
        }
      />,
    )

    const style = screen.getByText('safe').getAttribute('style') ?? ''
    expect(style).toMatch(/color:\s*blue/i)
    expect(style).not.toMatch(/position|inset|z-index|transform|margin|opacity/i)
  })

  it('keeps KaTeX positioning styles intact', () => {
    const { container } = render(<MarkdownRenderer content={'Inline $x^2$ formula'} />)

    expect(container.querySelector('.katex [style*="top"]')).toBeInTheDocument()
  })

  it('styles raw HTML tables without losing merged-cell attributes', () => {
    const content = `<table>
      <tr><th>分类</th><th>项目</th><th>描述</th></tr>
      <tr><td rowspan="2">前端</td><td>React</td><td>UI 库</td></tr>
      <tr><td>Vue</td><td>渐进式框架</td></tr>
      <tr><td colspan="3" align="center">后端技术栈</td></tr>
    </table>`
    const { container } = render(<MarkdownRenderer content={content} />)

    const table = screen.getByRole('table')
    expect(table).toHaveClass('markdown-html-table')
    expect(table.parentElement).toHaveClass('markdown-html-table-scroll')
    expect(screen.getByText('前端')).toHaveAttribute('rowspan', '2')
    expect(screen.getByText('后端技术栈')).toHaveAttribute('colspan', '3')
    expect(screen.getByText('后端技术栈')).toHaveAttribute('align', 'center')
    expect(container.querySelectorAll('th')).toHaveLength(3)
  })

  it('preserves native HTML control state across updates and stream completion', () => {
    const initial = `<div><details><summary>Options</summary><input value="initial"><select><option>A</option><option value="b">B</option></select></details><span>one</span></div>`
    const updated = initial
      .replace('<select>', '<select><option value="x">X</option>')
      .replace('<span>one</span>', '<span>two</span>')
    const view = render(<MarkdownRenderer content={initial} isStreaming />)

    const summary = screen.getByText('Options')
    const details = summary.closest('details') as HTMLDetailsElement
    fireEvent.click(summary)
    details.open = true
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'edited' } })
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'b' } })
    expect(select).toHaveAttribute('data-markdown-user-state')

    view.rerender(<MarkdownRenderer content={initial} />)
    view.rerender(<MarkdownRenderer content={updated} />)

    expect((screen.getByText('Options').closest('details') as HTMLDetailsElement).open).toBe(true)
    expect(screen.getByRole('textbox')).toHaveValue('edited')
    expect(screen.getByRole('combobox')).toHaveValue('b')
    expect(screen.getByText('two')).toBeInTheDocument()
  })

  it('renders Markdown mixed inside block HTML as one interactive structure', () => {
    const content = `<details>
<summary>Mixed content</summary>

**formatted text**

| A | B |
|---|---|
| 1 | 2 |

</details>`
    const { container } = render(<MarkdownRenderer content={content} />)

    const details = screen.getByText('Mixed content').closest('details')
    expect(details).toContainElement(screen.getByText('formatted text'))
    expect(screen.getByText('formatted text').tagName).toBe('STRONG')
    expect(details).toContainElement(screen.getByRole('table'))
    expect(container.querySelector('.markdown-html-table-scroll')).toContainElement(screen.getByRole('table'))
  })

  it('switches a direct block HTML island between rendered content and source', () => {
    render(<MarkdownRenderer content={'<div><strong>Rendered HTML</strong></div>'} />)

    expect(screen.getByText('Rendered HTML').tagName).toBe('STRONG')
    fireEvent.click(screen.getByRole('button', { name: 'View HTML source' }))
    expect(screen.getByTestId('code-block')).toHaveTextContent('html:<div><strong>Rendered HTML</strong></div>')
    fireEvent.click(screen.getByRole('button', { name: 'Render HTML' }))
    expect(screen.getByText('Rendered HTML')).toBeInTheDocument()
  })

  it('keeps inline HTML mixed into prose without island controls', () => {
    render(<MarkdownRenderer content={'Before <span style="color:red">inline HTML</span> after.'} />)

    expect(screen.getByText('inline HTML')).toHaveAttribute('style', expect.stringMatching(/color:\s*red/i))
    expect(screen.queryByRole('button', { name: 'View HTML source' })).not.toBeInTheDocument()
  })

  it('sandboxes a complete HTML document pasted directly into Markdown', () => {
    render(
      <MarkdownRenderer
        content={
          '<!doctype html>\n<html><body><h1>Document</h1><script>document.title="isolated"</script></body></html>'
        }
      />,
    )

    const frame = screen.getByTitle('HTML preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Document</h1>')
    expect(frame.getAttribute('srcdoc')).toContain('<script>document.title="isolated"</script>')
  })

  it('blocks raw HTML submission, active content, and unsafe media behavior', () => {
    const { container } = render(
      <MarkdownRenderer
        content={
          '<form action="https://example.com"><button>Send</button></form><video autoplay src="data:text/html,bad" controls></video>'
        }
      />,
    )

    const form = container.querySelector('form')
    const button = screen.getByRole('button', { name: 'Send' })
    const video = container.querySelector('video')
    expect(form).not.toHaveAttribute('action')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('markdown-html-control')
    expect(video).not.toHaveAttribute('autoplay')
    expect(video).not.toHaveAttribute('src')
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    expect(form?.dispatchEvent(submit)).toBe(false)
  })

  it('upgrades an executable HTML fragment pasted directly into Markdown to a sandbox', () => {
    const content = `<section class="ripple-field">
      <style>.ripple-field { height: 380px; }</style>
      <canvas></canvas>
      <script>document.currentScript.closest('.ripple-field').dataset.ready = 'true'</script>
    </section>`
    const { container } = render(<MarkdownRenderer content={content} />)

    const frame = screen.getByTitle('HTML preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('<section class="ripple-field">')
    expect(frame.getAttribute('srcdoc')).toContain("dataset.ready = 'true'")
    expect(container.querySelector('.ripple-field')).not.toBeInTheDocument()
  })

  it('sandboxes adjacent bare style, markup, and script as one HTML artifact', () => {
    const content = `<style>
.apple-clock { color: red; }
</style>

<div class="apple-clock">12:00</div>

<script>document.querySelector('.apple-clock').dataset.ready = 'true'</script>`
    render(<MarkdownRenderer content={content} />)

    const frame = screen.getByTitle('HTML preview')
    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('.apple-clock { color: red; }')
    expect(srcDoc).toContain('<div class="apple-clock">12:00</div>')
    expect(srcDoc).toContain("dataset.ready = 'true'")

    fireEvent.click(screen.getByRole('button', { name: 'View HTML source' }))
    expect(screen.getByTestId('code-block')).toHaveTextContent('.apple-clock { color: red; }')
    expect(screen.getByTestId('code-block')).toHaveTextContent("dataset.ready = 'true'")
  })

  it('previews and reveals the complete source of a styled SVG wrapper', () => {
    const artifact = `<div style="font-family:sans-serif;">
<style>:root { --surface: #fff; }</style>

<svg width="100%" viewBox="0 0 680 460">
  <!-- title -->
  <text x="40" y="30">微服务架构</text>
</svg>
</div>`
    render(<MarkdownRenderer content={`${artifact}\n\n再来个交付时间线`} />)

    const frame = screen.getByTitle('HTML preview')
    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain(':root { --surface: #fff; }')
    expect(srcDoc).toContain('<svg width="100%" viewBox="0 0 680 460">')
    expect(srcDoc).toContain('微服务架构')
    expect(screen.getByText('再来个交付时间线')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View HTML source' }))
    const source = screen.getByTestId('code-block')
    expect(source).toHaveTextContent(':root { --surface: #fff; }')
    expect(source).toHaveTextContent('微服务架构')
    expect(source).toHaveTextContent('</svg>')
    expect(source).toHaveTextContent('</div>')
    expect(source).not.toHaveTextContent('再来个交付时间线')
  })

  it('previews adjacent style, bare SVG, and script as one artifact', () => {
    const content = `<style>.diagram { color: red; }</style>

<svg class="diagram"><text>diagram</text></svg>

<script>document.querySelector('.diagram').dataset.ready = 'true'</script>`
    render(<MarkdownRenderer content={content} />)

    const srcDoc = screen.getByTitle('HTML preview').getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('.diagram { color: red; }')
    expect(srcDoc).toContain('<svg class="diagram">')
    expect(srcDoc).toContain("dataset.ready = 'true'")
  })

  it('previews a style and SVG artifact after a leading HTML comment', () => {
    const content = `<!-- diagram -->
<style>.diagram { color: red; }</style>

<svg class="diagram"><text>diagram</text></svg>`
    render(<MarkdownRenderer content={content} />)

    const srcDoc = screen.getByTitle('HTML preview').getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('.diagram { color: red; }')
    expect(srcDoc).toContain('<svg class="diagram">')

    fireEvent.click(screen.getByRole('button', { name: 'View HTML source' }))
    expect(screen.getByTestId('code-block')).toHaveTextContent('<!-- diagram -->')
  })

  it('sandboxes a styled interactive bare SVG with inherited theme variables', () => {
    const content = `<svg viewBox="0 0 100 100" onclick="this.dataset.clicked='true'">
<style>.surface { fill: var(--surface-1); stroke: var(--border-strong); }</style>
<rect class="surface" width="100" height="100"/>
<text>Bare SVG</text>
</svg>`
    render(<MarkdownRenderer content={content} />)

    const frame = screen.getByTitle('HTML preview')
    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(srcDoc).toContain('<style>.surface { fill: var(--surface-1); stroke: var(--border-strong); }</style>')
    expect(srcDoc).toContain('onclick="this.dataset.clicked=\'true\'"')
    expect(srcDoc).toContain('--surface-1:#f5f4f1')
    expect(srcDoc).toContain('--border-strong:#cfccc2')
  })

  it('runs complete HTML code fences only inside an isolated sandbox preview', () => {
    render(
      <MarkdownRenderer
        content={
          '```html\n<button onclick="document.body.dataset.clicked=1">Run</button><script>document.title="artifact"</script>\n```'
        }
      />,
    )

    const frame = screen.getByTitle('HTML preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy')
    expect(frame.getAttribute('srcdoc')).toContain('name="viewport" content="width=device-width, initial-scale=1"')
    expect(frame.getAttribute('srcdoc')).toContain('overflow:hidden')
    expect(frame.getAttribute('srcdoc')).toContain('opencode-html-resize')
    expect(frame).not.toHaveAttribute('scrolling')
    expect(frame.parentElement?.parentElement?.className).toContain('overflow-x-auto')
    expect(frame.parentElement?.parentElement?.className).toContain('code-scrollbar')
    expect(frame.getAttribute('srcdoc')).toContain('background:transparent')
    expect(frame.getAttribute('srcdoc')).toContain('<script>document.title="artifact"</script>')
    expect(document.title).not.toBe('artifact')

    fireEvent.click(screen.getByRole('button', { name: 'View HTML source' }))
    expect(screen.getByTestId('code-block')).toHaveTextContent('html:<button')
    fireEvent.click(screen.getByRole('button', { name: 'Preview HTML' }))
    expect(screen.getByTitle('HTML preview')).toBeInTheDocument()
  })

  it.each([
    ['svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>SVG preview</text></svg>', 'SVG preview'],
    [
      'xml',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><text>XML preview</text></svg>',
      'XML preview',
    ],
    ['xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body>XHTML preview</body></html>', 'XHTML preview'],
  ])('previews fenced %s markup in the HTML sandbox', (language, source, expectedContent) => {
    render(<MarkdownRenderer content={`\`\`\`${language}\n${source}\n\`\`\``} />)

    const frame = screen.getByTitle('HTML preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain(expectedContent)

    fireEvent.click(screen.getByRole('button', { name: 'View HTML source' }))
    expect(screen.getByTestId('code-block')).toHaveTextContent(`${language}:${source}`)
  })

  it('sizes the HTML iframe to content width so the parent container can scroll horizontally', async () => {
    render(<MarkdownRenderer content={'```html\n<div style="width:1200px">wide preview</div>\n```'} />)

    const frame = screen.getByTitle('HTML preview') as HTMLIFrameElement
    const scrollport = frame.parentElement?.parentElement
    expect(scrollport?.className).toContain('overflow-x-auto')
    expect(scrollport?.className).toContain('code-scrollbar')

    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    const resizeId = JSON.parse(srcDoc.match(/const id=("[^"]+")/)?.[1] ?? 'null') as string | null
    expect(resizeId).not.toBeNull()

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'opencode-html-resize', id: resizeId, height: 180, width: 1200 },
        source: frame.contentWindow,
      }),
    )

    await waitFor(() => {
      expect(frame.parentElement).toHaveStyle({ minWidth: '1200px' })
    })
  })

  it('releases locked HTML preview minWidth when content fits the container again', async () => {
    render(<MarkdownRenderer content={'```html\n<div style="width:1200px">wide preview</div>\n```'} />)

    const frame = screen.getByTitle('HTML preview') as HTMLIFrameElement
    const scrollport = frame.parentElement?.parentElement as HTMLDivElement
    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    const resizeId = JSON.parse(srcDoc.match(/const id=("[^"]+")/)?.[1] ?? 'null') as string | null
    expect(resizeId).not.toBeNull()

    Object.defineProperty(scrollport, 'clientWidth', { configurable: true, value: 360 })
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'opencode-html-resize', id: resizeId, height: 180, width: 1200 },
        source: frame.contentWindow,
      }),
    )
    await waitFor(() => {
      expect(frame.parentElement).toHaveStyle({ minWidth: '1200px' })
    })

    Object.defineProperty(scrollport, 'clientWidth', { configurable: true, value: 1300 })
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'opencode-html-resize', id: resizeId, height: 180, width: 1200 },
        source: frame.contentWindow,
      }),
    )
    await waitFor(() => {
      expect(frame.parentElement).toHaveStyle({ minWidth: '100%' })
    })
  })

  it('shrinks HTML preview height when content reports a smaller size', async () => {
    render(<MarkdownRenderer content={'```html\n<div>Preview</div>\n```'} />)

    const frame = screen.getByTitle('HTML preview') as HTMLIFrameElement
    const surface = screen.getByRole('button', { name: 'View HTML source' }).parentElement
    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    const resizeId = JSON.parse(srcDoc.match(/const id=("[^"]+")/)?.[1] ?? 'null') as string | null
    expect(resizeId).not.toBeNull()

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'opencode-html-resize', id: resizeId, height: 480, width: 320 },
        source: frame.contentWindow,
      }),
    )
    await waitFor(() => {
      expect(surface).toHaveStyle({ height: '480px' })
    })

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'opencode-html-resize', id: resizeId, height: 160, width: 320 },
        source: frame.contentWindow,
      }),
    )
    await waitFor(() => {
      expect(surface).toHaveStyle({ height: '160px' })
    })
  })

  it('keeps touch-revealed HTML source controls visible until tapping outside', async () => {
    useInputCapabilitiesMock.mockReturnValue({
      canHover: false,
      hasCoarsePointer: true,
      hasTouch: true,
      preferTouchUi: true,
    })

    render(<MarkdownRenderer content={'```html\n<div>Preview</div>\n```'} />)

    const frame = screen.getByTitle('HTML preview')
    const sourceButton = screen.getByRole('button', { name: 'View HTML source' })
    const surface = sourceButton.parentElement

    expect(surface).toHaveAttribute('tabindex', '0')
    expect(sourceButton.className).toContain('text-accent-main-100')
    expect(sourceButton.className).toContain('[@media(hover:none)]:opacity-0')

    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    const resizeId = JSON.parse(srcDoc.match(/const id=("[^"]+")/)?.[1] ?? 'null') as string | null
    expect(resizeId).not.toBeNull()

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'opencode-html-interaction', id: resizeId },
        source: (frame as HTMLIFrameElement).contentWindow,
      }),
    )
    await waitFor(() => expect(sourceButton.className).toContain('[@media(hover:none)]:opacity-100'))

    fireEvent.pointerUp(frame, { pointerType: 'touch' })
    expect(sourceButton.className).toContain('[@media(hover:none)]:opacity-100')

    fireEvent.pointerDown(document.body, { pointerType: 'touch' })
    await waitFor(() => expect(sourceButton.className).toContain('[@media(hover:none)]:opacity-0'))
  })

  it('updates a canonical HTML preview theme without reloading its document', async () => {
    const view = render(<MarkdownRenderer content={'```html\n<div>themed</div>\n```'} />)
    const lightFrame = screen.getByTitle('HTML preview') as HTMLIFrameElement
    const initialSrcDoc = lightFrame.getAttribute('srcdoc')
    const postMessage = vi.spyOn(lightFrame.contentWindow!, 'postMessage')
    expect(lightFrame).toHaveStyle({ colorScheme: 'light' })
    expect(lightFrame.getAttribute('srcdoc')).toContain('color-scheme:light')

    themeMock.resolvedTheme = 'dark'
    view.rerender(<MarkdownRenderer content={'```html\n<div>themed</div>\n```'} className="theme-dark" />)

    await waitFor(() => {
      expect(screen.getByTitle('HTML preview')).toHaveStyle({ colorScheme: 'dark' })
      expect(postMessage).toHaveBeenCalledWith({ type: 'opencode-html-theme', theme: 'dark' }, '*')
    })
    expect(screen.getByTitle('HTML preview')).toBe(lightFrame)
    expect(lightFrame.getAttribute('srcdoc')).toBe(initialSrcDoc)
  })

  it('renders incomplete streaming HTML fences without enabling scripts yet', () => {
    render(
      <MarkdownRenderer
        content={'```html\n<div onclick="window.bad=1">growing preview</div><script>window.bad=2'}
        isStreaming
      />,
    )

    const frame = screen.getByTitle('HTML preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('opencode-html-stream')
    expect(frame.getAttribute('srcdoc')).toContain('name="viewport" content="width=device-width, initial-scale=1"')
    expect(frame.getAttribute('srcdoc')).toContain('overflow:hidden')
    expect(frame.getAttribute('srcdoc')).toContain('opencode-html-measure')
    expect(frame.getAttribute('srcdoc')).toContain('opencode-html-resize')
    expect(frame).not.toHaveAttribute('scrolling')
    expect(frame.parentElement?.parentElement?.className).toContain('overflow-x-auto')
    expect(frame.getAttribute('srcdoc')).toContain('scriptQueue')
    expect(frame.getAttribute('srcdoc')).toContain('data-opencode-script-executed')
    expect(frame.getAttribute('srcdoc')).not.toContain('window.bad')
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
  })

  it('enables each user script as soon as that script closes during streaming', async () => {
    const view = render(<MarkdownRenderer content={'```html\n<section><div>live</div>'} isStreaming />)
    const frame = screen.getByTitle('HTML preview') as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')

    view.rerender(
      <MarkdownRenderer
        content={'```html\n<section><div>live</div><script>document.body.dataset.ready="yes"</script>'}
        isStreaming
      />,
    )

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ complete: false, scriptCount: 1 }), '*')
    })
    expect(screen.getByTitle('HTML preview')).toBe(frame)
  })

  it('patches one stable iframe while growing and swaps to a canonical document on completion', async () => {
    const view = render(<MarkdownRenderer content={'```html\n<div>one</div>'} isStreaming />)
    const frame = screen.getByTitle('HTML preview') as HTMLIFrameElement
    const initialSrcDoc = frame.getAttribute('srcdoc')
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')

    view.rerender(<MarkdownRenderer content={'```html\n<div>one</div><p>two</p>'} isStreaming />)
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<div>one</div><p>two</p>', complete: false }),
        '*',
      )
    })
    expect(screen.getByTitle('HTML preview')).toBe(frame)
    expect(frame.getAttribute('srcdoc')).toBe(initialSrcDoc)

    view.rerender(<MarkdownRenderer content={'```html\n<div>one</div><p>two</p>\n```'} isStreaming />)
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<div>one</div><p>two</p>', complete: true }),
        '*',
      )
    })
    const frames = screen.getAllByTitle('HTML preview') as HTMLIFrameElement[]
    const canonicalFrame = frames.find(candidate => candidate !== frame)
    expect(canonicalFrame).toBeInTheDocument()
    fireEvent.load(canonicalFrame!)
    expect(screen.getByTitle('HTML preview')).toBe(canonicalFrame)
  })

  it('keeps external markdown links isolated from the app webview', () => {
    render(<MarkdownRenderer content={'[site](https://example.com/docs)'} />)

    const link = screen.getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps external markdown image links isolated from the app webview', () => {
    render(<MarkdownRenderer content={'![avatar](https://example.com/avatar.png)'} />)

    const link = screen.getByRole('img', { name: 'avatar' }).closest('a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps React code and table renderers when reference definitions are present', () => {
    const content = [
      '[OpenCode][docs]',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '[docs]: https://example.com/docs',
    ].join('\n')

    render(<MarkdownRenderer content={content} />)

    expect(screen.getByRole('link', { name: 'OpenCode' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
  })

  it('renders mermaid code fences as diagrams', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument()
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false, theme: 'default' }),
    )
  })

  it('renders completed mermaid diagrams in stable streaming blocks', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```\n\nstill typing'} isStreaming />)

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.getByText('still typing')).toBeInTheDocument()
    expect(mermaidMocks.render).toHaveBeenCalledTimes(1)
  })

  it('reuses cached mermaid output after remounting', async () => {
    const content = '```mermaid\ngraph TD\n  A-->B\n```'
    const first = render(<MarkdownRenderer content={content} />)
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    first.unmount()

    render(<MarkdownRenderer content={content} />)

    expect(screen.getByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Rendering diagram')).not.toBeInTheDocument()
    expect(mermaidMocks.render).toHaveBeenCalledTimes(1)
  })

  it('scopes cached mermaid ids for each mounted diagram', async () => {
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg id="diagram" aria-labelledby="diagram-title"><title id="diagram-title">Diagram</title><style>#diagram-node { fill: red; }</style><defs><marker id="diagram-arrow"></marker></defs><path id="diagram-node" marker-end="url(#diagram-arrow)"></path><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hello<br>world</div></foreignObject></svg>',
    })
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph TD\n  A-->B\n```'} />)

    const diagrams = await screen.findAllByRole('img', { name: 'Mermaid diagram' })
    const firstSvg = diagrams[0].querySelector('svg')
    const secondSvg = diagrams[1].querySelector('svg')
    const firstMarker = firstSvg?.querySelector('marker')
    const secondMarker = secondSvg?.querySelector('marker')
    const firstTitle = firstSvg?.querySelector('title')

    expect(firstSvg?.id).not.toBe(secondSvg?.id)
    expect(firstMarker?.id).not.toBe(secondMarker?.id)
    expect(firstSvg?.querySelector('path')).toHaveAttribute('marker-end', `url(#${firstMarker?.id})`)
    expect(secondSvg?.querySelector('path')).toHaveAttribute('marker-end', `url(#${secondMarker?.id})`)
    expect(firstSvg).toHaveAttribute('aria-labelledby', firstTitle?.id)
    expect(firstSvg?.querySelector('style')).toHaveTextContent(`#${firstSvg?.querySelector('path')?.id}`)
    expect(mermaidMocks.render).toHaveBeenCalledTimes(1)
  })

  it('defers incomplete streaming mermaid diagrams as code blocks', () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B'} isStreaming />)

    expect(screen.getByTestId('code-block')).toHaveTextContent(/mermaid:graph TD\s+A-->B/)
    expect(screen.getByTestId('code-block')).toHaveAttribute('data-defer-highlight', 'true')
    expect(mermaidMocks.render).not.toHaveBeenCalled()
  })

  it('supports mermaid zoom, pan, and reset controls', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' })
    const zoomIn = screen.getByRole('button', { name: 'Zoom in diagram' })

    expect(screen.queryByRole('button', { name: 'Enable diagram pan' })).not.toBeInTheDocument()
    expect(zoomIn).toHaveClass('h-8', 'w-8')
    expect(zoomIn).not.toHaveClass('markdown-html-control')

    fireEvent.click(zoomIn)
    expect(diagram).toHaveStyle({ transform: 'translate(0px, 0px) scale(1.15)' })

    fireEvent.pointerDown(diagram, { button: 0, clientX: 10, clientY: 20, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerMove(diagram, { clientX: 35, clientY: 55, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(diagram, { pointerId: 1, pointerType: 'mouse' })
    expect(diagram).toHaveStyle({ transform: 'translate(25px, 35px) scale(1.15)' })

    fireEvent.click(screen.getByRole('button', { name: 'Reset diagram view' }))
    expect(diagram).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' })
  })

  it('marks streaming markdown chunk boundaries for stable spacing', () => {
    const content = 'first\n\n```ts\nconst a = 1\n```\n\n```ts\nconst b = 2'
    const { container } = render(<MarkdownRenderer content={content} isStreaming />)

    const chunks = container.querySelectorAll('.markdown-stream-block')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toHaveClass('markdown-stream-block')
    expect(chunks[chunks.length - 1]).toHaveClass('markdown-stream-block')
    // 间距靠 :first-child/:last-child，不再依赖 isFirst/isLast class props
    expect(chunks[0].parentElement?.firstElementChild).toBe(chunks[0])
    expect(chunks[0].parentElement?.lastElementChild).toBe(chunks[chunks.length - 1])
  })

  it('keeps desktop controls for hover-capable touch input', async () => {
    useInputCapabilitiesMock.mockReturnValue({
      canHover: true,
      hasCoarsePointer: false,
      hasTouch: true,
      preferTouchUi: false,
    })

    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' })

    expect(screen.queryByRole('button', { name: 'Enable diagram pan' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in diagram' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out diagram' })).toBeInTheDocument()
    expect(diagram.className).toContain('touch-pan-y')
  })

  it('uses tap-to-reveal mermaid controls for touch-preferred input', async () => {
    useInputCapabilitiesMock.mockReturnValue({
      canHover: false,
      hasCoarsePointer: true,
      hasTouch: true,
      preferTouchUi: true,
    })

    render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' })
    const container = diagram.parentElement
    const toolbar = screen.getByRole('button', { name: 'Copy to clipboard' }).parentElement

    expect(container).toHaveAttribute('tabindex', '0')
    expect(toolbar?.className).toContain('[@media(hover:none)]:opacity-0')
    expect(diagram.className).toContain('touch-pan-y')
    expect(screen.queryByRole('button', { name: 'Zoom in diagram' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zoom out diagram' })).not.toBeInTheDocument()

    fireEvent.pointerDown(diagram, { clientX: 10, clientY: 20, pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerMove(diagram, { clientX: 35, clientY: 55, pointerId: 2, pointerType: 'touch' })
    expect(diagram).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' })

    fireEvent.click(diagram)
    expect(container).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Enable diagram pan' }))
    const panButton = screen.getByRole('button', { name: 'Disable diagram pan' })
    expect(panButton).toHaveAttribute('aria-pressed', 'true')
    expect(panButton.className).toContain('ring-accent-main-100')
    expect(diagram.className).toContain('touch-none')

    fireEvent.pointerDown(diagram, { clientX: 10, clientY: 20, pointerId: 3, pointerType: 'touch' })
    fireEvent.pointerMove(diagram, { clientX: 35, clientY: 55, pointerId: 3, pointerType: 'touch' })
    expect(diagram).toHaveStyle({ transform: 'translate(25px, 35px) scale(1)' })
    fireEvent.pointerUp(diagram, { pointerId: 3, pointerType: 'touch' })

    fireEvent.pointerDown(diagram, { clientX: 100, clientY: 100, pointerId: 4, pointerType: 'touch' })
    fireEvent.pointerDown(diagram, { clientX: 140, clientY: 100, pointerId: 5, pointerType: 'touch' })
    fireEvent.pointerMove(diagram, { clientX: 180, clientY: 100, pointerId: 5, pointerType: 'touch' })
    expect(diagram).toHaveStyle({ transform: 'translate(-50px, -30px) scale(2)' })
  })

  it('renders markdown table with copy button in default mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} />)

    // Table should be rendered
    expect(screen.getByRole('table')).toBeInTheDocument()
    // Copy button should exist
    const copyButton = screen.getByTestId('copy-button')
    expect(copyButton).toBeInTheDocument()
    expect(copyButton.closest('th')).toBeInTheDocument()
    expect(copyButton.parentElement).toHaveClass('absolute')
    expect(copyButton.parentElement).toHaveClass('inset-y-0')
    expect(copyButton.closest('th')?.querySelector('.pr-8')).toBeInTheDocument()
    expect(copyButton.closest('tr')).toHaveClass('hover:bg-bg-200/12')
  })

  it('keeps table text cells unwrapped and ignores alignment styles like the old renderer', () => {
    const md = '| 类别 | 数量 |\n|:---|---:|\n| 代码块 | 7 |\n| 表格 | 2 |'
    const { container } = render(<MarkdownRenderer content={md} />)

    const cells = Array.from(container.querySelectorAll('th, td'))
    expect(cells).toHaveLength(6)
    for (const cell of cells) {
      expect(cell).not.toHaveAttribute('style')
    }

    expect(container.querySelector('thead th:first-child span')).not.toBeInTheDocument()
    expect(container.querySelector('tbody td span')).not.toBeInTheDocument()

    const lastHeaderText = container.querySelector('thead th:last-child .pr-8')
    expect(lastHeaderText).toHaveTextContent('数量')
    expect(lastHeaderText?.querySelector('span')).not.toBeInTheDocument()
  })

  it('keeps legacy spacing structure for consecutive markdown tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |\n\n| C | D |\n|---|---|\n| 3 | 4 |'
    const { container } = render(<MarkdownRenderer content={md} />)

    const tableWrappers = Array.from(container.querySelectorAll('table')).map(
      table => table.parentElement?.parentElement,
    )
    expect(tableWrappers).toHaveLength(2)
    for (const wrapper of tableWrappers) {
      expect(wrapper).toBeInTheDocument()
      if (!wrapper) continue
      expect(wrapper).toHaveClass('my-5')
      expect(wrapper.className).toContain('first:mt-0')
      expect(wrapper.className).toContain('last:mb-0')
      expect(wrapper.parentElement).toHaveClass('space-y-4')
      expect(wrapper.parentElement).toHaveClass('whitespace-normal')
    }
  })

  it('renders streaming markdown table with copy button in default mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} isStreaming />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
  })

  it('renders markdown table without copy button in reasoning mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} variant="reasoning" />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument()
  })

  it('renders markdown images as plain img links without wrapper controls', () => {
    render(<MarkdownRenderer content={'![avatar](https://example.com/avatar.png)'} />)

    const img = screen.getByRole('img', { name: 'avatar' })
    expect(img).toBeInTheDocument()
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('loading', 'eager')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(screen.queryByTitle('Download image')).not.toBeInTheDocument()
  })

  it('reserves image dimensions when the source URL includes them', () => {
    render(<MarkdownRenderer content={'![sample](https://picsum.photos/400/200)'} />)

    expect(screen.getByRole('img', { name: 'sample' })).toHaveAttribute('width', '400')
    expect(screen.getByRole('img', { name: 'sample' })).toHaveAttribute('height', '200')
  })

  it('blocks data image markdown sources through hardening', () => {
    render(<MarkdownRenderer content={'![dot](data:image/png;base64,iVBORw0KGgo=)'} />)

    expect(screen.queryByRole('img', { name: 'dot' })).not.toBeInTheDocument()
    expect(screen.getByText('[Image blocked: dot]')).toBeInTheDocument()
  })

  it('blocks unsafe markdown image sources', () => {
    render(<MarkdownRenderer content={'![bad](javascript:alert(1))'} />)

    expect(screen.queryByRole('img', { name: 'bad' })).not.toBeInTheDocument()
  })

  it('renders Windows absolute path links without blocked indicator', () => {
    const filePath =
      'G:/projects/koishi_projects/koishi-new/external/chatluna/packages/core/src/commands/conversation.ts'
    render(<MarkdownRenderer content={`[conversation.ts](${filePath})`} />)

    const link = screen.getByRole('link', { name: 'conversation.ts' })
    expect(link).toHaveAttribute('href', `#opencode-local-file:${encodeURIComponent(filePath)}`)
    expect(link).toHaveAttribute('title', filePath)
    expect(screen.queryByText(/\[blocked\]/)).not.toBeInTheDocument()
  })

  it('renders Windows backslash path links without blocked indicator', () => {
    const filePath = 'C:\\Users\\test\\projects\\assets\\script.js'
    render(<MarkdownRenderer content={`[script.js](${filePath})`} />)

    const link = screen.getByRole('link', { name: 'script.js' })
    expect(link).toHaveAttribute('href', `#opencode-local-file:${encodeURIComponent(filePath)}`)
    expect(link).toHaveAttribute('title', filePath)
    expect(screen.queryByText(/\[blocked\]/)).not.toBeInTheDocument()
  })

  it('still blocks unsafe javascript links', () => {
    render(<MarkdownRenderer content={'[bad](javascript:alert(1))'} />)

    expect(screen.getByText('bad [blocked]')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument()
  })
})
