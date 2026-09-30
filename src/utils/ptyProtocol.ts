const decoder = new TextDecoder()

export type PtyFrame = { kind: 'data'; data: string } | { kind: 'control'; cursor: number }

function parseControlPayload(payload: string): PtyFrame | null {
  try {
    const meta = JSON.parse(payload) as { cursor?: unknown }
    const cursor = meta?.cursor
    if (typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 0) {
      return { kind: 'control', cursor }
    }
  } catch {
    // Ignore malformed PTY control frames.
  }

  return null
}

export function parsePtyFrame(chunk: string | ArrayBuffer | Uint8Array): PtyFrame | null {
  if (typeof chunk === 'string') {
    if (chunk.startsWith('\0')) {
      return parseControlPayload(chunk.slice(1))
    }

    return chunk ? { kind: 'data', data: chunk } : null
  }

  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
  if (bytes.length === 0) return null

  if (bytes[0] === 0) {
    return parseControlPayload(decoder.decode(bytes.subarray(1)))
  }

  const data = decoder.decode(bytes)
  return data ? { kind: 'data', data } : null
}
