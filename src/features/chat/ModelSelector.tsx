/**
 * ModelSelector - 统一模型选择器
 *
 * 单一组件同时服务 PC 端（Header）和移动端（InputToolbar）。
 * 通过 props 控制触发按钮样式、弹出方向等差异。
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, SearchIcon, ThinkingIcon, EyeIcon, CheckIcon, PinIcon } from '../../components/Icons'
import { DropdownMenu } from '../../components/ui'
import type { ModelInfo } from '../../api'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import {
  getModelKey,
  groupModelsByProvider,
  getRecentModels,
  recordModelUsage,
  getPinnedModels,
  isModelPinned,
  toggleModelPin,
} from '../../utils/modelUtils'

// ============================================
// Public types
// ============================================

export interface ModelSelectorHandle {
  openMenu: () => void
}

interface ModelSelectorProps {
  models: ModelInfo[]
  selectedModelKey: string | null
  onSelect: (modelKey: string, model: ModelInfo) => void
  isLoading?: boolean
  disabled?: boolean
  /** 弹出方向 */
  position?: 'bottom' | 'top'
  /** 约束菜单边界的容器 ref */
  constrainToRef?: React.RefObject<HTMLElement | null>
  /** 触发按钮的展示风格 */
  trigger?: 'header' | 'toolbar'
}

// ============================================
// Internal types
// ============================================

type FlatListItem =
  | { type: 'header'; data: { name: string }; key: string }
  | { type: 'item'; data: ModelInfo; key: string }

// ============================================
// Flat list hook（分组 + 置顶 + 最近）
// ============================================

function useFlatList(
  models: ModelInfo[],
  filteredModels: ModelInfo[],
  searchQuery: string,
  refreshTrigger: number,
  t: (key: string) => string,
) {
  return useMemo(() => {
    void refreshTrigger

    const groups = groupModelsByProvider(filteredModels)
    const recent = searchQuery ? [] : getRecentModels(models, 5)
    const pinned = searchQuery ? [] : getPinnedModels(models)

    const flat: FlatListItem[] = []
    const addedKeys = new Set<string>()

    if (pinned.length > 0) {
      flat.push({ type: 'header', data: { name: t('modelSelector.pinned') }, key: 'header-pinned' })
      pinned.forEach(m => {
        const key = getModelKey(m)
        flat.push({ type: 'item', data: m, key: `pinned-${key}` })
        addedKeys.add(key)
      })
    }

    if (recent.length > 0) {
      const recentFiltered = recent.filter(m => !addedKeys.has(getModelKey(m)))
      if (recentFiltered.length > 0) {
        flat.push({ type: 'header', data: { name: t('modelSelector.recent') }, key: 'header-recent' })
        recentFiltered.forEach(m => {
          const key = getModelKey(m)
          flat.push({ type: 'item', data: m, key: `recent-${key}` })
          addedKeys.add(key)
        })
      }
    }

    groups.forEach(g => {
      const groupModels = g.models.filter(m => !addedKeys.has(getModelKey(m)))
      if (groupModels.length > 0) {
        flat.push({ type: 'header', data: { name: g.providerName }, key: `header-${g.providerId}` })
        groupModels.forEach(m => flat.push({ type: 'item', data: m, key: getModelKey(m) }))
      }
    })

    return flat
  }, [filteredModels, models, searchQuery, refreshTrigger, t])
}

// ============================================
// ModelListPanel — 列表面板
// ============================================

