// ============================================
// MCP 内部类型（OpenCode V2 形状）
// ============================================
//
// ⚠️ 阶段 3a：本文件**不再从 `./v1Model` 转发 V1 形状**。
//
// 为什么要就地重定义：V2 把 MCP 的数据结构整个换掉了，V1 形状已经
// **映射不回去**（不是字段改名，而是容器类型变了）：
//
//   | 概念 | V1（v1Model.ts） | V2（`Mcp.*`） |
//   |---|---|---|
//   | 服务器列表 | `Record<name, McpStatus>`（对象） | **`Mcp.Server[]`（数组）** |
//   | 服务器条目 | 只有 key 是名字 | **`{ name, status, integrationID? }`** |
//   | 状态联合 | connected / disabled / failed / needs_auth / needs_client_registration（V1 遗留） | connected / **pending** / disabled / failed / needs_auth |
//   | 资源目录 | `Record<uri, McpResource>`（`client` 字段标识来源） | **`{ resources: Mcp.Resource[]; templates: Mcp.ResourceTemplate[] }`**（来源字段改名 `client` → `server`） |
//   | 本地配置 | `command`、`environment`、**`enabled`**、`timeout: number` | `command: string[]`、`environment`、**`disabled`**（语义反转）、`timeout: {startup,catalog,execution}` |
//   | 远端 OAuth 配置 | 驼峰 `clientId` / `callbackPort` / `redirectUri` | **下划线** `client_id` / `callback_port` / `redirect_uri` |
//
// 约束：`./v1Model.ts` 是「B 桶 104 个导出」的一部分，**禁止修改**；
// 所以这里选择**就地重定义** V2 形状的内部类型，而不是删掉 v1Model 里的定义。
//
// 下游影响：只有 `src/api/mcp.ts` 与 `src/components/McpPanel.tsx` 消费这些类型，
// 两者在阶段 3a 已一并适配。
// ============================================

// ============================================
// 服务器状态
// ============================================

/** V2 `Mcp.Status.Connected` */
export type MCPStatusConnected = { status: 'connected' }

/**
 * V2 **新增**的状态：服务器正在启动 / 握手（V1 没有这一态）。
 * 出现在「刚 connect、进程还没就绪」或「首次 catalog 尚未完成」时。
 */
export type MCPStatusPending = { status: 'pending' }

/** V2 `Mcp.Status.Disabled` */
export type MCPStatusDisabled = { status: 'disabled' }

/** V2 `Mcp.Status.Failed`（`error` 在 V2 是**必填**） */
export type MCPStatusFailed = { status: 'failed'; error: string }

/**
 * V2 `Mcp.Status.NeedsAuth`。
 *
 * ⚠️ 与 V1 的差异：V1 的 `McpStatusNeedsAuth` **没有** `error` 字段，
 * V2 的 `error` 是必填（用来提示缺哪个 scope / 哪个 client 注册失败）。
 */
export type MCPStatusNeedsAuth = { status: 'needs_auth'; error: string }

// ⛔ 阶段 3b 已删除 `MCPStatusNeedsClientRegistration`：
//   V1 用它表示「OAuth 客户端还没动态注册」；V2 把客户端注册并入 `/api/integration/*`
//   体系，这个中间态从 `Mcp.Status` 里删掉了（V2 从不产生它）。
//   同时删除了 `McpPanel.tsx` 里对应的展示分支。

/**
 * MCP 服务器状态联合 = **V2 真实的 5 个状态**。
 */
export type MCPStatus = MCPStatusConnected | MCPStatusPending | MCPStatusDisabled | MCPStatusFailed | MCPStatusNeedsAuth

/** V2 `Mcp.Server`：服务器名 + 状态 + 可选的 integration 关联 */
export type MCPServer = {
  name: string
  status: MCPStatus
  /**
   * 该 MCP 服务器对应的 integration ID（V2 新增）。
   *
   * 🔴 这是**从 MCP 服务器走到 OAuth 登录体系的唯一桥梁**：
   * `src/api/mcp.ts` 的 startMcpAuth / authenticateMcp / removeMcpAuth
   * 都先靠它找到 `/api/integration/{integrationID}`。
   * 没有它 = 该服务器不支持 OAuth 登录。
   */
  integrationID?: string
}

