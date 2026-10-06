import { LOCAL_SERVER_ID, serverStore } from '../store/serverStore'

/**
 * 内嵌服务启动结果落地。
 *
 * `serverPassword`：v2 服务端在无显式密码时**强制生成随机密码**并打印
 * 到 stdout（官方 cli/server-process.ts:160 契约），Rust 侧提取后传回。
 * 必须写回本机服务器条目的 auth——否则后续所有 API/SSE 请求 401，
 * 内嵌服务完全不可用。
 */
export function applyLocalServiceUrl(url: string | null | undefined, serverPassword?: string | null) {
  if (!url) return

  serverStore.setLocalServerRuntimeUrl(url)
  if (serverPassword) {
    serverStore.updateServer(LOCAL_SERVER_ID, {
      auth: { username: 'opencode', password: serverPassword },
    })
  }
  void serverStore.checkHealth(LOCAL_SERVER_ID)
}
