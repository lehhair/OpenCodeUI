import { useState, useRef, useEffect } from 'react'
import type { ApiProject } from '../../api'

interface ProjectSelectorProps {
  currentProject: ApiProject | null
  projects: ApiProject[]
  isLoading: boolean
  onSelectProject: (projectId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
}

export function ProjectSelector({
  currentProject,
  projects,
  isLoading,
  onSelectProject,
  onAddProject,
  onRemoveProject,
}: ProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 获取显示名称
  const getDisplayName = (project: ApiProject | null) => {
    if (!project) return isLoading ? 'Loading...' : 'No project'
    
    // 优先用 name
    if (project.name) return project.name
    
    // 如果是 global，显示 "Global"
    if (project.id === 'global') return 'Global'
    
    // 否则显示目录名
    const worktree = project.worktree || ''
    const parts = worktree.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] || worktree
  }

  // 获取完整路径（用于 tooltip）
  const getFullPath = (project: ApiProject | null) => {
    if (!project) return ''
    return project.worktree
  }

  // 过滤掉当前选中的 project
  const otherProjects = projects.filter(p => p.id !== currentProject?.id)

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className="w-full flex flex-col items-start px-2 py-1.5 text-left hover:bg-bg-200/50 rounded-lg transition-colors group"
        title={getFullPath(currentProject)}
      >
        <div className="w-full flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-text-100 truncate tracking-tight">
            {getDisplayName(currentProject)}
          </span>
          <ChevronIcon className={`text-text-400 w-3 h-3 flex-shrink-0 transition-all duration-200 ${isOpen ? 'rotate-180 opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
        </div>
        <span className="text-[10px] text-text-400 truncate opacity-70 font-mono w-full">
          {currentProject?.id === 'global' ? 'All Projects' : getFullPath(currentProject)}
        </span>
      </button>

      {/* Dropdown - 使用 grid 实现平滑展开动画 */}
      <div 
        className={`absolute top-full left-0 right-0 mt-2 z-50 grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden">
          <div className="bg-bg-000/95 backdrop-blur-md border border-border-200 rounded-xl shadow-xl overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-1.5">
              <div className="px-2 py-1.5 text-[10px] font-bold text-text-400 uppercase tracking-wider">
                Switch Project
              </div>
              
              {/* Global (if not current) */}
              {projects.find(p => p.id === 'global' && p.id !== currentProject?.id) && (
                <ProjectItem
                  project={projects.find(p => p.id === 'global')!}
                  onClick={() => {
                    onSelectProject('global')
                    setIsOpen(false)
                  }}
                  getDisplayName={getDisplayName}
                  getFullPath={getFullPath}
                />
              )}

              {/* Other Projects */}
              {otherProjects.filter(p => p.id !== 'global').map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  onClick={() => {
                    onSelectProject(project.id)
                    setIsOpen(false)
                  }}
                  onRemove={(e) => {
                    e.stopPropagation()
                    if (confirm('Remove this project from list?')) {
                      onRemoveProject(project.id)
                    }
                  }}
                  getDisplayName={getDisplayName}
                  getFullPath={getFullPath}
                />
              ))}
              
              {otherProjects.length === 0 && !projects.find(p => p.id === 'global' && p.id !== currentProject?.id) && (
                <div className="px-3 py-4 text-center text-xs text-text-400">
                  No other projects
                </div>
              )}
            </div>
            
            {/* Footer Actions */}
            <div className="p-1.5 border-t border-border-200 bg-bg-50/50">
              <button
                onClick={() => {
                  onAddProject()
                  setIsOpen(false)
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-text-200 hover:text-text-100 hover:bg-bg-200 transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Add Project Folder...
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectItem({ 
  project, 
  onClick, 
  onRemove,
  getDisplayName, 
  getFullPath 
}: { 
  project: ApiProject
  onClick: () => void
  onRemove?: (e: React.MouseEvent) => void
  getDisplayName: (p: ApiProject) => string
  getFullPath: (p: ApiProject) => string
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-bg-100 transition-colors relative"
      title={getFullPath(project)}
    >
      <div 
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-sm"
        style={{ 
          backgroundColor: project.icon?.color 
            ? getColorValue(project.icon.color) 
            : '#6366f1' 
        }}
      >
        {project.id === 'global' ? (
          <GlobeIcon className="w-4 h-4" />
        ) : (
          <FolderIcon className="w-4 h-4" />
        )}
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-medium text-text-200 truncate">
          {getDisplayName(project)}
        </p>
        <p className="text-[10px] text-text-400 truncate opacity-70 font-mono">
          {project.id === 'global' ? 'All scopes' : getFullPath(project)}
        </p>
      </div>
      
      {onRemove && (
        <div 
          onClick={onRemove}
          className="absolute right-2 p-1.5 rounded-md text-text-400 hover:text-danger-100 hover:bg-bg-200 opacity-0 group-hover:opacity-100 transition-all"
          title="Remove from list"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </div>
      )}
    </button>
  )
}

// 颜色名称到实际值的映射
function getColorValue(colorName: string): string {
  const colors: Record<string, string> = {
    red: '#ef4444',
    orange: '#f97316',
    amber: '#f59e0b',
    yellow: '#eab308',
    lime: '#84cc16',
    green: '#22c55e',
    emerald: '#10b981',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    sky: '#0ea5e9',
    blue: '#3b82f6',
    indigo: '#6366f1',
    violet: '#8b5cf6',
    purple: '#a855f7',
    fuchsia: '#d946ef',
    pink: '#ec4899',
    rose: '#f43f5e',
    gray: '#6b7280',
  }
  return colors[colorName] || colorName
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}
