// ============================================
// 侧边栏连接状态点的显示口径
//
// 状态点表达「服务器是否可用」，直接复用设置页的服务器健康状态
// （serverStore.healthMap，来自 GET /api/info），不再看 SSE 长连接状态。
//
// 原因：移动端切后台、Wi-Fi ↔ 蜂窝切换、系统省电都会让长连接比 HTTP
// 断得频繁，但服务端通常是好的。之前会出现「消息正常在流、状态点却是灰的」，
// 而且 footer 只盯 active server，切到别的服务器的会话时会盯错对象。
// ============================================

import type { ServerHealth } from '../store/serverStore'

export type ConnectionDisplayState = 'connected' | 'connecting' | 'disconnected' | 'error'

export function healthToConnectionDisplay(health: ServerHealth | null | undefined): ConnectionDisplayState {
  switch (health?.status) {
    case 'online':
      return 'connected'
    case 'checking':
      return 'connecting'
    case 'unauthorized':
    case 'error':
      return 'error'
    case 'offline':
      return 'disconnected'
    default:
      // 还没查过：先按过渡态显示，发起检查后很快会落到 online/offline
      return 'connecting'
  }
}
