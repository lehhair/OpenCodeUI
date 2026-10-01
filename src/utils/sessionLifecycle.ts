import { activeSessionStore } from '../store/activeSessionStore'
import { childSessionStore } from '../store/childSessionStore'
import { followupQueueStore } from '../store/followupQueueStore'
import { messageStore } from '../store/messageStore'

export function clearSessionRuntimeState(sessionId: string) {
  const sessionIds = childSessionStore.getSessionAndDescendants(sessionId)

  for (const id of sessionIds) {
    messageStore.clearSession(id)
    followupQueueStore.clearSession(id)
    activeSessionStore.removeSession(id)
  }

  childSessionStore.removeSession(sessionId)
}
