import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { defaultKeymap } from '@codemirror/commands'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search'
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type Panel,
} from '@codemirror/view'
import { useSyntaxHighlightRef, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { themeStore } from '../store/themeStore'

/** codeFontScale 偏移 -> 代码行高 (px)。基准 24px，每 1px 字号偏移对应 2px 行高增量 */
function codeLineHeight(offset: number): number {
  return 24 + offset * 2
}

interface CodePreviewProps {
  code: string
  language: string
  maxHeight?: number
  isResizing?: boolean
  wordWrap?: boolean
}

export function CodePreview({ code, language, maxHeight, isResizing = false, wordWrap }: CodePreviewProps) {
  const { codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const lineHeight = codeLineHeight(codeFontScale)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: language !== 'text',
  })

  const extensions = useMemo(() => createCodePreviewExtensions(resolvedWordWrap, lineHeight), [resolvedWordWrap, lineHeight])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: code,
        extensions,
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [code, extensions])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setShikiTokensEffect.of(tokensRef.current) })
  }, [tokensRef, version])

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
      className="h-full min-h-0 w-full overflow-hidden font-mono text-[length:var(--fs-code)]"
      data-resizing={isResizing ? 'true' : undefined}
      onKeyDownCapture={handleKeyDownCapture}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div ref={hostRef} className="h-full min-h-0" />
    </div>
  )
}

function createCodePreviewExtensions(wordWrap: boolean, lineHeight: number): Extension[] {
  const extensions: Extension[] = [
    EditorState.readOnly.of(true),
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    keymap.of([...searchKeymap, ...defaultKeymap]),
    search({ top: true, createPanel: createCodePreviewSearchPanel }),
    highlightSelectionMatches(),
    shikiDecorationsField,
    codePreviewTheme(lineHeight),
  ]

  if (wordWrap) extensions.push(EditorView.lineWrapping)

  return extensions
}

const setShikiTokensEffect = StateEffect.define<HighlightTokens | null>()

const shikiDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShikiTokensEffect)) {
        return buildShikiDecorations(transaction.state, effect.value)
      }
    }
    return decorations.map(transaction.changes)
  },
  provide: field => EditorView.decorations.from(field),
})

function buildShikiDecorations(state: EditorState, tokens: HighlightTokens | null): DecorationSet {
  if (!tokens) return Decoration.none

  const ranges = []
  for (let lineIndex = 0; lineIndex < tokens.length && lineIndex < state.doc.lines; lineIndex++) {
    const line = state.doc.line(lineIndex + 1)
    let offset = 0

    for (const token of tokens[lineIndex] ?? []) {
      const from = line.from + offset
      const to = Math.min(from + token.content.length, line.to)
      offset += token.content.length
      if (!token.color || from >= to) continue
      ranges.push(Decoration.mark({ attributes: { style: `color: ${token.color}` } }).range(from, to))
    }
  }

  return Decoration.set(ranges, true)
}

