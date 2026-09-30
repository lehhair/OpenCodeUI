// ============================================
// MCP API - Model Context Protocol 服务器管理
// 基于 @opencode/client（OpenCode V2）
// ============================================
//
// V2 端点口径（迁移文档 §4.7 + `/tmp/opencode/openapi-v2.json` 核对）：
//
//   | 能力 | V1 | V2 |
//   |---|---|---|
//   | 服务器列表 | `GET /mcp` | `GET /api/mcp`（location 作用域，返回**数组**） |
//   | 增删服务器 | `POST /mcp`、`DELETE /mcp/{name}` | `PUT/DELETE /api/experimental/mcp/{server}` |
//   | 连接/断开 | `POST /mcp/{name}/connect|disconnect` | `/api/experimental/mcp/{server}/...` |
//   | 资源目录 | `GET /experimental/resource` | `GET /api/mcp/resource`（转正，多出 templates） |
//   | OAuth | `POST /mcp/{name}/auth*`（4 个端点） | 🔴 **全删**，改用 `/api/integration/*` 体系 |
//
// ── 为什么 OAuth 这一块要绕一大圈 ──────────────────────────────────────────
//
// V1：`POST /mcp/{name}/auth` 直接返回 `{ authorizationUrl }`，MCP 端点自己
//     就知道「这个服务器该怎么登录」。
//
// V2：MCP 与「登录」**解耦**了。`GET /api/mcp` 返回的每个服务器可能带一个
//     `integrationID`（唯一桥梁），真正的登录流程挂在 `/api/integration/{id}`：
//       ① `GET  /api/integration/{id}`                        → 看有哪些 methods
//       ② `POST /api/integration/{id}/connect/oauth`          → 发起 attempt，拿 url
//       ③ `GET  /api/integration/{id}/connect/oauth/{aid}`    → 轮询 attempt 状态
//       ④ `POST /api/integration/{id}/connect/oauth/{aid}/complete` → 提交授权码
//     凭证是独立资源：`DELETE /api/credential/{credentialID}`。
//
//     于是「按服务器名登录」变成了**多步串联**：本模块用一个模块级 Map 在
//     「发起」与「提交 code」之间传递 `{integrationID, attemptID}`
//     （UI 只持有服务器名，而 complete 端点必须拿到这两个 ID）。
// ============================================

import { getSDKClient } from './sdk'
import { locationInput } from './v2Convert'
import type { MCPResourceMap, MCPStatusResponse, McpServerConfig } from '../types/api/mcp'

/** `locationInput()` 的返回类型（`{location:{directory}}` 或 `undefined`） */
type LocationInput = ReturnType<typeof locationInput>

/** SDK client 类型（直接从工厂推导，避免 import 一长串生成的类型名） */
type SDKClient = ReturnType<typeof getSDKClient>

/** OAuth 轮询间隔：1 秒（服务端 attempt 状态变化不会更快） */
const OAUTH_POLL_INTERVAL_MS = 1_000

/**
 * OAuth 轮询总超时：5 分钟。
 *
 * 为什么要有上限：`authenticateMcp()` 的 V1 语义是「一步完成登录」，
 * UI（`McpPanel.handleAuth`）在它返回后才刷新状态。如果用户把浏览器标签页
 * 一关了之，无限轮询会让 UI 永远转圈。超时后抛错，用户至少能看到失败原因。
 * （真实的 OAuth attempt 本身也会过期，服务端会返回 `expired`。）
 */
const OAUTH_POLL_TIMEOUT_MS = 5 * 60 * 1_000

/**
 * 待完成的 OAuth attempt 缓存。
 *
 * key = `${serverId}::${serverName}`，value = complete 端点必需的两个 ID。
 *
 * ⚠️ 当前本模块的 API 只面向**活动服务器**（调用方只传 directory，不传 serverId），
 * 所以 serverId 恒为 `undefined`；key 里保留前缀是为了以后接多服务器时
 * 不会把不同服务器上同名 MCP 的 attempt 混在一起。
 */
const pendingOAuthAttempts = new Map<string, { integrationID: string; attemptID: string }>()

/** 拼 attempt 缓存 key（见 `pendingOAuthAttempts` 注释） */
function oauthAttemptKey(name: string, serverId?: string): string {
  return `${serverId ?? ''}::${name}`
}

/** 简易 sleep（轮询用；不引第三方依赖） */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================
// 服务器列表 / 资源目录
// ============================================

