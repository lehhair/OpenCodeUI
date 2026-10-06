function readErrorNumber(error: unknown, key: string): number | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : null
}

function collectErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (error == null || seen.has(error)) return ''
  seen.add(error)

  if (typeof error === 'string') return error
  if (error instanceof Error) {
    const record = error as Error & Record<string, unknown>
    return [
      error.name,
      error.message,
      collectErrorText(record.cause, seen),
      collectErrorText(record.error, seen),
      collectErrorText(record.response, seen),
      collectErrorText(record.data, seen),
      collectErrorText(record.body, seen),
    ].join(' ')
  }
  if (typeof error !== 'object') return String(error)

  const record = error as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['name', 'message', 'code', 'status', 'statusCode', 'error', 'data', 'body']) {
    const value = record[key]
    if (value == null) continue
    if (typeof value === 'object') parts.push(collectErrorText(value, seen))
    else parts.push(String(value))
  }

  try {
    parts.push(JSON.stringify(error))
  } catch {
    // Ignore non-serializable SDK errors.
  }

  return parts.join(' ')
}

export function isSessionNotFoundError(error: unknown): boolean {
  const status = readErrorNumber(error, 'status') ?? readErrorNumber(error, 'statusCode')
  if (status === 404) return true

  const text = collectErrorText(error).toLowerCase()
  if (!text) return false

  return (
    text.includes('404') ||
    text.includes('not found') ||
    text.includes('not_found') ||
    /session\s+(does\s+not\s+exist|not\s+found|missing)/i.test(text)
  )
}

/**
 * 通用「目标已不存在」判定（404 / not found）。
 * 用于 permission.reply / form.reply：服务端已没有该请求（被其他客户端
 * 处理、会话回退等）时不该重试，官方 data.ts:1741 同款吞掉。
 */
export function isNotFoundError(error: unknown): boolean {
  const status = readErrorNumber(error, 'status') ?? readErrorNumber(error, 'statusCode')
  if (status === 404) return true

  const text = collectErrorText(error).toLowerCase()
  if (!text) return false
  return text.includes('404') || text.includes('not found') || text.includes('not_found')
}
