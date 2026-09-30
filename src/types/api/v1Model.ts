// ============================================
// OpenCode V1 数据模型（阶段 1 临时兼容层）
// ============================================
//
// ⚠️ 这个文件**曾经**是「阶段 1 的临时过渡物」；阶段 2b / 3b 已把无用部分删净，**剩下的 42 个导出全部有活跃引用**（见下方「阶段 3b 已完成的收敛」）→ 它**不会**再被整体删除，而是当前 `src/api/*` 与 `v1Model` 别名之间**在用的类型契约**。
//
// 为什么需要它：
//   V2 的 `@opencode/client` **删除了 V1 的数据模型**（消息两层结构 `{info, parts}`、
//   12 种 Part、question / todo / tool / lsp / formatter / file 等）。而本项目
//   的 UI、store、渲染层**仍然按 V1 模型编写**，且阶段 1 的授权范围
//   明确禁止改动消息 / 渲染相关组件。
//
//   因此阶段 1 把 V1 模型类型**逐字**搬进仓库，让类型检查保持通过、
//   让渲染层零改动；API 层则按需把 V2 响应转换成这里定义的类型。
//
// 来源：`@opencode-ai/sdk@1.16.0` 的 `dist/v2/gen/types.gen.d.ts`
//       （用脚本抽取「项目实际引用到的类型名 + 传递闭包」，逐字复制，未做改写）
//
// 维护提示：
//   - ✅ 阶段 2b 已换掉消息 / Part / 消息事件（A 桶 + C 桶）
//   - ✅ 阶段 3b 已把 file / mcp / worktree / vcs / pty / tool / lsp / todo / question /
//     auth / server / 事件载荷 等类型**从本文件删除**（各模块改成就地按 V2 契约重定义）
//   - 每删一个类型，请同时确认没有下游引用（`grep` 全仓库 + `tsc`）
//
// ── ✅ 阶段 3b 已完成的收敛（2026-09-30）────────────────────────────────
//
//   **104 → 42 个顶层导出，1492 → 920 行。**
//
//   ⚠️ **剩余 42 个均有活跃引用**（不是「没人用但忘了删」）：
//     - **31 个**由 8 个文件直接 `import type { … } from './v1Model'`
//       （`agent.ts` / `config.ts` / `model.ts` / `permission.ts` / `project.ts` /
//         `session.ts` / `skill.ts` / `vcs.ts`，见各文件顶部的别名声明）
//     - **11 个**只被上面这些类型**传递引用**（闭包成员，自身没有外部 import）：
//       `AppSkillsResponses`、`AttachmentConfig`、`ConfigProvidersResponses`、
//       `ConfigV2ExperimentalPolicy`、`ImageAttachmentConfig`、`PermissionAction`、
//       `PermissionRule`、`PermissionRuleset`、`PolicyEffect`、`ReferenceConfig`、
//       `ReferenceConfigEntry`
//
//   删除的 62 个按类别：
//     - **file / 搜索**：`File`、`FileNode`、`FileContent`、`Symbol`、`FindTextResponse(s)`
//       （`src/types/api/file.ts` 已就地重定义 V2 形状，且删掉了 `ignored` / `patch` 等 V1 字段）
//     - **pty**：`Pty`、`PtyCreateData`、`PtyUpdateData`（`types/api/pty.ts` 就地重定义）
//     - **worktree**：`Worktree`、`WorktreeCreateInput`、`WorktreeRemoveInput`、`WorktreeResetInput`
//       （`types/api/worktree.ts` 就地重定义；`reset` 能力已随 UI 下架）
//     - **mcp**：`McpStatus*`（6 个）、`McpStatusResponse(s)`、`McpResource`
//       （`types/api/mcp.ts` 就地重定义 V2 数组形状）
//     - **question 体系**：`QuestionTool`、`QuestionOption`、`QuestionInfo`、`QuestionRequest`、
//       `QuestionAnswer`、`QuestionV2*`（4 个）—— V2 用 Form 取代；只读渲染器
//       `QuestionRenderer.tsx` 自己就地定义了所需的最小 interface
//     - **todo**：`Todo`（端点 / 事件 / 工具全部不存在）
//     - **lsp / formatter**：`LspStatus`、`FormatterStatus`（V2 不跑语言服务器）
//     - **tool**：`ToolIds`、`ToolList`、`ToolListItem`（两个端点已删、零调用点）
//     - **事件载荷**：`EventTodoUpdated`、`EventSessionIdle/Status/Diff`、
//       `EventVcsBranchUpdated`、`EventWorktreeReady/Failed`、`EventPermissionReplied`、
//       `EventQuestionReplied/Rejected`、`EventServerInstanceDisposed`、
//       `SyncEventSessionCreated/Updated/Deleted`（事件层 2b 已重写，这些是残留）
//     - **auth / server / model / location / 策略**：`AuthInfo`、`AuthCredential`、
//       `AuthApiKeyCredential`、`AuthOAuthCredential`、`GlobalHealthResponse(s)`、
//       `ModelV2Info`、`LocationRef`、`VcsDiffData`、`PermissionV2Reply`、`PermissionV2Source`
//
//   **校验方式**（复用阶段 2b 的「集合差」法，`tsc` 单独不足以发现误删）：
//     ① 切分 104 个顶层块 → ② 从「真正被 import 的 31 个名字」求传递闭包得 kept=42
//     → ③ 删除非闭包成员 → ④ 断言 `before == kept ∪ removed`、`实际导出 == kept`、
//     `removed ∩ 外部 import == ∅`（三条全部通过）
//
// ── ✅ 阶段 2b 已完成的清理（2026-09-30）────────────────────────────────
//
//   本文件的顶层导出从 **189 个降到 104 个**，删掉的两组是：
//     - **A 桶 66 个**：消息 / Part / 消息事件（V2 消息模型已推翻它们）
//     - **C 桶 17 个**：跨组类型，且只被 `GlobalEvent` / A 桶引用
//       （`GlobalEvent` 本身随事件层重写一起消失）
//
//   另有 **1 个 C 桶类型降级为「模块内非导出」**（不再算顶层导出）：
//     - `SnapshotFileDiff`：仍被 `Session.summary.diffs` 引用 → 保留定义但去掉 `export`
//   （`Range` 原先同理，但它唯一的引用方 `Symbol` 已在阶段 3b 删除 → `Range` 一并消失。）
//
//   剩下的 104 个就是迁移文档里说的 **B 桶** —— ✅ 阶段 3b 已收敛到 **42 个**（见上方）。
// ============================================

