// ============================================
// LayoutStore - 全局 UI 布局状态
// ============================================

import { syncableSetItem, onSyncRemoteChange } from '../utils/syncableStorage'

// 面板位置
export type PanelPosition = 'bottom' | 'right'

// 面板内容类型
export type PanelTabType = 'terminal' | 'files' | 'changes' | 'mcp' | 'skill' | 'worktree'

// 统一的面板标签
export interface PanelTab {
  id: string
  type: PanelTabType
  position: PanelPosition
  previewFile?: PreviewFile | null
  previewFiles?: PreviewFile[]
  // Terminal 特有属性
  ptyId?: string
  title?: string
  status?: 'connecting' | 'connected' | 'disconnected' | 'exited'
}

// 文件预览的文件信息
export interface PreviewFile {
  path: string
  name: string
}

const MAX_RIGHT_PANEL_WIDTH = 1280

// 兼容旧的 TerminalTab 类型
export interface TerminalTab {
  id: string // PTY session ID
  title: string // 显示标题
  status: 'connecting' | 'connected' | 'disconnected' | 'exited'
}

// 旧的 RightPanelView 类型 - 兼容
export type RightPanelView = 'files' | 'changes'

interface LayoutState {
  // 统一的面板标签系统
  panelTabs: PanelTab[]
  activeTabId: {
    bottom: string | null
    right: string | null
  }

  // 侧边栏
  sidebarExpanded: boolean
  sidebarFolderRecents: boolean

  // 右侧栏
  rightPanelOpen: boolean
  rightPanelWidth: number

  // 底部面板
  bottomPanelOpen: boolean
  bottomPanelHeight: number
}

type Subscriber = () => void

const STORAGE_KEY_SIDEBAR = 'opencode-sidebar-expanded'
const STORAGE_KEY_SIDEBAR_FOLDER_RECENTS = 'opencode-sidebar-folder-recents'

class LayoutStore {
  private state: LayoutState = {
    panelTabs: [
      // 默认 tabs: files 和 changes 在右侧面板
      { id: 'files', type: 'files', position: 'right', previewFile: null, previewFiles: [] },
      { id: 'changes', type: 'changes', position: 'right' },
    ],
    activeTabId: {
      bottom: null,
      right: 'files',
    },
    sidebarExpanded: true,
    sidebarFolderRecents: false,
    rightPanelOpen: false,
    rightPanelWidth: 450,
    bottomPanelOpen: false,
    bottomPanelHeight: 250,
  }
  private subscribers = new Set<Subscriber>()

  constructor() {
    // 从 localStorage 恢复状态
    try {
      // 侧边栏
      const savedSidebar = localStorage.getItem(STORAGE_KEY_SIDEBAR)
      if (savedSidebar !== null) {
        this.state.sidebarExpanded = savedSidebar !== 'false'
      }

      const savedFolderRecents = localStorage.getItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS)
      if (savedFolderRecents !== null) {
        this.state.sidebarFolderRecents = savedFolderRecents === 'true'
      }

      // 右侧面板宽度
      const savedWidth = localStorage.getItem('opencode-right-panel-width')
      if (savedWidth) {
        const width = parseInt(savedWidth)
        if (!isNaN(width) && width >= 300 && width <= MAX_RIGHT_PANEL_WIDTH) {
          this.state.rightPanelWidth = width
        }
      }

      // 底部面板高度
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

    // Listen for remote sync changes
    onSyncRemoteChange(
      [
        STORAGE_KEY_SIDEBAR,
        STORAGE_KEY_SIDEBAR_FOLDER_RECENTS,
        'opencode-right-panel-width',
        'opencode-bottom-panel-height',
      ],
      () => {
        try {
          const savedSidebar = localStorage.getItem(STORAGE_KEY_SIDEBAR)
          if (savedSidebar !== null) {
            this.state.sidebarExpanded = savedSidebar !== 'false'
          }
          const savedFolderRecents = localStorage.getItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS)
          if (savedFolderRecents !== null) {
            this.state.sidebarFolderRecents = savedFolderRecents === 'true'
          }
          const savedWidth = localStorage.getItem('opencode-right-panel-width')
          if (savedWidth) {
            const w = parseInt(savedWidth)
            if (!isNaN(w) && w >= 300 && w <= MAX_RIGHT_PANEL_WIDTH) {
              this.state.rightPanelWidth = w
            }
          }
          const savedBottomHeight = localStorage.getItem('opencode-bottom-panel-height')
          if (savedBottomHeight) {
            const h = parseInt(savedBottomHeight)
            if (!isNaN(h) && h >= 100 && h <= 500) {
              this.state.bottomPanelHeight = h
            }
          }
        } catch {
          // ignore
        }
        this.notify()
      },
    )
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
  // Sidebar
  // ============================================

