import { memo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { RefObject } from 'react'
import { FastForwardIcon } from '../../../components/Icons'
import { autoApproveStore, type FullAutoMode } from '../../../store/autoApproveStore'

// ============================================
// Full Auto 状态 hook
// ============================================

function useFullAutoMode(paneId: string): FullAutoMode {
  return useSyncExternalStore(
    cb => autoApproveStore.onFullAutoChange(cb),
    () => autoApproveStore.getPaneFullAutoMode(paneId),
  )
}

// ============================================
// InputFooter - disclaimer + full auto toggle
// ============================================
//
// ⛔ 阶段 3b 已删除「待办进度」整块 UI（进度环 + 任务列表弹出面板 + TodoSwapPanel）。
//
//   原因：**V2 完全没有待办能力** ——
//     - `GET /session/{id}/todo` 端点已删除，事件侧也没有 `todo.updated`（阶段 2b 已确认
//       v2.0.19 源码里不存在该事件）；
//     - V2 的工具集里**没有 todo 工具**（v1 的 `todowrite` 被列进
//       `packages/core/src/database/v1-migration.bun.ts:901` 的 `REMOVED_TOOLS`）；
//     - 本地库的 `todo` 表最后写入时间是 2026-09-24，之后（V2 时代）**零写入**。
//
//   → 连带删除：`src/api/todo.ts`、`src/types/api/todo.ts`、`src/store/todoStore.ts`。
//
//   ⚠️ **但 `TodoRenderer`（消息流里渲染历史 `todowrite` 工具卡片）保留**：
//      本地库有 328 条 `todowrite` 工具调用，且它们所在的会话**都在 `session_v2` 表里**
//      （即在 V2 的会话列表里可见）→ 历史消息仍需要它渲染。

interface InputFooterProps {
  paneId: string
  sessionId?: string | null
  onNewChat?: () => void
  inputContainerRef?: RefObject<HTMLDivElement | null>
}

export const InputFooter = memo(function InputFooter({ paneId, onNewChat }: InputFooterProps) {
  const { t } = useTranslation(['chat', 'common'])
  const fullAutoMode = useFullAutoMode(paneId)

  return (
    <div className="relative flex h-full w-full items-center justify-center gap-2 text-[length:var(--fs-xs)] leading-none text-text-500">
      {/* Full Auto 三态切换: off -> session -> global -> off */}
      <button
        onClick={() => autoApproveStore.cyclePaneFullAutoMode(paneId)}
        className="shrink-0 flex items-center justify-center hover:text-text-300 transition-colors"
        title={
          fullAutoMode === 'off'
            ? t('inputFooter.autoApproveOff')
            : fullAutoMode === 'session'
              ? t('inputFooter.autoApproveSession')
              : t('inputFooter.autoApproveGlobal')
        }
      >
        <FastForwardIcon
          size={11}
          className={`transition-colors ${
            fullAutoMode === 'global'
              ? 'text-danger-100 drop-shadow-[0_0_4px_var(--color-danger-100)]'
              : fullAutoMode === 'session'
                ? 'text-warning-100 drop-shadow-[0_0_4px_var(--color-warning-100)]'
                : ''
          }`}
        />
      </button>

      <span className="text-text-500/30 shrink-0">·</span>

      {/* 免责声明（原来的「待办进度 / 任务列表」入口已随 V2 无待办能力一并删除） */}
      <button onClick={onNewChat} className="hover:text-text-300 transition-colors">
        {t('inputFooter.pleaseVerify')}
      </button>
    </div>
  )
})
