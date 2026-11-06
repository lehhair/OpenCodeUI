import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import './i18n'
import { initOverlayScrollbars } from './lib/overlayScrollbar'
import App from './App.tsx'
import { DirectoryProvider, FullscreenProvider, SessionProvider } from './contexts'
import { themeStore } from './store/themeStore'
import { affectsBoundServer } from './store/serverChangeScope'
import { LOCAL_SERVER_ID, serverStore } from './store/serverStore'
import { startEndpointProbe } from './store/endpointProbe'
import { autoApproveStore } from './store/autoApproveStore'
import { serviceStore } from './store/serviceStore'
import { wslStore } from './store/wslStore'
import { reconnectSSE, reconnectServerSSE } from './api/events'
import { getSDKClientAsync, invalidateSDKClient } from './api/sdk'
import { resetPathModeCache } from './utils/directoryUtils'
import { isTauri, isTauriMobile } from './utils/tauri'
import { apiErrorHandler, globalErrorHandler } from './utils/errorHandling'
import { applyLocalServiceUrl } from './utils/localServiceUrl'

// Polyfill: randomUUID 在非 HTTPS 环境可能缺失（如局域网 HTTP）
// 统一补齐，避免业务层 scattered fallback。
function ensureRandomUUID() {
  const cryptoObj = globalThis.crypto as Crypto & { randomUUID?: () => string }
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') return
  if (typeof cryptoObj.randomUUID === 'function') return

  cryptoObj.randomUUID = () => {
    const bytes = new Uint8Array(16)
    cryptoObj.getRandomValues(bytes)
    // RFC 4122 v4
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
  }
}

ensureRandomUUID()

// 禁用浏览器的 scroll restoration（刷新时不恢复旧 scrollTop），
// 由 ChatArea 自行控制定位
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

// 初始化主题系统（在 React 渲染前注入 CSS 变量，避免闪烁）
themeStore.init()

// 订阅 WSL 后端状态推送（Windows 桌面端：事件驱动，非 Tauri 环境下静默）
wslStore.start()

// 全局 overlay 滚动条 — 等 DOM 就绪后启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOverlayScrollbars)
} else {
  // DOM 已就绪（defer script 或者 module）
  requestAnimationFrame(initOverlayScrollbars)
}

// 注册 active server 入口变化 → 重建目标服务器的 SDK + 刷新 per-server 配置 + 重连 SSE
serverStore.onServerChange((serverId, reason) => {
  // SDK client 按 serverId 缓存：仅重建目标服务器的 client。
  // 这是「该服务器端点事实已变」的处理，与 active 无关，任何 reason 都要做
  invalidateSDKClient(serverId)
  if (isTauri()) {
    void getSDKClientAsync(serverId).catch(err => apiErrorHandler('reinitialize sdk client after server endpoint change', err))
  }

  // 多服务器模式：messageStore / childSessionStore 的数据按 `serverId::sessionId`
  // 分片存储，切换 active server 不应清空其他 pane 正在使用的服务器数据，因此不再 clearAll。

  // 换入口地址（Issue #183：内网 ↔ 公网）：同一台服务器、同一份数据，
  // 只需要让连接跟着新地址走。不走下面的「重置数据类缓存」分支——
  // 路径模式/autoApprove 都由服务器身份决定，换入口不变。
  if (reason === 'endpoint-switch') {
    // 重连的是「这台服务器」的连接，不限于 active：多服务器模式下
    // 非 active 的订阅连接同样挂在旧地址上，不重连就会一直连着死地址。
    // reason 'network' 让重连成功后走补偿拉取，而不是按'换服务器'跳过。
    reconnectServerSSE(serverId, { reason: 'network' })
    // 健康灯探的是生效地址，换了地址就得重测，否则会一直挂着旧入口的红叉
    void serverStore.checkHealth(serverId)
    return
  }

  // 以下动作只作用于「当前 active 服务器的数据/连接」，必须按 reason 门控：
  // - server-switch：active 本身变了（含删除回退）→ 缓存与 SSE 目标都换了
  // - server-runtime-updated / local-runtime-url：仅当变的这台就是 active 才相关；
  //   非 active 的 WSL 服务器重启不得重置 active 缓存、更不得重连 active 的 SSE
  //   （重连窗口会丢事件、会话列表闪烁）
  if (!affectsBoundServer(undefined, serverId, reason, serverStore.getActiveServerId())) return

  // 重置路径模式缓存（不同服务器可能是不同操作系统）
  resetPathModeCache()

  // 重新加载 auto-approve 开关状态（从新服务器的 storage key 读取）
  autoApproveStore.reloadFromStorage()

  // 重连 active server 的 SSE（会自动连到新的 server endpoint）
  reconnectSSE()
})

// 多地址自动探测（Issue #183）：内网优先、不可达降级、恢复后带滞回升回。
// 内部只对配了 >1 个地址的服务器发请求，单地址用户零开销。
startEndpointProbe()

const isNativeTauri = isTauri()
const isNativeTauriMobile = isNativeTauri && isTauriMobile()

