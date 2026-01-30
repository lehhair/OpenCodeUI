import { useState, useEffect, useRef } from 'react'
import { getPath, type ApiProject, type ApiPath } from '../../api'
import { handleError } from '../../utils'

interface EmptyStateProps {
  currentProject: ApiProject | null
  projects: ApiProject[]
  onStartChat: (directory: string) => void
}

export function EmptyState({
  currentProject,
  projects,
  onStartChat,
}: EmptyStateProps) {
  const [pathInfo, setPathInfo] = useState<ApiPath | null>(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [customPath, setCustomPath] = useState('')
  const [isCustomMode, setIsCustomMode] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 获取当前路径信息
  useEffect(() => {
    getPath().then(setPathInfo).catch(handleError('get path', 'api'))
  }, [])

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 切换到自定义模式时聚焦输入框
  useEffect(() => {
    if (isCustomMode) {
      inputRef.current?.focus()
    }
  }, [isCustomMode])

  // 当前选中的目录
  const currentDirectory = currentProject?.id === 'global' 
    ? pathInfo?.directory || ''
    : currentProject?.worktree || ''

  // 处理开始聊天
  const handleStart = () => {
    const directory = isCustomMode ? customPath.trim() : currentDirectory
    if (directory) {
      onStartChat(directory)
    }
  }

  // 处理选择目录
  const handleSelectDirectory = (directory: string) => {
    setCustomPath(directory)
    setIsDropdownOpen(false)
    setIsCustomMode(false)
    // 找到对应的 project 并选中（如果有的话）
    // 这里直接用选中的目录开始
  }

  // 处理自定义路径
  const handleCustomPath = () => {
    setIsCustomMode(true)
    setIsDropdownOpen(false)
    setCustomPath(currentDirectory)
  }

  // 其他可选目录（排除当前的）
  const otherDirectories = projects
    .filter(p => p.id !== 'global' && p.worktree !== currentDirectory)
    .map(p => p.worktree)

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        {/* Logo / Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-main-100 to-accent-main-200 flex items-center justify-center">
            <ChatIcon className="w-8 h-8 text-white" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-text-100 text-center mb-2">
          Start a new conversation
        </h2>
        <p className="text-sm text-text-400 text-center mb-6">
          Choose a working directory for this session
        </p>

        {/* Directory Selector */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-text-400 uppercase tracking-wider">
            Working Directory
          </label>

          {isCustomMode ? (
            // 自定义路径输入
            <div className="space-y-2">
              <input
                ref={inputRef}
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customPath.trim()) {
                    handleStart()
                  } else if (e.key === 'Escape') {
                    setIsCustomMode(false)
                  }
                }}
                placeholder="Enter absolute path..."
                className="w-full px-3 py-2.5 bg-bg-200 border border-border-300/30 rounded-lg text-sm text-text-100 placeholder:text-text-500 focus:outline-none focus:border-accent-main-100/50 transition-colors"
              />
              <button
                onClick={() => setIsCustomMode(false)}
                className="text-xs text-text-400 hover:text-text-200 transition-colors"
              >
                ← Back to directory list
              </button>
            </div>
          ) : (
            // 目录选择下拉
            <div ref={dropdownRef} className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-bg-200 border border-border-300/30 rounded-lg text-sm text-text-100 hover:border-border-300/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FolderIcon className="w-4 h-4 text-text-400 flex-shrink-0" />
                  <span className="truncate">{currentDirectory || 'Select directory...'}</span>
                </div>
                <ChevronIcon className={`w-4 h-4 text-text-400 transition-transform flex-shrink-0 ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-bg-100 border border-border-300/30 rounded-lg shadow-lg overflow-hidden z-50">
                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                    {/* Current directory */}
                    <button
                      onClick={() => handleSelectDirectory(currentDirectory)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-200/50 transition-colors text-sm text-text-200"
                    >
                      <FolderIcon className="w-4 h-4 text-accent-main-100 flex-shrink-0" />
                      <span className="truncate">{currentDirectory}</span>
                      <span className="text-xs text-text-500 flex-shrink-0">(current)</span>
                    </button>

                    {/* Other project directories */}
                    {otherDirectories.map((dir) => (
                      <button
                        key={dir}
                        onClick={() => handleSelectDirectory(dir)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-200/50 transition-colors text-sm text-text-300"
                      >
                        <FolderIcon className="w-4 h-4 text-text-500 flex-shrink-0" />
                        <span className="truncate">{dir}</span>
                      </button>
                    ))}

                    {/* Custom path option */}
                    <div className="border-t border-border-300/20">
                      <button
                        onClick={handleCustomPath}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-200/50 transition-colors text-sm text-text-400"
                      >
                        <EditIcon className="w-4 h-4 flex-shrink-0" />
                        <span>Enter custom path...</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Start Button */}
        <button
          onClick={handleStart}
          disabled={isCustomMode ? !customPath.trim() : !currentDirectory}
          className="w-full mt-6 px-4 py-2.5 bg-accent-main-100 hover:bg-accent-main-200 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          Start Conversation
        </button>

        {/* Hint */}
        <p className="mt-4 text-xs text-text-500 text-center">
          Or just type a message below to start with the current directory
        </p>
      </div>
    </div>
  )
}

// ============================================
// Icons
// ============================================

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}
