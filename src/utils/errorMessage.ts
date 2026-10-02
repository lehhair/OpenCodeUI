// ============================================
// 错误文案解包
//
// 移植自官方 packages/session-ui/src/timeline/projection.ts 的 unwrapErrorMessage。
//
// 背景：v2 的错误可能被包成字符串再序列化，形如：
//   'Error: {"error":{"type":"...","message":"..."}}'
// 或   '{"message":"..."}'
// 直接展示给用户会是一坨 JSON。官方做的是：尝试解析 → 抽出
// error.message / error.type / message / error → 拿不到就原样返回。
//
// 这比我们之前那套「按 error.name 分支的 MessageError 联合」更贴近 v2：
// v2 的错误就是 `{ type, message, status?, response? }` 一个形状，
// 没有 name 判别字段，也就无从分支。
//
// 唯一改动：官方用 effect 的 Schema 解析，这里换成普通 JSON.parse。
// ============================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** 解析一次；若结果是字符串则再解析一次（官方 read 的递归两层行为） */
function read(value: string): unknown {
  const first = tryParse(value)
  if (typeof first !== 'string') return first
  return tryParse(first.trim())
}

/**
 * 把可能是「JSON 串里套 JSON」的错误文案解包成人类可读的一行。
 * 解不出结构化内容时原样返回输入。
 */
export function unwrapErrorMessage(message: string): string {
  if (typeof message !== 'string') return ''
  const text = message.replace(/^Error:\s*/, '').trim()

  let json = read(text)
  if (json === undefined) {
    // 错误信息前面往往还有别的内容，退而求其次取第一个 { 到最后一个 } 之间
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) json = read(text.slice(start, end + 1))
  }
  if (!isRecord(json)) return message

  const error = isRecord(json.error) ? json.error : undefined
  if (error) {
    const type = typeof error.type === 'string' ? error.type : undefined
    const detail = typeof error.message === 'string' ? error.message : undefined
    if (type && detail) return `${type}: ${detail}`
    if (detail) return detail
    if (type) return type
    const code = typeof error.code === 'string' ? error.code : undefined
    if (code) return code
  }

  const detail = typeof json.message === 'string' ? json.message : undefined
  if (detail) return detail
  const reason = typeof json.error === 'string' ? json.error : undefined
  if (reason) return reason
  return message
}

/**
 * 判断一个助手错误是否属于「被中断」。
 *
 * 官方同样不看 name，而是看 type 里是否含 abort/interrupt：
 *   packages/session-ui/src/timeline/projection.ts → isInterrupted
 */
export function isInterruptedError(error: { type?: string } | undefined): boolean {
  const type = error?.type?.toLowerCase()
  return !!type && (type.includes('abort') || type.includes('interrupt'))
}
