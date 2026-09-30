import { getAuthHeader } from './http'
import { createPtyConnectTicket, getPtyConnectUrl } from './pty'

/** Unified bridge event from Rust */
interface BridgeEvent {
  event: 'connected' | 'data' | 'disconnected' | 'error'
  data?: {
    data?: string
    code?: number
    reason?: string
    message?: string
  }
}

interface ConnectTauriPtyParams {
  ptyId: string
  directory?: string
  cursor?: number
  /** 终端所属服务器（PTY 创建时记录；缺省用活动服务器） */
  serverId?: string
  onConnected: () => void
  onMessage: (chunk: string) => void
  onDisconnected: (info: { code?: number; reason?: string }) => void
  onError: (message: string) => void
}

export interface TauriPtyConnection {
  send: (data: string) => void
  close: () => void
}

export async function connectTauriPty({
  ptyId,
  directory,
  cursor,
  serverId,
  onConnected,
  onMessage,
  onDisconnected,
  onError,
}: ConnectTauriPtyParams): Promise<TauriPtyConnection> {
  const { invoke, Channel } = await import('@tauri-apps/api/core')
  // V2 连接协议是两步：先申请一次性 ticket，再拼 URL。
  // ⚠️ ticket 只能走 query —— Rust 侧 `bridge_connect` 不支持自定义 header 传 ticket，
  //    所以**不要**试图把 ticket 挪到 authHeader 里（改了就连不上，且不会报错原因）。
  // 票据一次性 + 60 秒过期：每次调用本函数（含重连）都会重新申请一张。
  const { ticket } = await createPtyConnectTicket(ptyId, directory, serverId)
  // 必须用终端所属服务器的 URL/auth（不能是活动服务器）：
  // 多服务器模式下焦点服务器可能已切换，但 pty 在创建它的服务器上
  const url = getPtyConnectUrl(ptyId, ticket, directory, { includeAuthInUrl: false, cursor }, serverId)
  const authHeader = getAuthHeader(serverId)['Authorization'] || null
  // bridgeId 带服务器前缀，避免两个服务器（同后端）相同 ptyId 的 bridge 冲突
  const bridgeId = `pty:${serverId ?? ''}:${ptyId}`
  const onEvent = new Channel<BridgeEvent>()
  let closed = false

  onEvent.onmessage = msg => {
    if (closed) return

    switch (msg.event) {
      case 'connected':
        onConnected()
        break
      case 'data':
        if (msg.data?.data) {
          onMessage(msg.data.data)
        }
        break
      case 'disconnected':
        closed = true
        onDisconnected({ code: msg.data?.code, reason: msg.data?.reason })
        break
      case 'error':
        onError(msg.data?.message || 'Unknown bridge error')
        break
    }
  }

  void invoke('bridge_connect', {
    args: { bridgeId, url, authHeader },
    onEvent,
  }).catch((error: unknown) => {
    if (closed) return
    closed = true
    const message = error instanceof Error ? error.message : String(error)
    onDisconnected({ reason: message })
  })

  return {
    send(data: string) {
      if (closed) return
      void invoke('bridge_send', { args: { bridgeId, data } }).catch((error: unknown) => {
        if (closed) return
        const message = error instanceof Error ? error.message : String(error)
        onError(message)
      })
    },
    close() {
      if (closed) return
      closed = true
      void invoke('bridge_disconnect', { args: { bridgeId } }).catch(() => {})
    },
  }
}
