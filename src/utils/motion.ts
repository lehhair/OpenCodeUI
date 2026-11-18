/**
 * 系统动态效果偏好的统一读取入口。
 *
 * 浏览器/WebView 里 `prefers-reduced-motion` 是用户明确的偏好，自定义的
 * 高度补间、入场生长、流式逐字都不能绕开它。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
