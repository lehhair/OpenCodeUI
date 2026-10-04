import { activeSessionStore } from '../store/activeSessionStore'
import { childSessionStore } from '../store/childSessionStore'
import { inboxStore } from '../store/inboxStore'
import { messageStore } from '../store/messageStore'

export function clearSessionRuntimeState(sessionId: string) {
  const sessionIds = childSessionStore.getSessionAndDescendants(sessionId)

  for (const id of sessionIds) {
    messageStore.clearSession(id)
    inboxStore.clearSession(id)
    activeSessionStore.removeSession(id)
  }

  childSessionStore.removeSession(sessionId)
}
