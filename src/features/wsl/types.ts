// ============================================
// WSL 类型定义 —— 与官方桌面端 packages/app/src/wsl/types.ts 一一对应
// Rust 端序列化为 camelCase，此处字段名与 JSON 完全一致
// ============================================

/** WSL 运行时检查结果 */
export interface WslRuntimeCheck {
  available: boolean
  version: string | null
  error: string | null
}

/** 已安装的 WSL 发行版 */
export interface WslInstalledDistro {
  name: string
  version: number | null // WSL 1 或 2
  isDefault: boolean
}

/** 在线可用的发行版 */
export interface WslOnlineDistro {
  name: string
  label: string
}

/** 发行版探测结果 */
export interface WslDistroProbe {
  name: string
  canExecute: boolean
  hasBash: boolean
  hasCurl: boolean
  error: string | null
}

/** OpenCode 检查结果（matchesDesktop/expectedVersion 结构保留，见 Rust 端说明） */
export interface WslOpencodeCheck {
  distro: string
  resolvedPath: string | null
  version: string | null
  expectedVersion: string | null
  matchesDesktop: boolean | null
  error: string | null
}

/** WSL 服务器配置（官方同款：确定性 id = `wsl:<distro>`，端口每次启动动态分配） */
export interface WslServerConfig {
  id: string
  distro: string
}

/** WSL 服务器运行时状态 */
export type WslServerRuntime =
  | { kind: 'starting' }
  | { kind: 'ready'; url: string; username: string | null; password: string | null }
  | { kind: 'failed'; message: string }
  | { kind: 'stopped' }

/** WSL 服务器项 */
export interface WslServerItem {
  config: WslServerConfig
  runtime: WslServerRuntime
}

/** WSL 任务类型 */
export type WslJob =
  | { kind: 'runtime'; startedAt: number }
  | { kind: 'distros'; startedAt: number }
  | { kind: 'install-wsl'; startedAt: number }
  | { kind: 'install-distro'; distro: string; startedAt: number }
  | { kind: 'probe-addable'; distros: string[]; startedAt: number }
  | { kind: 'install-opencode'; distro: string; startedAt: number }

/** WSL 服务器全局状态 */
export interface WslServersState {
  runtime: WslRuntimeCheck | null
  installed: WslInstalledDistro[]
  online: WslOnlineDistro[]
  distroProbes: Record<string, WslDistroProbe>
  opencodeChecks: Record<string, WslOpencodeCheck>
  pendingRestart: boolean
  servers: WslServerItem[]
  job: WslJob | null
}

/** 后端推送的状态事件 */
export type WslServersEvent = { type: 'state'; state: WslServersState }

/** 前端可用的 WSL 平台能力（官方 WslServersPlatform） */
export interface WslServersPlatform {
  getState(): Promise<WslServersState>
  subscribe(cb: (event: WslServersEvent) => void): () => void
  probeRuntime(): Promise<void>
  refreshDistros(): Promise<void>
  installWsl(): Promise<void>
  installDistro(name: string): Promise<void>
  probeAddable(distros: string[]): Promise<void>
  installOpencode(name: string): Promise<void>
  openTerminal(name: string): Promise<void>
  addServer(distro: string): Promise<WslServerConfig>
  removeServer(id: string): Promise<void>
  startServer(id: string): Promise<void>
}
