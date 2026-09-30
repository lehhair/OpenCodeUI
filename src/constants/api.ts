/**
 * API 基础地址。
 *
 * - 未设置（Tauri / 本地开发）→ `http://127.0.0.1:4096`
 * - **相对路径**（Docker 构建注入 `/api`，语义是「同源反代」）→ 解析为**当前页面 origin**
 * - 其它值 → 原样使用（绝对地址）
 *
 * 🔴 V2 修正（2026-09-30，真实 Docker 部署发现）：
 *   V1 时代 base 用相对 `/api`、端点路径不带 `/api`，由反代**削掉** `/api` 前缀命中后端；
 *   V2 的端点本身带 `/api` 前缀，且 SDK 用 `new URL(baseUrl)` 解析（**必须绝对地址**）。
 *   继续把 `/api` 当 base 会：
 *     ① 健康检查拼成 `/api/api/info` → 401/404（实测复现，界面显示 401）；
 *     ② SDK 直接抛 `Invalid URL`（相对地址不能作为 base）。
 *   → 相对 base 一律解析为 origin；端点自带的 `/api` 前缀由请求路径提供，不再需要反代削前缀。
 */
function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (!raw) return 'http://127.0.0.1:4096'
  if (raw.startsWith('/') && typeof window !== 'undefined') return window.location.origin
  return raw
}

export const API_BASE_URL = resolveApiBaseUrl()
