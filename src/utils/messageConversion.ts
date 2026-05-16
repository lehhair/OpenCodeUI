import type { ApiMessage, ApiMessageWithParts, ApiPart } from '../api/types'
import type { Message, MessageInfo, Part, UserMessageInfo } from '../types/message'
import { isUserMessage } from '../types/message'

type ApiMessageEnvelope = ApiMessageWithParts | { message: ApiMessageWithParts['info']; parts: ApiMessageWithParts['parts'] }

function getEnvelopeInfo(apiMessage: ApiMessageEnvelope): ApiMessageWithParts['info'] {
  return 'info' in apiMessage ? apiMessage.info : apiMessage.message
}

export function toUIMessage(apiMessage: ApiMessageEnvelope): Message {
  return {
    info: getEnvelopeInfo(apiMessage) as MessageInfo,
    parts: apiMessage.parts as Part[],
    isStreaming: false,
  }
}

export function toUIMessageInfo(apiMessage: ApiMessage): MessageInfo {
  return apiMessage as MessageInfo
}

export function toUIPart(apiPart: ApiPart): Part {
  return apiPart as Part
}

export function toApiMessageWithParts(message: Pick<Message, 'info' | 'parts'>): ApiMessageWithParts {
  return {
    info: message.info as ApiMessageWithParts['info'],
    parts: message.parts as ApiMessageWithParts['parts'],
  }
}

export function isUserUIMessage(message: Message): message is Message & { info: UserMessageInfo } {
  return isUserMessage(message.info)
}
