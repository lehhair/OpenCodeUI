const MERMAID_CACHE_MAX = 64
/** SVG 体积差很多，单纯按条数会留下几十张超大图 */
const MERMAID_CACHE_MAX_CHARS = 4 * 1024 * 1024

const svgCache = new Map<string, string>()
const pendingRenders = new Map<string, Promise<string>>()
let svgCacheChars = 0
let renderQueue: Promise<void> = Promise.resolve()

export function getCachedMermaidSvg(key: string) {
  const cached = svgCache.get(key)
  if (cached === undefined) return undefined
  // 命中即移到队尾
  svgCache.delete(key)
  svgCache.set(key, cached)
  return cached
}

function rememberSvg(key: string, svg: string) {
  const existing = svgCache.get(key)
  if (existing !== undefined) {
    svgCacheChars -= existing.length
    svgCache.delete(key)
  }
  svgCache.set(key, svg)
  svgCacheChars += svg.length
  while (svgCache.size > MERMAID_CACHE_MAX || svgCacheChars > MERMAID_CACHE_MAX_CHARS) {
    const oldestKey = svgCache.keys().next().value
    if (oldestKey === undefined) break
    const oldestValue = svgCache.get(oldestKey)
    svgCache.delete(oldestKey)
    if (oldestValue !== undefined) svgCacheChars -= oldestValue.length
    if (oldestKey === key) break
  }
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
  svgCacheChars = 0
  pendingRenders.clear()
}
