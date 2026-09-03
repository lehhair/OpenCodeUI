import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, FolderIcon, GitBranchIcon } from '../../components/Icons'
import { useDropdown, useGitWorkspaceCatalog, useVcsInfo } from '../../hooks'
import { isSameDirectory, normalizeToForwardSlash } from '../../utils'
import { SessionHeaderLocationLabels, type SessionHeaderLocation } from './SessionHeaderLocation'
import { getWorkspaceDisplayName } from './sidebar/recentWorkspaceDirectories'
import { useRecentWorkspaceDirectories } from './useRecentWorkspaceDirectories'
import { useSwitchWorkspaceDirectory } from './useSwitchWorkspaceDirectory'

interface SessionHeaderLocationPickerProps {
  currentDirectory?: string
  location: SessionHeaderLocation
  textClassName: string
  iconSize?: number
  workspaceMaxWidthClass?: string
  branchMaxWidthClass?: string
}

function WorkspaceDropdownOption({
  directory,
  isSelected,
  onSelect,
}: {
  directory: string
  isSelected: boolean
  onSelect: () => void
}) {
  const normalized = normalizeToForwardSlash(directory)
  const catalogInput = useMemo(() => [normalized], [normalized])
  const { catalog } = useGitWorkspaceCatalog(catalogInput)
  const { vcsInfo } = useVcsInfo(normalized)
  const workspaceName = getWorkspaceDisplayName(normalized, catalog)
  const branchName = vcsInfo?.branch

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
        isSelected ? 'bg-accent-main-100/10 text-text-100' : 'text-text-300 hover:bg-bg-200/60 hover:text-text-100'
      }`}
    >
      <span className="inline-flex items-center gap-1 min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium">
        <FolderIcon size={12} className="shrink-0" />
        <span className="truncate">{workspaceName}</span>
        {branchName && (
          <>
            <span className="opacity-60">·</span>
            <GitBranchIcon size={12} className="shrink-0" />
            <span className="truncate">{branchName}</span>
          </>
        )}
      </span>
    </button>
  )
}

export function SessionHeaderLocationPicker({
  currentDirectory,
  location,
  textClassName,
  iconSize = 12,
  workspaceMaxWidthClass,
  branchMaxWidthClass,
}: SessionHeaderLocationPickerProps) {
  const { t } = useTranslation('chat')
  const switchWorkspace = useSwitchWorkspaceDirectory()
  const workspaceDirectories = useRecentWorkspaceDirectories(currentDirectory)
  const { isOpen, toggle, close, triggerRef, menuRef } = useDropdown<HTMLDivElement>()
  const normalizedCurrent = currentDirectory ? normalizeToForwardSlash(currentDirectory) : undefined
  const canSwitch = workspaceDirectories.length > 0

  if (!location.workspaceName && !location.branchName) return null

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={event => {
          event.stopPropagation()
          if (canSwitch) toggle()
        }}
        disabled={!canSwitch}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={t('header.switchWorkspace')}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-text-200 transition-colors hover:text-text-100 ${
          canSwitch ? 'cursor-pointer' : 'cursor-default'
        } ${textClassName}`}
      >
        <SessionHeaderLocationLabels
          location={location}
          textClassName={textClassName}
          iconSize={iconSize}
          workspaceMaxWidthClass={workspaceMaxWidthClass}
          branchMaxWidthClass={branchMaxWidthClass}
        />
        {canSwitch && (
          <ChevronDownIcon
            size={11}
            className={`shrink-0 opacity-70 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {canSwitch && (
        <div
          data-dropdown-open={isOpen ? '' : undefined}
          className={`absolute left-0 top-full z-50 mt-1 min-w-[220px] max-w-[min(320px,calc(100vw-2rem))] origin-top transition-all duration-200 ${
            isOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
          }`}
          aria-hidden={!isOpen}
        >
          <div className="glass overflow-hidden rounded-xl border border-border-200/60 shadow-lg">
            <div className="px-2.5 py-1.5 text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-400/70">
              {t('header.recentWorkspaces')}
            </div>
            <div className="max-h-[240px] overflow-y-auto custom-scrollbar p-1">
              {workspaceDirectories.map(directory => (
                <WorkspaceDropdownOption
                  key={directory}
                  directory={directory}
                  isSelected={!!normalizedCurrent && isSameDirectory(directory, normalizedCurrent)}
                  onSelect={() => {
                    switchWorkspace(directory)
                    close()
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}