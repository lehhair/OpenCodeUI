/// <reference lib="webworker" />

import { parseMarkdownToHtml } from '../components/markdownParseCore'

export type MarkdownWorkerRequest = {
  type: 'parse'
  id: number
  key: string
  src: string
  isReasoning: boolean
  renderHtml: boolean
}

export type MarkdownWorkerResponse =
  | { type: 'parsed'; id: number; key: string; html: string }
  | { type: 'error'; id: number; key: string; message: string }

/**
 * 只做解析（marked + KaTeX），不做 DOM 净化。
 * 净化依赖 DOMPurify 和真实 DOM，留在主线程；解析的大头在这里，不占主线程。
 */
self.onmessage = (event: MessageEvent<MarkdownWorkerRequest>) => {
  const msg = event.data
  if (msg.type !== 'parse') return
  try {
    const html = parseMarkdownToHtml(msg.src, msg.isReasoning, msg.renderHtml)
    self.postMessage({ type: 'parsed', id: msg.id, key: msg.key, html } satisfies MarkdownWorkerResponse)
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      key: msg.key,
      message: error instanceof Error ? error.message : String(error),
    } satisfies MarkdownWorkerResponse)
  }
}
