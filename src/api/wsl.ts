// ============================================
// WSL API —— Tauri 平台实现，对应官方 ipc.ts 暴露的命令面
// 状态更新经 "wsl-state" 事件全量推送（官方 subscribe/event.sender.send 模式）
// ============================================

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { WslServerConfig, WslServersState, WslServersEvent } from '../features/wsl/types'

// 探测/列表类命令保留独立入口（后端仍单独注册，供弹窗外探测使用）
export const wslApi = {
  /** 探测 WSL 运行时 */
  probeRuntime: () => invoke<void>('probe_wsl_runtime'),

  /** 刷新发行版列表（本地 + 在线）。force=true 绕过在线目录 TTL 缓存强制联网
   *  （用户显式「重新检测」）；默认走 stale-while-revalidate */
  refreshDistros: (force = false) => invoke<void>('refresh_wsl_distros', { force }),

  /** 按需预热（打开设置→服务器页时触发，幂等）：补齐 runtime 探测、
   *  发行版列表与已添加服务器的 opencode 检查。启动路径不再做任何 WSL 探测 */
  prewarm: () => invoke<void>('prewarm_wsl'),

  /** 批量探测可添加的发行版（增量语义，官方 probeAddable） */
  probeAddable: (distros: string[]) => invoke<void>('probe_wsl_addable', { distros }),

  /** 打开 WSL 终端 */
  openTerminal: (distro?: string) => invoke<void>('open_wsl_terminal', { distro }),

  /** 添加 WSL 服务器（确定性 id，后端立即启动并经事件推送状态） */
  addServer: (distro: string) => invoke<WslServerConfig>('add_wsl_server', { distro }),

  /** 移除 WSL 服务器 */
  removeServer: (id: string) => invoke<void>('remove_wsl_server', { id }),

  /** 启动 WSL 服务器（立即返回，状态经事件推送） */
  startServer: (id: string) => invoke<void>('start_wsl_server', { id }),

  /** 获取当前状态 */
  getState: () => invoke<WslServersState>('get_wsl_state'),

  /** 安装 WSL 运行时（触发 UAC 提权） */
  installWsl: () => invoke<void>('install_wsl'),

  /** 安装指定发行版 */
  installDistro: (name: string) => invoke<void>('install_wsl_distro', { name }),

  /** 在发行版中安装 opencode */
  installOpencode: (distro: string) => invoke<void>('install_wsl_opencode', { distro }),
}

/** 订阅后端状态推送（官方 wsl-servers-subscribe 模式），返回取消订阅函数 */
export function subscribeWslState(cb: (event: WslServersEvent) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let cancelled = false
  void listen<WslServersState>('wsl-state', event => {
    cb({ type: 'state', state: event.payload })
  }).then(fn => {
    if (cancelled) {
      fn()
      return
    }
    unlisten = fn
  })
  return () => {
    cancelled = true
    unlisten?.()
  }
}
