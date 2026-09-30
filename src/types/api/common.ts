// ============================================
// Common API Types
// ============================================
//
// 阶段 2b 的清理记录：
//   本文件原先还 re-export 了 5 个 V1 消息错误类型
//   （`ProviderAuthError` / `UnknownError` / `MessageOutputLengthError` /
//    `MessageAbortedError` / `APIError`），它们的定义源头是
//   `v1Model.ts` 的 **A 桶**（消息错误联合），已随事件层一起删除。
//
//   ⚠️ 这几个名字**并没有消失** —— UI 侧有自己的一份定义
//   （`src/types/message.ts` 的 `MessageError` 判别联合），渲染层一直用的是那一份；
//   这里原先的转发**全仓库零引用**（阶段 2b 逐个 grep 核对过），所以直接删除。
//
//   转换层的职责是把 V2 的 `Session.StructuredError`（`{type, message, status?}`，
//   `type` 是开放字符串）映射到 UI 的那 5 种，见
//   `src/utils/messageConversion.ts` 的 `toMessageError()`。

/**
 * 通用的错误信息形状（`{name, data}`）
 *
 * ⚠️ 这是 V1 的通用形状，与消息的 5 元错误联合**不是一回事**；
 * 保留它是因为它是本模块对外的稳定出口，且与任何桶都无关。
 */
export interface ErrorInfo {
  name: string
  data: unknown
}
