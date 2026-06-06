import { reconnectSSE } from '../api/events'
import { getSDKClientAsync, invalidateSDKClient } from '../api/sdk'
import { LOCAL_SERVER_ID, serverStore } from '../store/serverStore'
import { apiErrorHandler } from './errorHandling'

export function applyLocalServiceUrl(url: string | null | undefined) {
  if (!url) return

  const changed = serverStore.setLocalServerRuntimeUrl(url)
  void serverStore.checkHealth(LOCAL_SERVER_ID)

  if (!changed || !serverStore.isActiveLocalServer()) return

  invalidateSDKClient()
  void getSDKClientAsync().catch(err => apiErrorHandler('reinitialize sdk client after local service URL update', err))
  reconnectSSE()
}
