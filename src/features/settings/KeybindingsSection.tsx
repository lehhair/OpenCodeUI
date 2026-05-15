/**
 * KeybindingsSection - 快捷键设置
 * 简洁平铺列表，无 emoji，搜索即过滤
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useKeybindingStore } from '../../hooks/useKeybindings'
import { keyEventToString, formatKeybinding, parseKeybinding } from '../../store/keybindingStore'
import { UndoIcon, SearchIcon } from '../../components/Icons'
import type { KeybindingConfig, KeybindingAction } from '../../store/keybindingStore'

const ACTION_TRANSLATION_KEYS: Record<KeybindingAction, { label: string; description: string }> = {
  openSettings: { label: 'openSettings', description: 'openSettingsDesc' },
  openProject: { label: 'openProject', description: 'openProjectDesc' },
  commandPalette: { label: 'commandPalette', description: 'commandPaletteDesc' },
  toggleSidebar: { label: 'toggleSidebar', description: 'toggleSidebarDesc' },
  toggleRightPanel: { label: 'toggleRightPanel', description: 'toggleRightPanelDesc' },
  focusInput: { label: 'focusInput', description: 'focusInputDesc' },
  newSession: { label: 'newSession', description: 'newSessionDesc' },
  archiveSession: { label: 'archiveSession', description: 'archiveSessionDesc' },
  previousSession: { label: 'previousSession', description: 'previousSessionDesc' },
  nextSession: { label: 'nextSession', description: 'nextSessionDesc' },
  toggleTerminal: { label: 'toggleTerminal', description: 'toggleTerminalDesc' },
  newTerminal: { label: 'newTerminal', description: 'newTerminalDesc' },
  'terminal.copySelection': { label: 'terminalCopySelection', description: 'terminalCopySelectionDesc' },
  'terminal.paste': { label: 'terminalPaste', description: 'terminalPasteDesc' },
  selectModel: { label: 'selectModel', description: 'selectModelDesc' },
  toggleAgent: { label: 'toggleAgent', description: 'toggleAgentDesc' },
  sendMessage: { label: 'sendMessage', description: 'sendMessageDesc' },
  cancelMessage: { label: 'cancelMessage', description: 'cancelMessageDesc' },
  copyLastResponse: { label: 'copyLastResponse', description: 'copyLastResponseDesc' },
  toggleFullAuto: { label: 'toggleFullAuto', description: 'toggleFullAutoDesc' },
  focusNextPane: { label: 'focusNextPane', description: 'focusNextPaneDesc' },
  focusPrevPane: { label: 'focusPrevPane', description: 'focusPrevPaneDesc' },
  splitRight: { label: 'splitRight', description: 'splitRightDesc' },
  splitDown: { label: 'splitDown', description: 'splitDownDesc' },
  closePane: { label: 'closePane', description: 'closePaneDesc' },
  togglePaneFullscreen: { label: 'togglePaneFullscreen', description: 'togglePaneFullscreenDesc' },
}

// ============================================
// Kbd - 按键胶囊
// ============================================

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5
                    text-[length:var(--fs-xs)] font-mono font-medium leading-none
                    bg-bg-100 text-text-300 border border-border-200 rounded
                    shadow-[0_1px_0_0_var(--border-200)]"
    >
      {children}
    </kbd>
  )
}

function ShortcutDisplay({ shortcut, className }: { shortcut: string; className?: string }) {
  const parsed = parseKeybinding(shortcut)
  const formatted = formatKeybinding(parsed)
  const parts = formatted.split(' + ')
  return (
    <span className={`inline-flex items-center gap-0.5 ${className || ''}`}>
      {parts.map((p, i) => (
        <Kbd key={i}>{p}</Kbd>
      ))}
    </span>
  )
}

// ============================================
// KeybindingRow - 单行编辑
// ============================================

interface KeybindingRowProps {
  config: KeybindingConfig
  onEdit: (action: KeybindingAction, newKey: string) => void
  onReset: (action: KeybindingAction) => void
  isKeyUsed: (key: string, exclude?: KeybindingAction, scope?: KeybindingConfig['scope']) => boolean
  t: (key: string) => string
}

function KeybindingRow({ config, onEdit, onReset, isKeyUsed, t }: KeybindingRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [tempKey, setTempKey] = useState('')
  const [error, setError] = useState('')
  const captureRef = useRef<HTMLDivElement>(null)
  const isModified = config.currentKey !== config.defaultKey

  useEffect(() => {
    if (isEditing) captureRef.current?.focus()
  }, [isEditing])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return

      const newKey = keyEventToString(e)
      setTempKey(newKey)
      setError(isKeyUsed(newKey, config.action, config.scope) ? t('keybindings.alreadyInUse') : '')
    },
    [isKeyUsed, config.action, config.scope, t],
  )

  const confirm = useCallback(() => {
    if (tempKey && !error) onEdit(config.action, tempKey)
    setIsEditing(false)
    setTempKey('')
    setError('')
  }, [tempKey, error, onEdit, config.action])

  const cancel = useCallback(() => {
    setIsEditing(false)
    setTempKey('')
    setError('')
  }, [])

  useEffect(() => {
    if (!isEditing) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
        return
      }
      if (e.key === 'Enter' && tempKey && !error) {
        e.preventDefault()
        confirm()
        return
      }
      handleKeyDown(e)
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [isEditing, tempKey, error, handleKeyDown, confirm, cancel])

  return (
    <div
      className={`
      flex items-center h-9 px-3 rounded-md transition-colors group
      ${isEditing ? 'bg-accent-main-100/5 ring-1 ring-accent-main-100/20' : 'hover:bg-bg-100/60'}
    `}
    >
      {/* Label */}
      <span className="flex-1 text-[length:var(--fs-md)] text-text-200 truncate">{config.label}</span>

      {/* Reset */}
      {isModified && !isEditing && (
        <button
          onClick={() => onReset(config.action)}
          className="p-1 mr-1 rounded text-text-400 hover:text-text-100 hover:bg-bg-200 
                     opacity-0 group-hover:opacity-100 transition-opacity"
          title={t('keybindings.resetToDefault')}
        >
          <UndoIcon size={12} />
        </button>
      )}

      {/* Key */}
      {isEditing ? (
        <div className="flex items-center gap-2">
          <div
            ref={captureRef}
            tabIndex={0}
            className={`
              min-w-[120px] h-7 flex items-center justify-center px-3 
              text-[length:var(--fs-sm)] font-mono rounded border-2 outline-none
              ${
                error
                  ? 'border-danger-100/60 bg-danger-100/5 text-danger-100'
                  : 'border-accent-main-100/60 bg-accent-main-100/5 text-accent-main-100'
              }
            `}
          >
            {tempKey || <span className="text-text-400">...</span>}
          </div>
          {error && <span className="text-[length:var(--fs-xs)] text-danger-100">{error}</span>}
        </div>
      ) : (
        <button
          onClick={() => {
            setIsEditing(true)
            setTempKey('')
            setError('')
          }}
          className={`
            h-7 flex items-center gap-0.5 px-1 rounded transition-colors
            ${isModified ? 'hover:bg-accent-main-100/10' : 'hover:bg-bg-200/60'}
          `}
        >
          <ShortcutDisplay
            shortcut={config.currentKey}
            className={isModified ? '[&_kbd]:border-accent-main-100/40 [&_kbd]:text-accent-main-100' : ''}
          />
        </button>
      )}
    </div>
  )
}

