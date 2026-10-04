// ============================================
// SessionMoveMenu — 把会话移动到其他目录 / worktree
//
// 对应官方 session/timeline/session-workspace-menu.tsx：
//   - 目标列表 = 项目根（本地）+ 新建 worktree + 现有 worktree
//   - 会话运行中禁止移动（blocked while running）
//   - 成功后服务端发 session.moved，各列表据此增删
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitWorktreeIcon, SpinnerIcon } from '../../components/Icons'
import { getCurrentProject, moveSession } from '../../api/client'
import { listWorktreeEntries, createWorktree } from '../../api/worktree'
import { useSessionActiveEntry } from '../../store/activeSessionStore'
import { serverStore } from '../../store/serverStore'
import { makeSessionKey } from '../../utils/sessionKey'
import { isSameDirectory, normalizeToForwardSlash } from '../../utils'
import { uiErrorHandler } from '../../utils'

interface SessionMoveMenuProps {
  /** 会话 id（可为 scoped key） */
  sessionId: string
  /** 会话当前所在目录 */
  directory: string
}

interface MoveTarget {
  directory: string
  label: string
  kind: 'local' | 'worktree'
}

export function SessionMoveMenu({ sessionId, directory }: SessionMoveMenuProps) {
  const { t } = useTranslation(['chat', 'common'])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [moving, setMoving] = useState(false)
  const [targets, setTargets] = useState<MoveTarget[]>([])
  const [projectID, setProjectID] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // 官方 blocked()：会话运行中禁止移动
  const activeKey = makeSessionKey(serverStore.getActiveServerId(), sessionId)
  const activeEntry = useSessionActiveEntry(activeKey)
  const running = activeEntry?.status.type === 'busy' || activeEntry?.status.type === 'retry'

  const loadTargets = useCallback(async () => {
    setLoading(true)
    try {
      const project = await getCurrentProject(directory || undefined)
      if (!project) {
        setTargets([])
        setProjectID(null)
        return
      }
      setProjectID(project.id)
      const root = normalizeToForwardSlash(project.canonical)
      const current = normalizeToForwardSlash(directory)
      const entries = await listWorktreeEntries(project.id)
      const list: MoveTarget[] = []
      // 本地（项目根）：当前不在根时才列出（官方同款）
      if (!isSameDirectory(root, current)) {
        list.push({ directory: root, label: t('chat:sessionMove.local'), kind: 'local' })
      }
      for (const entry of entries) {
        const dir = normalizeToForwardSlash(entry.directory)
        if (isSameDirectory(dir, current) || isSameDirectory(dir, root)) continue
        list.push({ directory: dir, label: dir.split('/').filter(Boolean).pop() ?? dir, kind: 'worktree' })
      }
      setTargets(list)
    } catch {
      setTargets([])
      setProjectID(null)
    } finally {
      setLoading(false)
    }
  }, [directory, t])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const handleMove = async (destination: string) => {
    if (moving) return
    setMoving(true)
    try {
      await moveSession(sessionId, destination)
      setOpen(false)
      // 列表增删由 session.moved 事件驱动（useSessions）
    } catch (e) {
      uiErrorHandler('move session', e)
    } finally {
      setMoving(false)
    }
  }

  const handleCreateAndMove = async () => {
    const name = newName.trim()
    if (!name || !projectID || creating) return
    setCreating(true)
    try {
      const wt = await createWorktree({ projectID, name })
      setNewName('')
      await handleMove(normalizeToForwardSlash(wt.directory))
    } catch (e) {
      uiErrorHandler('create worktree', e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        disabled={running || moving}
        onClick={e => {
          e.stopPropagation()
          const next = !open
          setOpen(next)
          if (next) void loadTargets()
        }}
        title={running ? t('chat:sessionMove.runningTitle') : t('chat:sessionMove.title')}
        aria-label={t('chat:sessionMove.title')}
        className="p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {moving ? <SpinnerIcon size={12} className="animate-spin" /> : <GitWorktreeIcon size={12} />}
      </button>

      {open && (
        <div
          data-dropdown-open
          className="absolute z-50 top-full right-0 mt-1 w-56 glass border border-border-200/60 rounded-xl shadow-lg overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-2.5 py-1.5 text-[length:var(--fs-xs)] text-text-400 border-b border-border-200/40">
            {t('chat:sessionMove.title')}
          </div>
          <div className="max-h-56 overflow-y-auto custom-scrollbar p-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-3 text-text-400 text-[length:var(--fs-sm)]">
                <SpinnerIcon size={12} className="animate-spin" />
              </div>
            ) : targets.length === 0 ? (
              <div className="px-2 py-2 text-[length:var(--fs-sm)] text-text-400">{t('chat:sessionMove.empty')}</div>
            ) : (
              targets.map(target => (
                <button
                  key={target.directory}
                  type="button"
                  disabled={moving}
                  onClick={() => void handleMove(target.directory)}
                  title={target.directory}
                  className="w-full px-2 py-1.5 text-left text-[length:var(--fs-sm)] text-text-200 hover:bg-bg-100/60 hover:text-text-100 rounded-md transition-colors truncate disabled:opacity-50"
                >
                  {target.label}
                </button>
              ))
            )}
          </div>
          {/* 新建 worktree 并移入（官方菜单的 "create" 项） */}
          {projectID && (
            <div className="flex items-center gap-1 px-1.5 py-1.5 border-t border-border-200/40">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleCreateAndMove()
                  }
                }}
                placeholder={t('chat:sessionMove.newWorktreePlaceholder')}
                disabled={creating || moving}
                className="flex-1 min-w-0 bg-bg-000 border border-border-200 rounded-md px-2 py-1 text-[length:var(--fs-xs)] text-text-100 placeholder:text-text-400/60 focus:outline-none focus:border-accent-main-100/50"
              />
              <button
                type="button"
                onClick={() => void handleCreateAndMove()}
                disabled={!newName.trim() || creating || moving}
                className="px-2 py-1 text-[length:var(--fs-xs)] bg-accent-main-100 hover:bg-accent-main-200 text-oncolor-100 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0"
              >
                {creating && <SpinnerIcon size={10} className="animate-spin" />}
                {t('chat:sessionMove.newWorktree')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
