import { FolderIcon, GitBranchIcon } from '../../components/Icons'

export interface SessionHeaderLocation {
  workspaceName?: string
  branchName?: string
}

interface SessionHeaderLocationLabelsProps {
  location: SessionHeaderLocation
  textClassName: string
  iconSize?: number
  workspaceMaxWidthClass?: string
  branchMaxWidthClass?: string
}

export function SessionHeaderLocationLabels({
  location,
  textClassName,
  iconSize = 12,
  workspaceMaxWidthClass = 'max-w-[120px]',
  branchMaxWidthClass = 'max-w-[120px]',
}: SessionHeaderLocationLabelsProps) {
  const { workspaceName, branchName } = location
  if (!workspaceName && !branchName) return null

  return (
    <div className={`flex items-center min-w-0 gap-1.5 shrink-0 font-medium ${textClassName}`}>
      {workspaceName && (
        <span
          className={`inline-flex items-center gap-1 min-w-0 truncate ${workspaceMaxWidthClass}`}
          title={workspaceName}
        >
          <FolderIcon size={iconSize} className="shrink-0" />
          <span className="truncate">{workspaceName}</span>
        </span>
      )}
      {workspaceName && branchName && <span className="shrink-0 opacity-70">·</span>}
      {branchName && (
        <span
          className={`inline-flex items-center gap-1 min-w-0 truncate ${branchMaxWidthClass}`}
          title={branchName}
        >
          <GitBranchIcon size={iconSize} className="shrink-0" />
          <span className="truncate">{branchName}</span>
        </span>
      )}
    </div>
  )
}