// 模块内类型（非导出）：只服务 `Session.summary.diffs`。
// ⚠️ 阶段 3b 之后它是本文件**唯一**的非导出类型（`Range` 已随 `Symbol` 一起删除）。
type SnapshotFileDiff = {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: 'added' | 'deleted' | 'modified'
}

export type PermissionAction = 'allow' | 'deny' | 'ask'

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRuleset = Array<PermissionRule>

export type Session = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: Array<SnapshotFileDiff>
  }
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  share?: {
    url: string
  }
  title: string
  agent?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  version: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  permission?: PermissionRuleset
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}

export type SessionStatus =
  | {
      type: 'idle'
    }
  | {
      type: 'retry'
      attempt: number
      message: string
      action?: {
        reason: string
        provider: string
        title: string
        message: string
        label: string
        link?: string
      }
      next: number
    }
  | {
      type: 'busy'
    }

/**
 * Log level
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
/**
 * Server configuration for opencode serve and web commands
 */

export type ServerConfig = {
  port?: number
  hostname?: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: Array<string>
}

export type ReferenceConfigEntry =
  | string
  | {
      /**
       * Git repository URL, host/path reference, or GitHub owner/repo shorthand
       */
      repository: string
      branch?: string
    }
  | {
      /**
       * Absolute path, ~/ path, or workspace-relative path to a local reference directory
       */
      path: string
    }

export type ReferenceConfig = {
  [key: string]: ReferenceConfigEntry
}

export type PermissionActionConfig = 'ask' | 'allow' | 'deny'

