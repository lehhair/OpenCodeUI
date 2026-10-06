// ============================================
// sendAdmission —— 每会话发送串行链 + outbox 未确认集合
//
// 逐行移植官方 packages/client/src/solid/data.ts 的两件配套机制：
//   1. `sending` 链（data.ts:337-368）：同会话的 prompt/compact 必须按提交
//      顺序准入——每次发送等待上一个 POST 落定，避免 switchModel/switchAgent/
//      prompt 三步与另一次发送交错（模型/代理归属错配）；一次失败不阻塞下一次。
//   2. `outbox` 集合（data.ts:1539-1583）：乐观插入的行在服务端回声
//      （session.inbox.enqueued）到达前才算"未确认"；POST 失败只允许回滚
//      仍未确认的行，已确认的行属于服务端状态，绝不能撤。
//
// 键一律是带服务器前缀的 scoped sessionId（与 messageStore 一致）。
// ============================================

const sending = new Map<string, Promise<unknown>>()
const outbox = new Set<string>()

/** Register `promise` under `key` until it settles（官方 track 同款） */
function track(map: Map<string, Promise<unknown>>, key: string, promise: Promise<unknown>) {
  map.set(key, promise)
  const settle = () => {
    if (map.get(key) === promise) map.delete(key)
  }
  void promise.then(settle, settle)
}

/**
 * 按提交顺序准入一次发送（官方 sendAdmission 同款）。
 * 等待同会话上一次发送落定后再执行 `send`；失败不影响后续发送。
 */
export function sendAdmission<Value>(sessionId: string, send: () => Promise<Value>, gate?: Promise<unknown>): Promise<Value> {
  const previous = sending.get(sessionId)
  const request = Promise.resolve()
    .then(() => Promise.all([gate, previous]))
    .then(send)
  track(sending, sessionId, request.catch(() => undefined))
  return request
}

/** 乐观条目入 outbox（服务端回声到达前允许回滚） */
export function outboxAdd(id: string): void {
  outbox.add(id)
}

/** 回声确认（session.inbox.enqueued）：此后该行属于服务端状态，不可回滚 */
export function outboxConfirm(id: string): void {
  outbox.delete(id)
}

/**
 * 回滚许可（官方 `outbox.delete(id)` 守卫同款）：
 * 仅当条目仍在 outbox（服务端未确认）时返回 true 并移除。
 */
export function outboxTryRollback(id: string): boolean {
  return outbox.delete(id)
}

/** 测试专用：清空内部状态 */
export function resetSendAdmission(): void {
  sending.clear()
  outbox.clear()
}