// ============================================
// Main
// ============================================

const CATEGORY_ORDER: KeybindingConfig['category'][] = [
  'general',
  'session',
  'pane',
  'terminal',
  'model',
  'message',
  'permission',
]

const CATEGORY_LABELS: Record<KeybindingConfig['category'], string> = {
  general: 'keybindings.categories.general',
  session: 'keybindings.categories.session',
  pane: 'keybindings.categories.pane',
  terminal: 'keybindings.categories.terminal',
  model: 'keybindings.categories.model',
  message: 'keybindings.categories.message',
  permission: 'keybindings.categories.permission',
}

export function KeybindingsSection() {
  const { t } = useTranslation(['settings', 'common', 'commands'])
  const { keybindings, setKeybinding, resetKeybinding, resetAll, isKeyUsed } = useKeybindingStore()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const localizedKeybindings = useMemo(
    () =>
      keybindings.map(kb => ({
        ...kb,
        label: t(`commands:${ACTION_TRANSLATION_KEYS[kb.action].label}`),
        description: t(`commands:${ACTION_TRANSLATION_KEYS[kb.action].description}`),
      })),
    [keybindings, t],
  )

  // 搜索直接过滤，不需要 toggle
  const filtered = useMemo(() => {
    if (!search.trim()) return localizedKeybindings
    const q = search.toLowerCase()
    return localizedKeybindings.filter(
      kb =>
        kb.label.toLowerCase().includes(q) ||
        kb.description.toLowerCase().includes(q) ||
        kb.currentKey.toLowerCase().includes(q),
    )
  }, [localizedKeybindings, search])

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map(cat => ({ category: cat, items: filtered.filter(kb => kb.category === cat) })).filter(
        g => g.items.length > 0,
      ),
    [filtered],
  )

  const hasModifications = localizedKeybindings.some(kb => kb.currentKey !== kb.defaultKey)

  // 自动聚焦搜索
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[length:var(--fs-sm)] font-medium text-text-400 uppercase tracking-wider">{t('keybindings.title')}</span>
        {hasModifications && (
          <button
            onClick={resetAll}
            className="text-[length:var(--fs-xs)] text-text-400 hover:text-danger-100 px-2 py-0.5 rounded hover:bg-danger-100/10 transition-colors"
          >
            {t('keybindings.resetAll')}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-400 pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('keybindings.filterPlaceholder')}
          className="w-full h-8 pl-8 pr-3 text-[length:var(--fs-md)] bg-bg-050 border border-border-200 rounded-lg
                     text-text-100 placeholder:text-text-400 
                     focus:outline-none focus:border-accent-main-100/50 transition-colors"
        />
      </div>

      {/* List - no inner scroll, parent handles scrolling */}
      <div className="-mx-1">
        {grouped.length === 0 ? (
          <div className="py-8 text-center text-[length:var(--fs-base)] text-text-400">{t('common:noMatches')}</div>
        ) : (
          grouped.map(({ category, items }) => (
            <div key={category} className="mb-3">
              <div className="px-3 py-1 text-[length:var(--fs-xs)] font-medium text-text-400 uppercase tracking-wider">
                {t(CATEGORY_LABELS[category])}
              </div>
              {items.map(item => (
                <KeybindingRow
                  key={item.action}
                  config={item}
                  onEdit={setKeybinding}
                  onReset={resetKeybinding}
                  isKeyUsed={isKeyUsed}
                  t={t}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Help */}
      <div className="pt-3 mt-2 border-t border-border-100/50 text-[length:var(--fs-xs)] text-text-400">
        {t('keybindings.clickToRebind')}
      </div>
    </div>
  )
}
