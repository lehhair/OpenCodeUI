import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DirectoryProvider, SessionProvider } from './contexts'
import { themeStore } from './store/themeStore'
import { serverStore } from './store/serverStore'
import { messageStore } from './store/messageStore'
import { childSessionStore } from './store/childSessionStore'
import { todoStore } from './store/todoStore'
import { messageCacheStore } from './store/messageCacheStore'
import { autoApproveStore } from './store/autoApproveStore'
import { serviceStore } from './store/serviceStore'
import { reconnectSSE } from './api/events'
import { resetPathModeCache } from './utils/directoryUtils'
import { isTauri } from './utils/tauri'

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

// 初始化主题系统（在 React 渲染前注入 CSS 变量，避免闪烁）
themeStore.init()

// 注册 server 切换 → 清理所有 server-specific 状态 + SSE 重连
serverStore.onServerChange(() => {
  // 1. 清空内存中的 session/消息数据
  messageStore.clearAll()
  childSessionStore.clearAll()
  todoStore.clearAll()
  
  // 2. 清空 IndexedDB 消息缓存
  void messageCacheStore.clearAll()
  
  // 3. 重置路径模式缓存（不同服务器可能是不同操作系统）
  resetPathModeCache()
  
  // 4. 重新加载 auto-approve 开关状态（从新服务器的 storage key 读取）
  autoApproveStore.reloadFromStorage()
  
  // 5. 重连 SSE（会自动连到新服务器）
  reconnectSSE()
})

// Tauri 原生 app 初始化
if (isTauri()) {
  // 添加 CSS class 用于 safe-area 适配
  document.documentElement.classList.add('tauri-app')

  // 确保 viewport meta 包含 viewport-fit=cover（用于状态栏沉浸式）
  const viewportMeta = document.querySelector('meta[name="viewport"]')
  if (viewportMeta) {
    const content = viewportMeta.getAttribute('content') || ''
    if (!content.includes('viewport-fit=cover')) {
      viewportMeta.setAttribute('content', content + ', viewport-fit=cover')
    }
  }

  // Auto-start opencode serve（如果设置开启）
  if (serviceStore.autoStart) {
    const serverUrl = serverStore.getActiveServer()?.url || 'http://127.0.0.1:4096'
    const binaryPath = serviceStore.effectiveBinaryPath
    import('@tauri-apps/api/core').then(({ invoke }) => {
      serviceStore.setStarting(true)
      invoke<boolean>('start_opencode_service', { url: serverUrl, binaryPath, envVars: serviceStore.envVarsRecord })
        .then((weStarted) => {
          serviceStore.setStartedByUs(weStarted)
          serviceStore.setRunning(true)
          serviceStore.setStarting(false)
          if (weStarted) {
            console.info('[Service] opencode serve started by app')
          } else {
            console.info('[Service] opencode serve already running')
          }
        })
        .catch((err) => {
          serviceStore.setStarting(false)
          console.error('[Service] Failed to auto-start opencode serve:', err)
        })
    })
  }
}

// 全局错误处理 - 防止未捕获错误导致页面刷新
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error)
  event.preventDefault()
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason)
  event.preventDefault()
})

// 调试：追踪页面刷新来源
window.addEventListener('beforeunload', (_event) => {
  console.error('[beforeunload] Page is about to reload! Stack trace:')
  console.trace()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DirectoryProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </DirectoryProvider>
  </StrictMode>,
)
