import { Children, cloneElement, isValidElement, memo, useMemo } from 'react'
import { Streamdown, type Components } from 'streamdown'
import { math } from '@streamdown/math'
import { CodeBlock } from './CodeBlock'
import { CopyButton } from './ui'
import { detectLanguage } from '../utils/languageUtils'

interface MarkdownRendererProps {
  content: string
  className?: string
  /** Whether the content is actively being streamed */
  isStreaming?: boolean
  /** Display variant: 'default' for normal content, 'reasoning' for subdued thinking blocks */
  variant?: 'default' | 'reasoning'
}

// ─── Inline Code ───────────────────────────────────────────────

const InlineCode = memo(function InlineCode({
  children,
  variant = 'default',
}: {
  children: React.ReactNode
  variant?: 'default' | 'reasoning'
}) {
  return (
    <code
      className={
        variant === 'reasoning'
          ? 'font-mono text-accent-main-100 text-[0.9em] align-baseline break-words'
          : 'text-accent-main-100 text-[0.9em] font-mono align-baseline break-words'
      }
    >
      {children}
    </code>
  )
})

const MarkdownImage = memo(function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  if (!src) return null

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block max-w-full align-top"
      title={title || alt || undefined}
    >
      <img src={src} alt={alt || ''} title={title} loading="lazy" className="block max-w-full rounded-md" />
    </a>
  )
})

// ─── Helpers ───────────────────────────────────────────────────

/** Extract text content from React node tree */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return extractText(props.children)
  }
  return ''
}

/** Extract code and language from a <pre> element's children */
function extractBlockCode(children: React.ReactNode): { code: string; language?: string } | null {
  const codeNode = Array.isArray(children) ? children[0] : children
  if (!isValidElement(codeNode)) return null

  const props = codeNode.props as { className?: string; children?: React.ReactNode }
  const match = /language-([\w-]+)/.exec(props.className || '')
  const contentStr = extractText(props.children).replace(/\n$/, '')

  return {
    code: contentStr,
    language: match?.[1],
  }
}

// ─── Markdown Table ────────────────────────────────────────────

/**
 * Extract table AST into rows of cell text for markdown copy.
 * Walks thead/tbody > tr > th|td children.
 */
function extractTableData(children: React.ReactNode): { headers: string[]; rows: string[][] } {
  const headers: string[] = []
  const rows: string[][] = []

  const childArr = Array.isArray(children) ? children : [children]
  for (const section of childArr) {
    if (!isValidElement(section)) continue
    const sectionProps = section.props as { children?: React.ReactNode }
    const trArr = Array.isArray(sectionProps.children) ? sectionProps.children : [sectionProps.children]

    for (const tr of trArr) {
      if (!isValidElement(tr)) continue
      const trProps = tr.props as { children?: React.ReactNode }
      const cells = Array.isArray(trProps.children) ? trProps.children : [trProps.children]
      const texts = cells
        .filter(isValidElement)
        .map(c => extractText((c as React.ReactElement<{ children?: React.ReactNode }>).props?.children ?? ''))

      // If this row is inside thead (section type name check), treat as headers
      const sectionType = typeof section.type === 'string' ? section.type : (section.type as { name?: string })?.name
      if (sectionType === 'thead' || String(sectionType).toLowerCase().includes('thead')) {
        headers.push(...texts)
      } else {
        rows.push(texts)
      }
    }
  }
  return { headers, rows }
}

function tableToMarkdown(headers: string[], rows: string[][]): string {
  if (!headers.length) return ''
  const sep = headers.map(() => '---')
  const lines = [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)]
  return lines.join('\n')
}

