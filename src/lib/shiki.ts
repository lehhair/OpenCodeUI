/**
 * Shiki highlighter — lazy per-language loading
 *
 * 只静态打包 core + WASM engine + 2 个主题。
 * 语言 grammar 全部运行时按需 import()，每个语言单独 chunk（几 KB）。
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledLanguagesBase, bundledLanguagesAlias } from 'shiki/langs'
import type { BundledTheme } from 'shiki/themes'

export type ShikiThemeInput = BundledTheme

// ── singleton ──────────────────────────────────────────────

let highlighter: HighlighterCore | null = null
let initPromise: Promise<HighlighterCore> | null = null

/**
 * 获取 / 初始化 highlighter 单例。
 * 重复调用只会创建一次。
 */
export function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return Promise.resolve(highlighter)
  if (initPromise) return initPromise

  initPromise = createHighlighterCore({
    engine: createOnigurumaEngine(() => import('shiki/wasm')),
    themes: [import('shiki/themes/github-dark-default.mjs'), import('shiki/themes/github-light-default.mjs')],
    langs: [], // 不预加载任何语言
  }).then(h => {
    highlighter = h
    return h
  })

  return initPromise
}

// ── language loading ───────────────────────────────────────

/** 正在加载中的语言 → Promise（避免重复 import） */
const loadingLangs = new Map<string, Promise<void>>()

/**
 * 确保某个语言已经加载到 highlighter 中。
 * 已加载的语言会被跳过，不会重复请求。
 */
export async function ensureLang(lang: string): Promise<boolean> {
  const h = await getHighlighter()

  // 已经加载了
  const loaded = h.getLoadedLanguages()
  if (loaded.includes(lang)) return true

  // 正在加载中
  const pending = loadingLangs.get(lang)
  if (pending) {
    await pending
    return true
  }

  // 查找 loader
  const loader =
    (bundledLanguagesBase as Record<string, (() => Promise<unknown>) | undefined>)[lang] ??
    (bundledLanguagesAlias as Record<string, (() => Promise<unknown>) | undefined>)[lang]

  if (!loader) return false // shiki 不支持的语言

  const promise = h.loadLanguage(loader as Parameters<HighlighterCore['loadLanguage']>[0]).then(
    () => {
      loadingLangs.delete(lang)
    },
    err => {
      loadingLangs.delete(lang)
      if (import.meta.env.DEV) {
        console.warn(`[shiki] failed to load lang "${lang}":`, err)
      }
    },
  )
  loadingLangs.set(lang, promise)
  await promise

  return h.getLoadedLanguages().includes(lang)
}

// ── 高亮 API（对外封装）────────────────────────────────────

export async function codeToHtml(code: string, opts: { lang: string; theme: ShikiThemeInput }): Promise<string> {
  const h = await getHighlighter()
  await ensureLang(opts.lang)

  // 如果语言加载失败，fallback 到 plaintext
  const loaded = h.getLoadedLanguages()
  const safeLang = loaded.includes(opts.lang) ? opts.lang : 'text'

  return h.codeToHtml(code, { lang: safeLang, theme: opts.theme })
}

export async function codeToTokens(code: string, opts: { lang: string; theme: ShikiThemeInput }) {
  const h = await getHighlighter()
  await ensureLang(opts.lang)

  const loaded = h.getLoadedLanguages()
  const safeLang = loaded.includes(opts.lang) ? opts.lang : 'text'

  return h.codeToTokens(code, { lang: safeLang, theme: opts.theme })
}

// ── 语言支持检测（纯元数据，不拉 grammar）──────────────────

const supportedLangs = new Set([...Object.keys(bundledLanguagesBase), ...Object.keys(bundledLanguagesAlias)])

export function isSupportedLanguage(lang: string): boolean {
  return supportedLangs.has(lang)
}
