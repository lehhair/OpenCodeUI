// ============================================
// 会话标题展示兜底（官方 session-title-fallback.ts 的 displayLabel 同款）
//
// 官方规则：
//   - 无标题 → 根会话 "New session" / 子会话 "Child session"
//   - 历史遗留的时间戳兜底标题（"New session - <ISO>" /
//     "Child session - <ISO>"）→ 折叠为同一个简洁标签
// ============================================

const TIMESTAMPED_FALLBACK = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface SessionTitleLabels {
  newSession: string
  childSession: string
}

/**
 * 计算会话在列表/标题栏里的展示名（官方 displayLabel 语义，
 * 文案由调用方按 i18n 提供）。
 */
export function sessionDisplayTitle(
  session: { title?: string | null; parentID?: string | null },
  labels: SessionTitleLabels,
): string {
  if (!session.title) return session.parentID ? labels.childSession : labels.newSession
  const collapsed = session.title.match(TIMESTAMPED_FALLBACK)?.[1]
  if (collapsed) return collapsed === 'Child session' ? labels.childSession : labels.newSession
  return session.title
}
