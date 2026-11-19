/**
 * 语法加载失败的短期降级。
 *
 * 某一门语言的 grammar 编译/加载失败时，下一个 48ms tick 还会再试一次，
 * 流式期间等于持续打 worker。这里按语言记一个冷却窗口，期间直接按纯文本渲染；
 * 只影响这一门语言，不影响其它代码块。
 */
const COOLDOWN_MS = 60_000
const MAX_LANGUAGES = 32

const cooldowns = new Map<string, number>()

export function markHighlightLanguageFailed(language: string, now = Date.now()): void {
  const lang = language.toLowerCase()
  cooldowns.delete(lang)
  cooldowns.set(lang, now + COOLDOWN_MS)
  while (cooldowns.size > MAX_LANGUAGES) {
    const oldest = cooldowns.keys().next().value
    if (oldest == null) break
    cooldowns.delete(oldest)
  }
}

export function isHighlightLanguageCoolingDown(language: string, now = Date.now()): boolean {
  const lang = language.toLowerCase()
  const until = cooldowns.get(lang)
  if (until === undefined) return false
  if (until <= now) {
    cooldowns.delete(lang)
    return false
  }
  return true
}

/** 仅供测试 */
export function resetHighlightCooldownsForTests(): void {
  cooldowns.clear()
}
