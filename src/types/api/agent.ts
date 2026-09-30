import type { Agent as SDKAgent } from './v1Model'

export type AgentMode = SDKAgent['mode']

export type AgentPermission = SDKAgent['permission'][number]

export type Agent = SDKAgent
