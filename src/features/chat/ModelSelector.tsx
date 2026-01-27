/**
 * ModelSelector - 高效模型选择器
 * 风格：极简、开发者工具风格、高密度
 * 适配：统一 Dropdown 体验，响应式宽度
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { ChevronDownIcon, SearchIcon, ThinkingIcon, EyeIcon } from '../../components/Icons'
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

export const ModelSelector = memo(function ModelSelector({
  models,
  selectedModelKey,
  onSelect,
  isLoading = false,
  disabled = false,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0) // 强制刷新 Recent
  
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const ignoreMouseRef = useRef(false) // 防止打开时鼠标位置干扰初始高亮

  // 移除打开时的强制刷新，避免闪烁
  // useEffect(() => {
  //   if (isOpen) setRefreshTrigger(c => c + 1)
  // }, [isOpen])

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models
    const query = searchQuery.toLowerCase()
    return models.filter(m =>
      m.name.toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query) ||
      m.family.toLowerCase().includes(query) ||
      m.providerName.toLowerCase().includes(query)
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

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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
    <div ref={containerRef} className="relative font-sans">
      <button
        ref={triggerRef}
        onClick={() => isOpen ? closeMenu() : openMenu()}
        disabled={disabled || isLoading}
        className="group flex items-center gap-2 px-2 py-1.5 text-text-200 rounded-md hover:bg-bg-200/50 hover:text-text-100 transition-colors cursor-pointer text-sm"
        title={displayName}
      >
        <span className="font-medium truncate max-w-[240px]">{displayName}</span>
        <div className={`opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDownIcon size={10} />
        </div>
      </button>

      <div 
        className={`z-50 transition-all duration-200 ease-out 
          fixed top-[58px] left-1/2 -translate-x-1/2 w-[90vw] max-w-[380px] origin-top
          sm:absolute sm:top-full sm:left-0 sm:translate-x-0 sm:w-[380px] sm:origin-top-left sm:mt-1
          ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}
        `}
        onKeyDown={handleKeyDown}
      >
        <div className="bg-bg-000 border border-border-200 shadow-xl rounded-lg overflow-hidden flex flex-col max-h-[600px]">
          {/* Search */}
          <div className="flex items-center px-3 py-2.5 border-b border-border-200/50 flex-shrink-0 bg-bg-000 z-20">
            <SearchIcon className="w-3.5 h-3.5 text-text-400 mr-2" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setHighlightedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search model..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-text-100 placeholder:text-text-400 font-medium"
            />
          </div>

          {/* List */}
          <div ref={listRef} className="overflow-y-auto custom-scrollbar flex-1 relative scroll-pt-8">
            {flatList.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-text-400">No models found</div>
            ) : (
              <div className="pb-1">
                {flatList.map((item, index) => {
                  if (item.type === 'header') {
                    return (
                      <div key={item.key} className="px-3 py-1.5 mt-0.5 first:mt-0 text-[10px] font-bold text-text-400 uppercase tracking-wider select-none sticky top-0 bg-bg-000 z-10 border-b border-border-200 shadow-sm">
                        {item.data.name}
                      </div>
                    )
                  }
                  
                  const model = item.data as ModelInfo
                  const itemKey = getModelKey(model)
                  const isSelected = selectedModelKey === itemKey
                  const isCurrentlyHighlighted = itemIndices[highlightedIndex] === index

                  return (
                    <div key={item.key} className="px-1.5">
                      <div
                        id={`list-item-${index}`}
                        onClick={() => handleSelect(model)}
                    onMouseMove={() => {
                      if (ignoreMouseRef.current) return
                      const hIndex = itemIndices.indexOf(index)
                      if (hIndex !== -1 && hIndex !== highlightedIndex) {
                        setHighlightedIndex(hIndex)
                      }
                    }}
                    className={`
                      group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm font-sans transition-colors mt-0.5
                      ${isSelected ? 'bg-accent-main-100/10 text-accent-main-100' : 'text-text-200'}
                      ${isCurrentlyHighlighted && !isSelected ? 'bg-bg-200/60 text-text-100' : ''}
                    `}
                  >
                    {/* Left: Name */}
                    <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                      <span className={`truncate font-medium ${isSelected ? 'text-accent-main-100' : 'text-text-100'}`}>
                        {model.name}
                      </span>
                      {/* Icons - Fixed width container for alignment */}
                      <div className={`flex items-center gap-1.5 transition-opacity flex-shrink-0 h-4 ${isCurrentlyHighlighted || isSelected ? 'opacity-60' : 'opacity-30'}`}>
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
                        <div className="flex items-center gap-3 text-xs text-text-400 font-mono flex-shrink-0 ml-4">
                          <span className="opacity-40 max-w-[100px] truncate text-right hidden sm:block">
                            {model.providerName}
                          </span>
                          <span className="opacity-40 w-[4ch] text-right">
                            {formatContext(model.contextLimit)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

function formatContext(limit: number): string {
  if (!limit) return ''
  const k = Math.round(limit / 1000)
  if (k >= 1000) return `${(k/1000).toFixed(0)}M`
  return `${k}k`
}