interface ModelListPanelProps {
  menuRef: React.RefObject<HTMLDivElement | null>
  searchInputRef: React.RefObject<HTMLInputElement | null>
  listRef: React.RefObject<HTMLDivElement | null>
  searchQuery: string
  setSearchQuery: (q: string) => void
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>
  handleKeyDown: (e: React.KeyboardEvent) => void
  flatList: FlatListItem[]
  itemIndices: number[]
  highlightedIndex: number
  selectedModelKey: string | null
  onItemClick: (model: ModelInfo) => void
  onTogglePin: (e: React.MouseEvent, model: ModelInfo) => void
  onTouchStart?: (model: ModelInfo) => void
  onTouchEnd?: () => void
  ignoreMouseRef: React.RefObject<boolean>
  lastMousePosRef: React.RefObject<{ x: number; y: number }>
  idPrefix: string
  maxListHeight: string
  searchPlaceholder: string
  noResultsText: string
  noResultsHint: string
  preferTouchUi: boolean
}

const ModelListPanel = memo(function ModelListPanel({
  menuRef,
  searchInputRef,
  listRef,
  searchQuery,
  setSearchQuery,
  setHighlightedIndex,
  handleKeyDown,
  flatList,
  itemIndices,
  highlightedIndex,
  selectedModelKey,
  onItemClick,
  onTogglePin,
  onTouchStart,
  onTouchEnd,
  ignoreMouseRef,
  lastMousePosRef,
  idPrefix,
  maxListHeight,
  searchPlaceholder,
  noResultsText,
  noResultsHint,
  preferTouchUi,
}: ModelListPanelProps) {
  return (
    <div ref={menuRef} onKeyDown={handleKeyDown} className="flex flex-col min-h-0 pt-1.5">
      {/* 搜索栏 */}
      <div className="shrink-0 px-2 pb-1.5">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-bg-200/40 transition-colors focus-within:bg-bg-200/60">
          <SearchIcon className="w-3.5 h-3.5 text-text-400 flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value)
              setHighlightedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent border-none outline-none text-[length:var(--fs-base)] text-text-100 placeholder:text-text-400"
          />
        </div>
      </div>

      {/* 列表 — 左侧 padding 给内容，右侧留给滚动条不覆盖内容 */}
      <div ref={listRef} className={`overflow-y-auto custom-scrollbar flex-1 min-h-0 pl-2 pr-1 ${maxListHeight}`}>
        {flatList.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-[length:var(--fs-base)] text-text-400">{noResultsText}</div>
            <div className="text-[length:var(--fs-sm)] text-text-500 mt-1">{noResultsHint}</div>
          </div>
        ) : (
          <div className="pb-1 pr-1">
            {flatList.map((item, index) => {
              if (item.type === 'header') {
                return (
                  <div
                    key={item.key}
                    className="px-2.5 pt-3 pb-1 first:pt-0.5 text-[length:var(--fs-xxs)] font-semibold text-text-400/60 uppercase tracking-wider select-none"
                  >
                    {item.data.name}
                  </div>
                )
              }

              const model = item.data as ModelInfo
              const itemKey = getModelKey(model)
              const isSelected = selectedModelKey === itemKey
              const isHL = itemIndices[highlightedIndex] === index
              const pinned = isModelPinned(model)

              return (
                <div
                  key={item.key}
                  id={`${idPrefix}-${index}`}
                  onClick={() => onItemClick(model)}
                  onTouchStart={onTouchStart ? () => onTouchStart(model) : undefined}
                  onTouchEnd={onTouchEnd}
                  onTouchMove={onTouchEnd}
                  title={`${model.name} · ${model.providerName}${model.contextLimit ? ` · ${formatContext(model.contextLimit)}` : ''}`}
                  onMouseMove={e => {
                    if (ignoreMouseRef.current) return
                    if (e.clientX === lastMousePosRef.current.x && e.clientY === lastMousePosRef.current.y) return
                    lastMousePosRef.current = { x: e.clientX, y: e.clientY }
                    const hIndex = itemIndices.indexOf(index)
                    if (hIndex !== -1 && hIndex !== highlightedIndex) setHighlightedIndex(hIndex)
                  }}
                  className={`
                    group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-[length:var(--fs-base)] font-sans transition-colors duration-100 select-none
                    ${isSelected ? 'bg-accent-main-100/10 text-accent-main-100' : 'text-text-200'}
                    ${isHL && !isSelected ? 'bg-bg-200/40 text-text-100' : ''}
                  `}
                >
                  {/* Left: name + capability icons */}
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <span className={`truncate font-medium ${isSelected ? 'text-accent-main-100' : 'text-text-100'}`}>
                      {model.name}
                    </span>
                    <div
                      className={`flex items-center gap-1 flex-shrink-0 transition-opacity ${isHL || isSelected ? 'opacity-60' : 'opacity-25'}`}
                    >
                      {model.supportsReasoning && <ThinkingIcon size={12} />}
                      {model.supportsImages && <EyeIcon size={13} />}
                    </div>
                  </div>

                  {/* Right: provider + context + trailing icon (check / pin, mutually exclusive) */}
                  <div className="flex items-center gap-2 text-[length:var(--fs-sm)] font-mono flex-shrink-0">
                    <span className="text-text-500 max-w-[100px] truncate text-right">{model.providerName}</span>
                    {model.contextLimit > 0 && (
                      <span className="text-text-500 w-[4ch] text-right hidden sm:inline">
                        {formatContext(model.contextLimit)}
                      </span>
                    )}
                    {/*
                     * 末尾图标位：选中 / 已钉住 / hover pin 共享同一个固定宽度位置
                     * 优先级：选中对勾 > 已钉住图标 > hover 时渐现的 pin 按钮
                     */}
                    <span className="w-5 flex items-center justify-center flex-shrink-0">
                      {isSelected ? (
                        <span className="text-accent-secondary-100">
                          <CheckIcon />
                        </span>
                      ) : preferTouchUi ? (
                        // 触摸设备：已钉住时显示钉子图标（长按切换）
                        pinned ? (
                          <span className="text-accent-main-100/60">
                            <PinIcon size={12} />
                          </span>
                        ) : null
                      ) : (
                        // 鼠标设备：已钉住常驻，未钉住 hover 渐现
                        <button
                          onClick={e => onTogglePin(e, model)}
                          className={`p-0.5 rounded transition-all duration-150 ${
                            pinned
                              ? 'text-accent-main-100 opacity-80 hover:opacity-100'
                              : 'text-text-500 opacity-0 group-hover:opacity-40 hover:!opacity-100'
                          }`}
                        >
                          <PinIcon size={12} />
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

function formatContext(limit: number): string {
  if (!limit) return ''
  const k = Math.round(limit / 1000)
  if (k >= 1000) return `${(k / 1000).toFixed(0)}M`
  return `${k}k`
}

// ============================================
// ModelSelector — 统一组件
// ============================================

export const ModelSelector = memo(
  forwardRef<ModelSelectorHandle, ModelSelectorProps>(function ModelSelector(
    {
      models,
      selectedModelKey,
      onSelect,
      isLoading = false,
      disabled = false,
      position = 'bottom',
      constrainToRef,
      trigger = 'header',
    },
    ref,
  ) {
    const { t } = useTranslation('chat')
    const { preferTouchUi } = useInputCapabilities()
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [highlightedIndex, setHighlightedIndex] = useState(0)
    const [refreshTrigger, setRefreshTrigger] = useState(0)

    const containerRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const ignoreMouseRef = useRef(false)
    const lastMousePosRef = useRef({ x: 0, y: 0 })

    const idPrefix = trigger === 'header' ? 'ms-item' : 'ms-tb-item'

    // ---- Derived data ----

    const filteredModels = useMemo(() => {
      if (!searchQuery.trim()) return models
      const query = searchQuery.toLowerCase()
      const normalize = (value: unknown) => (typeof value === 'string' ? value : '').toLowerCase()
      return models.filter(
        m =>
          normalize(m.name).includes(query) ||
          normalize(m.id).includes(query) ||
          normalize(m.family).includes(query) ||
          normalize(m.providerName).includes(query),
      )
    }, [models, searchQuery])

    const flatList = useFlatList(models, filteredModels, searchQuery, refreshTrigger, t)

    const itemIndices = useMemo(() => {
      return flatList.map((item, index) => (item.type === 'item' ? index : -1)).filter(i => i !== -1)
    }, [flatList])

    const selectedModel = useMemo(() => {
      if (!selectedModelKey) return null
      return models.find(m => getModelKey(m) === selectedModelKey) ?? null
    }, [models, selectedModelKey])

    const displayName =
      trigger === 'header'
        ? selectedModel?.name || t('modelSelector.selectModel')
        : selectedModel?.name || (isLoading ? '...' : t('modelSelector.model'))

    // ---- Open / Close ----

    const openMenu = useCallback(() => {
      if (disabled || isLoading) return
      let targetIndex = 0
      if (selectedModelKey) {
        const index = flatList.findIndex(item => item.type === 'item' && getModelKey(item.data) === selectedModelKey)
        if (index !== -1) {
          const interactiveIndex = itemIndices.indexOf(index)
          if (interactiveIndex !== -1) targetIndex = interactiveIndex
        }
      }
      setHighlightedIndex(targetIndex)
      setIsOpen(true)
      setSearchQuery('')
      ignoreMouseRef.current = true
      setTimeout(() => {
        ignoreMouseRef.current = false
      }, 300)
    }, [disabled, isLoading, selectedModelKey, flatList, itemIndices])

    const closeMenu = useCallback(() => {
      setIsOpen(false)
      setSearchQuery('')
      if (trigger === 'header') triggerRef.current?.focus()
    }, [trigger])

    useImperativeHandle(ref, () => ({ openMenu }), [openMenu])

    // ---- Select / Pin ----

    const handleSelect = useCallback(
      (model: ModelInfo) => {
        const key = getModelKey(model)
        recordModelUsage(model)
        onSelect(key, model)
        closeMenu()
        setRefreshTrigger(c => c + 1)
      },
      [onSelect, closeMenu],
    )

    const handleTogglePin = useCallback((e: React.MouseEvent, model: ModelInfo) => {
      e.stopPropagation()
      toggleModelPin(model)
      setRefreshTrigger(c => c + 1)
    }, [])

    // ---- Long press to pin (touch devices) ----

    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const longPressFiredRef = useRef(false)

    const handleTouchStart = useCallback((model: ModelInfo) => {
      longPressFiredRef.current = false
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true
        toggleModelPin(model)
        setRefreshTrigger(c => c + 1)
        if (navigator.vibrate) navigator.vibrate(30)
      }, 500)
    }, [])

    const handleTouchEnd = useCallback(() => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }, [])

    const handleItemClick = useCallback(
      (model: ModelInfo) => {
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false
          return
        }
        handleSelect(model)
      },
      [handleSelect],
    )

    // ---- Side effects ----

    useEffect(() => {
      if (isOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
    }, [isOpen])

    useEffect(() => {
      if (!isOpen) return
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node
        if (
          containerRef.current &&
          !containerRef.current.contains(target) &&
          menuRef.current &&
          !menuRef.current.contains(target)
        ) {
          closeMenu()
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [isOpen, closeMenu])

    useEffect(() => {
      if (!isOpen) return
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          closeMenu()
        }
      }
      document.addEventListener('keydown', handleEsc, { capture: true })
      return () => document.removeEventListener('keydown', handleEsc, { capture: true })
    }, [isOpen, closeMenu])

    useEffect(() => {
      if (!isOpen) return
      requestAnimationFrame(() => {
        const realIndex = itemIndices[highlightedIndex]
        document.getElementById(`${idPrefix}-${realIndex}`)?.scrollIntoView({ block: 'nearest' })
      })
    }, [isOpen, highlightedIndex, itemIndices, idPrefix])

    // ---- Keyboard navigation ----

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        e.stopPropagation()
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            setHighlightedIndex(prev => {
              const next = Math.min(prev + 1, itemIndices.length - 1)
              document.getElementById(`${idPrefix}-${itemIndices[next]}`)?.scrollIntoView({ block: 'nearest' })
              return next
            })
            break
          case 'ArrowUp':
            e.preventDefault()
            setHighlightedIndex(prev => {
              const next = Math.max(prev - 1, 0)
              document.getElementById(`${idPrefix}-${itemIndices[next]}`)?.scrollIntoView({ block: 'nearest' })
              return next
            })
            break
          case 'Enter': {
            e.preventDefault()
            const globalIndex = itemIndices[highlightedIndex]
            const item = flatList[globalIndex]
            if (item && item.type === 'item') handleSelect(item.data)
            break
          }
          case 'Escape':
            e.preventDefault()
            closeMenu()
            break
        }
      },
      [itemIndices, flatList, highlightedIndex, handleSelect, closeMenu, idPrefix],
    )

    // ---- Trigger button ----

    const triggerButton =
      trigger === 'header' ? (
        <button
          ref={triggerRef}
          onClick={() => (isOpen ? closeMenu() : openMenu())}
          disabled={disabled || isLoading}
          className="group flex items-center gap-2 px-2 py-1.5 text-text-200 rounded-lg hover:bg-bg-200 hover:text-text-100 transition-all duration-150 active:scale-95 cursor-pointer text-[length:var(--fs-base)]"
          title={displayName}
        >
          <span className="font-medium truncate max-w-[240px]">{displayName}</span>
          <div className={`opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
            <ChevronDownIcon size={10} />
          </div>
        </button>
      ) : (
        <button
          ref={triggerRef}
          onClick={() => (isOpen ? closeMenu() : openMenu())}
          disabled={disabled || isLoading}
          className="flex items-center px-2 py-1.5 text-[length:var(--fs-base)] rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer min-w-0 overflow-hidden w-full"
          title={selectedModel?.name || t('modelSelector.selectModel')}
        >
          <span className="text-[length:var(--fs-sm)] text-text-300 truncate">{displayName}</span>
        </button>
      )

    // ---- Dropdown config ----

    const dropdownMaxH = position === 'top' ? 'max-h-[min(360px,45vh)]' : 'max-h-[min(600px,70vh)]'
    const listMaxH = position === 'top' ? 'max-h-[min(320px,40vh)]' : 'max-h-[min(500px,60vh)]'

    // ---- Render ----

    return (
      <div
        ref={containerRef}
        className={`relative font-sans ${trigger === 'toolbar' ? 'min-w-0 overflow-hidden' : ''}`}
        data-dropdown-open={isOpen || undefined}
      >
        {triggerButton}

        <DropdownMenu
          triggerRef={triggerRef}
          isOpen={isOpen}
          position={position}
          align="left"
          width="460px"
          minWidth="280px"
          maxWidth="min(460px, calc(100vw - 24px))"
          mobileFullWidth
          constrainToRef={constrainToRef}
          className={`!p-0 overflow-hidden flex flex-col ${dropdownMaxH}`}
        >
          <ModelListPanel
            menuRef={menuRef}
            searchInputRef={searchInputRef}
            listRef={listRef}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setHighlightedIndex={setHighlightedIndex}
            handleKeyDown={handleKeyDown}
            flatList={flatList}
            itemIndices={itemIndices}
            highlightedIndex={highlightedIndex}
            selectedModelKey={selectedModelKey}
            onItemClick={handleItemClick}
            onTogglePin={handleTogglePin}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            ignoreMouseRef={ignoreMouseRef}
            lastMousePosRef={lastMousePosRef}
            idPrefix={idPrefix}
            maxListHeight={listMaxH}
            searchPlaceholder={t('modelSelector.searchModels')}
            noResultsText={t('modelSelector.noModelsFound')}
            noResultsHint={t('modelSelector.tryDifferentKeyword')}
            preferTouchUi={preferTouchUi}
          />
        </DropdownMenu>
      </div>
    )
  }),
)
