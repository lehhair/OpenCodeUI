// ============================================
// PTY API - 终端管理
// 基于 @opencode/client（OpenCode V2）
// ============================================
//
// 阶段 3a：5 处 `notMigratedYet` **全部清零**，并重做连接协议。
//
// 端点口径（v2.0.19 实测 + openapi 核对，非推测）：
//
//   | 能力         | V2 端点                            | SDK 方法             |
//   |--------------|------------------------------------|----------------------|
//   | 会话列表     | GET    /api/pty                    | pty.list             |
//   | 创建会话     | POST   /api/pty                    | pty.create           |
//   | 会话详情     | GET    /api/pty/{ptyID}            | pty.get              |
//   | 更新会话     | **PUT** /api/pty/{ptyID}           | pty.update           |
//   | 删除会话     | DELETE /api/pty/{ptyID}            | pty.remove           |
//   | 连接票据     | POST   /api/pty/{ptyID}/connect-token | pty.connect.token |
//   | 连接（WS）   | GET    /api/pty/{ptyID}/connect?ticket=&cursor= | **不经 SDK，手拼 URL** |
//
// 🔴 与 V1 的三大差异（每一条都踩过，别凭直觉改）：
//
// 1. **更新方法从 PATCH 改成 PUT**（`pty.update` 内部已是 PUT，调用方无感）。
//
// 2. **连接协议从「带 auth 直连 WS」改成两步**：
//      ① `POST /api/pty/{ptyID}/connect-token` 换一次性 ticket
//      ② 再连 `GET /api/pty/{ptyID}/connect?ticket=...`
//    票据一次性、60 秒过期 → **每次建连都要重新申请**，URL 不可缓存复用。
//    详见 `createPtyConnectTicket()` / `getPtyConnectUrl()` 的注释。
//
// 3. **目录参数口径不同**：
//    - 5 个 REST 端点是 location 作用域 → 用 `locationInput()` 传
//      `location[directory]`（缺目录会被服务端静默回落到 `process.cwd()`）。
//    - connect 端点（WS）只认 **`location[directory]`** 这个 query 名，
//      V1 那种裸 `directory=` 会被**静默忽略**（详见 `getPtyConnectUrl`）。
//
// 响应信封：REST 端点返回 `{ location, data }`，**需要自己取 `.data`**
//   （SDK 只对少数端点做了 `.then(v => v.data)` 解包，pty 系列没有）。
// ============================================

import { getSDKClient } from './sdk'
import { getApiBaseUrl, buildQueryString } from './http'
import { locationInput } from './v2Convert'
import { serverStore } from '../store/serverStore'
import type { Pty, PtyCreateParams, PtyUpdateParams } from '../types/api/pty'

export interface ShellInfo {
  path: string
  name: string
  acceptable: boolean
}

interface PtyConnectUrlOptions {
  /**
   * false = 不在 URL 里放认证（Tauri bridge 通过 header 传）
   * true  = 在 URL 里放认证（浏览器原生 WebSocket 无法设 header）
   *
   * ⚠️ 无论哪种模式，**ticket 都必须放在 URL 里**：
   *   Rust 侧 `bridge_connect` 只支持自定义 header，ticket 不在它的白名单内，
   *   所以 Tauri 路径也是「ticket 走 query、认证走 header」。
   */
  includeAuthInUrl?: boolean
  cursor?: number
}

/**
 * 获取所有 PTY 会话列表
 *
 * V1 `GET /pty` → V2 `GET /api/pty`（location 作用域）
 * 返回信封 `{ location, data: Pty[] }` → 取 `.data`
 *
 * ⚠️ `Pty` 的形状换了（`running: boolean` → `status: 'running' | 'exited'`），
 *    见 `src/types/api/pty.ts`。
 */
export async function listPtySessions(directory?: string, serverId?: string): Promise<Pty[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.list(locationInput(directory, serverId, 'GET /api/pty'))
  return result.data
}

