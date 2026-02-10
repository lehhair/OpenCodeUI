import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import { detectLanguage } from '../utils/languageUtils'

interface MarkdownRendererProps {
  content: string
  className?: string
}

/**
 * Inline code component
 */
const InlineCode = memo(function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 mx-0.5 bg-bg-200/50 border border-border-200/50 rounded text-accent-main-100 text-[0.85em] font-mono tracking-tight align-middle break-all">
      {children}
    </code>
  )
})

/**
 * Main Markdown renderer component
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className = '' 
}: MarkdownRendererProps) {
  const components = useMemo(() => ({
    // Code blocks and inline code
    code({ className, children }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const contentStr = String(children).replace(/\n$/, '')
      const isMultiLine = contentStr.includes('\n')
      
      // 只有既没有语言标记，内容又是单行时，才认为是 inline code
      const isInline = !match && !className && !isMultiLine
      
      if (isInline) {
        return <InlineCode>{children}</InlineCode>
      }
      
      // Block code
      return (
        <div className="my-4 w-full">
          <CodeBlock code={contentStr} language={match?.[1]} />
        </div>
      )
    },
    
    // Prevent pre from wrapping code blocks (we handle it in CodeBlock)
    pre({ children }: any) {
      return <>{children}</>
    },
    
    // Headings - Improved typography
    h1: ({ children }: any) => (
      <h1 className="text-xl font-bold text-text-100 mt-8 mb-4 first:mt-0 tracking-tight">{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-lg font-bold text-text-100 mt-6 mb-3 first:mt-0 tracking-tight pb-1 border-b border-border-100/50">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-base font-semibold text-text-100 mt-5 mb-2 first:mt-0 tracking-tight">{children}</h3>
    ),
    h4: ({ children }: any) => (
      <h4 className="text-sm font-semibold text-text-100 mt-4 mb-2 first:mt-0 tracking-tight">{children}</h4>
    ),
    
    // Paragraphs
    p: ({ children }: any) => (
      <p className="mb-4 last:mb-0 leading-7 text-text-200">{children}</p>
    ),
    
    // Lists
    ul: ({ children }: any) => (
      <ul className="list-disc list-outside ml-5 mb-4 space-y-1 marker:text-text-400/80">{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal list-outside ml-5 mb-4 space-y-1 marker:text-text-400/80">{children}</ol>
    ),
    li: ({ children }: any) => (
      <li className="text-text-200 pl-1 leading-7">{children}</li>
    ),
    
    // Links
    a: ({ href, children }: any) => (
      <a 
        href={href} 
        target="_blank" 
        rel="noopener noreferrer"
        className="font-medium text-accent-main-100 hover:text-accent-main-200 hover:underline underline-offset-2 transition-colors"
      >
        {children}
      </a>
    ),
    
    // Blockquotes - Modern style
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-accent-main-100 pl-4 py-1 my-4 bg-bg-200/30 rounded-r-md text-text-300 italic">
        {children}
      </blockquote>
    ),
    
    // Tables - Modern style with striping
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-6 border border-border-200 rounded-lg shadow-sm w-full">
        <table className="min-w-full border-collapse text-sm divide-y divide-border-200">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-bg-100 text-text-200 font-medium">{children}</thead>
    ),
    th: ({ children }: any) => (
      <th className="px-4 py-3 text-left font-semibold whitespace-nowrap border-b border-border-200">
        {children}
      </th>
    ),
    tbody: ({ children }: any) => (
      <tbody className="divide-y divide-border-200/50 bg-bg-000">
        {children}
      </tbody>
    ),
    tr: ({ children }: any) => (
      <tr className="hover:bg-bg-50/50 transition-colors even:bg-bg-50/30">{children}</tr>
    ),
    td: ({ children }: any) => (
      <td className="px-4 py-2.5 text-text-300 leading-relaxed">{children}</td>
    ),
    
    // Horizontal rule
    hr: () => <hr className="border-border-200 my-8" />,
    
    // Strong and emphasis
    strong: ({ children }: any) => (
      <strong className="font-semibold text-text-100">{children}</strong>
    ),
    em: ({ children }: any) => (
      <em className="italic text-text-200">{children}</em>
    ),
    
    // Strikethrough (GFM)
    del: ({ children }: any) => (
      <del className="text-text-400 line-through decoration-text-400/50">{children}</del>
    ),
  }), [])

  return (
    <div className={`markdown-content text-sm text-text-100 leading-relaxed break-words min-w-0 overflow-hidden ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
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
    <div 
      className={`overflow-auto ${className}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <CodeBlock code={code} language={lang} />
    </div>
  )
})

export default MarkdownRenderer