function codePreviewTheme(lineHeight: number): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      color: 'hsl(var(--text-100))',
      backgroundColor: 'transparent',
      fontSize: 'var(--fs-code)',
    },
    '.cm-editor': {
      height: '100%',
    },
    '.cm-scroller': {
      height: '100%',
      overflow: 'auto',
      fontFamily: 'var(--font-mono)',
      lineHeight: `${lineHeight}px`,
    },
    '.cm-content': {
      padding: '0',
      minHeight: '100%',
      caretColor: 'hsl(var(--accent-main-100))',
    },
    '.cm-cursor': {
      borderLeftColor: 'hsl(var(--accent-main-100))',
      borderLeftWidth: '2px',
    },
    '.cm-line': {
      padding: '0 1rem 0 0.75rem',
      minHeight: `${lineHeight}px`,
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'hsl(var(--text-500))',
      borderRight: '1px solid hsl(var(--border-100) / 0.35)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '2rem',
      padding: '0 0.75rem 0 1rem',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'hsl(var(--accent-main-100) / 0.08)',
      color: 'hsl(var(--accent-main-100))',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgb(255 255 255 / 0.15)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'rgb(255 255 255 / 0.15)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-searchMatch': {
      backgroundColor: 'hsl(var(--warning-100) / 0.22)',
      outline: '1px solid hsl(var(--warning-100) / 0.34)',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'hsl(var(--warning-100) / 0.36)',
      outline: '1px solid hsl(var(--warning-100) / 0.58)',
    },
    '.cm-panels': {
      backgroundColor: 'transparent',
      color: 'hsl(var(--text-200))',
      border: '0',
      fontFamily: 'inherit',
      pointerEvents: 'none',
    },
    '.cm-panels-top': {
      borderBottom: '0',
      top: '0.6rem',
      left: 'auto',
      right: '0.85rem',
      maxWidth: 'calc(100% - 1.7rem)',
    },
    '.cm-code-search': {
      display: 'flex',
      alignItems: 'center',
      gap: '0.2rem',
      width: 'max-content',
      maxWidth: '100%',
      minHeight: '2.45rem',
      padding: '0.28rem 0.36rem',
      border: '1px solid hsl(var(--border-100) / 0.45)',
      borderRadius: '0.7rem',
      backgroundColor: 'hsl(var(--bg-200) / 0.92)',
      boxShadow: '0 12px 32px hsl(var(--bg-000) / 0.28)',
      backdropFilter: 'blur(14px)',
      fontSize: 'var(--fs-xs)',
      lineHeight: '1',
      pointerEvents: 'auto',
    },
    '.cm-code-search-inputWrap': {
      position: 'relative',
      minWidth: '10rem',
      width: '16rem',
      maxWidth: 'min(16rem, 38vw)',
    },
    '.cm-code-search-input': {
      width: '100%',
      height: '1.85rem',
      borderRadius: '0.45rem',
      border: '1px solid transparent',
      backgroundColor: 'hsl(var(--bg-300) / 0.48)',
      color: 'hsl(var(--text-100))',
      padding: '0 0.5rem',
      outline: 'none',
      font: 'inherit',
    },
    '.cm-code-search-input:focus': {
      borderColor: 'hsl(var(--accent-main-100) / 0.5)',
      boxShadow: '0 0 0 1px hsl(var(--accent-main-100) / 0.14)',
    },
    '.cm-code-search-nav, .cm-code-search-options': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.1rem',
      flex: '0 0 auto',
    },
    '.cm-code-search-divider': {
      width: '1px',
      height: '1.05rem',
      margin: '0 0.22rem',
      backgroundColor: 'hsl(var(--border-100) / 0.5)',
    },
    '.cm-code-search-count': {
      minWidth: '4.7rem',
      padding: '0 0.35rem',
      color: 'hsl(var(--text-300))',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-xs)',
      whiteSpace: 'nowrap',
      textAlign: 'center',
    },
    '.cm-code-search-button, .cm-code-search-toggle': {
      appearance: 'none',
      WebkitAppearance: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '1.85rem',
      minWidth: '1.85rem',
      border: '0',
      backgroundColor: 'transparent',
      color: 'hsl(var(--text-300))',
      borderRadius: '0.42rem',
      font: 'inherit',
      cursor: 'pointer',
      padding: '0',
      transition: 'background-color 120ms ease, color 120ms ease',
    },
    '.cm-code-search-button:hover, .cm-code-search-toggle:hover': {
      backgroundColor: 'hsl(var(--bg-300) / 0.55)',
      color: 'hsl(var(--text-100))',
    },
    '.cm-code-search-button': {
      fontSize: '1rem',
    },
    '.cm-code-search-toggle': {
      padding: '0 0.34rem',
      fontSize: 'var(--fs-sm)',
      fontWeight: '500',
    },
    '.cm-code-search-toggle[aria-pressed="true"]': {
      backgroundColor: 'hsl(var(--accent-main-100) / 0.14)',
      color: 'hsl(var(--accent-main-100))',
    },
    '@media (max-width: 640px)': {
      '.cm-panels-top': {
        top: '0.45rem',
        right: '0.45rem',
        maxWidth: 'calc(100% - 0.9rem)',
      },
      '.cm-code-search': {
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      },
      '.cm-code-search-inputWrap': {
        width: 'calc(100vw - 2.4rem)',
        maxWidth: 'none',
      },
    },
  })
}

function createCodePreviewSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-code-search'

  const inputWrap = document.createElement('div')
  inputWrap.className = 'cm-code-search-inputWrap'

  const input = document.createElement('input')
  input.className = 'cm-code-search-input'
  input.type = 'search'
  input.placeholder = 'Find'
  input.setAttribute('main-field', 'true')
  input.setAttribute('aria-label', 'Find in code')
  input.spellcheck = false
  inputWrap.append(input)

  const nav = document.createElement('div')
  nav.className = 'cm-code-search-nav'

  const previousButton = createSearchButton('↑', 'Previous match', () => findPrevious(view))
  const nextButton = createSearchButton('↓', 'Next match', () => findNext(view))
  const allButton = createSearchButton('≡', 'Select all matches', () => selectMatches(view))
  nav.append(previousButton, nextButton, allButton)

  const options = document.createElement('div')
  options.className = 'cm-code-search-options'

  const caseSensitive = createSearchToggle('Aa', 'Match case')
  const regexp = createSearchToggle('.*', 'Use regular expression')
  const wholeWord = createSearchToggle('ab', 'Match whole word')
  options.append(caseSensitive.button, regexp.button, wholeWord.button)

  const count = document.createElement('span')
  count.className = 'cm-code-search-count'
  count.textContent = 'No results'

  const dividerOne = createSearchDivider()
  const dividerTwo = createSearchDivider()

  const closeButton = createSearchButton('×', 'Close search', () => {
    closeSearchPanel(view)
    view.focus()
  })

  dom.append(inputWrap, options, count, dividerOne, nav, dividerTwo, closeButton)

  const syncFromState = () => {
    const query = getSearchQuery(view.state)
    if (document.activeElement !== input) input.value = query.search
    caseSensitive.setPressed(query.caseSensitive)
    regexp.setPressed(query.regexp)
    wholeWord.setPressed(query.wholeWord)
    count.textContent = getSearchCountLabel(view.state, query)
  }

  const applyQuery = () => {
    const current = getSearchQuery(view.state)
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: input.value,
          caseSensitive: caseSensitive.pressed(),
          regexp: regexp.pressed(),
          wholeWord: wholeWord.pressed(),
          replace: current.replace,
          literal: current.literal,
        }),
      ),
    })
  }

  input.addEventListener('input', applyQuery)
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      applyQuery()
      if (event.shiftKey) findPrevious(view)
      else findNext(view)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchPanel(view)
      view.focus()
    }
  })

  for (const option of [caseSensitive, regexp, wholeWord]) {
    option.button.addEventListener('click', () => {
      option.setPressed(!option.pressed())
      applyQuery()
    })
  }

  syncFromState()

  return {
    dom,
    mount() {
      input.focus()
      input.select()
    },
    update() {
      syncFromState()
    },
    top: true,
  }
}

function getSearchCountLabel(state: EditorState, query: SearchQuery): string {
  if (!query.search) return 'No results'

  const selectionFrom = state.selection.main.from
  let total = 0
  let current = 0
  const cursor = query.getCursor(state)

  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++
    if (next.value.from <= selectionFrom && next.value.to >= selectionFrom) current = total
  }

  if (total === 0) return 'No results'
  return `${current || 1} / ${total}`
}

function createSearchDivider(): HTMLSpanElement {
  const divider = document.createElement('span')
  divider.className = 'cm-code-search-divider'
  divider.setAttribute('aria-hidden', 'true')
  return divider
}

function createSearchButton(label: string, title: string, action: () => boolean | void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'cm-code-search-button'
  button.type = 'button'
  button.textContent = label
  button.title = title
  button.setAttribute('aria-label', title)
  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', () => action())
  return button
}

function createSearchToggle(label: string, title: string) {
  const button = document.createElement('button')
  button.className = 'cm-code-search-toggle'
  button.type = 'button'
  button.textContent = label
  button.title = title
  button.setAttribute('aria-label', title)
  button.setAttribute('aria-pressed', 'false')

  return {
    button,
    pressed: () => button.getAttribute('aria-pressed') === 'true',
    setPressed: (pressed: boolean) => button.setAttribute('aria-pressed', pressed ? 'true' : 'false'),
  }
}
