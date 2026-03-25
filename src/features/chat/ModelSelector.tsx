/**
 * ModelSelector - 模型选择器
 * 毛玻璃风格：无生硬分隔线，分组标签内联，列表上下渐隐遮罩
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, SearchIcon, ThinkingIcon, EyeIcon, CheckIcon, PinIcon } from '../../components/Icons'
import { DropdownMenu } from '../../components/ui'
import type { ModelInfo } from '../../api'
import {
  getModelKey,
  groupModelsByProvider,
  getRecentModels,
  recordModelUsage,
  getPinnedModels,
  isModelPinned,
  toggleModelPin,
} from '../../utils/modelUtils'

interface ModelSelectorProps {
  models: ModelInfo[]
  selectedModelKey: string | null
  onSelect: (modelKey: string, model: ModelInfo) => void
  isLoading?: boolean
  disabled?: boolean
}

export interface ModelSelectorHandle {
  openMenu: () => void
}

type FlatListItem =
  | { type: 'header'; data: { name: string }; key: string }
  | { type: 'item'; data: ModelInfo; key: string }

// ============================================
// 共用的分组数据 hook
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
// 共用的列表渲染组件
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
  onTogglePin?: (e: React.MouseEvent, model: ModelInfo) => void
  onTouchStart?: (model: ModelInfo) => void
  onTouchEnd?: () => void
  ignoreMouseRef: React.RefObject<boolean>
  lastMousePosRef: React.RefObject<{ x: number; y: number }>
  idPrefix: string
  maxListHeight: string
  searchPlaceholder: string
  noResultsText: string
  noResultsHint: string
  /** PC 端显示 provider 列、context 列、pin 按钮 */
  showMeta?: boolean
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
  showMeta = false,
}: ModelListPanelProps) {
  return (
    <div ref={menuRef} onKeyDown={handleKeyDown} className="flex flex-col min-h-0 px-1.5 pt-1.5">
      {/* 搜索栏 — 固定在顶部，不参与滚动 */}
      <div className="shrink-0 px-0.5 pb-1.5">
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
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-100 placeholder:text-text-400"
          />
        </div>
      </div>

      {/* 列表 — 中间唯一滚动区域 */}
      <div ref={listRef} className={`overflow-y-auto custom-scrollbar flex-1 min-h-0 ${maxListHeight}`}>
        {flatList.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-sm text-text-400">{noResultsText}</div>
            <div className="text-xs text-text-500 mt-1">{noResultsHint}</div>
          </div>
        ) : (
          <div className="px-0.5 pb-1">
            {flatList.map((item, index) => {
              if (item.type === 'header') {
                return (
                  <div
                    key={item.key}
                    className="px-2.5 pt-3 pb-1 first:pt-0.5 text-[10px] font-semibold text-text-400/60 uppercase tracking-wider select-none"
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
                    group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-sans transition-colors duration-100 select-none
                    ${isSelected ? 'bg-accent-main-100/10 text-accent-main-100' : 'text-text-200'}
                    ${isHL && !isSelected ? 'bg-bg-200/40 text-text-100' : ''}
                  `}
                >
                  {/* Left: Name + capabilities */}
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    {pinned && (
                      <span className="text-accent-main-100/50 shrink-0">
                        <PinIcon size={11} />
                      </span>
                    )}
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

                  {/* Right: Meta */}
                  {showMeta ? (
                    <div className="flex items-center gap-3 text-xs font-mono flex-shrink-0">
                      <span className="text-text-500 max-w-[100px] truncate text-right">{model.providerName}</span>
                      <span className="text-text-500 w-[4ch] text-right">{formatContext(model.contextLimit)}</span>
                      {onTogglePin && (
                        <button
                          onClick={e => onTogglePin(e, model)}
                          className={`flex-shrink-0 p-0.5 rounded transition-all duration-150 ${
                            pinned
                              ? 'text-accent-main-100 opacity-80 hover:opacity-100'
                              : 'text-text-500 opacity-0 group-hover:opacity-40 hover:!opacity-100'
                          }`}
                        >
                          <PinIcon size={13} />
                        </button>
                      )}
                      {isSelected && (
                        <span className="text-accent-secondary-100 flex-shrink-0">
                          <CheckIcon />
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isSelected && (
                        <span className="text-accent-secondary-100">
                          <CheckIcon />
                        </span>
                      )}
                      {!isSelected && (
                        <span className="text-xs text-text-500 truncate max-w-[80px]">{model.providerName}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

// ============================================
// PC 端 ModelSelector
// ============================================

export const ModelSelector = memo(
  forwardRef<ModelSelectorHandle, ModelSelectorProps>(function ModelSelector(
    { models, selectedModelKey, onSelect, isLoading = false, disabled = false },
    ref,
  ) {
    const { t } = useTranslation('chat')
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
      selectedModel?.name || (isLoading ? t('modelSelector.selectModel') : t('modelSelector.selectModel'))

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
      triggerRef.current?.focus()
    }, [])

    useImperativeHandle(ref, () => ({ openMenu }), [openMenu])

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
        document.getElementById(`list-item-${realIndex}`)?.scrollIntoView({ block: 'nearest' })
      })
    }, [isOpen, highlightedIndex, itemIndices])

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        e.stopPropagation()
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            setHighlightedIndex(prev => {
              const next = Math.min(prev + 1, itemIndices.length - 1)
              document.getElementById(`list-item-${itemIndices[next]}`)?.scrollIntoView({ block: 'nearest' })
              return next
            })
            break
          case 'ArrowUp':
            e.preventDefault()
            setHighlightedIndex(prev => {
              const next = Math.max(prev - 1, 0)
              document.getElementById(`list-item-${itemIndices[next]}`)?.scrollIntoView({ block: 'nearest' })
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
      [itemIndices, flatList, highlightedIndex, handleSelect, closeMenu],
    )

    return (
      <div ref={containerRef} className="relative font-sans" data-dropdown-open={isOpen || undefined}>
        <button
          ref={triggerRef}
          onClick={() => (isOpen ? closeMenu() : openMenu())}
          disabled={disabled || isLoading}
          className="group flex items-center gap-2 px-2 py-1.5 text-text-200 rounded-lg hover:bg-bg-200 hover:text-text-100 transition-all duration-150 active:scale-95 cursor-pointer text-sm"
          title={displayName}
        >
          <span className="font-medium truncate max-w-[240px]">{displayName}</span>
          <div className={`opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
            <ChevronDownIcon size={10} />
          </div>
        </button>

        <DropdownMenu
          triggerRef={triggerRef}
          isOpen={isOpen}
          position="bottom"
          align="left"
          width="460px"
          minWidth="280px"
          maxWidth="min(460px, calc(100vw - 24px))"
          mobileFullWidth
          className="!p-0 overflow-hidden flex flex-col max-h-[min(600px,70vh)]"
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
            onItemClick={handleSelect}
            onTogglePin={handleTogglePin}
            ignoreMouseRef={ignoreMouseRef}
            lastMousePosRef={lastMousePosRef}
            idPrefix="list-item"
            maxListHeight="max-h-[min(500px,60vh)]"
            searchPlaceholder={t('modelSelector.searchModels')}
            noResultsText={t('modelSelector.noModelsFound')}
            noResultsHint={t('modelSelector.tryDifferentKeyword')}
            showMeta
          />
        </DropdownMenu>
      </div>
    )
  }),
)

function formatContext(limit: number): string {
  if (!limit) return ''
  const k = Math.round(limit / 1000)
  if (k >= 1000) return `${(k / 1000).toFixed(0)}M`
  return `${k}k`
}

// ============================================
// 移动端 InputToolbarModelSelector
// ============================================

interface InputToolbarModelSelectorProps {
  models: ModelInfo[]
  selectedModelKey: string | null
  onSelect: (modelKey: string, model: ModelInfo) => void
  isLoading?: boolean
  disabled?: boolean
  constrainToRef?: React.RefObject<HTMLElement | null>
}

export const InputToolbarModelSelector = memo(function InputToolbarModelSelector({
  models,
  selectedModelKey,
  onSelect,
  isLoading = false,
  disabled = false,
  constrainToRef,
}: InputToolbarModelSelectorProps) {
  const { t } = useTranslation('chat')
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

  const displayName = selectedModel?.name || (isLoading ? '...' : t('modelSelector.model'))

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
  }, [])

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

  // 长按置顶
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
      document.getElementById(`itms-item-${realIndex}`)?.scrollIntoView({ block: 'nearest' })
    })
  }, [isOpen, highlightedIndex, itemIndices])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex(prev => {
            const next = Math.min(prev + 1, itemIndices.length - 1)
            document.getElementById(`itms-item-${itemIndices[next]}`)?.scrollIntoView({ block: 'nearest' })
            return next
          })
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex(prev => {
            const next = Math.max(prev - 1, 0)
            document.getElementById(`itms-item-${itemIndices[next]}`)?.scrollIntoView({ block: 'nearest' })
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
    [itemIndices, flatList, highlightedIndex, handleSelect, closeMenu],
  )

  return (
    <div ref={containerRef} className="relative font-sans min-w-0 overflow-hidden">
      <button
        ref={triggerRef}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        disabled={disabled || isLoading}
        className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer min-w-0 overflow-hidden w-full"
        title={selectedModel?.name || t('modelSelector.selectModel')}
      >
        <span className="text-xs text-text-300 truncate">{displayName}</span>
        <span className="text-text-400 hidden md:inline shrink-0">
          <ChevronDownIcon />
        </span>
      </button>

      <DropdownMenu
        triggerRef={triggerRef}
        isOpen={isOpen}
        position="top"
        align="left"
        width="460px"
        minWidth="280px"
        maxWidth="min(460px, calc(100vw - 24px))"
        mobileFullWidth
        constrainToRef={constrainToRef}
        className="!p-0 overflow-hidden flex flex-col max-h-[min(360px,45vh)]"
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
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          ignoreMouseRef={ignoreMouseRef}
          lastMousePosRef={lastMousePosRef}
          idPrefix="itms-item"
          maxListHeight="max-h-[min(320px,40vh)]"
          searchPlaceholder={t('modelSelector.searchModels')}
          noResultsText={t('modelSelector.noModelsFound')}
          noResultsHint={t('modelSelector.tryDifferentKeyword')}
        />
      </DropdownMenu>
    </div>
  )
})