/**
 * 获取当前机器可用 shell 列表，用于 opencode config.shell 的候选项。
 *
 * ✅ 阶段 1 已迁移：
 *   V1 `GET /pty/shells` → V2 `GET /api/config/shell`
 *   响应类型 `{ path, name, acceptable }[]` 两版完全一致，无需转换。
 *
 * ⚠️ 该端点是**服务级**的，不接受 location 参数（phase0 附录 A：`/api/config/shell` 无目录参数）。
 *   所以 `directory` / `serverId` 仅用于选择目标服务器的 client。
 */
export async function listAvailableShells(_directory?: string, serverId?: string): Promise<ShellInfo[]> {
  const sdk = getSDKClient(serverId)
  return sdk.config.shells()
}

/**
 * 创建新的 PTY 会话
 *
 * V1 `POST /pty` → V2 `POST /api/pty`（location 作用域）
 * 请求体字段（command/args/cwd/title/env）与 V1 同名同形状 → 调用方零改动。
 * 返回信封 `{ location, data: Pty }` → 取 `.data`
 */
export async function createPtySession(params: PtyCreateParams, directory?: string, serverId?: string): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.create({
    ...params,
    ...locationInput(directory, serverId, 'POST /api/pty'),
  })
  return result.data
}

/**
 * 获取单个 PTY 会话信息
 *
 * V1 `GET /pty/{id}` → V2 `GET /api/pty/{ptyID}`（location 作用域）
 * 返回信封 `{ location, data: Pty }` → 取 `.data`
 */
export async function getPtySession(ptyId: string, directory?: string, serverId?: string): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.get({
    ptyID: ptyId,
    ...locationInput(directory, serverId, 'GET /api/pty/{ptyID}'),
  })
  return result.data
}

/**
 * 更新 PTY 会话（改标题 / 改尺寸）
 *
 * V1 `PATCH /pty/{id}` → V2 **`PUT`** `/api/pty/{ptyID}`
 *
 * ⚠️ **HTTP 方法从 PATCH 变成了 PUT**，请求体形状不变
 *    （`{ title?, size?: { rows, cols } }`，`size` 字段名与形状与 V1 完全一致）。
 *    方法差异由 SDK 内部处理（`generated/client.js` 里 `update` 的 `method: "PUT"`），
 *    调用方只管调 `sdk.pty.update()` 即可，**不要**自己拼 HTTP 请求。
 *
 * 返回信封 `{ location, data: Pty }` → 取 `.data`
 */
export async function updatePtySession(
  ptyId: string,
  params: PtyUpdateParams,
  directory?: string,
  serverId?: string,
): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.update({
    ptyID: ptyId,
    ...params,
    ...locationInput(directory, serverId, 'PUT /api/pty/{ptyID}'),
  })
  return result.data
}

/**
 * 删除 PTY 会话
 *
 * V1 `DELETE /pty/{id}` → V2 `DELETE /api/pty/{ptyID}`（方法名 remove 不变）
 *
 * 返回类型：V2 端点返回 **204 No Content**（SDK 生成类型是 `void`），
 * 没有 V1 那种「成功/失败」布尔值。为了不改动调用方签名（`Promise<boolean>`），
 * 这里在成功时返回 `true`；失败时 SDK 直接 throw，由调用方 catch。
 * 全仓库调用点（`WorktreePanel` / `BottomPanel` / `RightPanel`）都不读返回值。
 */
export async function removePtySession(ptyId: string, directory?: string, serverId?: string): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  await sdk.pty.remove({
    ptyID: ptyId,
    ...locationInput(directory, serverId, 'DELETE /api/pty/{ptyID}'),
  })
  return true
}

