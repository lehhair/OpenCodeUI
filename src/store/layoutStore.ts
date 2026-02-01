// ============================================
// LayoutStore - 全局 UI 布局状态
// ============================================

export type RightPanelTab = 'changes' | 'terminal' | 'preview'

interface LayoutState {
  rightPanelOpen: boolean
  activeTab: RightPanelTab
  rightPanelWidth: number
}

type Subscriber = () => void

class LayoutStore {
  private state: LayoutState = {
    rightPanelOpen: false,
    activeTab: 'changes',
    rightPanelWidth: 450
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
  // Actions
  // ============================================

  toggleRightPanel(tab?: RightPanelTab) {
    if (tab && tab !== this.state.activeTab) {
      this.state.activeTab = tab
      this.state.rightPanelOpen = true
    } else {
      this.state.rightPanelOpen = !this.state.rightPanelOpen
    }
    this.notify()
  }

  openRightPanel(tab: RightPanelTab) {
    this.state.rightPanelOpen = true
    this.state.activeTab = tab
    this.notify()
  }

  closeRightPanel() {
    this.state.rightPanelOpen = false
    this.notify()
  }

  setRightPanelWidth(width: number) {
    this.state.rightPanelWidth = width
    // 保存到 localStorage
    try {
      localStorage.setItem('opencode-right-panel-width', width.toString())
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
