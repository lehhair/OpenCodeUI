// ============================================
// Integration API — provider 连接与 OAuth（OpenCode v2 原生）
//
// 对应官方 packages/app/src/providers/connect/：
//   - integration.list/get   → provider 目录与连接状态
//   - integration.connect.key → API key 连接
//   - integration.oauth.connect/status/complete/cancel → OAuth 授权流
//     （connect 拿授权 URL 拉起浏览器 → status 轮询 → complete/failed/expired）
//   - integration.wellknown.add → models.dev 知名 provider 一键添加
//
// Console 特例（官方 controller.ts）：OpenCode Go 与 OpenCode Zen 都走
// `opencode` integration 的 Console 登录。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { FormAnswer, IntegrationAttempt, IntegrationAttemptStatus, IntegrationInfo } from '@opencode/client/promise'

export type { IntegrationInfo }
export type Authorization = IntegrationAttempt
export type AuthorizationStatus = IntegrationAttemptStatus

/** OpenCode Go 与 OpenCode Zen 共用 OpenCode Console 登录（官方 CONSOLE_INTEGRATION） */
export const CONSOLE_INTEGRATION = 'opencode'
export const CONSOLE_PROVIDERS = new Set(['opencode', 'opencode-go'])

/** 官方 consoleIntegration 同款：Console 系 provider 的连接统一走 `opencode` */
export function consoleIntegration(provider: string): string {
  return CONSOLE_PROVIDERS.has(provider) ? CONSOLE_INTEGRATION : provider
}

/** 列出全部 integration（含 methods 与 connections） */
export async function getIntegrations(directory?: string, serverId?: string): Promise<IntegrationInfo[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.integration.list({ location: locationParam(directory, serverId) })
  return result.data
}

/** 获取单个 integration（methods + connections） */
export async function getIntegration(
  integrationID: string,
  directory?: string,
  serverId?: string,
): Promise<IntegrationInfo | undefined> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.integration.get({ integrationID, location: locationParam(directory, serverId) })
  return result.data
}

/** models.dev 知名 provider 一键添加（官方 integration.wellknown.add，入参是 url） */
export async function addWellknownIntegration(url: string, directory?: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.integration.wellknown.add({ url, location: locationParam(directory, serverId) })
}

/** API key 连接（官方 connect.key：answer 为表单补充答案） */
export async function connectIntegrationKey(
  integrationID: string,
  key: string,
  answer?: FormAnswer,
  directory?: string,
  serverId?: string,
): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.integration.connect.key({
    integrationID,
    key,
    ...(answer ? { answer } : {}),
    location: locationParam(directory, serverId),
  })
}

/** OAuth：发起授权，返回授权信息（url / attemptID / mode） */
export async function connectIntegrationOauth(
  integrationID: string,
  methodID: string,
  answer?: FormAnswer,
  directory?: string,
  serverId?: string,
): Promise<Authorization> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.integration.oauth.connect({
    integrationID,
    methodID,
    ...(answer && Object.keys(answer).length ? { answer } : {}),
    location: locationParam(directory, serverId),
  })
  return result.data
}

/** OAuth：轮询授权状态（pending/complete/failed/expired） */
export async function getIntegrationOauthStatus(
  integrationID: string,
  attemptID: string,
  directory?: string,
  serverId?: string,
): Promise<AuthorizationStatus> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.integration.oauth.status({
    integrationID,
    attemptID,
    location: locationParam(directory, serverId),
  })
  return result.data
}

/** OAuth：手动输入授权码完成（mode !== 'auto' 时） */
export async function completeIntegrationOauth(
  integrationID: string,
  attemptID: string,
  code: string,
  directory?: string,
  serverId?: string,
): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.integration.oauth.complete({
    integrationID,
    attemptID,
    code,
    location: locationParam(directory, serverId),
  })
}

/** OAuth：取消进行中的授权尝试（对话框关闭时调用，官方 cancelAttempt 同款） */
export async function cancelIntegrationOauth(
  integrationID: string,
  attemptID: string,
  directory?: string,
  serverId?: string,
): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.integration.oauth.cancel({
    integrationID,
    attemptID,
    location: locationParam(directory, serverId),
  })
}