  getSidebarExpanded(): boolean {
    return this.state.sidebarExpanded
  }

  setSidebarExpanded(expanded: boolean) {
    if (this.state.sidebarExpanded === expanded) return
    this.state.sidebarExpanded = expanded
    try {
      syncableSetItem(STORAGE_KEY_SIDEBAR, String(expanded))
    } catch {
      // ignore
    }
    this.notify()
  }

  setSidebarFolderRecents(enabled: boolean) {
    if (this.state.sidebarFolderRecents === enabled) return
    this.state.sidebarFolderRecents = enabled
    try {
      syncableSetItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS, String(enabled))
    } catch {
      // ignore
    }
    this.notify()
  }

  toggleSidebar() {
    this.setSidebarExpanded(!this.state.sidebarExpanded)
  }

  // ============================================
  // 辅助方法
  // ============================================

  /** 设置指定位置面板的开关状态 */
  private setPanelOpen(position: PanelPosition, open: boolean) {
    if (position === 'bottom') {
      this.state.bottomPanelOpen = open
    } else {
      this.state.rightPanelOpen = open
    }
  }

  // ============================================
  // 新的统一 Panel Tab API
  // ============================================

  // 获取指定位置的所有 tabs
  getTabsForPosition(position: PanelPosition): PanelTab[] {
    return this.state.panelTabs.filter(t => t.position === position)
  }

  // 获取指定位置的活动 tab
  getActiveTab(position: PanelPosition): PanelTab | null {
    const activeId = this.state.activeTabId[position]
    if (!activeId) return null
    return this.state.panelTabs.find(t => t.id === activeId && t.position === position) ?? null
  }

  // 设置活动 tab
  setActiveTab(position: PanelPosition, tabId: string) {
    const tab = this.state.panelTabs.find(t => t.id === tabId && t.position === position)
    if (tab) {
      this.state.activeTabId[position] = tabId
      this.notify()
    }
  }

  // 添加新 tab
  addTab(tab: Omit<PanelTab, 'id'> & { id?: string }, openPanel = true) {
    const id = tab.id ?? `${tab.type}-${Date.now()}`
    const newTab: PanelTab = { ...tab, id }
    this.state.panelTabs.push(newTab)
    this.state.activeTabId[tab.position] = id

    if (openPanel) {
      this.setPanelOpen(tab.position, true)
    }
    this.notify()
    return id
  }

  /**
   * 添加单例 tab（同一位置同类型只允许一个）
   * 如果已存在则激活，否则创建新的
   */
  private addSingletonTab(type: PanelTab['type'], position: PanelPosition, fixedId?: string): string {
    const existing = this.state.panelTabs.find(t => t.type === type && t.position === position)
    if (existing) {
      this.setActiveTab(position, existing.id)
      this.setPanelOpen(position, true)
      this.notify()
      return existing.id
    }
    return this.addTab({ type, position, ...(fixedId && { id: fixedId }) })
  }

  // 添加 Files 标签
  addFilesTab(position: PanelPosition) {
    return this.addTab({ type: 'files', position, previewFile: null, previewFiles: [] })
  }

  // 添加 Changes 标签
  addChangesTab(position: PanelPosition) {
    return this.addTab({ type: 'changes', position })
  }

  // 添加 MCP 标签
  addMcpTab(position: PanelPosition) {
    return this.addSingletonTab('mcp', position, 'mcp')
  }

  // 添加 Skill 标签
  addSkillTab(position: PanelPosition) {
    return this.addSingletonTab('skill', position, 'skill')
  }

  // 添加 Worktree 标签
  addWorktreeTab(position: PanelPosition) {
    return this.addSingletonTab('worktree', position, 'worktree')
  }

  // 移除 tab
  removeTab(tabId: string) {
    const index = this.state.panelTabs.findIndex(t => t.id === tabId)
    if (index === -1) return

    const tab = this.state.panelTabs[index]
    const position = tab.position
    this.state.panelTabs.splice(index, 1)

    // 如果关闭的是当前活动 tab，切换到同位置的相邻 tab
    if (this.state.activeTabId[position] === tabId) {
      const remainingTabs = this.getTabsForPosition(position)
      const newIndex = Math.min(index, remainingTabs.length - 1)
      this.state.activeTabId[position] = remainingTabs[newIndex]?.id ?? null
    }

    // 如果该位置没有 tab 了，关闭面板
    if (this.getTabsForPosition(position).length === 0) {
      this.setPanelOpen(position, false)
    }

    this.notify()
  }

  // 更新 tab 属性
  updateTab(tabId: string, updates: Partial<Omit<PanelTab, 'id' | 'type'>>) {
    const tab = this.state.panelTabs.find(t => t.id === tabId)
    if (tab) {
      Object.assign(tab, updates)
      this.notify()
    }
  }

  // 移动 tab 到另一个位置
  moveTab(tabId: string, toPosition: PanelPosition) {
    const tab = this.state.panelTabs.find(t => t.id === tabId)
    if (!tab || tab.position === toPosition) return

    const fromPosition = tab.position

    // 更新位置
    tab.position = toPosition

    // 更新活动状态
    // 如果原位置的 activeTab 是这个 tab，切换到其他 tab
    if (this.state.activeTabId[fromPosition] === tabId) {
      const remainingTabs = this.getTabsForPosition(fromPosition)
      this.state.activeTabId[fromPosition] = remainingTabs[0]?.id ?? null
    }

    // 新位置设为活动
    this.state.activeTabId[toPosition] = tabId

    // 打开目标面板
    if (toPosition === 'bottom') {
      this.state.bottomPanelOpen = true
    } else {
      this.state.rightPanelOpen = true
    }

    // 如果原位置空了，关闭面板
    if (this.getTabsForPosition(fromPosition).length === 0) {
      if (fromPosition === 'bottom') {
        this.state.bottomPanelOpen = false
      } else {
        this.state.rightPanelOpen = false
      }
    }

    this.notify()
  }

  // 重新排序同位置的 tabs
  reorderTabs(position: PanelPosition, draggedId: string, targetId: string) {
    const tabs = this.state.panelTabs
    const draggedIndex = tabs.findIndex(t => t.id === draggedId && t.position === position)
    const targetIndex = tabs.findIndex(t => t.id === targetId && t.position === position)

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
      return
    }

    const [draggedTab] = tabs.splice(draggedIndex, 1)
    tabs.splice(targetIndex, 0, draggedTab)

    this.notify()
  }

  // ============================================
  // 兼容旧 API - Right Panel
  // ============================================

  // 获取当前 rightPanelView (兼容)
  get rightPanelView(): RightPanelView {
    const activeTab = this.getActiveTab('right')
    if (activeTab?.type === 'files' || activeTab?.type === 'changes') {
      return activeTab.type
    }
    return 'files'
  }

  toggleRightPanel(view?: RightPanelView) {
    if (view) {
      const currentView = this.rightPanelView
      if (view !== currentView) {
        this.setRightPanelView(view)
        this.state.rightPanelOpen = true
      } else if (this.state.rightPanelOpen) {
        this.state.rightPanelOpen = false
      } else {
        this.state.rightPanelOpen = true
      }
    } else {
      this.state.rightPanelOpen = !this.state.rightPanelOpen
    }
    this.notify()
  }

  openRightPanel(view: RightPanelView) {
    this.state.rightPanelOpen = true
    this.setRightPanelView(view)
  }

  closeRightPanel() {
    this.state.rightPanelOpen = false
    this.notify()
  }

  setRightPanelView(view: RightPanelView) {
    // 找到该 view 对应的 tab 并激活
    const tab = this.state.panelTabs.find(t => t.type === view && t.position === 'right')
    if (tab) {
      this.state.activeTabId.right = tab.id
    }
    this.notify()
  }

  setRightPanelWidth(width: number) {
    this.state.rightPanelWidth = Math.min(Math.max(width, 300), MAX_RIGHT_PANEL_WIDTH)
    try {
      syncableSetItem('opencode-right-panel-width', this.state.rightPanelWidth.toString())
    } catch {
      // ignore
    }
    this.notify()
  }

  // ============================================
  // File Preview Actions
  // ============================================

  openFilePreview(file: PreviewFile, position?: PanelPosition) {
    const targetTab = this.getTargetFilesTab(position)
    if (!targetTab) return

    const previewFiles = targetTab.previewFiles ?? []
    const existingIndex = previewFiles.findIndex(item => item.path === file.path)
    const nextPreviewFiles =
      existingIndex === -1 ? [...previewFiles, file] : previewFiles.map(item => (item.path === file.path ? file : item))

    targetTab.previewFiles = nextPreviewFiles
    targetTab.previewFile = file
    this.state.activeTabId[targetTab.position] = targetTab.id
    this.setPanelOpen(targetTab.position, true)
    this.notify()
  }

  activateFilePreview(tabId: string, path: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const file = tab?.previewFiles?.find(item => item.path === path)
    if (!tab || !file) return
    tab.previewFile = file
    this.notify()
  }

  closeFilePreview(tabId: string, path?: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const previewFiles = tab?.previewFiles
    const targetPath = path ?? tab?.previewFile?.path
    if (!tab || !previewFiles || !targetPath) return

    const index = previewFiles.findIndex(item => item.path === targetPath)
    if (index === -1) return

    const isActive = tab.previewFile?.path === targetPath
    const nextPreviewFiles = previewFiles.filter(item => item.path !== targetPath)

    tab.previewFiles = nextPreviewFiles

    if (nextPreviewFiles.length === 0) {
      tab.previewFile = null
    } else if (isActive) {
      const nextIndex = Math.min(index, nextPreviewFiles.length - 1)
      tab.previewFile = nextPreviewFiles[nextIndex] ?? null
    }

    this.notify()
  }

  closeAllFilePreviews(tabId: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    if (!tab) return
    tab.previewFile = null
    tab.previewFiles = []
    this.notify()
  }

  reorderFilePreviews(tabId: string, draggedPath: string, targetPath: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const previewFiles = tab?.previewFiles
    if (!tab || !previewFiles) return

    const draggedIndex = previewFiles.findIndex(item => item.path === draggedPath)
    const targetIndex = previewFiles.findIndex(item => item.path === targetPath)

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return

    const nextPreviewFiles = [...previewFiles]
    const [dragged] = nextPreviewFiles.splice(draggedIndex, 1)
    nextPreviewFiles.splice(targetIndex, 0, dragged)
    tab.previewFiles = nextPreviewFiles
    this.notify()
  }

  private getTargetFilesTab(position?: PanelPosition): PanelTab | null {
    if (position) {
      const activeId = this.state.activeTabId[position]
      const activeFilesTab = this.state.panelTabs.find(
        t => t.id === activeId && t.type === 'files' && t.position === position,
      )
      if (activeFilesTab) return activeFilesTab

      const filesTab = this.state.panelTabs.find(t => t.type === 'files' && t.position === position)
      if (filesTab) return filesTab

      const id = this.addFilesTab(position)
      return this.state.panelTabs.find(t => t.id === id) ?? null
    }

    const preferred = (['right', 'bottom'] as const)
      .map(pos =>
        this.state.panelTabs.find(
          t => t.id === this.state.activeTabId[pos] && t.type === 'files' && t.position === pos,
        ),
      )
      .find(Boolean)
    if (preferred) return preferred

    return this.state.panelTabs.find(t => t.type === 'files') ?? null
  }

  // ============================================
  // 兼容旧 API - Bottom Panel
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
      syncableSetItem('opencode-bottom-panel-height', height.toString())
    } catch {
      // ignore
    }
    this.notify()
  }

  // ============================================
  // 兼容旧 API - Terminal Tabs
  // ============================================

  addTerminalTab(tab: TerminalTab, openPanel = true, position: PanelPosition = 'bottom') {
    this.addTab(
      {
        id: tab.id,
        type: 'terminal',
        position,
        ptyId: tab.id,
        title: tab.title,
        status: tab.status,
      },
      openPanel,
    )
  }

  removeTerminalTab(id: string) {
    this.removeTab(id)
  }

  setActiveTerminal(id: string) {
    this.setActiveTab('bottom', id)
  }

  updateTerminalTab(id: string, updates: Partial<Omit<TerminalTab, 'id'>>) {
    this.updateTab(id, updates)
  }

  reorderTerminalTabs(draggedId: string, targetId: string) {
    this.reorderTabs('bottom', draggedId, targetId)
  }

  getTerminalTabs(): TerminalTab[] {
    return this.getTabsForPosition('bottom')
      .filter(t => t.type === 'terminal')
      .map(t => ({
        id: t.id,
        title: t.title ?? 'Terminal',
        status: t.status ?? 'connecting',
      }))
  }

  // 获取当前活动的终端 ID
  get activeTerminalId(): string | null {
    const activeTab = this.getActiveTab('bottom')
    if (activeTab?.type === 'terminal') {
      return activeTab.id
    }
    return null
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

// 兼容的 snapshot 类型，包含派生属性
interface LayoutSnapshot extends LayoutState {
  // 派生属性 - 兼容旧组件
  rightPanelView: RightPanelView
  terminalTabs: TerminalTab[]
  activeTerminalId: string | null
}

let cachedSnapshot: LayoutSnapshot | null = null

function getSnapshot(): LayoutSnapshot {
  if (!cachedSnapshot) {
    const state = layoutStore.getState()
    cachedSnapshot = {
      ...state,
      // 派生属性
      rightPanelView: layoutStore.rightPanelView,
      terminalTabs: layoutStore.getTerminalTabs(),
      activeTerminalId: layoutStore.activeTerminalId,
    }
  }
  return cachedSnapshot
}

// 订阅更新时清除缓存
layoutStore.subscribe(() => {
  cachedSnapshot = null
})

export function useLayoutStore() {
  return useSyncExternalStore(cb => layoutStore.subscribe(cb), getSnapshot, getSnapshot)
}
