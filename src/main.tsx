import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DirectoryProvider, SessionProvider } from './contexts'

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