/**
 * 申请 PTY 连接票据 —— V2 连接协议的**第一步**
 *
 * V2 端点：`POST /api/pty/{ptyID}/connect-token`
 * SDK：`sdk.pty.connect.token({ ptyID, location, 'x-opencode-ticket': '1' })`
 *
 * 🔴 三个必须照做的细节（v2.0.19 实测确认，不是推测）：
 *
 * 1. **必须带 `x-opencode-ticket: '1'` 请求头**。
 *    服务端 handler 的判断是
 *      `headers["x-opencode-ticket"] !== "1" || !originAllowed(...) → 403`
 *    —— 这个头的值是**固定字面量 "1"**（一个 CSRF 防护标记），**不是票据本身**！
 *    openapi 把它标成 optional，**实际必填**；漏了就 403
 *    `{"_tag":"ForbiddenError","message":"Invalid PTY connect token request"}`。
 *    实测：不带 → 403；带 `'1'` → 200。
 *
 * 2. **必须带 location**（走 `locationInput()`，不要绕过）。
 *    服务端会拿本次请求的 location 去查 pty（内部 `pty.get(ptyID)`），查不到直接 404。
 *    缺目录时服务端**静默**回落到它自己的 `process.cwd()` —— 那是另一个目录，
 *    结果就是 404，或者「连到了别的目录的同名 pty」。这类错不报错、只错连，最难查。
 *    实测：`?location[directory]=/tmp/opencode/pty-probe` → 200；
 *          `?location[directory]=/tmp`（错目录）→ 404 `PtyNotFoundError`。
 *
 * 3. 返回值是**完整信封** `{ location, data: { ticket, expires_in } }`，
 *    需要自己取 `.data`。（阶段 3 任务说明里写的「SDK 已解包」与实测不符：
 *    SDK 只对 `experimental.persistentPty.*` 等少数端点做了 `.then(v => v.data)`，
 *    `pty.connect.token` 没有。这里按实测实现。）
 *
 * 票据语义：**一次性 + 短时效**。实测 `expires_in = 60`（秒），
 * 同一个 ticket 消费第二次返回 403。所以**每次建连都必须重新申请**，
 * 生成的 URL 不能缓存、不能复用、不能重试。
 */
export async function createPtyConnectTicket(
  ptyId: string,
  directory?: string,
  serverId?: string,
): Promise<{ ticket: string; expiresIn: number }> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.connect.token({
    ptyID: ptyId,
    ...locationInput(directory, serverId, 'POST /api/pty/{ptyID}/connect-token'),
    // 固定字面量 '1'，见函数头第 1 条 —— 不是票据，是 CSRF 标记
    'x-opencode-ticket': '1',
  })
  return { ticket: result.data.ticket, expiresIn: result.data.expires_in }
}

/**
 * 拼装 PTY 连接 WebSocket URL —— V2 连接协议的**第二步**
 *
 * 调用顺序：先 `await createPtyConnectTicket()` 拿 ticket，再把 ticket 传进来。
 * 本函数是**纯同步字符串拼接**（不碰 SDK），方便在重连路径里直接调用。
 *
 * 🔴 与 V1 的几个关键差异（每一条都实测确认过）：
 *
 * 1. **query 里必须带 `ticket`**。票据一次性 + 60 秒过期，
 *    所以**每次建连都要重新申请** —— 这个 URL 不能缓存、不能复用，
 *    复用第二次会被服务端判 403（实测：同一 ticket 第二次 connect → 403）。
 *    带 ticket 时服务端会**跳过 Basic 认证**（票据本身就是这一次连接的凭证），
 *    但下面仍保留 auth_token / userinfo 兜底，兼容「不带 ticket」的旧路径。
 *
 * 2. **目录参数名从 `directory` 改成 `location[directory]`**。
 *    V2 的 connect 端点只认 `location[directory]`；V1 那种裸 `directory=`
 *    会被**静默忽略** —— HTTP 依然是 101，但服务端用 `process.cwd()` 去定位 pty，
 *    结果是 404 或连到别的目录。实测（pty 在 /tmp、服务端 cwd 在别处）：
 *      `?ticket=X`                          → 404
 *      `?ticket=X&location[directory]=/tmp` → 101 Switching Protocols
 *      `?ticket=X&directory=/tmp`           → 404（裸参数被忽略）
 *    这里复用 `locationInput()` 取目录，保证与「申请票据时」用的是**同一份归一化结果**，
 *    否则票据消费会因 location 不匹配而 403。
 *
 * 3. **路径要带 `/api` 前缀**：`getApiBaseUrl()` 返回的是裸服务器地址
 *    （如 `http://127.0.0.1:4096`，SDK 内部自己拼 `/api/...`），
 *    V1 时代这里拼的是 `/pty/...`（V1 路由无 /api 前缀），换 V2 必须补 `/api`，
 *    否则会打到 SPA 兜底路由拿到 **200 + text/html**（不是 404，很有迷惑性），
 *    WebSocket 握手直接失败。实测确认。
 *
 * 4. ⚠️ 服务端还有一道 **Origin 白名单**：`http(s)://localhost:*`、`http://127.0.0.1:*`、
 *    `tauri://localhost` / `http(s)://tauri.localhost`、`oc://renderer`、`*.opencode.ai`
 *    之外的前端 origin 会被 connect-token / connect 判 **403**（除非服务端 `--cors` 显式放行）。
 *    也就是说：用局域网 IP（如 `http://192.168.1.5:5173`）打开本前端时，
 *    浏览器路径会 403 —— 这是服务端策略，前端无法绕过，只能让服务端加 `--cors`。
 *    实测：`Origin: http://localhost:5173` → 200/101；`Origin: http://192.168.1.50:5173` → 403。
 *
 * 浏览器 WebSocket 不支持自定义 header，认证方式：
 * - 跨域：auth_token query parameter（与官方 opencode app 一致）
 * - 同源：浏览器会复用页面的 Basic auth 凭据
 * - Tauri bridge：`includeAuthInUrl: false`，认证交给 Rust 侧 header，
 *   但 **ticket 依然在 query 里**（Rust 的 `bridge_connect` 不支持自定义 header 传 ticket）
 *
 * @param ptyId   PTY 会话 id
 * @param ticket  `createPtyConnectTicket()` 返回的**一次性**票据（每次建连都要新申请）
 */
