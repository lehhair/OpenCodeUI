import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderIcon, GlobeIcon, ChevronDownIcon, PlusIcon, TrashIcon } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import type { ApiProject } from '../../api'

// ============================================
// Types
// ============================================

interface ProjectSelectorProps {
  currentProject: ApiProject | null
  projects: ApiProject[]
  isLoading: boolean
  onSelectProject: (projectId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
}

// ============================================
// ProjectSelector Component
// ============================================

export function ProjectSelector({
  currentProject,
  projects,
  isLoading,
  onSelectProject,
  onAddProject,
  onRemoveProject,
}: ProjectSelectorProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const [isOpen, setIsOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; projectId: string | null }>({
    isOpen: false,
    projectId: null,
  })
  const containerRef = useRef<HTMLDivElement>(null)

  // ==========================================
  // Click Outside
  // ==========================================

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // ==========================================
  // Helpers
  // ==========================================

  const getDisplayName = useCallback(
    (project: ApiProject | null): string => {
      if (!project) return isLoading ? t('common:loading') : t('sessions.noProject')
      if (project.name) return project.name
      if (project.id === 'global') return t('chat:sidebar.global')

      const worktree = project.worktree || ''
      const parts = worktree.replace(/\\/g, '/').split('/').filter(Boolean)
      return parts[parts.length - 1] || worktree
    },
    [isLoading, t],
  )

  const getPath = useCallback(
    (project: ApiProject | null): string => {
      if (!project) return ''
      if (project.id === 'global') return t('chat:sidebar.allProjects')
      return project.worktree || ''
    },
    [t],
  )

  // ==========================================
  // Computed
  // ==========================================

  const otherProjects = projects.filter(p => p.id !== currentProject?.id)

  // ==========================================
  // Render
  // ==========================================

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-200/50 transition-colors group text-left"
        title={getPath(currentProject)}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[length:var(--fs-base)] font-semibold text-text-100 truncate">{getDisplayName(currentProject)}</div>
          <div className="text-[length:var(--fs-xxs)] text-text-400/70 truncate font-mono">{getPath(currentProject)}</div>
        </div>
        <ChevronDownIcon
          className={`w-3 h-3 text-text-400 transition-all duration-200 shrink-0 ${
            isOpen ? 'rotate-180' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
      </button>

      {/* Dropdown */}
      <div
        className={`
          absolute top-full left-0 right-0 mt-1 z-50
          transition-all duration-200 origin-top
          ${isOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}
        `}
      >
        <div className="glass border border-border-200/60 rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-[280px] overflow-y-auto custom-scrollbar p-1">
            <div className="px-2 py-1.5 text-[length:var(--fs-xxs)] font-semibold text-text-400/70 uppercase tracking-wider">
              {t('sessions.switchProject')}
            </div>

            {otherProjects.length === 0 ? (
              <div className="px-3 py-4 text-center text-[length:var(--fs-sm)] text-text-400/60">{t('sessions.noOtherProjects')}</div>
            ) : (
              otherProjects.map(project => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  displayName={getDisplayName(project)}
                  path={getPath(project)}
                  onSelect={() => {
                    onSelectProject(project.id)
                    setIsOpen(false)
                  }}
                  onRemove={
                    project.id !== 'global'
                      ? () => {
                          setDeleteConfirm({ isOpen: true, projectId: project.id })
                        }
                      : undefined
                  }
                />
              ))
            )}
          </div>

          {/* Add Button */}
          <div className="p-1 border-t border-border-200/50">
            <button
              type="button"
              onClick={() => {
                onAddProject()
                setIsOpen(false)
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-100 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {t('sessions.addProject')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, projectId: null })}
        onConfirm={() => {
          if (deleteConfirm.projectId) {
            onRemoveProject(deleteConfirm.projectId)
          }
          setDeleteConfirm({ isOpen: false, projectId: null })
        }}
        title={t('sessions.removeProjectTitle')}
        description={t('sessions.removeProjectConfirm')}
        confirmText={t('common:remove')}
        variant="danger"
      />
    </div>
  )
}

// ============================================
// ProjectItem Component
// ============================================

interface ProjectItemProps {
  project: ApiProject
  displayName: string
  path: string
  onSelect: () => void
  onRemove?: () => void
}

function ProjectItem({ project, displayName, path, onSelect, onRemove }: ProjectItemProps) {
  const { t } = useTranslation(['commands', 'common'])
  const isGlobal = project.id === 'global'

  return (
    <div className="group w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-bg-100 transition-colors">
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex flex-1 items-center gap-2.5 text-left bg-transparent border-none p-0"
        title={path}
      >
        <div
          className={`
          w-7 h-7 rounded-lg flex items-center justify-center shrink-0
          ${isGlobal ? 'bg-accent-main-100/15 text-accent-main-100' : 'bg-bg-200 text-text-400'}
        `}
        >
          {isGlobal ? <GlobeIcon className="w-3.5 h-3.5" /> : <FolderIcon className="w-3.5 h-3.5" />}
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="text-[length:var(--fs-base)] text-text-200 truncate">{displayName}</div>
          <div className="text-[length:var(--fs-xxs)] text-text-400/60 truncate font-mono">{path}</div>
        </div>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('common:remove')}
          className="p-1 rounded text-text-400 hover:text-danger-100 hover:bg-danger-100/10 md:opacity-0 md:group-hover:opacity-100 transition-colors"
          title={t('common:remove')}
        >
          <TrashIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
