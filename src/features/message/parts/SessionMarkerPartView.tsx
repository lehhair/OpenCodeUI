import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon } from '../../../components/Icons'
import { useDisclosureScrollLock } from '../../../hooks'
import type { SessionMarkerPart, SessionMarkerMessage } from '../../../types/message'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { chevronClass, MessageExpandPanel, useMessageExpandRender } from '../messageExpand'

// ============================================
// Session Marker Part View —— V2 新增消息类型的渲染
// ============================================
//
// 背景：V2 在 user / assistant 之外新增了 9 种消息（迁移文档 §5.3）。
//   它们的共同点是「**一行转录提示**」而不是对话内容，所以共用这一个视图，
//   按 `marker.type` 分支渲染。转换层把它们统一包成
//   `{ type: 'session-marker', marker }`（见 messageConversion.ts）。
//
// 实测（本机 17,288 条真实 V2 消息）：
//   - `system`   482 条 —— 指令/上下文更新通知，`description` 是给人看的摘要
//   - `synthetic` 71 条 —— 官方用来把 shell 作业产出插进转录
//   - `idle`      81 条 —— 一轮结束边界（**不渲染**，见下）
//   - `location-switched` 1 条
//   - `skill` / `shell` / `agent-switched` / `model-switched` 本次样本中为 0
//
// ⚠️ `idle` 故意**不渲染**：它只是「一轮结束」的边界标记，
//    可见的耗时/完成时刻已由 assistant 尾部的 step-finish 与 footer 展示，
//    再画一条分隔线只会让信息流变吵。

interface SessionMarkerPartViewProps {
  part: SessionMarkerPart
}

export const SessionMarkerPartView = memo(function SessionMarkerPartView({ part }: SessionMarkerPartViewProps) {
  const { marker } = part

  switch (marker.type) {
    case 'idle':
      // 见文件头注释：边界标记，不产生可见内容
      return null
    case 'system':
      return <NoticeLine text={marker.description ?? marker.text} />
    case 'synthetic':
      return <CollapsibleText marker={marker} part={part} />
    case 'skill':
      return <NoticeLine text={marker.name} />
    case 'shell':
      return <ShellLine marker={marker} />
    case 'agent-switched':
      return <NoticeLine text={marker.agent} />
    case 'model-switched':
      return <NoticeLine text={marker.model.id} />
    case 'location-switched':
      return <NoticeLine text={marker.location.directory} mono />
  }
})

// ============================================
// 一行式提示（分隔线 + 居中小字）
// ============================================

const NoticeLine = memo(function NoticeLine({ text, mono = false }: { text: string; mono?: boolean }) {
  if (!text) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-500">
      <span className="flex-1 h-px bg-border-200/70" />
      <span
        className={`shrink-0 text-[length:var(--fs-xs)] leading-none text-text-400 max-w-[70%] truncate ${
          mono ? 'font-mono' : ''
        }`}
        title={text}
      >
        {text}
      </span>
      <span className="flex-1 h-px bg-border-200/70" />
    </div>
  )
})

// ============================================
// shell 命令消息
// ============================================

const SHELL_STATUS_KEYS: Record<string, string> = {
  running: 'marker.shellRunning',
  exited: 'marker.shellExited',
  timeout: 'marker.shellTimeout',
  killed: 'marker.shellKilled',
}

const ShellLine = memo(function ShellLine({ marker }: { marker: Extract<SessionMarkerMessage, { type: 'shell' }> }) {
  const { t } = useTranslation('message')
  const statusKey = SHELL_STATUS_KEYS[marker.status] ?? 'marker.shellRunning'

  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-2 text-[length:var(--fs-xs)] text-text-500">
        <span className="shrink-0">{t(statusKey)}</span>
        <span className="font-mono text-text-400 truncate" title={marker.command}>
          {marker.command}
        </span>
      </div>
    </div>
  )
})

// ============================================
// 可展开的正文（synthetic —— 实测就是 shell 作业的产出）
// ============================================

const CollapsibleText = memo(function CollapsibleText({
  marker,
  part,
}: {
  marker: Extract<SessionMarkerMessage, { type: 'synthetic' }>
  part: SessionMarkerPart
}) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useUiDisclosureState(`message:${part.messageID}:marker:${part.id}`, false)
  const shouldRenderBody = useMessageExpandRender(expanded)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()

  return (
    <div ref={rootRef} className="rounded-md border border-border-200/60 bg-bg-100/50 overflow-hidden">
      <button
        type="button"
        ref={headerRef}
        onClick={() => withScrollLock(() => setExpanded(!expanded))}
        aria-expanded={expanded}
        className="flex h-8 w-full items-center gap-2 px-3 text-left bg-transparent border-none hover:bg-bg-200/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <span className="text-[length:var(--fs-base)] text-text-300 truncate">
            {marker.description ?? t('marker.synthetic')}
          </span>
        </div>
        <ChevronDownIcon className={chevronClass(expanded)} />
      </button>

      <MessageExpandPanel open={expanded} variant="fade" innerClassName="overflow-hidden">
        {shouldRenderBody && (
          <div className="px-3 py-2 border-t border-border-200/40">
            <pre className="text-[length:var(--fs-sm)] text-text-300 font-mono whitespace-pre-wrap break-words overflow-x-hidden m-0">
              {marker.text}
            </pre>
          </div>
        )}
      </MessageExpandPanel>
    </div>
  )
})