function injectTableCopyButton(
  children: React.ReactNode,
  copyText: string,
): { children: React.ReactNode; inserted: boolean } {
  let inserted = false

  const nextChildren = Children.map(children, section => {
    if (!isValidElement(section)) return section

    const sectionType = typeof section.type === 'string' ? section.type : (section.type as { name?: string })?.name
    if (sectionType !== 'thead' && !String(sectionType).toLowerCase().includes('thead')) return section

    const sectionElement = section as React.ReactElement<{ children?: React.ReactNode }>
    const rows = Children.toArray(sectionElement.props.children)
    if (rows.length === 0) return section

    return cloneElement(
      sectionElement,
      undefined,
      rows.map((row, rowIndex) => {
        if (!isValidElement(row) || rowIndex !== rows.length - 1) return row

        const rowElement = row as React.ReactElement<{ children?: React.ReactNode }>
        const cells = Children.toArray(rowElement.props.children)
        if (cells.length === 0) return row

        return cloneElement(
          rowElement,
          undefined,
          cells.map((cell, cellIndex) => {
            if (!isValidElement(cell) || cellIndex !== cells.length - 1 || inserted) return cell

            inserted = true
            const cellElement = cell as React.ReactElement<{ children?: React.ReactNode }>

            return cloneElement(
              cellElement,
              undefined,
              <>
                <span className="block pr-8">{cellElement.props.children}</span>
                <span className="absolute inset-y-0 right-0 flex items-center px-2">
                  <CopyButton
                    text={copyText}
                    position="static"
                    className="!p-1 opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                  />
                </span>
              </>,
            )
          }),
        )
      }),
    )
  })

  return { children: nextChildren ?? children, inserted }
}

const MarkdownTable = memo(function MarkdownTable({
  children,
  isReasoning,
}: {
  children: React.ReactNode
  isReasoning: boolean
}) {
  const copyText = useMemo(() => {
    const { headers, rows } = extractTableData(children)
    return tableToMarkdown(headers, rows)
  }, [children])

  const { children: tableChildren, inserted: hasInlineCopyButton } = useMemo(() => {
    if (isReasoning || !copyText) return { children, inserted: false }
    return injectTableCopyButton(children, copyText)
  }, [children, copyText, isReasoning])

  if (isReasoning) {
    return (
      <div className="overflow-x-auto my-2 first:mt-0 last:mb-0 w-full">
        <table className="min-w-full border-collapse text-[length:var(--fs-sm)]">{children}</table>
      </div>
    )
  }

  return (
    <div className="group/table relative my-5 first:mt-0 last:mb-0 rounded-md border border-border-200/35 w-full">
      {/* Scrollable table area */}
      <div className="overflow-x-auto">
        <table className="w-full text-[length:var(--fs-md)] border-collapse">{tableChildren}</table>
      </div>
      {/* Copy button — outside scroll, pinned to visible top-right */}
      {copyText && !hasInlineCopyButton && (
        <CopyButton
          text={copyText}
          position="absolute"
          className="!top-1.5 !right-2 opacity-0 group-hover/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity z-20"
        />
      )}
    </div>
  )
})

