import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from '../../../components/Icons'
import { useTheme } from '../../../hooks'
import { AVAILABLE_CODE_BLOCK_THEMES, filterThemesByType, type CodeBlockThemeInfo } from '../../../lib/codeBlockThemes'
import { highlightHtmlInWorker } from '../../../lib/shikiWorkerClient'
// 配置编辑器（configEditorControls）已在阶段 3b 删除，这里改用 SettingsUI 的等价样式常量
import { SegmentedControl, SettingRow, SettingsSection, settingsFieldClass as fieldClass } from './SettingsUI'

const PREVIEW_CODE = `// greet user by name
function greet(name: string): string {
  const message = \`Hello, \${name}!\`
  return message
}

const result = greet("world")
console.log(result)`

const PREVIEW_LANGUAGE = 'ts'

function themeDisplayName(id: string): string {
  return AVAILABLE_CODE_BLOCK_THEMES.find(t => t.id === id)?.displayName ?? id
}

function matchesThemeQuery(theme: CodeBlockThemeInfo, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return theme.displayName.toLowerCase().includes(q) || theme.id.toLowerCase().includes(q)
}

function CodeBlockThemeSelect({
  value,
  onChange,
  type,
  ariaLabel,
  sameTypeLabel,
  otherTypeLabel,
  searchPlaceholder,
}: {
  value: string
  onChange: (id: string) => void
  type: 'light' | 'dark'
  ariaLabel: string
  sameTypeLabel: string
  otherTypeLabel: string
  searchPlaceholder: string
}) {
  const { t } = useTranslation(['settings', 'common'])
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<React.CSSProperties>({})

  const sameType = useMemo(() => filterThemesByType(type), [type])
  const otherType = useMemo(() => filterThemesByType(type === 'light' ? 'dark' : 'light'), [type])
  const display = themeDisplayName(value)
  const query = open ? draft : ''

  const filteredSame = useMemo(() => sameType.filter(theme => matchesThemeQuery(theme, query)), [sameType, query])
  const filteredOther = useMemo(() => otherType.filter(theme => matchesThemeQuery(theme, query)), [otherType, query])
  const filteredAll = useMemo(() => [...filteredSame, ...filteredOther], [filteredSame, filteredOther])
  const hasResults = filteredAll.length > 0

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom
    const openUp = below < 280 && rect.top > below
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16)
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8)
    setPos({
      left,
      width,
      maxWidth: 'calc(100vw - 16px)',
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(place)
    const onDown = (event: PointerEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return
      if (menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onScroll = () => place()
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
      cancelAnimationFrame(raf)
    }
  }, [open, place])

  const selectTheme = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const renderGroup = (label: string, themes: readonly CodeBlockThemeInfo[]) => {
    if (themes.length === 0) return null
    return (
      <div>
        <div className="px-2.5 py-1.5 text-[length:var(--fs-xxs)] font-medium uppercase tracking-wider text-text-400">
          {label}
        </div>
        {themes.map(theme => (
          <button
            key={theme.id}
            type="button"
            role="option"
            aria-selected={theme.id === value}
            onClick={() => selectTheme(theme.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[length:var(--fs-sm)] transition-colors ${
              theme.id === value ? 'bg-bg-200 text-text-100' : 'text-text-100 hover:bg-bg-100'
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate">{theme.displayName}</span>
              <span className="mt-0.5 block truncate text-[length:var(--fs-xs)] text-text-400">{theme.id}</span>
            </span>
            {theme.id === value && <CheckIcon size={14} className="shrink-0 text-text-200" />}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div ref={triggerRef} className="relative w-[13.5rem] max-w-[min(13.5rem,42vw)] shrink-0">
      {open ? (
        <input
          autoFocus
          role="combobox"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={ariaLabel}
          value={draft}
          placeholder={display || searchPlaceholder}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              if (filteredAll[0]) selectTheme(filteredAll[0].id)
              else setOpen(false)
            }
          }}
          className={`${fieldClass} pr-9`}
        />
      ) : (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={ariaLabel}
          onClick={() => {
            setDraft('')
            setOpen(true)
          }}
          onKeyDown={event => {
            if (event.key === 'Escape' && open) {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
            }
          }}
          className={`${fieldClass} flex items-center justify-between gap-2 text-left`}
        >
          <span className="truncate">{display}</span>
          <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
        </button>
      )}

      {open && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('common:close')}
          onClick={() => setOpen(false)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-text-300 transition-colors hover:bg-bg-100 hover:text-text-100"
        >
          <ChevronDownIcon size={14} />
        </button>
      )}

      {open &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[400] max-h-64 overflow-y-auto rounded-lg border border-border-200 glass p-1 shadow-lg custom-scrollbar"
            style={pos}
          >
            {!hasResults && (
              <div className="px-3 py-2.5 text-[length:var(--fs-xs)] text-text-400">{t('common:noMatches')}</div>
            )}
            {renderGroup(sameTypeLabel, filteredSame)}
            {filteredSame.length > 0 && filteredOther.length > 0 && (
              <div className="my-1 border-t border-border-200/30" />
            )}
            {renderGroup(otherTypeLabel, filteredOther)}
          </div>,
          document.body,
        )}
    </div>
  )
}

function CodeBlockPreview({
  themeId,
  mode,
  onModeChange,
}: {
  themeId: string
  mode: 'light' | 'dark'
  onModeChange: (mode: 'light' | 'dark') => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestKeyRef = useRef(0)

  useEffect(() => {
    const key = `preview-${mode}-${themeId}`
    const myKey = ++requestKeyRef.current
    let cancelled = false

    highlightHtmlInWorker({
      key,
      text: PREVIEW_CODE,
      language: PREVIEW_LANGUAGE,
      theme: themeId as Parameters<typeof highlightHtmlInWorker>[0]['theme'],
    })
      .then(result => {
        if (cancelled || myKey !== requestKeyRef.current) return
        setHtml(result.html)
        setError(null)
      })
      .catch(err => {
        if (cancelled || myKey !== requestKeyRef.current) return
        setError(err instanceof Error ? err.message : String(err))
        setHtml(null)
      })

    return () => {
      cancelled = true
    }
  }, [themeId, mode])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[length:var(--fs-sm)] font-medium text-text-100">{t('appearance.codeBlockPreview')}</p>
          <p className="mt-0.5 truncate text-[length:var(--fs-xs)] text-text-400">{themeDisplayName(themeId)}</p>
        </div>
        <div className="w-[9.5rem] shrink-0">
          <SegmentedControl
            value={mode}
            options={[
              { value: 'light', label: t('appearance.codeBlockPreviewLight') },
              { value: 'dark', label: t('appearance.codeBlockPreviewDark') },
            ]}
            onChange={onModeChange}
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border-200/50 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)]">
        {html ? (
          <div className="shiki-preview-container overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
        ) : error ? (
          <div className="bg-bg-200/40 px-3 py-2 text-text-400">{error}</div>
        ) : (
          <pre className="bg-bg-200/40 px-3 py-2 text-text-400">
            <code>{PREVIEW_CODE}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

export function CodeBlockThemeSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const { codeBlockThemeLight, codeBlockThemeDark, setCodeBlockThemeLight, setCodeBlockThemeDark, resolvedTheme } =
    useTheme()
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>(resolvedTheme === 'dark' ? 'dark' : 'light')

  const lightGroupLabel = t('appearance.codeBlockThemeGroupLight')
  const darkGroupLabel = t('appearance.codeBlockThemeGroupDark')
  const searchPlaceholder = t('appearance.codeBlockThemeSearch')
  const previewThemeId = previewMode === 'dark' ? codeBlockThemeDark : codeBlockThemeLight

  return (
    <SettingsSection title={t('appearance.codeBlockThemes')} description={t('appearance.codeBlockThemesDesc')}>
      <SettingRow label={t('appearance.codeBlockThemeLight')} description={t('appearance.codeBlockThemeLightDesc')}>
        <CodeBlockThemeSelect
          value={codeBlockThemeLight}
          onChange={setCodeBlockThemeLight}
          type="light"
          ariaLabel={t('appearance.codeBlockThemeLight')}
          sameTypeLabel={lightGroupLabel}
          otherTypeLabel={darkGroupLabel}
          searchPlaceholder={searchPlaceholder}
        />
      </SettingRow>

      <SettingRow label={t('appearance.codeBlockThemeDark')} description={t('appearance.codeBlockThemeDarkDesc')}>
        <CodeBlockThemeSelect
          value={codeBlockThemeDark}
          onChange={setCodeBlockThemeDark}
          type="dark"
          ariaLabel={t('appearance.codeBlockThemeDark')}
          sameTypeLabel={darkGroupLabel}
          otherTypeLabel={lightGroupLabel}
          searchPlaceholder={searchPlaceholder}
        />
      </SettingRow>

      <CodeBlockPreview themeId={previewThemeId} mode={previewMode} onModeChange={setPreviewMode} />
    </SettingsSection>
  )
}