/**
 * 获取所有 MCP 服务器状态
 *
 * V1: `sdk.mcp.status({ directory })` → `Record<name, McpStatus>`
 * V2: `sdk.mcp.list({ location })`    → `{ location, data: Mcp.Server[] }`
 *
 * ⚠️ 结构变了（对象 → 数组），这里显式映射成内部 `MCPServer[]`，
 * 而不是直接把 SDK 的类型透传出去 —— 内部模型与 SDK 解耦，
 * 将来 V2 增删字段不会影响 UI。
 */
export async function getMcpStatus(directory?: string): Promise<MCPStatusResponse> {
  const sdk = getSDKClient()
  const result = await sdk.mcp.list(locationInput(directory, undefined, 'GET /api/mcp'))
  return result.data.map(server => ({
    name: server.name,
    status: server.status,
    // 这是 OAuth 登录的唯一入口，必须原样带出来（见文件头注释）
    integrationID: server.integrationID,
  }))
}

/**
 * 获取已连接 MCP 服务器暴露的 resources
 *
 * V1: `GET /experimental/resource` → `Record<uri, McpResource>`（来源字段叫 `client`）
 * V2: `sdk.mcp.resource.catalog({ location })` → `{ location, data: { resources, templates } }`
 *
 * ⚠️ 两个变化：① 容器从「按 uri 的 Map」变成 `{resources, templates}`；
 *            ② 资源的来源字段 `client` → `server`（值都是服务器名）。
 */
export async function getMcpResources(directory?: string): Promise<MCPResourceMap> {
  const sdk = getSDKClient()
  const result = await sdk.mcp.resource.catalog(locationInput(directory, undefined, 'GET /api/mcp/resource'))
  return {
    resources: result.data.resources,
    templates: result.data.templates,
  }
}

// ============================================
// 增删 / 连接 / 断开
// ============================================

/**
 * 添加 MCP 服务器
 *
 * V1: `POST /mcp`（body 里带 name）
 * V2: `sdk.mcp.add({ server, config, location })`
 *     → `PUT /api/experimental/mcp/{server}`，body 是 `{ config }`（包一层）
 *
 * ⚠️ 配置字段与 V1 不同（`disabled` 而不是 `enabled`、`timeout` 从数字变对象等），
 * 详见 `src/types/api/mcp.ts` 的说明。类型不兼容会在这一行直接编译报错。
 */
export async function addMcpServer(name: string, config: McpServerConfig, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  await sdk.mcp.add({
    server: name,
    config,
    // ⚠️ locationInput() 返回的是**整个入参对象的形状** `{location:{directory}}`，
    //    所以多参数端点必须**展开**（`...locationInput(...)`），
    //    不能写成 `location: locationInput(...)`（那会变成 `location[location][directory]`，
    //    服务端静默忽略 → 回落到 process.cwd()）。
    ...locationInput(directory, undefined, 'PUT /api/experimental/mcp/{server}'),
  })
}

/**
 * 连接到 MCP 服务器
 *
 * V2: `sdk.mcp.connect({ server, location })`
 *     → `POST /api/experimental/mcp/{server}/connect`
 *     （语义：运行时临时连接，覆盖配置里的 disabled，直到服务进程重启）
 */
export async function connectMcpServer(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  await sdk.mcp.connect({
    server: name,
    ...locationInput(directory, undefined, 'POST /api/experimental/mcp/{server}/connect'),
  })
}

/**
 * 断开 MCP 服务器连接
 *
 * V2: `sdk.mcp.disconnect({ server, location })`
 *     → `POST /api/experimental/mcp/{server}/disconnect`
 */
export async function disconnectMcpServer(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  await sdk.mcp.disconnect({
    server: name,
    ...locationInput(directory, undefined, 'POST /api/experimental/mcp/{server}/disconnect'),
  })
}

// ============================================
// OAuth（V2 的 /api/integration/* 体系）
// ============================================

/**
 * 通过服务器名找到它的 `integrationID`（MCP → integration 的**唯一桥梁**）。
 *
 * ⚠️ V2 里 `integrationID` 只出现在 `GET /api/mcp` 的响应里，没有别的入口；
 * 所以「按服务器名做 OAuth 相关操作」都必须先做这一次 list。
 *
 * 失败时抛中文错误（不返回 undefined）：调用方都是 UI 按钮，
 * 静默失败会让用户以为「点了没反应」。
 */
