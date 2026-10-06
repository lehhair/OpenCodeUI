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
          if (id.includes('marked') || id.includes('dompurify') || id.includes('morphdom') || id.includes('katex')) return 'vendor-markdown'

          if (id.includes('@tauri-apps/')) return 'vendor-tauri'
        },
      },
    },
  },

  worker: {
    format: 'es',
  },

  // shiki 全家桶在 Web Worker 里用（src/workers/shikiWorker.ts）。vite 初始
  // 依赖扫描只走 index.html 主图，扫不到 worker 的依赖——不设这里的话，
  // worker 首次加载会触发「发现新依赖」的中途重优化，browserHash 换戳后
  // worker 里已转换好的 chunk URL（主题/语言）全部失效（504/404），
  // 设置页代码块预览报 "Failed to fetch dynamically imported module" 就是它。
  optimizeDeps: {
    entries: ['index.html', 'src/workers/shikiWorker.ts'],
    include: [
      'shiki-stream',
      'shiki/core',
      'shiki/engine/oniguruma',
      'shiki/langs',
      'shiki/themes',
      'shiki/themes/github-dark-default.mjs',
      'shiki/themes/github-light-default.mjs',
    ],
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

    watch: {
      // Rust 构建目录可达数十 GB / 数万文件，chokidar 全量监听会拖垮 dev server
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/src-tauri/target/**',
        '**/src-router/target/**',
        '**/public/material-icons/**',
        // vitest 运行时临时目录（Windows 上监听会 EBUSY 导致 dev server 崩溃）
        '**/*.tmpdir/**',
      ],
    },

    proxy: {
      // 开发环境代理 - 将 /api 前缀的请求转发到 OpenCode 后端
      // 注意：Tauri 模式下前端直接请求后端（通过 plugin-http），不走此代理。
      // v2 后端的 API 就在 /api/* 下，**不能**像 v1 那样把 /api 前缀 rewrite 掉。
      '/api': {
        target: 'http://127.0.0.1:4096',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
