import { defaultKeymap } from '@codemirror/commands'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
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
import type { HighlightTokens } from '../hooks/useSyntaxHighlight'

export function codeLineHeight(offset: number): number {
  return 24 + offset * 2
}

export function createReadonlyCodeMirrorExtensions({
  wordWrap,
  lineHeight,
  showLineNumbers = true,
  maxHeight,
  editable = true,
  lineNumberWidth,
  extraExtensions = [],
}: {
  wordWrap: boolean
  lineHeight: number
  showLineNumbers?: boolean
  maxHeight?: number
  editable?: boolean
  lineNumberWidth: number
  extraExtensions?: Extension[]
}): Extension[] {
  const extensions: Extension[] = [
    EditorView.editable.of(editable),
    EditorState.readOnly.of(true),
    highlightActiveLineGutter(),
    drawSelection(),
    keymap.of([...searchKeymap, ...defaultKeymap]),
    search({ top: true, createPanel: createCodeMirrorSearchPanel }),
    highlightSelectionMatches(),
    shikiDecorationsField,
    readonlyCodeMirrorTheme(lineHeight, maxHeight, lineNumberWidth),
    ...extraExtensions,
  ]

  if (showLineNumbers) extensions.unshift(lineNumbers())
  if (wordWrap) extensions.push(EditorView.lineWrapping)

  return extensions
}

export function dispatchShikiTokens(view: EditorView, tokens: HighlightTokens | null) {
  view.dispatch({ effects: setShikiTokensEffect.of(tokens) })
}

const setShikiTokensEffect = StateEffect.define<HighlightTokens | null>()

const shikiDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShikiTokensEffect)) return buildShikiDecorations(transaction.state, effect.value)
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

