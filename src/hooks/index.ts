export { useClickOutside } from './useClickOutside'
export { useDropdown } from './useDropdown'
export { usePermissions } from './usePermissions'
export { useTheme } from './useTheme'
export { useModels } from './useModels'
export { useSessions } from './useSessions'
export { useRouter } from './useRouter'
export { useProject } from './useProject'
export { usePermissionHandler } from './usePermissionHandler'
export { useMessageAnimation } from './useMessageAnimation'
export { useSessionManager } from './useSessionManager'
export { useGlobalEvents } from './useGlobalEvents'
export { registerSessionConsumer, updateConsumerSessionId, hasOtherConsumerForSession } from './useGlobalEvents'
export type { SessionEventCallbacks } from './useGlobalEvents'
export { useDelayedRender } from './useDelayedRender'
export { useDisclosureScrollLock } from './useDisclosureScrollLock'
export { useCompositorExpand } from './useCompositorExpand'
export { useBackClose } from './useBackClose'
export { useModelSelection } from './useModelSelection'
export { useChatSession } from './useChatSession'
export { usePathMode } from './usePathMode'
export { useSessionStats, formatTokens, formatCost } from './useSessionStats'
export { useFileExplorer } from './useFileExplorer'
export { useIsMobile } from './useIsMobile'
export { useServerStore } from './useServerStore'
export { useKeybindingStore, useGlobalKeybindings, useKeybindingLabel } from './useKeybindings'
export type { KeybindingHandlers } from './useKeybindings'
export { useNotification } from './useNotification'
export { usePresence } from './usePresence'
export { useResponsiveMaxHeight } from './useResponsiveMaxHeight'
export type { ThemeMode } from './useTheme'
export type { UseProjectResult } from './useProject'
// ⛔ 阶段 3b 已删除 `useRevertState`（含 `UseRevertStateResult` / `RevertHistoryItem`）：
//    该 hook 全仓库零消费点（真正在跑 undo/redo 的是 `useSessionManager`）。
//    真正的撤销历史类型在 `src/store/messageStoreTypes.ts`（那边才有消费方）。
export type { UsePermissionHandlerResult } from './usePermissionHandler'
export type { SessionStats } from './useSessionStats'
export type { FileTreeNode, UseFileExplorerOptions, UseFileExplorerResult } from './useFileExplorer'
export { useVcsInfo } from './useVcsInfo'
export type { UseVcsInfoResult } from './useVcsInfo'
export { useGitWorkspaceCatalog, requestGitWorkspaceCatalogRefresh } from './useGitWorkspaceCatalog'
export type { GitWorkspaceCatalog, GitWorkspaceMeta } from './useGitWorkspaceCatalog'

// Re-export from contexts
export {
  DirectoryProvider,
  useDirectory,
  useCurrentDirectory,
  useSavedDirectories,
  usePathInfo,
  useSidebarExpanded,
  SessionProvider,
  useSessionContext,
} from '../contexts'
export type { DirectoryContextValue, SessionContextValue } from '../contexts'
