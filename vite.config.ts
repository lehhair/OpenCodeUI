import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { bundledLanguagesInfo } from 'shiki/langs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

const shikiSupportedLangs = bundledLanguagesInfo.flatMap(info => [info.id, ...(info.aliases ?? [])])

function katexWoff2Only() {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const normalizedId = id.split('?')[0].replace(/\\/g, '/')
      if (!normalizedId.endsWith('/katex/dist/katex.min.css') && !normalizedId.endsWith('/katex/dist/katex.css')) {
        return null
      }

      return code.replace(
        /,url\(fonts\/KaTeX_[^)]+\.woff\) format\("woff"\),url\(fonts\/KaTeX_[^)]+\.ttf\) format\("truetype"\)/g,
        '',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __SHIKI_SUPPORTED_LANGS__: JSON.stringify(shikiSupportedLangs),
  },
  plugins: [katexWoff2Only(), react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('@xterm/')) return 'vendor-terminal'
          // shiki core + engine + themes → 一个小 chunk；
          // 语言 grammar（@shikijs/langs/*）由 dynamic import 自动拆分
          if ((id.includes('shiki') || id.includes('@shikijs/')) && !id.includes('@shikijs/langs'))
            return 'vendor-shiki'
          if (id.includes('marked') || id.includes('dompurify') || id.includes('morphdom') || id.includes('katex'))
            return 'vendor-markdown'

          if (id.includes('@tauri-apps/')) return 'vendor-tauri'
        },
      },
    },
  },

  worker: {
    format: 'es',
  },

  // Tauri CLI 兼容：不清屏，让 Tauri 的日志能保留在终端
  clearScreen: false,

  server: {
    // Tauri mobile dev 需要通过网络访问 Vite dev server
    host: process.env.TAURI_DEV_HOST || false,
    // 避免端口冲突
    strictPort: true,
    // 允许所有域名
    allowedHosts: true,

    proxy: {
      // 开发环境代理 - 将 /api 前缀的请求转发到 OpenCode 后端
      // 注意：Tauri 模式下前端直接请求后端（通过 plugin-http），不走此代理
      //
      // 🔴 阶段 2b 修正（2a 报告 §8#11 记录的问题）：
      //   这里原本有一条 `rewrite: path => path.replace(/^\/api/, '')`，
      //   那是 **V1 遗留** —— V1 的端点就是 `/session`、`/config`、`/event` 等**不带 `/api` 前缀**的路径，
      //   所以要把前端写的 `/api/xxx` 削掉才能命中后端。
      //
      //   但 **V2 的端点全都带 `/api` 前缀**（`/api/session`、`/api/event`、`/api/fs/find` …，
      //   见迁移文档 §4）。继续削前缀会把请求打到不存在的 `/session` 上，
      //   后端只会返回 SPA 兜底 HTML → **浏览器 dev 模式下整条链路都会坏**
      //   （Tauri 路径不受影响，因为它不走这个代理，而是用 `getSDKClient` 里的 baseUrl 直连）。
      //
      //   → 正确做法：**原样透传** `/api` 前缀，只做换源。
      '/api': {
        target: 'http://127.0.0.1:4096',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
