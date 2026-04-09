import type {
  AgentPart as SDKAgentPart,
  AgentPartInput as SDKAgentPartInput,
  AssistantMessage as SDKAssistantMessage,
  CompactionPart as SDKCompactionPart,
  FilePart as SDKFilePart,
  FilePartInput as SDKFilePartInput,
  FilePartSource as SDKFilePartSource,
  PatchPart as SDKPatchPart,
  ReasoningPart as SDKReasoningPart,
  RetryPart as SDKRetryPart,
  SnapshotPart as SDKSnapshotPart,
  StepFinishPart as SDKStepFinishPart,
  StepStartPart as SDKStepStartPart,
  SubtaskPart as SDKSubtaskPart,
  SubtaskPartInput as SDKSubtaskPartInput,
  TextPart as SDKTextPart,
  TextPartInput as SDKTextPartInput,
  ToolPart as SDKToolPart,
  ToolState as SDKToolState,
  UserMessage as SDKUserMessage,
} from '@opencode-ai/sdk/v2/client'
import type { ErrorInfo } from './common'
import type { FileDiff } from './file'

export interface MessageSummary {
  title?: string
  body?: string
  diffs?: FileDiff[]
}

export type UserMessage = Omit<SDKUserMessage, 'summary'> & {
  summary?: MessageSummary
  variant?: string
}

export type AssistantMessage = Omit<SDKAssistantMessage, 'error'> & {
  error?: SDKAssistantMessage['error'] | ErrorInfo
}

export type Message = UserMessage | AssistantMessage

export type TextPart = SDKTextPart

export type ReasoningPart = SDKReasoningPart

export type ToolState = SDKToolState

export type ToolPart = SDKToolPart

export type FileSource = SDKFilePartSource

export type FileSourceType = NonNullable<FileSource>['type']

export type FilePart = SDKFilePart

export type AgentPart = SDKAgentPart

export type StepStartPart = SDKStepStartPart

export type StepFinishPart = SDKStepFinishPart

export type SnapshotPart = SDKSnapshotPart

export type PatchPart = SDKPatchPart

export type SubtaskPart = SDKSubtaskPart

export type RetryPart = SDKRetryPart

export type CompactionPart = SDKCompactionPart

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | FilePart
  | AgentPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | SubtaskPart
  | RetryPart
  | CompactionPart

export interface MessageWithParts {
  info: Message
  parts: Part[]
}

export type TextPartInput = SDKTextPartInput

export type FilePartInput = SDKFilePartInput

export type AgentPartInput = SDKAgentPartInput

export type SubtaskPartInput = SDKSubtaskPartInput
