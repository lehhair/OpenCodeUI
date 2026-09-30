import type { DragDropEvent } from '@tauri-apps/api/webview'
import { getDesktopPlatform, isTauri } from '../utils/tauri'

export type TauriDragDropEvent = DragDropEvent
export type TauriDropPosition = Extract<DragDropEvent, { type: 'drop' }>['position']

export interface DroppedPathInfo {
  type: 'file' | 'folder'
  path: string
  name: string
}

export function getTauriDropClientPoints(position: TauriDropPosition): Array<{ x: number; y: number }> {
  const directPoint = { x: position.x, y: position.y }
  const scale = window.devicePixelRatio || 1
  if (scale === 1) return [directPoint]
  return [directPoint, { x: position.x / scale, y: position.y / scale }]
}

/** Physical + CSS 坐标双试，兼容 Windows / macOS 拖放坐标差异 */
export function isTauriDropPointInsideElement(position: TauriDropPosition, element: HTMLElement | null): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return getTauriDropClientPoints(position).some(
    ({ x, y }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  )
}

export async function getDroppedPathsInfo(paths: string[]): Promise<DroppedPathInfo[]> {
  if (paths.length === 0) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<DroppedPathInfo[]>('get_dropped_paths_info', { paths })
}

function trackCleanup(disposed: () => boolean, cleanups: Array<() => void>, unlisten: () => void) {
  if (disposed()) {
    unlisten()
    return
  }
  cleanups.push(unlisten)
}

/**
 * 订阅桌面端文件/文件夹拖放。
 * - Windows / Linux: Tauri onDragDropEvent
 * - macOS: Rust WindowEvent::DragDrop 转发的 file-drop-*（标准 API 不可靠）
 * 非 Tauri 环境返回 no-op。
 */
export function subscribeTauriDragDrop(handler: (event: TauriDragDropEvent) => void): () => void {
  if (!isTauri()) return () => {}

  const platform = getDesktopPlatform()
  let disposed = false
  const isDisposed = () => disposed
  const cleanups: Array<() => void> = []

  if (platform === 'macos') {
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        if (disposed) return
        const { PhysicalPosition } = await import('@tauri-apps/api/dpi')
        if (disposed) return

        const onEnter = await listen<[string[], number, number]>('file-drop-enter', e => {
          if (disposed) return
          handler({
            type: 'enter',
            paths: e.payload[0],
            position: new PhysicalPosition(e.payload[1], e.payload[2]),
          })
        })
        trackCleanup(isDisposed, cleanups, onEnter)

        const onOver = await listen<[number, number]>('file-drop-over', e => {
          if (disposed) return
          handler({
            type: 'over',
            position: new PhysicalPosition(e.payload[0], e.payload[1]),
          })
        })
        trackCleanup(isDisposed, cleanups, onOver)

        const onDrop = await listen<[string[], number, number]>('file-drop-drop', e => {
          if (disposed) return
          handler({
            type: 'drop',
            paths: e.payload[0],
            position: new PhysicalPosition(e.payload[1], e.payload[2]),
          })
        })
        trackCleanup(isDisposed, cleanups, onDrop)

        const onLeave = await listen<void>('file-drop-leave', () => {
          if (disposed) return
          handler({ type: 'leave' })
        })
        trackCleanup(isDisposed, cleanups, onLeave)
      })
      .catch(err => {
        console.warn('[tauriDragDrop] Failed to listen for macOS file-drop events:', err)
      })
  } else {
    void import('@tauri-apps/api/webview')
      .then(async ({ getCurrentWebview }) => {
        if (disposed) return
        const unlisten = await getCurrentWebview().onDragDropEvent(event => {
          if (disposed) return
          handler(event.payload)
        })
        trackCleanup(isDisposed, cleanups, unlisten)
      })
      .catch(err => {
        console.warn('[tauriDragDrop] Failed to listen for drag-drop events:', err)
      })
  }

  return () => {
    disposed = true
    cleanups.forEach(fn => fn())
    cleanups.length = 0
  }
}