function readonlyCodeMirrorTheme(lineHeight: number, maxHeight: number | undefined, lineNumberWidth: number): Extension {
  const fillContainer = maxHeight === undefined

  return EditorView.theme({
    '&': { color: 'hsl(var(--text-100))', backgroundColor: 'transparent', fontSize: 'var(--fs-code)', position: 'relative', ...(fillContainer ? { height: '100%' } : {}) },
    '.cm-editor': fillContainer ? { height: '100%' } : {},
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: `${lineHeight}px`, ...(fillContainer ? { height: '100%' } : { maxHeight: `${maxHeight}px` }) },
    '.cm-content': { margin: '0', padding: '0', caretColor: 'hsl(var(--accent-main-100))', ...(fillContainer ? { minHeight: '100%' } : {}) },
    '.cm-cursor': { borderLeftColor: 'hsl(var(--accent-main-100))', borderLeftWidth: '2px' },
    '.cm-line': { padding: '0 1rem 0 0', minHeight: `${lineHeight}px` },
    '.cm-gutters': {
      backgroundColor: 'hsl(var(--bg-100))',
      color: 'hsl(var(--text-400))',
      borderRight: '0',
      margin: '0',
      padding: '0',
      userSelect: 'none',
      zIndex: '3',
    },
    '.cm-gutter': { backgroundColor: 'hsl(var(--bg-100))', margin: '0', padding: '0', userSelect: 'none' },
    '.cm-lineNumbers': { width: `${lineNumberWidth}px`, minWidth: `${lineNumberWidth}px`, margin: '0', padding: '0' },
    '.cm-lineNumbers .cm-gutterElement': { boxSizing: 'border-box', width: `${lineNumberWidth}px`, minWidth: `${lineNumberWidth}px`, padding: '0 0.75rem 0 1rem', textAlign: 'right', userSelect: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'hsl(var(--accent-main-100))' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'hsl(var(--accent-main-100) / 0.2)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'hsl(var(--accent-main-100) / 0.26)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-searchMatch': { backgroundColor: 'hsl(var(--warning-100) / 0.22)', outline: '1px solid hsl(var(--warning-100) / 0.34)' },
    '.cm-searchMatch-selected': { backgroundColor: 'hsl(var(--warning-100) / 0.36)', outline: '1px solid hsl(var(--warning-100) / 0.58)' },
    '.cm-panels': { backgroundColor: 'transparent', color: 'hsl(var(--text-200))', border: '0', fontFamily: 'inherit', pointerEvents: 'none' },
    '.cm-panels-top': { position: 'absolute', borderBottom: '0', inset: '0', zIndex: '20', overflow: 'visible' },
    '.cm-code-search': { position: 'absolute', top: '0.55rem', right: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '0.2rem', width: 'max-content', maxWidth: 'calc(100% - 1.5rem)', minHeight: '2.45rem', padding: '0.28rem 0.36rem', border: '1px solid hsl(var(--border-100) / 0.45)', borderRadius: '0.7rem', backgroundColor: 'hsl(var(--bg-200) / 0.92)', boxShadow: '0 12px 32px hsl(var(--bg-000) / 0.28)', backdropFilter: 'blur(14px)', fontSize: 'var(--fs-xs)', lineHeight: '1', pointerEvents: 'auto' },
    '.cm-code-search-inputWrap': { position: 'relative', minWidth: '10rem', width: 'clamp(10rem, 28vw, 16rem)', maxWidth: '100%', flex: '1 1 10rem' },
    '.cm-code-search-input': { width: '100%', height: '1.85rem', borderRadius: '0.45rem', border: '1px solid transparent', backgroundColor: 'hsl(var(--bg-300) / 0.48)', color: 'hsl(var(--text-100))', padding: '0 1.85rem 0 0.5rem', outline: 'none', font: 'inherit' },
    '.cm-code-search-clear': { position: 'absolute', top: '50%', right: '0.28rem', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1.35rem', height: '1.35rem', border: '0', borderRadius: '0.35rem', backgroundColor: 'transparent', color: 'hsl(var(--text-400))', font: 'inherit', cursor: 'pointer', opacity: '0', pointerEvents: 'none', transition: 'opacity 120ms ease, background-color 120ms ease, color 120ms ease' },
    '.cm-code-search-inputWrap[data-has-value="true"] .cm-code-search-clear': { opacity: '1', pointerEvents: 'auto' },
    '.cm-code-search-clear:hover': { backgroundColor: 'hsl(var(--bg-300) / 0.55)', color: 'hsl(var(--text-100))' },
    '.cm-code-search-input:focus': { borderColor: 'hsl(var(--accent-main-100) / 0.5)', boxShadow: '0 0 0 1px hsl(var(--accent-main-100) / 0.14)' },
    '.cm-code-search-nav, .cm-code-search-options': { display: 'inline-flex', alignItems: 'center', gap: '0.1rem', flex: '0 0 auto' },
    '.cm-code-search-divider': { width: '1px', height: '1.05rem', margin: '0 0.22rem', backgroundColor: 'hsl(var(--border-100) / 0.5)' },
    '.cm-code-search-count': { minWidth: '4.7rem', padding: '0 0.35rem', color: 'hsl(var(--text-300))', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap', textAlign: 'center' },
    '.cm-code-search-button, .cm-code-search-toggle': { appearance: 'none', WebkitAppearance: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '1.85rem', minWidth: '1.85rem', border: '0', backgroundColor: 'transparent', color: 'hsl(var(--text-300))', borderRadius: '0.42rem', font: 'inherit', cursor: 'pointer', padding: '0', transition: 'background-color 120ms ease, color 120ms ease' },
    '.cm-code-search-button:hover, .cm-code-search-toggle:hover': { backgroundColor: 'hsl(var(--bg-300) / 0.55)', color: 'hsl(var(--text-100))' },
    '.cm-code-search-button': { fontSize: '1rem' },
    '.cm-code-search-toggle': { padding: '0 0.34rem', fontSize: 'var(--fs-sm)', fontWeight: '500' },
    '.cm-code-search-toggle[aria-pressed="true"]': { backgroundColor: 'hsl(var(--accent-main-100) / 0.14)', color: 'hsl(var(--accent-main-100))' },
    '@media (max-width: 640px)': { '.cm-code-search': { top: '0.45rem', right: '0.45rem', justifyContent: 'flex-end', maxWidth: 'calc(100% - 0.9rem)' }, '.cm-code-search-inputWrap': { width: '100%', flexBasis: '100%', maxWidth: 'none' } },
    '@media (min-width: 641px) and (max-width: 900px)': { '.cm-code-search-inputWrap': { width: '11rem' }, '.cm-code-search-count': { minWidth: '3.8rem' } },
  })
}

function createCodeMirrorSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-code-search'
  const inputWrap = document.createElement('div')
  inputWrap.className = 'cm-code-search-inputWrap'
  const input = document.createElement('input')
  input.className = 'cm-code-search-input'
  input.type = 'text'
  input.placeholder = 'Find'
  input.setAttribute('main-field', 'true')
  input.setAttribute('aria-label', 'Find in code')
  input.spellcheck = false
  const clearButton = createSearchButton('×', 'Clear search', () => {
    input.value = ''
    applyQuery()
    input.focus()
  })
  clearButton.className = 'cm-code-search-clear'
  inputWrap.append(input, clearButton)
  const nav = document.createElement('div')
  nav.className = 'cm-code-search-nav'
  nav.append(createSearchButton('↑', 'Previous match', () => findPrevious(view)), createSearchButton('↓', 'Next match', () => findNext(view)), createSearchButton('≡', 'Select all matches', () => selectMatches(view)))
  const options = document.createElement('div')
  options.className = 'cm-code-search-options'
  const caseSensitive = createSearchToggle('Aa', 'Match case')
  const regexp = createSearchToggle('.*', 'Use regular expression')
  const wholeWord = createSearchToggle('ab', 'Match whole word')
  options.append(caseSensitive.button, regexp.button, wholeWord.button)
  const count = document.createElement('span')
  count.className = 'cm-code-search-count'
  count.textContent = 'No results'
  const closeButton = createSearchButton('×', 'Close search', () => {
    closeSearchPanel(view)
    view.focus()
  })
  dom.append(inputWrap, options, count, createSearchDivider(), nav, createSearchDivider(), closeButton)
  const syncFromState = () => {
    const query = getSearchQuery(view.state)
    if (document.activeElement !== input) input.value = query.search
    inputWrap.dataset.hasValue = input.value ? 'true' : 'false'
    caseSensitive.setPressed(query.caseSensitive)
    regexp.setPressed(query.regexp)
    wholeWord.setPressed(query.wholeWord)
    count.textContent = getSearchCountLabel(view.state, query)
  }
  const applyQuery = () => {
    const current = getSearchQuery(view.state)
    inputWrap.dataset.hasValue = input.value ? 'true' : 'false'
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value, caseSensitive: caseSensitive.pressed(), regexp: regexp.pressed(), wholeWord: wholeWord.pressed(), replace: current.replace, literal: current.literal })) })
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
  return { dom, mount: () => { input.focus(); input.select() }, update: syncFromState, top: true }
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
  return { button, pressed: () => button.getAttribute('aria-pressed') === 'true', setPressed: (pressed: boolean) => button.setAttribute('aria-pressed', pressed ? 'true' : 'false') }
}
