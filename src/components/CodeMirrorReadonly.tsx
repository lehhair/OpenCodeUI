import { useCallback, useEffect, useMemo, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import type { HighlightTokens } from '../hooks/useSyntaxHighlight'
import { createReadonlyCodeMirrorExtensions, dispatchShikiTokens } from './codeMirrorReadonlyExtensions'
import { getLineCount, getLineNumberColumnWidth } from '../utils/lineNumberUtils'

interface CodeMirrorReadonlyProps {
  code: string
  tokensRef: React.RefObject<HighlightTokens | null>
  tokensVersion: number
  wordWrap: boolean
  lineHeight: number
  maxHeight?: number
  isResizing?: boolean
  showLineNumbers?: boolean
  className?: string
  extraExtensions?: Extension[]
}

export function CodeMirrorReadonly({
  code,
  tokensRef,
  tokensVersion,
  wordWrap,
  lineHeight,
  maxHeight,
  isResizing = false,
  showLineNumbers = true,
  className = '',
  extraExtensions = [],
}: CodeMirrorReadonlyProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const constrainedHeight = maxHeight !== undefined
  const lineNumberWidth = useMemo(() => getLineNumberColumnWidth(getLineCount(code)), [code])

  const extensions = useMemo(
    () =>
      createReadonlyCodeMirrorExtensions({
        wordWrap,
        lineHeight,
        showLineNumbers,
        maxHeight,
        editable: !constrainedHeight,
        lineNumberWidth,
        extraExtensions,
      }),
    [wordWrap, lineHeight, showLineNumbers, maxHeight, constrainedHeight, lineNumberWidth, extraExtensions],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: code, extensions }),
    })

    viewRef.current = view
    dispatchShikiTokens(view, tokensRef.current)

    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [code, extensions, tokensRef])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    dispatchShikiTokens(view, tokensRef.current)
  }, [tokensRef, tokensVersion])

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      const view = viewRef.current
      if (!view) return
      event.preventDefault()
      openSearchPanel(view)
    }
  }, [])

  return (
    <div
      className={`${constrainedHeight ? 'w-full overflow-hidden' : 'h-full min-h-0 w-full overflow-hidden'} font-mono text-[length:var(--fs-code)] ${className}`}
      data-resizing={isResizing ? 'true' : undefined}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <div ref={hostRef} className={constrainedHeight ? '' : 'h-full min-h-0'} />
    </div>
  )
}
