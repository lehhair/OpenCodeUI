import type { CSSProperties, ReactNode, Ref } from 'react'
import { EXPAND_MOTION } from '../../constants/expandMotion'
import { useDelayedRender } from '../../hooks/useDelayedRender'

/**
 * 消息流折叠展开动画契约
 * - grid 与全局 EXPAND_MOTION 同源
 * - delayed unmount 略长于动画，避免收起中途卸 DOM
 * - clip 横向放行，防止流光 / 阴影被竖向裁切
 */
export const MSG_EXPAND = {
  durationMs: EXPAND_MOTION.durationMs,
  unmountDelayMs: EXPAND_MOTION.unmountDelayMs,
  panel: EXPAND_MOTION.gridTransition,
  panelFade: EXPAND_MOTION.gridFadeTransition,
  chevron: EXPAND_MOTION.chevronTransition,
  clipPath: EXPAND_MOTION.clipPath,
} as const

export function expandGridClass(open: boolean, animate = true, panelClassName: string = MSG_EXPAND.panel): string {
  const rows = open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
  if (!animate) return `grid ${rows}`
  return `grid ${panelClassName} ${rows}`
}

export function expandFadeGridClass(open: boolean): string {
  return `grid ${MSG_EXPAND.panelFade} ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`
}

const CHEVRON_SIZE = {
  sm: 'inline-flex h-5 w-3 shrink-0 items-center justify-center text-text-500',
  md: 'w-4 h-4 text-text-400',
} as const

export type ChevronSize = keyof typeof CHEVRON_SIZE

/** size=sm 给思考/小行；md 给卡片默认 chevron */
export function chevronClass(open: boolean, size: ChevronSize = 'md', extra = ''): string {
  return [CHEVRON_SIZE[size], MSG_EXPAND.chevron, open ? '' : '-rotate-90', extra].filter(Boolean).join(' ')
}

/** 消息流统一 unmount 延迟，与 MSG_EXPAND.unmountDelayMs 同源 */
export function useMessageExpandRender(show: boolean): boolean {
  return useDelayedRender(show, MSG_EXPAND.unmountDelayMs)
}

export type MessageExpandVariant = 'height' | 'fade'

export interface MessageExpandPanelProps {
  open: boolean
  children?: ReactNode
  /** height=纯高度；fade=高度+opacity（卡片） */
  variant?: MessageExpandVariant
  animate?: boolean
  /** compositor 桌面/Android 切换时的 panel class */
  panelClassName?: string
  contentRef?: Ref<HTMLDivElement | null>
  /** contentRef 所在的实际 body 节点 class；未提供时 ref 仍挂在 inner shell */
  contentClassName?: string
  /** 横向放行 clip，思考/过程壳用 */
  clip?: boolean
  className?: string
  innerClassName?: string
}

/**
 * 共享展开壳：grid 动画 + overflow 内层
 * 子节点是否挂载由调用方 useMessageExpandRender / compositor keepMounted 控制
 */
export function MessageExpandPanel({
  open,
  children,
  variant = 'height',
  animate = true,
  panelClassName = MSG_EXPAND.panel,
  contentRef,
  contentClassName,
  clip = false,
  className,
  innerClassName = 'min-h-0 min-w-0 overflow-hidden',
}: MessageExpandPanelProps) {
  const outerClass = variant === 'fade' ? expandFadeGridClass(open) : expandGridClass(open, animate, panelClassName)
  const style: CSSProperties | undefined = clip ? { clipPath: MSG_EXPAND.clipPath } : undefined

  return (
    <div className={className ? `${outerClass} ${className}` : outerClass}>
      <div ref={contentClassName ? undefined : contentRef} className={innerClassName} style={style}>
        {contentClassName ? (
          <div ref={contentRef} className={contentClassName}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