interface StartOpencodeServiceResult {
  started: boolean
  startedByUs: boolean
  /** 是否是注册表可认领的共享后台服务（serve --service；认领来的也算） */
  managed?: boolean
  url?: string | null
  /** 连接用密码：注册表（管理模式）或服务端随机生成 / OPENCODE_PASSWORD / OPENCODE_SERVER_PASSWORD 环境变量（私有模式） */
  serverPassword?: string | null
}

function configureNativeShell() {
  if (!isNativeTauri) return

  // 添加 CSS class 用于 safe-area 适配
  document.documentElement.classList.add('tauri-app')

  // 确保 viewport meta 包含 viewport-fit=cover（用于状态栏沉浸式）
  const viewportMeta = document.querySelector('meta[name="viewport"]')
  if (!viewportMeta) return

  const content = viewportMeta.getAttribute('content') || ''
  if (!content.includes('viewport-fit=cover')) {
    viewportMeta.setAttribute('content', content + ', viewport-fit=cover')
  }
}

async function initializeNativeDesktopService() {
  if (!isNativeTauri || isNativeTauriMobile || !serviceStore.autoStart) return

  const { invoke } = await import('@tauri-apps/api/core')
  const serverUrl = serverStore.getLocalServerUrl()
  const localServer = serverStore.getLocalServer()

  /**
   * 页面刷新 / webview 重载：本机运行时地址已从 sessionStorage 恢复，
   * 服务通常还活着。这里只探一次 /api/info，活着就直接复用——不调用
   * `start_opencode_service`（探测子进程 → 认领注册表 → 必要时 spawn），
   * 也不设 `starting`，首屏立刻能用恢复的地址发请求。
   *
   * 只在「有恢复地址」时走这条捷径：冷启动 / 新窗口仍然走完整流程，
   * 保证「注册表里的托管服务优先于条目 URL 上别人跑的 serve」这一优先级
   * 不被改掉。
   */
  if (serverStore.hasLocalRuntimeUrl()) {
    const alreadyRunning = await invoke<boolean>('check_opencode_service', {
      url: serverUrl,
      // v2 服务端强制密码；无凭据探测会 401 误判成没在跑
      auth: localServer?.auth ? ([localServer.auth.username, localServer.auth.password] as [string, string]) : null,
    }).catch(() => false)

    if (alreadyRunning) {
      serviceStore.setRunning(true)
      const byUs = await invoke<boolean>('get_service_started_by_us').catch(() => false)
      serviceStore.setStartedByUs(byUs)
      void invoke<boolean>('get_service_managed')
        .then(managed => serviceStore.setManaged(managed))
        .catch(() => {})
      // 健康灯：探测结果落地即在线（与 SSE 连接状态收敛）
      void serverStore.checkHealth(LOCAL_SERVER_ID).catch(() => {})
      return
    }
  }

  serviceStore.setStarting(true)

  try {
    try {
      const path = await invoke<string | null>('detect_opencode_binary', { envVars: serviceStore.envVarsRecord })
      serviceStore.setDetectedBinaryPath(path)
    } catch {
      // Starting with PATH fallback is still useful if detection fails.
    }

    const result = await invoke<StartOpencodeServiceResult>('start_opencode_service', {
      url: serverUrl,
      binaryPath: serviceStore.effectiveBinaryPath,
      envVars: serviceStore.envVarsRecord,
      extraArgs: serviceStore.serveArgsList,
      // 条目上已有的凭据：让「已经在跑」的探测通过 v2 的强制密码门
      auth: serverStore.getLocalServer()?.auth
        ? ([serverStore.getLocalServer()!.auth!.username, serverStore.getLocalServer()!.auth!.password] as [
            string,
            string,
          ])
        : null,
    })

    applyLocalServiceUrl(result.url, result.serverPassword)
    serviceStore.setStartedByUs(result.startedByUs)
    serviceStore.setManaged(result.managed ?? false)
    serviceStore.setRunning(true)
    if (result.started) {
      console.info('[Service] opencode background service started by app')
    } else if (result.managed) {
      console.info('[Service] adopted running background service')
    } else {
      console.info('[Service] opencode serve already running')
    }
  } catch (err) {
    apiErrorHandler('auto-start opencode serve', err)
  } finally {
    serviceStore.setStarting(false)
  }
}

configureNativeShell()

// 全局错误处理 - 防止未捕获错误导致页面刷新
window.addEventListener('error', event => {
  globalErrorHandler('uncaught error', event.error)
  event.preventDefault()
})

window.addEventListener('unhandledrejection', event => {
  globalErrorHandler('unhandled promise rejection', event.reason)
  event.preventDefault()
})

function bootstrap() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <DirectoryProvider>
          <SessionProvider>
            <FullscreenProvider>
              <App />
            </FullscreenProvider>
          </SessionProvider>
        </DirectoryProvider>
      </Suspense>
    </StrictMode>,
  )
}

function startApp() {
  bootstrap()

  void initializeNativeDesktopService()

  if (isNativeTauri) {
    void getSDKClientAsync().catch(err => apiErrorHandler('initialize sdk client', err))
  }
}

startApp()
