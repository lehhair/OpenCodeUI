import { isValidElement, memo, useMemo } from 'react'
import { Streamdown, type Components } from 'streamdown'
import { math } from '@streamdown/math'
import { CodeBlock } from './CodeBlock'
import { detectLanguage } from '../utils/languageUtils'

interface MarkdownRendererProps {
  content: string
  className?: string
  /** Whether the content is actively being streamed */
  isStreaming?: boolean
  /** Display variant: 'default' for normal content, 'reasoning' for subdued thinking blocks */
  variant?: 'default' | 'reasoning'
}

/**
 * Inline code component
 */
const InlineCode = memo(function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-accent-main-100 text-[0.9em] align-baseline break-words">
      {children}
    </code>
  )
})

/**
 * Extract text content from React node tree (for code block extraction)
 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  return ''
}

/**
 * Extract code and language from a <pre> element's children
 */
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

/**
 * Main Markdown renderer component
 *
 * Uses Streamdown for streaming-optimized rendering:
 * - Block-level memoization (completed blocks skip re-render)
 * - Unterminated markdown block healing via remend
 * - GFM support built-in
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  isStreaming = false,
  variant = 'default',
}: MarkdownRendererProps) {
  const isReasoning = variant === 'reasoning'

  const components = useMemo<Components>(
    () => ({
      // Inline code — Streamdown supports `inlineCode` as a dedicated key
      inlineCode({ children }) {
        return <InlineCode>{children}</InlineCode>
      },

      // Block code — delegate to our existing CodeBlock with shiki highlighting
      pre({ children }) {
        const blockCode = extractBlockCode(children)
        if (!blockCode) return <pre>{children}</pre>

        return (
          <div className={isReasoning ? 'my-2 first:mt-0 last:mb-0 w-full' : 'my-4 first:mt-0 last:mb-0 w-full'}>
            <CodeBlock
              code={blockCode.code}
              language={blockCode.language}
              showHeader={!isReasoning}
              wordwrap={isReasoning}
              className={isReasoning ? '!bg-transparent !rounded-none !overflow-visible' : ''}
            />
          </div>
        )
      },

      // Headings
      h1: ({ children }) => (
        <h1
          className={
            isReasoning
              ? 'text-xs font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0 italic'
              : 'text-xl font-bold text-text-100 mt-8 mb-4 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2
          className={
            isReasoning
              ? 'text-xs font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0 italic'
              : 'text-lg font-bold text-text-100 mt-6 mb-3 first:mt-0 last:mb-0 tracking-tight pb-1 border-b border-border-100/50'
          }
        >
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3
          className={
            isReasoning
              ? 'text-xs font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0 italic'
              : 'text-base font-semibold text-text-100 mt-5 mb-2 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4
          className={
            isReasoning
              ? 'text-xs font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0 italic'
              : 'text-sm font-semibold text-text-100 mt-4 mb-2 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h4>
      ),

      // Paragraphs
      p: ({ children }) => (
        <p className={isReasoning ? 'text-xs mb-2 last:mb-0 leading-5 text-text-400 italic' : 'mb-4 last:mb-0 leading-7 text-text-200'}>
          {children}
        </p>
      ),

      // Lists
      ul: ({ children }) => (
        <ul
          className={
            isReasoning
              ? 'text-xs list-disc list-outside ml-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
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
              ? 'text-xs list-decimal list-outside ml-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
              : 'list-decimal list-outside ml-5 mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
          }
        >
          {children}
        </ol>
      ),
      li: ({ children }) => (
        <li className={isReasoning ? 'text-xs text-text-400 pl-1 leading-5 italic' : 'text-text-200 pl-1 leading-7'}>
          {children}
        </li>
      ),

      // Links
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            isReasoning
              ? 'text-xs font-medium text-accent-main-200/80 hover:text-accent-main-200 hover:underline underline-offset-2 transition-colors'
              : 'font-medium text-accent-main-100 hover:text-accent-main-200 hover:underline underline-offset-2 transition-colors'
          }
        >
          {children}
        </a>
      ),

      // Blockquotes
      blockquote: ({ children }) => (
        <blockquote
          className={
            isReasoning
              ? 'text-xs border-l-2 border-accent-main-100/50 pl-3 py-0.5 my-2 first:mt-0 last:mb-0 bg-bg-200/20 rounded-r-md text-text-400 italic'
              : 'border-l-2 border-accent-main-100 pl-4 py-1 my-4 first:mt-0 last:mb-0 bg-bg-200/30 rounded-r-md text-text-300 italic'
          }
        >
          {children}
        </blockquote>
      ),

      // Tables
      table: ({ children }) => (
        <div
          className={
            isReasoning
              ? 'text-xs overflow-x-auto my-3 first:mt-0 last:mb-0 border border-border-200/50 rounded-lg w-full'
              : 'overflow-x-auto my-6 first:mt-0 last:mb-0 border border-border-200 rounded-lg shadow-sm w-full'
          }
        >
          <table className={isReasoning ? 'min-w-full border-collapse text-xs divide-y divide-border-200/50' : 'min-w-full border-collapse text-sm divide-y divide-border-200'}>
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className={isReasoning ? 'text-xs bg-bg-100/50 text-text-300 font-medium' : 'bg-bg-100 text-text-200 font-medium'}>
          {children}
        </thead>
      ),
      th: ({ children }) => (
        <th
          className={
            isReasoning
              ? 'text-xs px-3 py-2 text-left font-semibold whitespace-nowrap border-b border-border-200/50'
              : 'px-4 py-3 text-left font-semibold whitespace-nowrap border-b border-border-200'
          }
        >
          {children}
        </th>
      ),
      tbody: ({ children }) => (
        <tbody className={isReasoning ? 'text-xs divide-y divide-border-200/30 bg-bg-000' : 'divide-y divide-border-200/50 bg-bg-000'}>
          {children}
        </tbody>
      ),
      tr: ({ children }) => (
        <tr className={isReasoning ? 'text-xs hover:bg-bg-200/20 transition-colors even:bg-bg-200/10' : 'hover:bg-bg-200/30 transition-colors even:bg-bg-200/15'}>
          {children}
        </tr>
      ),
      td: ({ children }) => (
        <td className={isReasoning ? 'text-xs px-3 py-2 text-text-400 leading-relaxed' : 'px-4 py-2.5 text-text-300 leading-relaxed'}>
          {children}
        </td>
      ),

      // Horizontal rule
      hr: () => <hr className={isReasoning ? 'border-border-200/50 my-4 first:mt-0 last:mb-0' : 'border-border-200 my-8 first:mt-0 last:mb-0'} />,

      // Strong and emphasis
      strong: ({ children }) => (
        <strong className={isReasoning ? 'text-xs font-semibold text-text-300' : 'font-semibold text-text-100'}>{children}</strong>
      ),
      em: ({ children }) => <em className={isReasoning ? 'text-xs italic text-text-400' : 'italic text-text-200'}>{children}</em>,

      // Strikethrough (GFM)
      del: ({ children }) => (
        <del className={isReasoning ? 'text-xs text-text-500 line-through decoration-text-500/50' : 'text-text-400 line-through decoration-text-400/50'}>
          {children}
        </del>
      ),
    }),
    [isReasoning],
  )

  return (
    <div
      className={`markdown-content ${isReasoning ? 'text-xs leading-5 text-text-400 italic' : 'text-sm leading-relaxed text-text-100'} break-words min-w-0 overflow-hidden ${className}`}
    >
      <Streamdown components={components} isAnimating={isStreaming} controls={false} plugins={{ math }}>
        {content}
      </Streamdown>
    </div>
  )
})

/**
 * Standalone code highlighter for tool previews
 * Uses file extension to determine language
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
