import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDownIcon, NewChatIcon, MenuDotsIcon, SunIcon, MoonIcon, SystemIcon, SidebarIcon, SearchIcon } from '../../components/Icons'
import { DropdownMenu, MenuItem, IconButton } from '../../components/ui'
import type { ThemeMode } from '../../hooks'
import type { ModelInfo } from '../../api'

interface HeaderProps {
  models: ModelInfo[]
  modelsLoading: boolean
  selectedModelId: string | null
  onModelChange: (modelId: string) => void
  onNewChat: () => void
  onToggleSidebar: () => void
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
}

export function Header({
  models,
  modelsLoading,
  selectedModelId,
  onModelChange,
  onNewChat,
  onToggleSidebar,
  themeMode,
  onThemeChange,
}: HeaderProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 过滤模型
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

  // 按 provider 分组
  const modelsByProvider = useMemo(() => {
    return filteredModels.reduce((acc, model) => {
      if (!acc[model.providerName]) {
        acc[model.providerName] = []
      }
      acc[model.providerName].push(model)
      return acc
    }, {} as Record<string, ModelInfo[]>)
  }, [filteredModels])

  const selectedModel = models.find(m => m.id === selectedModelId)
  const displayName = selectedModel?.name || (modelsLoading ? 'Loading...' : 'Select model')

  // 打开菜单时聚焦搜索框
  useEffect(() => {
    if (modelMenuOpen) {
      // 延迟聚焦，等待 DOM 渲染
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    } else {
      // 关闭时清空搜索
      setSearchQuery('')
    }
  }, [modelMenuOpen])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(e.target as Node) &&
        !modelTriggerRef.current?.contains(e.target as Node)
      ) {
        setModelMenuOpen(false)
      }
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(e.target as Node) &&
        !settingsTriggerRef.current?.contains(e.target as Node)
      ) {
        setSettingsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 键盘导航
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setModelMenuOpen(false)
    } else if (e.key === 'Enter' && filteredModels.length > 0) {
      // 选择第一个匹配的模型
      onModelChange(filteredModels[0].id)
      setModelMenuOpen(false)
    }
  }

  return (
    <div className="h-14 flex justify-between items-center px-4 z-20 pointer-events-none">
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* Sidebar Toggle */}
        <IconButton
          aria-label="Toggle sidebar"
          onClick={onToggleSidebar}
          size="sm"
          className="hover:bg-bg-200/50" // 增加轻微的 hover 背景
        >
          <SidebarIcon />
        </IconButton>

        {/* Model Selector */}
        <div className="relative">
          <button
            ref={modelTriggerRef}
            onClick={() => {
              setModelMenuOpen(!modelMenuOpen)
              setSettingsMenuOpen(false)
            }}
            className="flex items-center gap-1 px-2 py-1.5 text-text-200 rounded-lg transition-all duration-150 hover:bg-bg-200/50 hover:text-text-100 active:scale-95 cursor-pointer"
            aria-label="Model selector"
            aria-haspopup="menu"
            aria-expanded={modelMenuOpen}
            disabled={modelsLoading}
          >
            <span className="font-medium text-sm opacity-90">{displayName}</span>
            <span className="opacity-60">
              <ChevronDownIcon />
            </span>
          </button>

          {/* Model Menu (保持不变，但要确保 z-index 够高) */}
          <DropdownMenu
            triggerRef={modelTriggerRef}
            isOpen={modelMenuOpen}
            position="bottom"
            align="left"
            width={320}
          >
            {/* ... */}
            <div ref={modelMenuRef}>
              {/* Search Input */}
              <div className="p-2 border-b border-border-300/20">
                <div className="relative">
                  <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Search models..."
                    className="w-full bg-bg-200 border border-border-300/30 rounded-lg py-1.5 pl-8 pr-3 text-sm text-text-100 placeholder:text-text-400 focus:outline-none focus:border-border-300/60 transition-colors"
                  />
                </div>
              </div>

              {/* Model List */}
              <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                {Object.entries(modelsByProvider).map(([providerName, providerModels]) => (
                  <div key={providerName}>
                    <div className="px-3 py-1.5 text-xs text-text-400 font-medium sticky top-0 bg-bg-000 z-10">
                      {providerName}
                    </div>
                    {providerModels.map((model) => (
                      <MenuItem
                        key={model.id}
                        label={model.name}
                        description={formatModelDescription(model)}
                        selected={selectedModelId === model.id}
                        onClick={() => {
                          onModelChange(model.id)
                          setModelMenuOpen(false)
                        }}
                      />
                    ))}
                  </div>
                ))}
                {filteredModels.length === 0 && (
                  <div className="px-3 py-6 text-sm text-text-400 text-center">
                    {modelsLoading ? 'Loading models...' : searchQuery ? 'No models found' : 'No models available'}
                  </div>
                )}
              </div>
            </div>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-1 pointer-events-auto">
        {/* New Chat Button */}
        <IconButton
          aria-label="New chat"
          onClick={onNewChat}
          size="sm"
          className="hover:bg-bg-200/50"
        >
          <NewChatIcon />
        </IconButton>

        {/* Settings Button */}
        <div className="relative">
          <IconButton
            ref={settingsTriggerRef}
            aria-label="Menu"
            onClick={() => {
              setSettingsMenuOpen(!settingsMenuOpen)
              setModelMenuOpen(false)
            }}
            size="sm"
            className="hover:bg-bg-200/50"
          >
            <MenuDotsIcon />
          </IconButton>

          {/* Settings Menu */}
          <DropdownMenu
            triggerRef={settingsTriggerRef}
            isOpen={settingsMenuOpen}
            position="bottom"
            align="right"
            width={220}
          >
            {/* ... (保持不变) ... */}
            <div ref={settingsMenuRef}>
              <div className="px-3 py-2">
                <p className="text-xs text-text-400 mb-2">Theme</p>
                <div className="flex gap-1">
                  <button
                    onClick={() => onThemeChange('system')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                      themeMode === 'system'
                        ? 'bg-bg-300 text-text-100'
                        : 'text-text-300 hover:bg-bg-200 hover:text-text-200'
                    }`}
                  >
                    <SystemIcon />
                    <span>Auto</span>
                  </button>
                  <button
                    onClick={() => onThemeChange('light')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                      themeMode === 'light'
                        ? 'bg-bg-300 text-text-100'
                        : 'text-text-300 hover:bg-bg-200 hover:text-text-200'
                    }`}
                  >
                    <SunIcon />
                    <span>Light</span>
                  </button>
                  <button
                    onClick={() => onThemeChange('dark')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                      themeMode === 'dark'
                        ? 'bg-bg-300 text-text-100'
                        : 'text-text-300 hover:bg-bg-200 hover:text-text-200'
                    }`}
                  >
                    <MoonIcon />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
              <div className="border-t border-border-300/30 my-1" />
              <MenuItem
                label="Convert to task"
                disabled
                onClick={() => setSettingsMenuOpen(false)}
              />
              <MenuItem
                label="Settings"
                onClick={() => {
                  setSettingsMenuOpen(false)
                }}
              />
              <MenuItem
                label="Take a screenshot"
                disabled
                onClick={() => setSettingsMenuOpen(false)}
              />
              <MenuItem
                label="Add an image"
                onClick={() => {
                  setSettingsMenuOpen(false)
                }}
              />
            </div>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

function formatModelDescription(model: ModelInfo): string {
  const parts: string[] = []
  
  // Context limit in K
  const contextK = Math.round(model.contextLimit / 1000)
  parts.push(`${contextK}K`)
  
  // Capabilities
  if (model.supportsReasoning) parts.push('reasoning')
  if (model.supportsImages) parts.push('vision')
  
  return parts.join(' • ')
}