// ─── Main Renderer ─────────────────────────────────────────────

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  isStreaming = false,
  variant = 'default',
}: MarkdownRendererProps) {
  const isReasoning = variant === 'reasoning'

  const components = useMemo<Components>(
    () => ({
      // --- Inline code ---
      inlineCode({ children }) {
        return <InlineCode variant={isReasoning ? 'reasoning' : 'default'}>{children}</InlineCode>
      },

      // --- Block code ---
      pre({ children }) {
        const blockCode = extractBlockCode(children)
        if (!blockCode) return <pre>{children}</pre>

        return (
          <div className={isReasoning ? 'my-2 first:mt-0 last:mb-0 w-full' : 'my-4 first:mt-0 last:mb-0 w-full'}>
            <CodeBlock
              code={blockCode.code}
              language={blockCode.language}
              variant={isReasoning ? 'reasoning' : 'default'}
              wordwrap={isReasoning}
            />
          </div>
        )
      },

      // --- Headings ---
      h1: ({ children }) => (
        <h1
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-heading-1)] font-bold text-text-100 mt-8 mb-4 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-heading-2)] font-bold text-text-100 mt-6 mb-3 first:mt-0 last:mb-0 tracking-tight pb-1.5 border-b border-border-100/40'
          }
        >
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-heading-3)] font-semibold text-text-100 mt-5 mb-2 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-base)] font-semibold text-text-100 mt-4 mb-2 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h4>
      ),

      // --- Paragraphs ---
      p: ({ children }) => (
        <p
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400'
              : 'mb-4 last:mb-0 leading-7 text-text-200'
          }
        >
          {children}
        </p>
      ),

      // --- Lists ---
      ul: ({ children }) => (
        <ul
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] list-disc list-outside ml-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
              : 'list-disc list-outside ml-5 mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
          }
        >
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] list-decimal list-outside ml-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
              : 'list-decimal list-outside ml-5 mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
          }
        >
          {children}
        </ol>
      ),
      li: ({ children }) => (
        <li
          className={
            isReasoning ? 'text-[length:var(--fs-sm)] text-text-400 pl-1 leading-5' : 'text-text-200 pl-1 leading-7'
          }
        >
          {children}
        </li>
      ),

      // --- Links ---
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-medium text-accent-main-200/80 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
              : 'font-medium text-accent-main-100 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
          }
        >
          {children}
        </a>
      ),

      // --- Images ---
      img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} />,

      // --- Blockquotes ---
      blockquote: ({ children }) => (
        <blockquote
          className={
            isReasoning
              ? 'border-l-2 border-text-500/30 pl-3 py-0.5 my-2 first:mt-0 last:mb-0 text-text-400'
              : 'border-l-2 border-accent-main-100/60 pl-4 py-1 my-4 first:mt-0 last:mb-0 text-text-300 italic'
          }
        >
          {children}
        </blockquote>
      ),

      // --- Tables ---
      table: ({ children }) => <MarkdownTable isReasoning={isReasoning}>{children}</MarkdownTable>,

      thead: ({ children }) => <thead className={isReasoning ? 'text-text-400' : 'text-text-200'}>{children}</thead>,
      th: ({ children }) => (
        <th
          className={
            isReasoning
              ? 'px-3 py-1.5 text-left text-[length:var(--fs-sm)] font-medium whitespace-nowrap border-b border-border-200/32'
              : 'relative px-3 py-2.5 text-left text-[length:var(--fs-md)] font-semibold whitespace-nowrap border-b border-border-200/38'
          }
        >
          {children}
        </th>
      ),
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => (
        <tr className={isReasoning ? 'hover:bg-bg-200/10 transition-colors' : 'hover:bg-bg-200/12 transition-colors'}>
          {children}
        </tr>
      ),
      td: ({ children }) => (
        <td
          className={
            isReasoning
              ? 'px-3 py-1.5 text-[length:var(--fs-sm)] text-text-300 w-max border-b border-border-200/18'
              : 'px-3 py-2 text-[length:var(--fs-md)] text-text-300 leading-[1.55] w-max border-b border-border-200/14'
          }
        >
          {children}
        </td>
      ),

      // --- Horizontal rule ---
      hr: () => (
        <hr
          className={
            isReasoning
              ? 'border-border-200/40 my-4 first:mt-0 last:mb-0'
              : 'border-border-200/60 my-8 first:mt-0 last:mb-0'
          }
        />
      ),

      // --- Strong & emphasis ---
      strong: ({ children }) => (
        <strong className={isReasoning ? 'font-semibold text-text-300' : 'font-semibold text-text-100'}>
          {children}
        </strong>
      ),
      em: ({ children }) => (
        <em className={isReasoning ? 'italic text-text-300' : 'italic text-text-200'}>{children}</em>
      ),

      // --- Strikethrough (GFM) ---
      del: ({ children }) => (
        <del
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] text-text-500 line-through decoration-text-500/50'
              : 'text-text-400 line-through decoration-text-400/50'
          }
        >
          {children}
        </del>
      ),
    }),
    [isReasoning],
  )

  return (
    <div
      className={`markdown-content ${isReasoning ? 'text-[length:var(--fs-sm)] leading-5 text-text-400' : 'text-[length:var(--fs-base)] leading-relaxed text-text-100'} break-words min-w-0 overflow-hidden ${className}`}
    >
      <Streamdown components={components} isAnimating={isStreaming} controls={false} plugins={{ math }}>
        {content}
      </Streamdown>
    </div>
  )
})

// ─── Standalone Code Highlighter ───────────────────────────────

/**
 * Standalone code highlighter for tool previews.
 * Uses file extension to determine language.
 */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  filePath,
  language,
  maxHeight,
  className = '',
}: {
  code: string
  filePath?: string
  language?: string
  maxHeight?: number
  className?: string
}) {
  const lang = useMemo(() => {
    return language || detectLanguage(filePath)
  }, [filePath, language])

  return (
    <div className={`overflow-auto ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      <CodeBlock code={code} language={lang} />
    </div>
  )
})

export default MarkdownRenderer
