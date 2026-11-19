import { BoundedCache } from '../utils/boundedCache'

const MERMAID_CACHE_MAX = 64
/** SVG 体积差很多，单纯按条数会留下几十张超大图 */
const MERMAID_CACHE_MAX_CHARS = 4 * 1024 * 1024

const svgCache = new BoundedCache<string, string>({
  maxEntries: MERMAID_CACHE_MAX,
  maxCost: MERMAID_CACHE_MAX_CHARS,
  costOf: svg => svg.length,
})
const pendingRenders = new Map<string, Promise<string>>()
let renderQueue: Promise<void> = Promise.resolve()

export function getCachedMermaidSvg(key: string) {
  return svgCache.get(key)
}

function rememberSvg(key: string, svg: string) {
  svgCache.set(key, svg)
}

export async function getOrRenderMermaidSvg(key: string, render: () => Promise<string>) {
  const cached = getCachedMermaidSvg(key)
  if (cached !== undefined) return cached

  const pending = pendingRenders.get(key)
  if (pending) return pending

  const promise = renderQueue.then(render, render).then(svg => {
    rememberSvg(key, svg)
    return svg
  })
  renderQueue = promise.then(
    () => undefined,
    () => undefined,
  )

  pendingRenders.set(key, promise)
  try {
    return await promise
  } finally {
    pendingRenders.delete(key)
  }
}

export function clearMermaidRenderCache() {
  svgCache.clear()
  pendingRenders.clear()
}