export function getPtyConnectUrl(
  ptyId: string,
  ticket: string,
  directory?: string,
  options?: PtyConnectUrlOptions,
  serverId?: string,
): string {
  const httpBase = getApiBaseUrl(serverId)
  const wsBase = httpBase.replace(/^http/, 'ws')
  const includeAuthInUrl = options?.includeAuthInUrl ?? true
  const cursor =
    typeof options?.cursor === 'number' && Number.isSafeInteger(options.cursor) && options.cursor >= 0
      ? options.cursor
      : undefined

  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  // 复用 locationInput()：与「申请票据」用的是同一份归一化目录（含多服务器/路径格式处理）
  const formatted = locationInput(directory, serverId, 'GET /api/pty/{ptyID}/connect')?.location.directory

  // ⚠️ 路径必须带 `/api` 前缀！
  //   `getApiBaseUrl()` 返回的是**裸**服务器地址（如 `http://127.0.0.1:4096`，
  //   不含 `/api`）—— SDK 内部是自己拼 `/api/...` 的，所以手拼 URL 的地方
  //   必须自己补上。V1 时代这里是 `${wsBase}/pty/...`（V1 路由没有 /api 前缀），
  //   换 V2 后不改会打到 SPA 兜底路由，拿到 **200 + text/html**（不是 404！），
  //   WebSocket 握手自然失败 —— 实测确认过这个假象。
  const connectPath = `/api/pty/${ptyId}/connect`

  // query 参数：ticket 与 location[directory] 都是 V2 新增的**必需项**
  const queryParams: Record<string, string | number | undefined> = {
    ticket,
    cursor,
    'location[directory]': formatted,
  }

  // Tauri bridge：认证走 Rust 侧 header，但 ticket 依然必须留在 query 里
  if (!includeAuthInUrl) {
    return `${wsBase}${connectPath}${buildQueryString(queryParams)}`
  }

  // 浏览器原生 WebSocket：
  // 跨域时用 auth_token query parameter + userinfo fallback
  // 同源时浏览器会自动复用 Basic auth
  const isCrossOrigin = (() => {
    try {
      return new URL(httpBase).origin !== location.origin
    } catch {
      return true
    }
  })()

  let wsUrl = wsBase
  if (auth?.password) {
    if (isCrossOrigin) {
      // auth_token = base64(username:password)，与官方 opencode app 一致
      queryParams.auth_token = btoa(`${auth.username}:${auth.password}`)
    }
    // 同时设 userinfo 作为 fallback（部分浏览器直连时能用）
    const creds = `${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password)}@`
    wsUrl = wsBase.replace('://', `://${creds}`)
  }

  return `${wsUrl}${connectPath}${buildQueryString(queryParams)}`
}