async function resolveIntegrationID(sdk: SDKClient, name: string, location: LocationInput): Promise<string> {
  const list = await sdk.mcp.list(location)
  const server = list.data.find(item => item.name === name)
  if (!server) {
    throw new Error(
      `[MCP OAuth] 未找到名为 "${name}" 的 MCP 服务器（GET /api/mcp）。` + '请先刷新面板确认该服务器仍然存在。',
    )
  }
  if (!server.integrationID) {
    throw new Error(
      `[MCP OAuth] MCP 服务器 "${name}" 没有 integrationID —— 说明它未配置 OAuth 登录` +
        '（V2 里 OAuth 由 /api/integration/* 体系管理，未关联 integration 的服务器无法发起认证）。',
    )
  }
  return server.integrationID
}

/**
 * 通过服务器名找到它的 integration，并挑出 OAuth 认证方法。
 *
 * 三步：`mcp.list` → 匹配 name → 取 `integrationID` → `integration.get` → 找 `type === 'oauth'`。
 */
async function resolveOAuthTarget(
  sdk: SDKClient,
  name: string,
  location: LocationInput,
): Promise<{ integrationID: string; methodID: string }> {
  const integrationID = await resolveIntegrationID(sdk, name, location)

  const info = await sdk.integration.get({ integrationID, ...location })
  const oauthMethod = info.data.methods.find(method => method.type === 'oauth')
  if (!oauthMethod) {
    const available = info.data.methods.map(method => method.type).join(', ') || '(无)'
    throw new Error(
      `[MCP OAuth] integration "${integrationID}" 没有可用的 OAuth 认证方法` +
        `（现有方法类型：${available}），无法发起登录。`,
    )
  }

  return { integrationID, methodID: oauthMethod.id }
}

/**
 * 开始 MCP 认证流程
 *
 * 🔴 V1 的 `POST /mcp/{name}/auth` 在 V2 已被删除，替代链路见文件头注释。
 *
 * 返回值保持 `{ url }` 不变 —— `McpPanel.tsx` 用它去 `window.open()`
 * （V1 的字段名是 `authorizationUrl`，这里是本模块自己的契约，所以不需要跟着改名）。
 *
 * 同时把 `{integrationID, attemptID}` 记进模块级 Map，供 `completeMcpAuth()` 使用。
 */
export async function startMcpAuth(name: string, directory?: string): Promise<{ url: string }> {
  const sdk = getSDKClient()
  const location = locationInput(directory, undefined, 'POST /api/integration/{integrationID}/connect/oauth')
  const { integrationID, methodID } = await resolveOAuthTarget(sdk, name, location)

  const result = await sdk.integration.oauth.connect({ integrationID, methodID, ...location })
  const attempt = result.data

  // 记下来：complete 端点需要 integrationID + attemptID，而 UI 只持有服务器名
  pendingOAuthAttempts.set(oauthAttemptKey(name), {
    integrationID,
    attemptID: attempt.attemptID,
  })

  return { url: attempt.url }
}

/**
 * 完成 MCP OAuth 认证（提交授权码）
 *
 * 🔴 V1 的 `POST /mcp/{name}/auth/callback` 已删除；
 * V2 对应 `POST /api/integration/{id}/connect/oauth/{attemptID}/complete`。
 *
 * ⚠️ 必须先通过 `startMcpAuth()` 或 `authenticateMcp()` 发起 attempt
 * （V2 的 complete 需要 integrationID + attemptID，无法只凭服务器名拼出来）。
 */
export async function completeMcpAuth(name: string, code: string, directory?: string): Promise<void> {
  const pending = pendingOAuthAttempts.get(oauthAttemptKey(name))
  if (!pending) {
    throw new Error(
      `[MCP OAuth] 没有找到服务器 "${name}" 的待完成 OAuth attempt。` +
        '请先调用 startMcpAuth()（拿授权链接）或 authenticateMcp() 发起认证，再提交授权码。',
    )
  }

  const sdk = getSDKClient()
  const location = locationInput(
    directory,
    undefined,
    'POST /api/integration/{integrationID}/connect/oauth/{attemptID}/complete',
  )
  await sdk.integration.oauth.complete({
    integrationID: pending.integrationID,
    attemptID: pending.attemptID,
    code,
    ...location,
  })

  // 只有提交成功才清缓存：失败（比如 code 输错）时保留 attempt，用户可以直接重试
  pendingOAuthAttempts.delete(oauthAttemptKey(name))
}

/**
 * 轮询 OAuth attempt 直到出结果（只给 `mode === 'auto'` 用）。
 *
 * 间隔 1 秒、总超时 5 分钟（见常量注释）。服务端在浏览器侧授权完成前
 * 一直返回 `pending`，完成后变 `complete`；失败/过期则分别返回
 * `failed`（带 message）/ `expired`。
 */
