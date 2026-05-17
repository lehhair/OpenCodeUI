import { useEffect } from 'react'

/**
 * 跟踪视口高度，处理移动端键盘弹出时的布局适配。
 *
 * - Tauri Android: 原生 setPadding 让 WebView 自动 resize，直接用 window.innerHeight
 * - Browser/PWA: 通过 visualViewport 计算键盘遮挡区域
 */
export function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement
    const isTauriApp = root.classList.contains('tauri-app')

    if (isTauriApp) {
      // Tauri: 原生层已处理键盘 resize，只需跟踪 innerHeight
      const updateAppHeight = () => {
        root.style.setProperty('--app-height', `${window.innerHeight}px`)
      }
      updateAppHeight()
      window.addEventListener('resize', updateAppHeight)
      return () => window.removeEventListener('resize', updateAppHeight)
    }
    // Browser/PWA: 用 visualViewport 检测键盘。
    //
    // 陷阱：iOS PWA standalone 下 window.innerHeight 包含 home indicator 区域，
    // 而 visualViewport.height 不包含。没键盘时两者差值 ≈ safe-area-inset-bottom（~34px），
    // 会被误判为“键盘弹出”。需减掉这部分才是真实键盘高度。
    // 不减的后果：#root 多出 34px padding-bottom + InputBox 自身又读一次
    // var(--safe-area-inset-bottom) → 双倍 safe-area 间距。
    //
    // env(safe-area-inset-bottom) 在 CSS 自定义属性里不会被 getComputedStyle 解析为像素，
    // 用临时 probe 元素把它赋给实际 padding 属性才能获得解析后的 px 值。
    let safeAreaBottomPx = 0
    const measureSafeAreaBottom = () => {
      const probe = document.createElement('div')
      probe.style.cssText =
        'position:fixed;left:-9999px;top:0;width:0;height:0;' +
        'padding-bottom:env(safe-area-inset-bottom,0px);' +
        'visibility:hidden;pointer-events:none'
      document.body.appendChild(probe)
      safeAreaBottomPx = parseFloat(getComputedStyle(probe).paddingBottom) || 0
      document.body.removeChild(probe)
    }
    measureSafeAreaBottom()

    const updateViewport = () => {
      const viewport = window.visualViewport
      if (!viewport) return
      const rawInset = window.innerHeight - viewport.height - viewport.offsetTop
      // 减掉 safe-area phantom，再用阈值区分键盘与 iOS Safari 底部工具栏。
      // 真实软键盘通常远高于 100px，工具栏/phantom 误差一般低于这个值。
      const candidateInset = rawInset - safeAreaBottomPx
      const keyboardInset = candidateInset >= 100 ? candidateInset : 0
      root.style.setProperty('--keyboard-inset-bottom', `${Math.round(keyboardInset)}px`)
    }

    // 旋转设备 / 窗口 resize 时 safe-area 可能变化，重测一次。
    const handleWindowResize = () => {
      measureSafeAreaBottom()
      updateViewport()
    }

    updateViewport()
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewport)
      window.visualViewport.addEventListener('scroll', updateViewport)
    }
    window.addEventListener('resize', handleWindowResize)
    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewport)
        window.visualViewport.removeEventListener('scroll', updateViewport)
      }
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [])
}
