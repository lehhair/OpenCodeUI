import { useState } from 'react'
import type { ApiPermissionRequest, PermissionReply } from '../../api'
import { PermissionListIcon, UsersIcon, ReturnIcon, ChevronDownIcon, ChevronUpIcon } from '../../components/Icons'
import { DiffView } from '../../components/DiffView'
import { ContentBlock } from '../../components'
import { childSessionStore, autoApproveStore } from '../../store'

interface PermissionDialogProps {
  request: ApiPermissionRequest
  onReply: (reply: PermissionReply) => void
  onAutoApprove?: (sessionId: string, permission: string, patterns: string[]) => void  // 添加本地规则
  queueLength?: number  // 队列中的请求数量
  isReplying?: boolean  // 是否正在回复
  currentSessionId?: string | null  // 当前主 session ID，用于判断是否来自子 agent
}

export function PermissionDialog({ request, onReply, onAutoApprove, queueLength = 1, isReplying = false, currentSessionId }: PermissionDialogProps) {
  const [collapsed, setCollapsed] = useState(false)

  // 从 metadata 中提取 diff 信息
  const metadata = request.metadata
  const diff = metadata?.diff as string | undefined
  const filepath = metadata?.filepath as string | undefined
  
  // Extract structured filediff if available
  let before: string | undefined
  let after: string | undefined
  
  if (metadata?.filediff && typeof metadata.filediff === 'object') {
    const fd = metadata.filediff as Record<string, unknown>
    before = String(fd.before || '')
    after = String(fd.after || '')
  }
  
  // 判断是否是文件编辑类权限
  const isFileEdit = request.permission === 'edit' || request.permission === 'write'

  // 判断是否来自子 session
  const isFromChildSession = currentSessionId && request.sessionID !== currentSessionId
  const childSessionInfo = isFromChildSession 
    ? childSessionStore.getSessionInfo(request.sessionID) 
    : null

  // 折叠态：小胶囊
  if (collapsed) {
    return (
      <div className="absolute bottom-0 left-0 right-0 z-[10] pointer-events-none">
        <div className="mx-auto max-w-3xl px-4 pb-4 flex justify-center">
          <button
            onClick={() => setCollapsed(false)}
            className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-000 border border-border-200/50 shadow-lg text-sm text-text-200 hover:bg-bg-200 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            <PermissionListIcon size={14} />
            <span className="font-medium">Permission: {request.permission}</span>
            {queueLength > 1 && (
              <span className="text-xs text-text-400 bg-bg-200 px-1.5 py-0.5 rounded-full">
                +{queueLength - 1}
              </span>
            )}
            <ChevronUpIcon size={14} className="text-text-400" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[10]">
      <div className="mx-auto max-w-3xl px-4 pb-4">
        <div className="border border-border-300/40 rounded-[14px] shadow-float bg-bg-100 overflow-hidden">
          <div className="bg-bg-000 rounded-t-[14px]">
            {/* Header */}
            <div className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center text-text-100 w-5 h-5">
                  <PermissionListIcon size={20} />
                </div>
                <h3 className="text-sm font-medium text-text-100">Permission: {request.permission}</h3>
                {queueLength > 1 && (
                  <span className="text-xs text-text-400 bg-bg-200 px-1.5 py-0.5 rounded">
                    +{queueLength - 1} more
                  </span>
                )}
              </div>
              <button
                onClick={() => setCollapsed(true)}
                className="p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200 transition-colors"
                title="Minimize"
              >
                <ChevronDownIcon size={16} />
              </button>
            </div>

            {/* Child session indicator */}
            {isFromChildSession && (
              <div className="px-4 pb-2 flex items-center gap-2">
                <UsersIcon className="w-3.5 h-3.5 text-info-100" />
                <span className="text-xs text-info-100">
                  From subtask: {childSessionInfo?.title || 'Subtask'}
                </span>
              </div>
            )}

            <div className="border-t border-border-300/30" />

            {/* Content */}
            <div className="px-4 py-3 space-y-4 max-h-[45vh] overflow-y-auto custom-scrollbar">
              {/* Diff Preview for file edits */}
              {isFileEdit && diff && (
                <div>
                  <p className="text-xs text-text-400 mb-2">Changes preview</p>
                  <DiffView 
                    diff={diff} 
                    before={before}
                    after={after}
                    filePath={filepath}
                    defaultCollapsed={false}
                    maxHeight={200}
                  />
                </div>
              )}

              {/* Patterns */}
              {request.patterns && request.patterns.length > 0 && (
                <ContentBlock
                  label="Requesting"
                  content={request.patterns.map(p => p.replace(/\\n/g, '\n')).join('\n\n')}
                  language="bash"
                  maxHeight={200}
                  collapsible={false}
                />
              )}

              {/* Already allowed */}
              {request.always && request.always.length > 0 && (
                <ContentBlock
                  label="Allowed"
                  content={request.always.join('\n')}
                  language="bash"
                  maxHeight={80}
                  collapsible={false}
                />
              )}
            </div>

            {/* Actions */}
            <div className="px-3 py-3 space-y-[6px]">
              {/* Primary: Allow once */}
              <button
                onClick={() => onReply('once')}
                disabled={isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg bg-text-100 text-bg-000 hover:bg-text-200 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{isReplying ? 'Sending...' : 'Allow once'}</span>
                {!isReplying && <ReturnIcon />}
              </button>
              
              {/* Secondary: Always allow */}
              <button
                onClick={() => {
                  if (autoApproveStore.enabled && request.always && request.always.length > 0) {
                    // 实验性功能：添加本地规则，然后用 once 回复
                    autoApproveStore.addRules(request.sessionID, request.permission, request.always)
                    onAutoApprove?.(request.sessionID, request.permission, request.always)
                    onReply('once')
                  } else {
                    // 原有行为：发送 always 给后端
                    onReply('always')
                  }
                }}
                disabled={isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg border border-border-200/50 text-text-100 hover:bg-bg-200 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>Always allow</span>
                <span className="text-xs text-text-400">
                  {autoApproveStore.enabled ? 'Browser session' : 'This session'}
                </span>
              </button>

              {/* Tertiary: Reject */}
              <button
                onClick={() => onReply('reject')}
                disabled={isReplying}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-text-300 hover:bg-bg-200 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>Reject</span>
                <span className="text-xs text-text-500">Esc</span>
              </button>

              <p className="text-[11px] text-text-500 pt-1 px-1 leading-relaxed">
                {autoApproveStore.enabled 
                  ? 'Auto-approve enabled. Refresh browser to reset permissions.'
                  : 'You can change permission settings at any time.'}
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

