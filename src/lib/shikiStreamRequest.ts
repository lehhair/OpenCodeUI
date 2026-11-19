import type { BundledTheme } from 'shiki/themes'
import type { WorkerRequest } from '../workers/shikiWorker'

export type HighlightRequestParams = {
  id: number
  key: string
  text: string
  language: string
  theme: BundledTheme
  mode: 'tokens' | 'html'
  complete?: boolean
  forceReset?: boolean
}

export type HighlightStreamState = {
  /** worker 里这条流已经处理到的完整文本 */
  confirmedText: string
  /** 这个 key 上还没回来的请求数 */
  inFlight: number
}

export type HighlightRequestMessage = Extract<WorkerRequest, { type: 'highlight' }>

/**
 * 决定这一拍发「全量文本」还是「只发新增片段」。
 *
 * 增量只在同时满足这些条件时成立：tokens 流式、没有在途请求（否则 worker 的位置
 * 可能已经被上一拍推进）、不是强制重开、文本确实是在已确认前缀上继续增长。
 * 其他情况一律发全量，让 worker 自己决定要不要重开流。
 */
export function buildHighlightRequest(
  params: HighlightRequestParams,
  state: HighlightStreamState,
): HighlightRequestMessage {
  const canAppend =
    params.mode === 'tokens' &&
    !params.complete &&
    !params.forceReset &&
    state.inFlight === 0 &&
    state.confirmedText.length > 0 &&
    params.text.startsWith(state.confirmedText)

  if (!canAppend) {
    return {
      type: 'highlight',
      id: params.id,
      key: params.key,
      text: params.text,
      language: params.language,
      theme: params.theme,
      mode: params.mode,
      complete: params.complete,
      forceReset: params.forceReset,
    }
  }

  return {
    type: 'highlight',
    id: params.id,
    key: params.key,
    append: params.text.slice(state.confirmedText.length),
    baseLength: state.confirmedText.length,
    language: params.language,
    theme: params.theme,
    mode: params.mode,
    forceReset: params.forceReset,
  }
}
