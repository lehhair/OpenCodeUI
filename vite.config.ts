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
  // 🔥 THIS IS THE FIX: Changed from '/' to '/OpenCodeUI/'
  base: process.env.VITE_BASE_PATH || '/OpenCodeUI/',
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

  optimizeDeps: {
    exclude: [
      'shiki-stream',
      'shiki/core',
      'shiki/engine/oniguruma',
      'shiki/langs',
      'shiki/themes',
      'shiki/themes/github-dark-default.mjs',
      'shiki/themes/github-light-default.mjs',
    ],
  },

  clearScreen: false,

  server: {
    host: process.env.TAURI_DEV_HOST || false,
    strictPort: true,
    allowedHosts: true,
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/src-tauri/target/**',
        '**/src-router/target/**',
        '**/public/material-icons/**',
        '**/*.tmpdir/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4096',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
