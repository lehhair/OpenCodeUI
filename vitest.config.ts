import { defineConfig, defaultExclude } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { bundledLanguagesInfo } from 'shiki/langs'

const shikiSupportedLangs = bundledLanguagesInfo.flatMap(info => [info.id, ...(info.aliases ?? [])])

export default defineConfig({
  define: {
    __SHIKI_SUPPORTED_LANGS__: JSON.stringify(shikiSupportedLangs),
  },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // opencode/ 是本地参考用的外部仓库，里面的测试不属于本项目
    exclude: [...defaultExclude, 'opencode/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
