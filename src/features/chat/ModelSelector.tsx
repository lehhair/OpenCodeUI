/**
 * ModelSelector - 高效模型选择器
 * 风格：极简、开发者工具风格、高密度
 * 适配：统一 Dropdown 体验，响应式宽度
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo, forwardRef, useImperativeHandle } from 'react'
import { ChevronDownIcon, SearchIcon, ThinkingIcon, EyeIcon, CheckIcon } from '../../components/Icons'
import { DropdownMenu } from '../../components/ui'
import type { ModelInfo } from '../../api'
import {
  getModelKey,
  groupModelsByProvider,
  getRecentModels,
  recordModelUsage,
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

export const ModelSelector = memo(forwardRef<ModelSelectorHandle, ModelSelectorProps>(function ModelSelector({
  models,
  selectedModelKey,
  onSelect,
  isLoading = false,
  disabled = false,
}, ref) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0) // 强制刷新 Recent
  
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const ignoreMouseRef = useRef(false)
  const lastMousePosRef = useRef({ x: 0, y: 0 })

  // 移除打开时的强制刷新，避免闪烁
  // useEffect(() => {
  //   if (isOpen) setRefreshTrigger(c => c + 1)
  // }, [isOpen])

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models
    const query = searchQuery.toLowerCase()
    const normalize = (value: unknown) => (typeof value === 'string' ? value : '').toLowerCase()

    return models.filter(m =>
      normalize(m.name).includes(query) ||
      normalize(m.id).includes(query) ||
      normalize(m.family).includes(query) ||
      normalize(m.providerName).includes(query)
    )
  }, [models, searchQuery])

  // 分组数据
  const { flatList } = useMemo(() => {
    const groups = groupModelsByProvider(filteredModels)
    const recent = searchQuery ? [] : getRecentModels(models, 5)
    
    let flat: Array<{ type: 'header' | 'item', data: any, key: string }> = []
    const addedKeys = new Set<string>()
    
    if (recent.length > 0) {
      flat.push({ type: 'header', data: { name: 'Recent' }, key: 'header-recent' })
      recent.forEach(m => {
        const key = getModelKey(m)
        flat.push({ type: 'item', data: m, key: `recent-${key}` })
        addedKeys.add(key)
      })
    }
    
    groups.forEach(g => {
      const groupModels = g.models.filter(m => !addedKeys.has(getModelKey(m)))
      if (groupModels.length > 0) {
        flat.push({ type: 'header', data: { name: g.providerName }, key: `header-${g.providerId}` })
        groupModels.forEach(m => flat.push({ type: 'item', data: m, key: getModelKey(m) }))
      }
    })
    
    return { flatList: flat }
  }, [filteredModels, models, searchQuery, refreshTrigger])

  // 仅计算可交互项的索引映射
  const itemIndices = useMemo(() => {
    return flatList
      .map((item, index) => item.type === 'item' ? index : -1)
      .filter(i => i !== -1)
  }, [flatList])

  const selectedModel = useMemo(() => {
    if (!selectedModelKey) return null
    return models.find(m => getModelKey(m) === selectedModelKey) ?? null
  }, [models, selectedModelKey])

  const displayName = selectedModel?.name || (isLoading ? 'Loading...' : 'Select model')

  const openMenu = useCallback(() => {
    if (disabled || isLoading) return
    
    // 计算初始高亮索引
    let targetIndex = 0
    if (selectedModelKey) {
      const index = flatList.findIndex(item => 
        item.type === 'item' && getModelKey(item.data) === selectedModelKey
      )
      if (index !== -1) {
        const interactiveIndex = itemIndices.indexOf(index)
        if (interactiveIndex !== -1) targetIndex = interactiveIndex
      }
    }
    
    setHighlightedIndex(targetIndex)
    setIsOpen(true)
    setSearchQuery('')
    
    // 暂时忽略鼠标移动，防止打开时高亮跳变
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

  // 暴露给外部的方法
  useImperativeHandle(ref, () => ({
    openMenu
  }), [openMenu])

  const handleSelect = useCallback((model: ModelInfo) => {
    const key = getModelKey(model)
    recordModelUsage(model)
    onSelect(key, model)
    closeMenu()
    // 选择后刷新列表顺序，确保 Recent 更新
    setRefreshTrigger(c => c + 1)
  }, [onSelect, closeMenu])

  useEffect(() => {
    if (isOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [isOpen])

  // Click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, closeMenu])

  // Esc 关闭 - document 级监听确保不依赖焦点位置
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

  // 初始定位逻辑：打开时自动滚动到当前选中项
  useEffect(() => {
    if (!isOpen) return

    // 延迟滚动以等待渲染
    requestAnimationFrame(() => {
      const realIndex = itemIndices[highlightedIndex]
      const el = document.getElementById(`list-item-${realIndex}`)
      el?.scrollIntoView({ block: 'nearest' })
    })
  }, [isOpen]) // 只在打开时触发滚动，键盘导航有自己的滚动逻辑

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 阻止冒泡，防止 input 和外层 div 重复触发导致跳步
    e.stopPropagation()
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => {
          const next = Math.min(prev + 1, itemIndices.length - 1)
          const realIndex = itemIndices[next]
          document.getElementById(`list-item-${realIndex}`)?.scrollIntoView({ block: 'nearest' })
          return next
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => {
          const next = Math.max(prev - 1, 0)
          const realIndex = itemIndices[next]
          document.getElementById(`list-item-${realIndex}`)?.scrollIntoView({ block: 'nearest' })
          return next
        })
        break
      case 'Enter':
        e.preventDefault()
        const globalIndex = itemIndices[highlightedIndex]
        const item = flatList[globalIndex]
        if (item && item.type === 'item') {
          handleSelect(item.data)
        }
        break
      case 'Escape':
        e.preventDefault()
        closeMenu()
        break
    }
  }, [itemIndices, flatList, highlightedIndex, handleSelect, closeMenu])

  return (
    <div ref={containerRef} className="relative font-sans" data-dropdown-open={isOpen || undefined}>
      <button
        ref={triggerRef}
        onClick={() => isOpen ? closeMenu() : openMenu()}
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
        <div ref={menuRef} onKeyDown={handleKeyDown}>
          {/* Search */}
          <div className="flex items-center gap-2.5 px-3 border-b border-border-200/50 flex-shrink-0">
            <SearchIcon className="w-3.5 h-3.5 text-text-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setHighlightedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search models..."
              className="flex-1 py-2 bg-transparent border-none outline-none text-sm text-text-100 placeholder:text-text-400"
            />
          </div>

          {/* List */}
          <div ref={listRef} className="overflow-y-auto custom-scrollbar flex-1 relative max-h-[min(500px,60vh)]">
            {flatList.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-sm text-text-400">No models found</div>
                <div className="text-xs text-text-500 mt-1">Try a different keyword</div>
              </div>
            ) : (
              <div className="px-1 pb-1">
                {flatList.map((item, index) => {
                  if (item.type === 'header') {
                    return (
                      <div key={item.key} className="px-3 pt-2.5 pb-1.5 first:pt-1.5 -mx-1 text-[10px] font-semibold text-text-400/70 uppercase tracking-wider select-none sticky -top-px bg-bg-000 z-10">
                        {item.data.name}
                      </div>
                    )
                  }
                  
                  const model = item.data as ModelInfo
                  const itemKey = getModelKey(model)
                  const isSelected = selectedModelKey === itemKey
                  const isCurrentlyHighlighted = itemIndices[highlightedIndex] === index

                  return (
                    <div key={item.key}>
                      <div
                        id={`list-item-${index}`}
                        onClick={() => handleSelect(model)}
                        title={`${model.name} · ${model.providerName}${model.contextLimit ? ` · ${formatContext(model.contextLimit)}` : ''}`}
                        onMouseMove={(e) => {
                          if (ignoreMouseRef.current) return
                          if (e.clientX === lastMousePosRef.current.x && e.clientY === lastMousePosRef.current.y) return
                          lastMousePosRef.current = { x: e.clientX, y: e.clientY }
                          const hIndex = itemIndices.indexOf(index)
                          if (hIndex !== -1 && hIndex !== highlightedIndex) {
                            setHighlightedIndex(hIndex)
                          }
                        }}
                        className={`
                          scroll-mt-7 group flex items-center justify-between px-2 py-2.5 sm:py-2 rounded-lg cursor-pointer text-sm font-sans transition-all duration-150 mt-px active:scale-[0.98]
                          ${isSelected ? 'bg-accent-main-100/10 text-accent-main-100' : 'text-text-200'}
                          ${isCurrentlyHighlighted && !isSelected ? 'bg-bg-200 text-text-100' : ''}
                        `}
                      >
                        {/* Left: Name */}
                        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                          <span className={`truncate font-medium ${isSelected ? 'text-accent-main-100' : 'text-text-100'}`}>
                            {model.name}
                          </span>
                          <div className={`flex items-center gap-1.5 transition-opacity flex-shrink-0 h-4 ${isCurrentlyHighlighted || isSelected ? 'opacity-70' : 'opacity-35'}`}>
                            {model.supportsReasoning && (
                              <div className="flex items-center justify-center w-3.5" title="Thinking">
                                <ThinkingIcon size={13} />
                              </div>
                            )}
                            {model.supportsImages && (
                              <div className="flex items-center justify-center w-3.5" title="Vision">
                                <EyeIcon size={14} />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: Meta Info */}
                        <div className="flex items-center gap-3 text-xs font-mono flex-shrink-0 ml-4">
                          <span className="text-text-500 max-w-[100px] truncate text-right">
                            {model.providerName}
                          </span>
                          <span className="text-text-500 w-[4ch] text-right">
                            {formatContext(model.contextLimit)}
                          </span>
                          {isSelected && (
                            <span className="text-accent-secondary-100 flex-shrink-0">
                              <CheckIcon />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DropdownMenu>
    </div>
  )
}))

function formatContext(limit: number): string {
  if (!limit) return ''
  const k = Math.round(limit / 1000)
  if (k >= 1000) return `${(k/1000).toFixed(0)}M`
  return `${k}k`
}

// ============================================
// InputToolbarModelSelector
// 移动端输入框工具栏用的模型选择器
// 按钮更紧凑，菜单向上弹出，参考 Claude 风格
// ============================================

interface InputToolbarModelSelectorProps {
  models: ModelInfo[]
  selectedModelKey: string | null
  onSelect: (modelKey: string, model: ModelInfo) => void
  isLoading?: boolean
  disabled?: boolean
  /** 约束菜单不超过此容器的边界 */
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
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const ignoreMouseRef = useRef(false)
  const lastMousePosRef = useRef({ x: 0, y: 0 })

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models
    const query = searchQuery.toLowerCase()
    const normalize = (value: unknown) => (typeof value === 'string' ? value : '').toLowerCase()
    return models.filter(m =>
      normalize(m.name).includes(query) ||
      normalize(m.id).includes(query) ||
      normalize(m.family).includes(query) ||
      normalize(m.providerName).includes(query)
    )
  }, [models, searchQuery])

  // 分组：和 PC 端一致的结构
  const { flatList } = useMemo(() => {
    const groups = groupModelsByProvider(filteredModels)
    const recent = searchQuery ? [] : getRecentModels(models, 5)
    
    let flat: Array<{ type: 'header' | 'item', data: any, key: string }> = []
    const addedKeys = new Set<string>()
    
    if (recent.length > 0) {
      flat.push({ type: 'header', data: { name: 'Recent' }, key: 'header-recent' })
      recent.forEach(m => {
        const key = getModelKey(m)
        flat.push({ type: 'item', data: m, key: `recent-${key}` })
        addedKeys.add(key)
      })
    }
    
    groups.forEach(g => {
      const groupModels = g.models.filter(m => !addedKeys.has(getModelKey(m)))
      if (groupModels.length > 0) {
        flat.push({ type: 'header', data: { name: g.providerName }, key: `header-${g.providerId}` })
        groupModels.forEach(m => flat.push({ type: 'item', data: m, key: getModelKey(m) }))
      }
    })
    
    return { flatList: flat }
  }, [filteredModels, models, searchQuery, refreshTrigger])

  const itemIndices = useMemo(() => {
    return flatList
      .map((item, index) => item.type === 'item' ? index : -1)
      .filter(i => i !== -1)
  }, [flatList])

  const selectedModel = useMemo(() => {
    if (!selectedModelKey) return null
    return models.find(m => getModelKey(m) === selectedModelKey) ?? null
  }, [models, selectedModelKey])

  const displayName = selectedModel?.name || (isLoading ? '...' : 'Model')

  const openMenu = useCallback(() => {
    if (disabled || isLoading) return
    let targetIndex = 0
    if (selectedModelKey) {
      const index = flatList.findIndex(item =>
        item.type === 'item' && getModelKey(item.data) === selectedModelKey
      )
      if (index !== -1) {
        const interactiveIndex = itemIndices.indexOf(index)
        if (interactiveIndex !== -1) targetIndex = interactiveIndex
      }
    }
    setHighlightedIndex(targetIndex)
    setIsOpen(true)
    setSearchQuery('')
    ignoreMouseRef.current = true
    setTimeout(() => { ignoreMouseRef.current = false }, 300)
  }, [disabled, isLoading, selectedModelKey, flatList, itemIndices])

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    setSearchQuery('')
  }, [])

  const handleSelect = useCallback((model: ModelInfo) => {
    const key = getModelKey(model)
    recordModelUsage(model)
    onSelect(key, model)
    closeMenu()
    setRefreshTrigger(c => c + 1)
  }, [onSelect, closeMenu])

  useEffect(() => {
    if (isOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [isOpen])

  // Click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, closeMenu])

  // Esc
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

  // 初始滚动
  useEffect(() => {
    if (!isOpen) return
    requestAnimationFrame(() => {
      const realIndex = itemIndices[highlightedIndex]
      const el = document.getElementById(`itms-item-${realIndex}`)
      el?.scrollIntoView({ block: 'nearest' })
    })
  }, [isOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
      case 'Enter':
        e.preventDefault()
        const globalIndex = itemIndices[highlightedIndex]
        const item = flatList[globalIndex]
        if (item && item.type === 'item') handleSelect(item.data)
        break
      case 'Escape':
        e.preventDefault()
        closeMenu()
        break
    }
  }, [itemIndices, flatList, highlightedIndex, handleSelect, closeMenu])

  return (
    <div ref={containerRef} className="relative font-sans">
      {/* 触发按钮：和 agent/variant 按钮统一风格 */}
      <button
        ref={triggerRef}
        onClick={() => isOpen ? closeMenu() : openMenu()}
        disabled={disabled || isLoading}
        className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer"
        title={selectedModel?.name || 'Select model'}
      >
        <span className="text-xs text-text-300 truncate max-w-[100px]">{displayName}</span>
        <span className="text-text-400"><ChevronDownIcon /></span>
      </button>

      {/* 菜单：向上弹出，和 PC 端列表样式一致 */}
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
        <div ref={menuRef} onKeyDown={handleKeyDown}>
          {/* Search */}
          <div className="flex items-center gap-2.5 px-3 border-b border-border-200/50 flex-shrink-0">
            <SearchIcon className="w-3.5 h-3.5 text-text-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setHighlightedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search models..."
              className="flex-1 py-2 bg-transparent border-none outline-none text-sm text-text-100 placeholder:text-text-400"
            />
          </div>

          {/* List — 复用 PC 端的样式：sticky header + 横向布局 */}
          <div className="overflow-y-auto custom-scrollbar flex-1 relative max-h-[min(320px,40vh)]">
            {flatList.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-sm text-text-400">No models found</div>
                <div className="text-xs text-text-500 mt-1">Try a different keyword</div>
              </div>
            ) : (
              <div className="px-1 pb-1">
                {flatList.map((item, index) => {
                  if (item.type === 'header') {
                    return (
                      <div key={item.key} className="px-3 pt-2.5 pb-1.5 first:pt-1.5 -mx-1 text-[10px] font-semibold text-text-400/70 uppercase tracking-wider select-none sticky -top-px bg-bg-000 z-10">
                        {item.data.name}
                      </div>
                    )
                  }

                  const model = item.data as ModelInfo
                  const itemKey = getModelKey(model)
                  const isSelected = selectedModelKey === itemKey
                  const isHL = itemIndices[highlightedIndex] === index

                  return (
                    <div key={item.key}>
                      <div
                        id={`itms-item-${index}`}
                        onClick={() => handleSelect(model)}
                        title={`${model.name} · ${model.providerName}${model.contextLimit ? ` · ${formatContext(model.contextLimit)}` : ''}`}
                        onMouseMove={(e) => {
                          if (ignoreMouseRef.current) return
                          if (e.clientX === lastMousePosRef.current.x && e.clientY === lastMousePosRef.current.y) return
                          lastMousePosRef.current = { x: e.clientX, y: e.clientY }
                          const hIndex = itemIndices.indexOf(index)
                          if (hIndex !== -1 && hIndex !== highlightedIndex) setHighlightedIndex(hIndex)
                        }}
                        className={`
                          scroll-mt-7 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 items-center px-2 py-2 rounded-lg cursor-pointer text-sm font-sans transition-all duration-150 mt-px active:scale-[0.98]
                          ${isSelected ? 'bg-accent-main-100/10 text-accent-main-100' : 'text-text-200'}
                          ${isHL && !isSelected ? 'bg-bg-200 text-text-100' : ''}
                        `}
                      >
                        {/* Row 1 left: Name + capability icons */}
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className={`truncate font-medium ${isSelected ? 'text-accent-main-100' : 'text-text-100'}`}>
                            {model.name}
                          </span>
                          <div className={`flex items-center gap-1 flex-shrink-0 ${isHL || isSelected ? 'opacity-70' : 'opacity-35'}`}>
                            {model.supportsReasoning && <ThinkingIcon size={12} />}
                            {model.supportsImages && <EyeIcon size={13} />}
                          </div>
                        </div>
                        {/* Row 1 right: Check */}
                        {isSelected ? (
                          <span className="text-accent-secondary-100 flex-shrink-0 row-span-2 self-center">
                            <CheckIcon />
                          </span>
                        ) : <span />}
                        {/* Row 2: Provider + context */}
                        <div className="text-xs text-text-500 truncate">
                          {model.providerName}{model.contextLimit ? ` · ${formatContext(model.contextLimit)}` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DropdownMenu>
    </div>
  )
})