/**
 * `GET /api/mcp` 的返回。
 *
 * V1 是 `Record<serverName, McpStatus>`；V2 是**数组**（顺序由服务端决定，
 * 需要稳定顺序请自行排序 —— `McpPanel.tsx` 里按名字排了）。
 */
export type MCPStatusResponse = MCPServer[]

// ============================================
// 资源目录
// ============================================

/**
 * V2 `Mcp.Resource`。
 *
 * ⚠️ 与 V1 的差异：来源字段从 `client` 改名为 **`server`**（值就是服务器名）。
 */
export type MCPResource = {
  server: string
  name: string
  uri: string
  description?: string
  mimeType?: string
}

/**
 * V2 `Mcp.ResourceTemplate`（V1 的 `GET /experimental/resource` 里没有这个东西）。
 *
 * 模板用 `uriTemplate`（带占位符，例如 `file:///{path}`）而不是固定 `uri`。
 * 当前 UI 没有展示模板的位置，先原样带出来。
 * （阶段 3b 已决定**不做**模板展示：`McpPanel` 只列资源，模板保留在类型层备用。）
 */
export type MCPResourceTemplate = {
  server: string
  name: string
  uriTemplate: string
  description?: string
  mimeType?: string
}

/**
 * `GET /api/mcp/resource` 的返回（V2 `Mcp.ResourceCatalog`）。
 *
 * V1 是 `Record<uri, McpResource>`（`Object.values()` 后使用）；
 * V2 是 `{ resources, templates }` 两个**数组**。
 */
export type MCPResourceMap = {
  resources: MCPResource[]
  templates: MCPResourceTemplate[]
}

// ============================================
// 配置（PUT /api/experimental/mcp/{server} 的 body.config）
// ============================================
//
// ⚠️ 这些类型只用于「新增 MCP 服务器」表单，形状必须与 V2 SDK 的
// `McpAddInput['config']` 结构兼容 —— `src/api/mcp.ts` 会把它直接传给
// `sdk.mcp.add({ server, config, location })`，类型不兼容会在那里编译报错。
//
// 与 V1 的差异（重点，容易踩）：
//   - `enabled?: boolean` → **`disabled?: boolean`**（语义反转，默认值是「启用」）
//   - `timeout?: number`  → **`timeout?: { startup?, catalog?, execution? }`**（按阶段细分）
//   - 新增 `cwd` / `codemode` / `protocol`（V1 没有，UI 暂不使用）
//   - `oauth` 的字段从驼峰改为下划线（见 `McpOAuthConfig`）

/** V2 `Mcp.OAuthConfigEncoded`（字段名是**下划线**，与配置文件里的写法一致） */
export type McpOAuthConfig = {
  client_id?: string
  client_secret?: string
  scope?: string
  callback_port?: number
  redirect_uri?: string
  auth_server_metadata_url?: string
}

/** V2 `Mcp.LocalConfigEncoded` */
export type McpLocalConfig = {
  type: 'local'
  /** ⚠️ 是**数组**：UI 表单里用户输入的是一行字符串，提交前按空白切分（见 `McpPanel` 的 AddServerForm） */
  command: string[]
  cwd?: string
  /** ⚠️ V1 也叫 `environment`，不要写成 `env` */
  environment?: Record<string, string>
  /** ⚠️ V1 是 `enabled`（反向语义），V2 是 `disabled` */
  disabled?: boolean
  codemode?: boolean
  timeout?: { startup?: number; catalog?: number; execution?: number }
  protocol?: 'legacy' | 'auto' | '2026-07-28'
}

/** V2 `Mcp.RemoteConfigEncoded` */
export type McpRemoteConfig = {
  type: 'remote'
  url: string
  headers?: Record<string, string>
  /** `false` 表示显式关闭 OAuth 自动探测（V1 也是这个约定） */
  oauth?: McpOAuthConfig | false
  /** ⚠️ V1 是 `enabled`（反向语义），V2 是 `disabled` */
  disabled?: boolean
  codemode?: boolean
  timeout?: { startup?: number; catalog?: number; execution?: number }
  protocol?: 'legacy' | 'auto' | '2026-07-28'
}

/** 新增 MCP 服务器时提交的配置：本地进程 或 远端 URL 二选一 */
export type McpServerConfig = McpLocalConfig | McpRemoteConfig
