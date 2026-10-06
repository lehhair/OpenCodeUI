// ============================================
// 外链打开 — Tauri 原生 opener，浏览器回退 window.open
// （与 AboutSettings 既有的打开方式保持一致）
// ============================================

import { isTauri } from './tauri'

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await import('@tauri-apps/plugin-opener')
      .then(mod => mod.openUrl(url))
      .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
