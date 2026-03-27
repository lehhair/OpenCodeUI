/**
 * overlayScrollbar — 全局自绘滚动条
 *
 * 隐藏浏览器原生滚动条，自动为所有可垂直滚动的容器注入 overlay thumb。
 *
 * 架构：
 *   CSS  :where(:not(textarea)) { scrollbar-width:none }   隐藏原生
 *   JS   MutationObserver 扫描 DOM → attach(el)            发现可滚动容器
 *        attach() → 在容器的父元素上创建 .os-thumb          不随内容滚走
 *        scroll → getBoundingClientRect 定位 thumb           跟随容器视口
 *
 * thumb 挂在容器的父元素上（而非容器内部），这样：
 *   - 不会被容器的滚动带走
 *   - 不会干扰 column-reverse 等 flex 布局
 *   - 受父元素及祖先的 overflow 裁剪 → 容器消失 thumb 自然消失
 */

const ATTR = 'data-os'
const TRACK_PAD = 8
const MIN_THUMB = 32
const FADE_MS = 800

interface Entry {
  vp: HTMLElement
  thumb: HTMLDivElement
  ro: ResizeObserver
  update: () => void
  cleanup: () => void
}
const entries = new Map<HTMLElement, Entry>()

// ── 判断元素是否可垂直滚动 ──────────────────────────────
function isScrollableY(el: HTMLElement): boolean {
  if (el === document.documentElement || el === document.body) return false
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return false
  const oy = getComputedStyle(el).overflowY
  if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false
  return el.scrollHeight > el.clientHeight + 1
}

// ── 挂载 ────────────────────────────────────────────────
function attach(vp: HTMLElement) {
  if (entries.has(vp)) return

  const parent = vp.parentElement
  if (!parent) return

  // 确保父元素是定位上下文
  const parentPos = getComputedStyle(parent).position
  if (parentPos === 'static' || parentPos === '') {
    parent.style.position = 'relative'
  }

  // thumb 挂在父元素上，不在滚动容器内部
  const thumb = document.createElement('div')
  thumb.className = 'os-thumb'
  parent.appendChild(thumb)
  vp.setAttribute(ATTR, '')

  let fadeTimer: ReturnType<typeof setTimeout> | null = null
  let dragging = false

  // ── update ────────────────────────────────────────
  const update = () => {
    const { scrollTop, scrollHeight, clientHeight } = vp
    if (scrollHeight <= clientHeight + 1) {
      thumb.classList.remove('os-visible')
      return
    }

    // 容器相对于父元素的位置
    const vpRect = vp.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    const offsetTop = vpRect.top - parentRect.top
    const offsetRight = parentRect.right - vpRect.right

    const track = vpRect.height - TRACK_PAD * 2
    let h = (clientHeight / scrollHeight) * track
    h = Math.max(h, MIN_THUMB)

    const maxScroll = scrollHeight - clientHeight
    const maxTop = track - h

    const isReverse = scrollTop < 0 || getComputedStyle(vp).flexDirection === 'column-reverse'
    const ratio = isReverse ? (maxScroll + scrollTop) / maxScroll : scrollTop / maxScroll
    const thumbY = TRACK_PAD + (maxScroll > 0 ? ratio * maxTop : 0)

    thumb.style.height = `${h}px`
    thumb.style.top = `${offsetTop + thumbY}px`
    thumb.style.right = `${offsetRight}px`
  }

  // ── reveal / fade ─────────────────────────────────
  const scheduleFade = () => {
    if (fadeTimer) clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => {
      if (!dragging) thumb.classList.remove('os-visible')
    }, FADE_MS)
  }

  const reveal = () => {
    thumb.classList.add('os-visible')
    scheduleFade()
  }

  const onScroll = () => {
    update()
    reveal()
  }

  const onEnter = () => {
    if (vp.scrollHeight > vp.clientHeight + 1) {
      update()
      thumb.classList.add('os-visible')
      if (fadeTimer) clearTimeout(fadeTimer)
    }
  }

  const onLeave = () => {
    if (!dragging) {
      if (fadeTimer) clearTimeout(fadeTimer)
      fadeTimer = setTimeout(() => thumb.classList.remove('os-visible'), 400)
    }
  }

  // ── 拖拽 ──────────────────────────────────────────
  const onThumbDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging = true
    thumb.classList.add('os-dragging')

    const startY = e.clientY
    const startScroll = vp.scrollTop
    thumb.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const maxScroll = vp.scrollHeight - vp.clientHeight
      const maxThumbY = vp.clientHeight - thumb.offsetHeight
      if (maxThumbY > 0) {
        vp.scrollTop = startScroll + (ev.clientY - startY) * (maxScroll / maxThumbY)
      }
    }

    const onUp = (ev: PointerEvent) => {
      dragging = false
      thumb.classList.remove('os-dragging')
      thumb.releasePointerCapture(ev.pointerId)
      thumb.removeEventListener('pointermove', onMove)
      thumb.removeEventListener('pointerup', onUp)
      scheduleFade()
    }

    thumb.addEventListener('pointermove', onMove)
    thumb.addEventListener('pointerup', onUp)
  }

  // ── 绑定 ──────────────────────────────────────────
  vp.addEventListener('scroll', onScroll, { passive: true })
  vp.addEventListener('pointerenter', onEnter)
  vp.addEventListener('pointerleave', onLeave)
  thumb.addEventListener('pointerdown', onThumbDown)

  const ro = new ResizeObserver(() => update())
  ro.observe(vp)
  update()

  const cleanup = () => {
    vp.removeEventListener('scroll', onScroll)
    vp.removeEventListener('pointerenter', onEnter)
    vp.removeEventListener('pointerleave', onLeave)
    thumb.removeEventListener('pointerdown', onThumbDown)
    ro.disconnect()
    if (fadeTimer) clearTimeout(fadeTimer)
    thumb.remove()
    vp.removeAttribute(ATTR)
  }

  entries.set(vp, { vp, thumb, ro, update, cleanup })
}

// ── 卸载 ────────────────────────────────────────────────
function detach(vp: HTMLElement) {
  const e = entries.get(vp)
  if (e) {
    e.cleanup()
    entries.delete(vp)
  }
}

// ── 扫描 DOM ────────────────────────────────────────────
function scan() {
  for (const [vp] of entries) {
    if (!document.contains(vp) || !isScrollableY(vp)) detach(vp)
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  let node: Node | null = walker.currentNode
  while (node) {
    const el = node as HTMLElement
    if (
      el.nodeType === 1 &&
      !entries.has(el) &&
      !el.hasAttribute(ATTR) &&
      !el.classList.contains('os-thumb') &&
      isScrollableY(el)
    ) {
      attach(el)
    }
    node = walker.nextNode()
  }
}

// ── 初始化 ──────────────────────────────────────────────
let inited = false

export function initOverlayScrollbars() {
  if (inited) return
  inited = true

  scan()

  let timer: ReturnType<typeof setTimeout> | null = null
  const debounceScan = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      scan()
    }, 200)
  }

  new MutationObserver(debounceScan).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  })

  window.addEventListener('resize', debounceScan, { passive: true })

  // 任何元素滚动 → 更新所有 thumb 位置
  // 父级滚动时子级 thumb 需要重定位
  document.addEventListener(
    'scroll',
    () => {
      for (const e of entries.values()) e.update()
    },
    { capture: true, passive: true },
  )
}
