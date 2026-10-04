// ============================================
// 消息 ID 生成 —— 与官方完全一致
//
// 逐行移植自 `@opencode/schema/dist/identifier.js` 的 ascending()：
// 12 位时间戳 hex（毫秒 * 0x1000 + 同毫秒计数）+ 14 位随机 base62，
// 字典序即时间序。客户端铸造的 prompt id（`msg_${ascending()}`）随
// session.prompt 提交，服务端原样采用 → 乐观插入的本地行与服务端
// durable 行同 id 对账（官方 packages/client/src/solid/data.ts:1544-1575
// 同款机制）。
// ============================================

const length = 26
const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
let lastTimestamp = 0
let counter = 0

function ascending(timestamp = Date.now()): string {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((current >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, '0'),
  ).join('')
  const bytes = crypto.getRandomValues(new Uint8Array(length - 12))
  return time + Array.from(bytes, byte => chars[byte % 62]).join('')
}

/** 生成官方格式的消息 id（`msg_` 前缀，字典序 = 时间序） */
export function createMessageId(): string {
  return `msg_${ascending()}`
}
