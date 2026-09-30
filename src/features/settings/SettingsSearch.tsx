import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CloseIcon, SearchIcon } from '../../components/Icons'
import { scrollItemIntoView } from '../../utils/scrollUtils'
import { filterSettingsSearchItems, type SearchMenuItem } from './settingsSearchCatalog'

interface SettingsSearchProps<T extends SearchMenuItem> {
  items: T[]
  placeholder: string
  clearLabel: string
  noResultsLabel: string
  onSelect: (item: T) => boolean | void
}

export function SettingsSearch<T extends SearchMenuItem>({
  items,
  placeholder,
  clearLabel,
  noResultsLabel,
  onSelect,
}: SettingsSearchProps<T>) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [hasFocus, setHasFocus] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const activeOptionRef = useRef<HTMLButtonElement>(null)
  const keyboardNavigationRef = useRef(false)
  const results = useMemo(() => filterSettingsSearchItems(items, query).slice(0, 10), [items, query])
  const open = hasFocus && query.trim().length > 0
  const listboxId = useId()
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, results.length - 1))

  useLayoutEffect(() => {
    if (!open) return
    const root = rootRef.current
    const listbox = listboxRef.current
    const dialog = root?.closest<HTMLElement>('[role="dialog"]')
    if (!root || !listbox || !dialog) return

    const updateWidth = () => {
      const rootRect = root.getBoundingClientRect()
      const dialogRect = dialog.getBoundingClientRect()
      const edgeGap = 8
      const roomOnRight = Math.max(rootRect.width, dialogRect.right - rootRect.left - edgeGap)
      const roomOnLeft = Math.max(rootRect.width, rootRect.right - dialogRect.left - edgeGap)
      const alignRight = roomOnLeft > roomOnRight
      const maxWidth = Math.max(rootRect.width, alignRight ? roomOnLeft : roomOnRight)

      listbox.style.width = 'max-content'
      listbox.style.minWidth = `${Math.min(rootRect.width, maxWidth)}px`
      listbox.style.maxWidth = `${maxWidth}px`
      listbox.style.left = alignRight ? 'auto' : '0px'
      listbox.style.right = alignRight ? '0px' : 'auto'
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth)
    observer?.observe(root)
    observer?.observe(dialog)
    return () => {
      window.removeEventListener('resize', updateWidth)
      observer?.disconnect()
    }
  }, [open, results])

  useLayoutEffect(() => {
    if (!open || !keyboardNavigationRef.current || !listboxRef.current || !activeOptionRef.current) return
    scrollItemIntoView(listboxRef.current, activeOptionRef.current)
    keyboardNavigationRef.current = false
  }, [open, safeActiveIndex])

  const select = (item: T) => {
    if (onSelect(item) === false) return
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.blur()
  }

  return (
    <div
      ref={rootRef}
      className="relative z-30"
      onFocusCapture={() => setHasFocus(true)}
      onBlurCapture={event => {
        const nextTarget = event.relatedTarget
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setHasFocus(false)
      }}
      onKeyDownCapture={event => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        setQuery('')
        setActiveIndex(0)
        inputRef.current?.focus()
      }}
    >
      <SearchIcon size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={placeholder}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && results.length > 0 ? `${listboxId}-result-${safeActiveIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={event => {
          keyboardNavigationRef.current = false
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={event => {
          if (results.length === 0) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const direction = event.key === 'ArrowDown' ? 1 : -1
            keyboardNavigationRef.current = true
            setActiveIndex((safeActiveIndex + direction + results.length) % results.length)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            select(results[safeActiveIndex])
          }
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-border-200 bg-transparent pl-8 pr-8 text-[length:var(--fs-sm)] text-text-100 outline-none placeholder:text-text-400 transition-colors hover:border-border-300 focus-visible:border-accent-main-100 focus-visible:ring-1 focus-visible:ring-accent-main-100/30"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            setActiveIndex(0)
            inputRef.current?.focus()
          }}
          aria-label={clearLabel}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-text-400 hover:bg-bg-200/60 hover:text-text-100"
        >
          <CloseIcon size={12} />
        </button>
      )}

      {open && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] max-h-72 min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border-200 bg-bg-000/95 p-1 shadow-xl backdrop-blur-xl custom-scrollbar"
        >
          {results.length === 0 ? (
            <div className="px-2.5 py-3 text-[length:var(--fs-xs)] text-text-400" role="status">
              {noResultsLabel}
            </div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                id={`${listboxId}-result-${index}`}
                ref={index === safeActiveIndex ? activeOptionRef : undefined}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === safeActiveIndex}
                onMouseEnter={() => {
                  keyboardNavigationRef.current = false
                  setActiveIndex(index)
                }}
                onMouseDown={event => event.preventDefault()}
                onClick={() => select(item)}
                className={`flex w-full min-w-0 items-center justify-between gap-3 rounded px-2.5 py-2 text-left transition-colors ${
                  index === safeActiveIndex ? 'bg-bg-200/80' : 'hover:bg-bg-200/50'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--fs-sm)] text-text-100">{item.label}</span>
                  {item.description && (
                    <span className="mt-0.5 block truncate font-mono text-[length:var(--fs-xs)] text-text-400">
                      {item.description}
                    </span>
                  )}
                </span>
                <span
                  className="max-w-[48%] shrink-0 truncate text-[length:var(--fs-xs)] text-text-400"
                  title={item.tabLabel}
                >
                  {item.tabLabel}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