export type PermissionObjectConfig = {
  [key: string]: PermissionActionConfig
}

export type PermissionRuleConfig = PermissionActionConfig | PermissionObjectConfig

export type PermissionConfig =
  | PermissionActionConfig
  | {
      read?: PermissionRuleConfig
      edit?: PermissionRuleConfig
      glob?: PermissionRuleConfig
      grep?: PermissionRuleConfig
      list?: PermissionRuleConfig
      bash?: PermissionRuleConfig
      task?: PermissionRuleConfig
      external_directory?: PermissionRuleConfig
      todowrite?: PermissionActionConfig
      question?: PermissionActionConfig
      webfetch?: PermissionActionConfig
      websearch?: PermissionActionConfig
      lsp?: PermissionRuleConfig
      doom_loop?: PermissionActionConfig
      skill?: PermissionRuleConfig
      [key: string]: PermissionRuleConfig | PermissionActionConfig | undefined
    }

export type AgentConfig = {
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  tools?: {
    [key: string]: boolean
  }
  disable?: boolean
  description?: string
  mode?: 'subagent' | 'primary' | 'all'
  hidden?: boolean
  options?: {
    [key: string]: unknown
  }
  /**
   * Hex color code (e.g., #FF5733) or theme color (e.g., primary)
   */
  color?: string | 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'info'
  steps?: number
  maxSteps?: number
  permission?: PermissionConfig
  [key: string]:
    | unknown
    | string
    | number
    | {
        [key: string]: boolean
      }
    | boolean
    | 'subagent'
    | 'primary'
    | 'all'
    | {
        [key: string]: unknown
      }
    | string
    | 'primary'
    | 'secondary'
    | 'accent'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | number
    | PermissionConfig
    | undefined
}

export type ProviderConfig = {
  api?: string
  name?: string
  env?: Array<string>
  id?: string
  npm?: string
  whitelist?: Array<string>
  blacklist?: Array<string>
  options?: {
    apiKey?: string
    baseURL?: string
    enterpriseUrl?: string
    setCacheKey?: boolean
    /**
     * Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.
     */
    timeout?: number | false
    /**
     * Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.
     */
    headerTimeout?: number | false
    chunkTimeout?: number
    [key: string]: unknown | string | boolean | number | false | number | false | number | undefined
  }
  models?: {
    [key: string]: {
      id?: string
      name?: string
      family?: string
      release_date?: string
      attachment?: boolean
      reasoning?: boolean
      temperature?: boolean
      tool_call?: boolean
      interleaved?:
        | true
        | {
            field: 'reasoning_content' | 'reasoning_details'
          }
      cost?: {
        input: number
        output: number
        cache_read?: number
        cache_write?: number
        context_over_200k?: {
          input: number
          output: number
          cache_read?: number
          cache_write?: number
        }
      }
      limit?: {
        context: number
        input?: number
        output: number
      }
      modalities?: {
        input?: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>
        output?: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>
      }
      experimental?: boolean
      status?: 'alpha' | 'beta' | 'deprecated' | 'active'
      provider?: {
        npm?: string
        api?: string
      }
      options?: {
        [key: string]: unknown
      }
      headers?: {
        [key: string]: string
      }
      /**
       * Variant-specific configuration
       */
      variants?: {
        [key: string]: {
          disabled?: boolean
          [key: string]: unknown | boolean | undefined
        }
      }
    }
  }
}

export type McpLocalConfig = {
  /**
   * Type of MCP server connection
   */
  type: 'local'
  /**
   * Command and arguments to run the MCP server
   */
  command: Array<string>
  environment?: {
    [key: string]: string
  }
  enabled?: boolean
  timeout?: number
}

export type McpOAuthConfig = {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  redirectUri?: string
}

export type McpRemoteConfig = {
  /**
   * Type of MCP server connection
   */
  type: 'remote'
  /**
   * URL of the remote MCP server
   */
  url: string
  enabled?: boolean
  headers?: {
    [key: string]: string
  }
  /**
   * OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.
   */
  oauth?: McpOAuthConfig | false
  timeout?: number
}
/**
 * @deprecated Always uses stretch layout.
 */

