// ============================================
// API Constants - API 相关常量
// ============================================

/** API 基础地址 */
export const API_BASE_URL = 'http://127.0.0.1:4096'

/** SSE 重连延迟序列（毫秒） */
export const SSE_RECONNECT_DELAYS_MS = [1000, 2000, 3000, 5000, 10000, 30000]

/** SSE 心跳超时 */
export const SSE_HEARTBEAT_TIMEOUT_MS = 60000
