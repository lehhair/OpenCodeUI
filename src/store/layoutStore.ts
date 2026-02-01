// ============================================
// LayoutStore - 全局 UI 布局状态
// ============================================

// 右侧栏面板类型: files(文件浏览) 或 changes(变更)
export type RightPanelView = 'files' | 'changes'

// 文件预览的文件信息
export interface PreviewFile {
  path: string
  name: string
}

interface LayoutState {
  // 右侧栏
  rightPanelOpen: boolean
  rightPanelView: RightPanelView  // 当前视图
  rightPanelWidth: number
  
  // 文件预览状态
  previewFile: PreviewFile | null
  
  // 下边栏 (为将来的终端准备)
  bottomPanelOpen: boolean
  bottomPanelHeight: number
}

type Subscriber = () => void

class LayoutStore {
  private state: LayoutState = {
    rightPanelOpen: false,
    rightPanelView: 'files',
    rightPanelWidth: 450,
    previewFile: null,
    bottomPanelOpen: false,
    bottomPanelHeight: 200,
  }
  private subscribers = new Set<Subscriber>()

  constructor() {
    // 从 localStorage 恢复宽度
    try {
      const savedWidth = localStorage.getItem('opencode-right-panel-width')
      if (savedWidth) {
        const width = parseInt(savedWidth)
        if (!isNaN(width) && width >= 300 && width <= 800) {
          this.state.rightPanelWidth = width
        }
      }
      const savedBottomHeight = localStorage.getItem('opencode-bottom-panel-height')
      if (savedBottomHeight) {
        const height = parseInt(savedBottomHeight)
        if (!isNaN(height) && height >= 100 && height <= 500) {
          this.state.bottomPanelHeight = height
        }
      }
    } catch {
      // ignore
    }
  }

  // ============================================
  // Subscription
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private notify() {
    this.subscribers.forEach(fn => fn())
  }

  // ============================================
  // Right Panel Actions
  // ============================================

  toggleRightPanel(view?: RightPanelView) {
    if (view && view !== this.state.rightPanelView) {
      this.state.rightPanelView = view
      this.state.rightPanelOpen = true
    } else if (view === this.state.rightPanelView && this.state.rightPanelOpen) {
      this.state.rightPanelOpen = false
    } else {
      this.state.rightPanelOpen = !this.state.rightPanelOpen
    }
    this.notify()
  }

  openRightPanel(view: RightPanelView) {
    this.state.rightPanelOpen = true
    this.state.rightPanelView = view
    this.notify()
  }

  closeRightPanel() {
    this.state.rightPanelOpen = false
    this.notify()
  }

  setRightPanelView(view: RightPanelView) {
    this.state.rightPanelView = view
    this.notify()
  }

  setRightPanelWidth(width: number) {
    this.state.rightPanelWidth = width
    try {
      localStorage.setItem('opencode-right-panel-width', width.toString())
    } catch {
      // ignore
    }
    this.notify()
  }

  // ============================================
  // File Preview Actions
  // ============================================

  openFilePreview(file: PreviewFile) {
    this.state.previewFile = file
    // 打开右侧栏并切换到文件视图
    this.state.rightPanelOpen = true
    this.state.rightPanelView = 'files'
    this.notify()
  }

  closeFilePreview() {
    this.state.previewFile = null
    this.notify()
  }

  // ============================================
  // Bottom Panel Actions (为终端准备)
  // ============================================

  toggleBottomPanel() {
    this.state.bottomPanelOpen = !this.state.bottomPanelOpen
    this.notify()
  }

  openBottomPanel() {
    this.state.bottomPanelOpen = true
    this.notify()
  }

  closeBottomPanel() {
    this.state.bottomPanelOpen = false
    this.notify()
  }

  setBottomPanelHeight(height: number) {
    this.state.bottomPanelHeight = height
    try {
      localStorage.setItem('opencode-bottom-panel-height', height.toString())
    } catch {
      // ignore
    }
    this.notify()
  }

  getState() {
    return this.state
  }
}

export const layoutStore = new LayoutStore()

// ============================================
// React Hook
// ============================================

import { useSyncExternalStore } from 'react'

let cachedSnapshot: LayoutState | null = null

function getSnapshot(): LayoutState {
  if (!cachedSnapshot) {
    cachedSnapshot = { ...layoutStore.getState() }
  }
  return cachedSnapshot
}

// 订阅更新时清除缓存
layoutStore.subscribe(() => {
  cachedSnapshot = null
})

export function useLayoutStore() {
  return useSyncExternalStore(
    (cb) => layoutStore.subscribe(cb),
    getSnapshot,
    getSnapshot
  )
}
