// ============================================
// Store Exports
// ============================================

export { messageStore } from './messageStore'
export type { SessionState, RevertState, RevertHistoryItem } from './messageStoreTypes'
export type { MessageStoreSnapshot, SessionStateSnapshot } from './messageStoreTypes'
export {
  useMessageStore,
  useMessageStoreSelector,
  useSessionState,
  useCurrentSessionId,
  useIsStreaming,
  useMessages,
  useUndoRedoState,
} from './messageStoreHooks'

export { childSessionStore, useChildSessions, useSessionFamily } from './childSessionStore'
export type { ChildSessionInfo } from './childSessionStore'

export { layoutStore, useLayoutStore, exportLayoutBackup, importLayoutBackup } from './layoutStore'
export type { LayoutBackup } from './layoutStore'

export { changeScopeStore, useSessionChangeScope } from './changeScopeStore'
export type { ChangeScopeMode } from './changeScopeStore'

export { paneLayoutStore, usePaneLayout } from './paneLayoutStore'
export type { PaneNode, PaneLeaf, PaneSplit, PaneLayoutSnapshot } from './paneLayoutStore'

export { paneControllerStore, usePaneController, usePaneControllers } from './paneControllerStore'
export type { PaneControllerState } from './paneControllerStore'

export { autoApproveStore } from './autoApproveStore'
export type { AutoApproveRule } from './autoApproveStore'

export { serverStore, makeBasicAuthHeader, exportServerSettingsBackup, importServerSettingsBackup } from './serverStore'
export type { ServerConfig, ServerHealth, ServerAuth, ServerSettingsBackup } from './serverStore'

export {
  keybindingStore,
  exportKeybindingBackup,
  importKeybindingBackup,
  parseKeybinding,
  formatKeybinding,
  keyEventToString,
  matchesKeybinding,
} from './keybindingStore'
export type { KeybindingAction, KeybindingBackup, KeybindingConfig, ParsedKeybinding } from './keybindingStore'

export { themeStore, exportThemeBackup, importThemeBackup } from './themeStore'
export type { ColorMode, ThemeBackup, ThemeState } from './themeStore'

export { todoStore, useTodos, useTodoStats, useCurrentTask } from './todoStore'
export type { SessionTodos } from './todoStore'

export {
  notificationStore,
  exportNotificationPreferencesBackup,
  importNotificationPreferencesBackup,
  useNotificationStore,
  useNotifications,
  useUnreadNotificationCount,
} from './notificationStore'
export type { NotificationEntry, NotificationPreferencesBackup, NotificationType, ToastItem } from './notificationStore'

export { activeSessionStore, useActiveSessionStore, useBusySessions, useBusyCount } from './activeSessionStore'
export type { ActiveSessionEntry } from './activeSessionStore'

export { serviceStore, useServiceStore, exportServiceSettingsBackup, importServiceSettingsBackup } from './serviceStore'
export type { ServiceSettingsBackup } from './serviceStore'

export { modelVisibilityStore, useHiddenModelKeys } from './modelVisibilityStore'

export { soundStore, useSoundSettings, exportSoundBackup, importSoundBackup } from './soundStore'
export type { SoundBackup, SoundSettings, EventSoundConfig } from './soundStore'

export {
  notificationEventSettingsStore,
  useNotificationEventSettings,
  exportNotificationEventSettingsBackup,
  importNotificationEventSettingsBackup,
} from './notificationEventSettingsStore'
export type {
  NotificationEventSettings,
  NotificationEventConfig,
  NotificationEventSettingsBackup,
} from './notificationEventSettingsStore'

export { followupQueueStore, useFollowupQueue } from './followupQueueStore'
export type { QueuedFollowupDraft } from './followupQueueStore'

export {
  updateStore,
  useUpdateStore,
  compareVersions,
  hasUpdateAvailable,
  shouldShowUpdateToast,
  exportUpdateSettingsBackup,
  importUpdateSettingsBackup,
} from './updateStore'
export type { UpdateRelease, UpdateSettingsBackup, UpdateState } from './updateStore'
