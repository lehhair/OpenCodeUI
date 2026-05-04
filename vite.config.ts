import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

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
          if (id.includes('streamdown') || id.includes('remend')) return 'vendor-markdown'

          if (id.includes('@tauri-apps/')) return 'vendor-tauri'
        },
      },
    },
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
      '/api': {
        target: 'http://127.0.0.1:4096',
        changeOrigin: true,
        ws: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
})
