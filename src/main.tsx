import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import './i18n'
import { initOverlayScrollbars } from './lib/overlayScrollbar'
import App from './App.tsx'
import { DirectoryProvider, FullscreenProvider, SessionProvider } from './contexts'
import { themeStore } from './store/themeStore'
import { serverStore } from './store/serverStore'
import { autoApproveStore } from './store/autoApproveStore'
import { serviceStore } from './store/serviceStore'
import { wslStore } from './store/wslStore'
import { reconnectSSE } from './api/events'
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
serverStore.onServerChange(serverId => {
  // SDK client 按 serverId 缓存：仅重建目标服务器的 client
  invalidateSDKClient(serverId)
  if (isTauri()) {
    void getSDKClientAsync(serverId).catch(err => apiErrorHandler('reinitialize sdk client after server endpoint change', err))
  }

  // 多服务器模式：messageStore / childSessionStore / todoStore 的数据按 `serverId::sessionId`
  // 分片存储，切换 active server 不应清空其他 pane 正在使用的服务器数据，因此不再 clearAll。

  // 重置路径模式缓存（不同服务器可能是不同操作系统）
  resetPathModeCache()

  // 重新加载 auto-approve 开关状态（从新服务器的 storage key 读取）
  autoApproveStore.reloadFromStorage()

  // 重连 active server 的 SSE（会自动连到新的 server endpoint）
  reconnectSSE()
})

const isNativeTauri = isTauri()
const isNativeTauriMobile = isNativeTauri && isTauriMobile()

interface StartOpencodeServiceResult {
  started: boolean
  startedByUs: boolean
  url?: string | null
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

  const serverUrl = serverStore.getLocalServerUrl()
  serviceStore.setStarting(true)

  try {
    const { invoke } = await import('@tauri-apps/api/core')

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
    })

    applyLocalServiceUrl(result.url)
    serviceStore.setStartedByUs(result.startedByUs)
    serviceStore.setRunning(true)
    if (result.started) {
      console.info('[Service] opencode serve started by app')
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