export type LayoutConfig = 'auto' | 'stretch'

export type ImageAttachmentConfig = {
  auto_resize?: boolean
  max_width?: number
  max_height?: number
  max_base64_bytes?: number
}

export type AttachmentConfig = {
  image?: ImageAttachmentConfig
}

export type Config = {
  $schema?: string
  shell?: string
  logLevel?: LogLevel
  server?: ServerConfig
  command?: {
    [key: string]: {
      template: string
      description?: string
      agent?: string
      model?: string
      variant?: string
      subtask?: boolean
    }
  }
  skills?: {
    paths?: Array<string>
    urls?: Array<string>
  }
  reference?: ReferenceConfig
  watcher?: {
    ignore?: Array<string>
  }
  snapshot?: boolean
  plugin?: Array<
    | string
    | [
        string,
        {
          [key: string]: unknown
        },
      ]
  >
  share?: 'manual' | 'auto' | 'disabled'
  autoshare?: boolean
  /**
   * Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications
   */
  autoupdate?: boolean | 'notify'
  disabled_providers?: Array<string>
  enabled_providers?: Array<string>
  model?: string
  small_model?: string
  default_agent?: string
  username?: string
  mode?: {
    build?: AgentConfig
    plan?: AgentConfig
    [key: string]: AgentConfig | undefined
  }
  agent?: {
    plan?: AgentConfig
    build?: AgentConfig
    general?: AgentConfig
    explore?: AgentConfig
    title?: AgentConfig
    summary?: AgentConfig
    compaction?: AgentConfig
    [key: string]: AgentConfig | undefined
  }
  provider?: {
    [key: string]: ProviderConfig
  }
  mcp?: {
    [key: string]:
      | McpLocalConfig
      | McpRemoteConfig
      | {
          enabled: boolean
        }
  }
  /**
   * Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.
   */
  formatter?:
    | boolean
    | {
        [key: string]: {
          disabled?: boolean
          command?: Array<string>
          environment?: {
            [key: string]: string
          }
          extensions?: Array<string>
        }
      }
  /**
   * Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.
   */
  lsp?:
    | boolean
    | {
        [key: string]:
          | {
              disabled: true
            }
          | {
              command: Array<string>
              extensions?: Array<string>
              disabled?: boolean
              env?: {
                [key: string]: string
              }
              initialization?: {
                [key: string]: unknown
              }
            }
      }
  instructions?: Array<string>
  layout?: LayoutConfig
  permission?: PermissionConfig
  tools?: {
    [key: string]: boolean
  }
  attachment?: AttachmentConfig
  enterprise?: {
    url?: string
  }
  tool_output?: {
    max_lines?: number
    max_bytes?: number
  }
  compaction?: {
    auto?: boolean
    prune?: boolean
    tail_turns?: number
    preserve_recent_tokens?: number
    reserved?: number
  }
  experimental?: {
    disable_paste_summary?: boolean
    batch_tool?: boolean
    openTelemetry?: boolean
    primary_tools?: Array<string>
    continue_loop_on_deny?: boolean
    mcp_timeout?: number
    policies?: Array<ConfigV2ExperimentalPolicy>
  }
}

export type Model = {
  id: string
  providerID: string
  api: {
    id: string
    url: string
    npm: string
  }
  name: string
  family?: string
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    interleaved:
      | boolean
      | {
          field: 'reasoning_content' | 'reasoning_details'
        }
  }
  cost: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
    tiers?: Array<{
      input: number
      output: number
      cache: {
        read: number
        write: number
      }
      tier: {
        type: 'context'
        size: number
      }
    }>
    experimentalOver200K?: {
      input: number
      output: number
      cache: {
        read: number
        write: number
      }
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  status: 'alpha' | 'beta' | 'deprecated' | 'active'
  options: {
    [key: string]: unknown
  }
  headers: {
    [key: string]: string
  }
  release_date: string
  variants?: {
    [key: string]: {
      [key: string]: unknown
    }
  }
}

