import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../index.css'
import '../i18n'
import { themeStore } from '../store/themeStore'
import { FullscreenProvider } from '../contexts'
import { PerfPreview } from './PerfPreview'

themeStore.init()

// 正式入口把 html/body/#root 锁成 100dvh + overflow hidden（聊天区自己滚）。
// 这里是长文档，放开滚动，方便测视口挂载。
for (const element of [document.documentElement, document.body, document.getElementById('root')]) {
  if (!element) continue
  element.style.height = 'auto'
  element.style.overflow = 'visible'
}

createRoot(document.getElementById('root')!).render(
  <FullscreenProvider>
    <PerfPreview />
  </FullscreenProvider>,
)