async function waitForOAuthAttempt(
  sdk: SDKClient,
  params: { integrationID: string; attemptID: string; location: LocationInput; name: string },
): Promise<void> {
  const { integrationID, attemptID, location, name } = params
  const deadline = Date.now() + OAUTH_POLL_TIMEOUT_MS

  for (;;) {
    const result = await sdk.integration.oauth.status({ integrationID, attemptID, ...location })
    const status = result.data

    switch (status.status) {
      case 'complete':
        return
      case 'failed':
        throw new Error(`[MCP OAuth] 服务器 "${name}" 的 OAuth 认证失败：${status.message}`)
      case 'expired':
        throw new Error(`[MCP OAuth] 服务器 "${name}" 的 OAuth attempt 已过期，请重新点击认证按钮发起。`)
      case 'pending':
        break
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `[MCP OAuth] 等待服务器 "${name}" 完成 OAuth 认证超时（${OAUTH_POLL_TIMEOUT_MS / 60_000} 分钟）。` +
          '请确认浏览器里的授权页面是否已完成；也可以重新点击认证按钮。',
      )
    }
    await sleep(OAUTH_POLL_INTERVAL_MS)
  }
}

/**
 * 启动完整的 OAuth 认证流程（V1 `POST /mcp/{name}/auth/authenticate` 的替代）
 *
 * V2 下按 attempt 的 `mode` 分两种处理：
 *
 *   - `mode === 'auto'`：服务端会在浏览器授权后自动完成（回调走服务端），
 *     所以这里**轮询等待**到 complete/failed/expired 再返回，保持 V1
 *     「调用返回 = 认证结束」的语义（UI 在它返回后才刷新状态）。
 *
 *   - `mode === 'code'`：必须由用户把授权码贴回来（`completeMcpAuth`）。
 *     这里**不轮询**（轮询永远不会 complete，UI 会静默卡 5 分钟），
 *     直接抛错并把授权链接带出来；同时记录 attempt，
 *     这样用户按提示调用 `completeMcpAuth()` 就能直接成功。
 */
export async function authenticateMcp(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  const location = locationInput(directory, undefined, 'POST /api/integration/{integrationID}/connect/oauth')
  const { integrationID, methodID } = await resolveOAuthTarget(sdk, name, location)

  const result = await sdk.integration.oauth.connect({ integrationID, methodID, ...location })
  const attempt = result.data

  if (attempt.mode === 'code') {
    // 记录 attempt：错误信息里让用户直接用 completeMcpAuth 提交 code
    pendingOAuthAttempts.set(oauthAttemptKey(name), {
      integrationID,
      attemptID: attempt.attemptID,
    })
    throw new Error(
      `[MCP OAuth] 服务器 "${name}" 的 OAuth 采用授权码模式（mode=code），无法自动完成。\n` +
        `请在浏览器打开以下链接完成授权：${attempt.url}\n` +
        `然后调用 completeMcpAuth("${name}", code) 提交授权码。\n` +
        '（也可以改用 startMcpAuth() 重新发起以获取链接；本次 attempt 已记录，可直接提交 code。）',
    )
  }

  await waitForOAuthAttempt(sdk, { integrationID, attemptID: attempt.attemptID, location, name })

  // 认证已结束，清掉可能存在的历史记录（例如用户先 startMcpAuth 又点了认证按钮）
  pendingOAuthAttempts.delete(oauthAttemptKey(name))
}

/**
 * 移除 MCP 认证
 *
 * 🔴 V1 的 `DELETE /mcp/{name}/auth` 已删除。V2 里凭证是独立资源：
 *   `integration.get` → `connections` 里找 `type === 'credential'` → `DELETE /api/credential/{id}`。
 *
 * ⚠️ `credential.remove` **没有** location 参数（凭证按服务进程全局存储），
 * 所以这里只传 `credentialID`。
 */
export async function removeMcpAuth(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  const location = locationInput(directory, undefined, 'GET /api/integration/{integrationID}')

  const integrationID = await resolveIntegrationID(sdk, name, location)

  const info = await sdk.integration.get({ integrationID, ...location })
  const credential = info.data.connections.find(connection => connection.type === 'credential')
  if (!credential) {
    throw new Error(`[MCP OAuth] integration "${integrationID}" 没有任何已保存的凭证，无需移除。`)
  }

  await sdk.credential.remove({ credentialID: credential.id })
}