export type Provider = {
  id: string
  name: string
  source: 'env' | 'config' | 'custom' | 'api'
  env: Array<string>
  key?: string
  options: {
    [key: string]: unknown
  }
  models: {
    [key: string]: Model
  }
}

export type Path = {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

export type VcsInfo = {
  branch?: string
  default_branch?: string
}

export type Agent = {
  name: string
  description?: string
  mode: 'subagent' | 'primary' | 'all'
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: PermissionRuleset
  model?: {
    modelID: string
    providerID: string
  }
  variant?: string
  prompt?: string
  options: {
    [key: string]: unknown
  }
  steps?: number
}

export type Project = {
  id: string
  worktree: string
  vcs?: 'git'
  name?: string
  icon?: {
    url?: string
    override?: string
    color?: string
  }
  commands?: {
    /**
     * Startup script to run when creating a new workspace (worktree)
     */
    start?: string
  }
  time: {
    created: number
    updated: number
    initialized?: number
  }
  sandboxes: Array<string>
}

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  metadata: {
    [key: string]: unknown
  }
  always: Array<string>
  tool?: {
    messageID: string
    callID: string
  }
}

export type ProviderAuthMethod = {
  type: 'oauth' | 'api'
  label: string
  prompts?: Array<
    | {
        type: 'text'
        key: string
        message: string
        placeholder?: string
        when?: {
          key: string
          op: 'eq' | 'neq'
          value: string
        }
      }
    | {
        type: 'select'
        key: string
        message: string
        options: Array<{
          label: string
          value: string
          hint?: string
        }>
        when?: {
          key: string
          op: 'eq' | 'neq'
          value: string
        }
      }
  >
}

export type ProviderAuthAuthorization = {
  url: string
  method: 'auto' | 'code'
  instructions: string
}

export type PolicyEffect = 'allow' | 'deny'

export type ConfigV2ExperimentalPolicy = {
  action: 'provider.use'
  effect: PolicyEffect
  resource: string
}

export type ConfigProvidersResponses = {
  /**
   * List of providers
   */
  200: {
    providers: Array<Provider>
    default: {
      [key: string]: string
    }
  }
}

export type ConfigProvidersResponse = ConfigProvidersResponses[keyof ConfigProvidersResponses]

export type AppSkillsResponses = {
  /**
   * List of skills
   */
  200: Array<{
    name: string
    description?: string
    location: string
    content: string
  }>
}

export type AppSkillsResponse = AppSkillsResponses[keyof AppSkillsResponses]

export type ProjectUpdateData = {
  body?: {
    name?: string
    icon?: {
      url?: string
      override?: string
      color?: string
    }
    commands?: {
      /**
       * Startup script to run when creating a new workspace (worktree)
       */
      start?: string
    }
  }
  path: {
    projectID: string
  }
  query?: {
    directory?: string
    workspace?: string
  }
  url: '/project/{projectID}'
}

export type SessionListData = {
  body?: never
  path?: never
  query?: {
    directory?: string
    workspace?: string
    scope?: 'project'
    path?: string
    roots?: boolean | 'true' | 'false'
    start?: number
    search?: string
    limit?: number
  }
  url: '/session'
}

export type SessionCreateData = {
  body?: {
    parentID?: string
    title?: string
    agent?: string
    model?: {
      id: string
      providerID: string
      variant?: string
    }
    metadata?: {
      [key: string]: unknown
    }
    permission?: PermissionRuleset
    workspaceID?: string
  }
  path?: never
  query?: {
    directory?: string
    workspace?: string
  }
  url: '/session'
}

export type SessionUpdateData = {
  body?: {
    title?: string
    metadata?: {
      [key: string]: unknown
    }
    permission?: PermissionRuleset
    time?: {
      archived?: number
    }
  }
  path: {
    sessionID: string
  }
  query?: {
    directory?: string
    workspace?: string
  }
  url: '/session/{sessionID}'
}

export type SessionForkData = {
  body?: {
    messageID?: string
  }
  path: {
    sessionID: string
  }
  query?: {
    directory?: string
    workspace?: string
  }
  url: '/session/{sessionID}/fork'
}
