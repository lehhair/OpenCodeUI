import type { ApiSession } from '../../../api'

export const DRAFT_NEW_CHAT_SESSION_ID = '__draft_new_chat__'

export function isDraftNewChatSession(session: Pick<ApiSession, 'id'> | null | undefined) {
  return session?.id === DRAFT_NEW_CHAT_SESSION_ID
}

export function createDraftNewChatSession(directory: string, title: string): ApiSession {
  return {
    id: DRAFT_NEW_CHAT_SESSION_ID,
    title,
    directory,
  } as ApiSession
}
