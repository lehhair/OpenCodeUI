# OpenCode V2 迁移计划

> 状态：✅ **全部阶段已完成**（0 / 1 / 2a / 2b / 3a / 3b / **4 收尾**）——迁移结束，见 [§8.5 迁移完成总结](#85-迁移完成总结)
> 目标环境：opencode `v2.0.19`（本机实测）、`@opencode/client` `2.0.19`
> 当前状态：依赖已换成 `@opencode/client@2.0.19`；**聊天主流程可用**；
> **51 处 `notMigratedYet` 已清零**（阶段 3a）；
> **13 处 `removedInV2()` 与对应 UI 已全部下架**（阶段 3b）；
> `v1Model.ts` 收敛到 **42 个导出 / 920 行**（阶段 3b）；
> **Docker 钉死 opencode 版本 + sha256 校验**（阶段 4）；**Rust `cargo check` 0 报错**（阶段 4）
> （发消息、流式回复、工具卡片、历史加载）—— 阶段 2b 完成
> 决策：**只支持 V2，直接切换，不保留 V1 兼容分支**（详见 [§9 决策记录](#9-决策记录)）
> 阶段报告：`docs/opencode-v2-migration-phase0.md`、`-phase0.5.md`、`-phase2a.md`、`-phase2b.md`、`-phase3a.md`、`-phase3b.md`、`-phase4.md`
> 手工回归清单：`docs/opencode-v2-migration-regression-checklist.md`（面向非专业用户，含**已知未验证项**）
> 文档来源：<https://opencode.ai/v2/docs/>、<https://opencode.ai/v2/openapi.json>（113 条路径 / 245 个 schema）
> **计数说明**：本机 v2.0.19 二进制导出的权威 openapi 为 **115 路径 / 247 schema**，比 docs 站点快照多 2 条。
> **阶段 0 已精确定位**：差的 2 条路径 = `POST /api/pair`、`GET /auth/connect/{code}`（配对登录），
> 2 个 schema = `PairingCode`、`PairingSession`（113+2=115、245+2=247，严丝合缝）。
> 原因：这两个端点由 commit `eccf0b3b7b` 加入，而 `openapi.json` 最后一次生成于其**祖先** `53179daefa`，
> **生成后未随 pairing 功能重新生成** → **仓库内与 docs 站点的 spec 均已过期，二进制才是权威**。
> ⚠️ 阶段 1 用 `openapi.json` 做对照时须留意这 2 条缺失。
> 🔴 **阶段 2b 的重大修正**：`session.idle` / `session.status` 在 v2.0.19 **从未下发**
> （`idle` 已标 deprecated）→「一轮结束」必须用 `session.execution.*`；详见 §6.4 修正 ①
> 🔴 **阶段 3b 的重大修正**：`Form.Info` **有**可选 `metadata`（3a 说「没有 tool 关联字段」是错的）；
> V2 **仍有 `question` 工具**、历史里仍有 `todowrite` 工具卡片 → `QuestionRenderer` / `TodoRenderer`
> **必须保留**（删了是功能倒退）；详见 §4.3 / §9.4 与阶段 3b 报告 §8
> 🔴 **阶段 4 的重大修正（本轮最高价值产出）**：修掉**两个「静默装成 V1」的真 bug** ——
> ① `docker/Dockerfile.backend` 拉 GitHub `releases/latest`（**`latest` 已停在 v1.18.33**）
> → 换 `opencode.ai/files/bin/<版本>/…` 渠道 + 钉 `2.0.19` + **sha256 校验**；
> ② **新发现**：WSL「安装 opencode」按钮用 `https://opencode.ai/install`（那个脚本**也是拉 GitHub latest**）
> → 换 `https://opencode.ai/v2/install`。详见阶段 4 报告 §1 / §5.3
> 🟡 **阶段 4 还推翻了 3b 的一条结论**：WSL `resolve_opencode` **无需**加 `command -v opencode` ——
> 官方 **WSL** 路径也不查它（那是 **SSH** 专有行为）；3b 把 SSH 的行为错当成 WSL 的。详见 §9.3 末与阶段 4 报告 §6

---

## 目录

1. [背景与结论](#1-背景与结论)
2. [现状：项目如何接入 OpenCode](#2-现状项目如何接入-opencode)
3. [V2 五个层面的变更](#3-v2-五个层面的变更)
4. [完整端点对照表](#4-完整端点对照表)
5. [消息模型变更（最大改动）](#5-消息模型变更最大改动)
6. [事件流变更](#6-事件流变更)
7. [文件改动清单](#7-文件改动清单)
8. [分阶段实施计划](#8-分阶段实施计划)
9. [决策记录](#9-决策记录)
10. [开工前必须验证的事项](#10-开工前必须验证的事项)

---

## 1. 背景与结论

### 1.1 为什么要做

本机 opencode 已升级到 **v2.0.19**，而 OpenCodeUI 仍对接 **V1 API**。V2 是一次**有意为之的破坏性升级**，官方文档明确说明：

> V2 有三处有意的破坏性变更：**插件 API**、**服务端 API 与客户端**、**终端客户端配置**。
> 集成方若调用 V1 服务端 API，**必须迁移到 V2 API**。

也就是说：配置文件、agent、命令、skill 都还能用，**唯独「界面程序怎么跟 opencode 说话」这套协议被换掉了** —— 而这恰好是本项目的核心依赖。

### 1.2 结论

**属于中等偏大的重构**，主要难点有二：

| #   | 难点                                                                 | 影响面                              |
| --- | -------------------------------------------------------------------- | ----------------------------------- |
| 1   | **接口全部重命名**（统一加 `/api` 前缀，十余个端点改名或删除）       | `src/api/` 约 20 个文件             |
| 2   | **消息数据结构被推翻**（`{info, parts}` 两层 → 扁平联合 + 游标分页） | 类型、转换层、渲染组件、store、事件 |

**有利条件**：

- 项目**没有自己造轮子**，直接使用官方 SDK，迁移路径清晰
- 配置**全部走 HTTP**，不读 opencode 的数据库 / `auth.json` / `cli.json` / `opencode.json` 文件本体 → 这部分**零改动**
- `src/types/api/` 下共 17 个文件，其中 **16 个是 SDK 类型的转发**，换包后大部分自动跟随
  ⚠️ **但非全自动**：项目实际 import 的是 `@opencode-ai/sdk/v2/client`（这里的 `v2` 指 **SDK 自身第二代**，打的仍是 V1 端点），
  换包时 `src/types/api/*` 的 import 路径需**一并改掉**，不是纯"自动跟随"
- V2 鉴权**已实测确认零改动**：用户名**硬编码为 `"opencode"`**（`packages/server/src/auth.ts:20`），与项目 `makeBasicAuthHeader` 默认值一致

### 1.3 🔴 已实测确认的阻断性问题

> 以下问题**不是"将来会遇到"，而是当前代码在 V2 下就已经失效**。按严重度排列。

#### ① 启动命令直接报错，WSL 路径服务起不来（最严重）

⚠️ **本问题只影响 WSL 启动路径**。桌面路径 `opencode.rs:88` 只 spawn `opencode serve`（**不带任何参数**），实测正常。

**WSL 启动命令**（`src-tauri/src/app/commands/wsl_commands.rs:920-922`）：

```rust
"exec {} --print-logs --log-level {} serve --hostname 0.0.0.0 --port {}",
...
if cfg!(debug_assertions) { "INFO" } else { "WARN" },   // ← 两个分支都是大写
```

**实机测试结果（opencode v2.0.19）**：

```
~effect/cli/CliError/InvalidValue:
Invalid value for flag --log-level: "INFO".
Expected: "all" | "trace" | "debug" | "info" | "warn" | "warning" | "error" | "fatal" | "none"
```

- ❌ **大写 `INFO`/`WARN` 均不被接受** → CLI 直接退出 → `parse_listening_url()` 永远等不到 URL → **WSL 路径启动失败**
- ✅ 改为小写 `info`/`warn` 后正常启动
- ✅ `--print-logs`、`serve --hostname --port --cors --service --stdio` 均有效
- ✅ stdout 输出格式为 `server listening on http://127.0.0.1:<port>`
- ✅ **`parse_listening_url()` 能正确解析**（`opencode.rs:139` 找 `http://` 后取第一个空白分隔 token）
- ✅ `--print-logs` 使结构化日志（`timestamp=... level=INFO ...`）输出到 **stderr**，**不污染 stdout**
  （阶段 0 复测：**401 请求每请求 1 行、200 请求 0 行**、不带 `--print-logs` 恒 0 行。
  即**只有失败请求打日志**；`serve --help` 中 "server logs require --standalone" 是**过时 help 文本**）

> 官方桌面版自己也是这么启动的（`packages/desktop/src/main/wsl/sidecar.ts:35`）：
> `exec opencode --log-level warn serve --hostname 0.0.0.0 --port ${port}`
> —— 注意它**不加 `--print-logs`**，且用**小写**。

**修复**：`wsl_commands.rs:922` 的 `"INFO"` → `"info"`、`"WARN"` → `"warn"`（**1 个文件里的 2 个值**）。
`opencode.rs` 无需改动。

#### ② V1 端点在二进制中已彻底移除

对本机 `/home/coder/.opencode/bin/opencode` 做字符串统计：

| 端点                 | 出现次数 |
| -------------------- | -------: |
| `/api/info`          |        7 |
| `/api/event`         |        3 |
| `/api/session`       |       35 |
| **`/global/health`** |    **0** |
| **`/global/event`**  |    **0** |

→ 健康检查会拿到 HTML SPA 页面而非 `{healthy, version}` JSON。

**阶段 0 修正：这要分两条链路看，结论相反**（原文把两条混为一谈，已修正）：

| 链路     | 代码位置                                                                    | 判活依据                                 | V2 下实际行为                                                                                                                              |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **前端** | `serverStore.ts:643`（打 `/global/health`）→ `:678-680` 检查 `content-type` | 必须含 `application/json`                | 🔴 **确实失败**：拿到 `text/html` → `status:'error'`，提示 _"Server returned HTML instead of OpenCode health JSON"_ → **界面显示服务异常** |
| **Rust** | `opencode.rs:52-76` `is_service_running_with_auth()`                        | **只看状态码** `r.status().is_success()` | 🟡 **歪打正着**：`/api/health`→404（非 2xx）→ 试 `/global/health`→ **200** → `true` → **判"服务在运行"，不挡启动**                         |

**两个反直觉后果**：

1. 桌面路径的 `start_opencode_service`（`opencode.rs:309/351`）**不会被挡**，服务能起来 →
   **"解析必然失败"的说法只对前端成立**。
2. 但 Rust 侧同时**失去了校验能力**：以前验证 `{healthy:true, version}`，现在**任何**在该路径返 200 的
   HTTP 服务都算"健康" → **静默失效，非显式报错** →
   §9.3「改为单一 `GET /api/info`」的整改**优先级应提高**（阶段 3）。

#### ③ `OPENCODE_SERVER_USERNAME` 实际不可配置（但别删它）

- ✅ **结论成立**：v2.0.19 **`src/` 中零读取处**，用户名硬编码 `"opencode"`（`packages/server/src/auth.ts:20`）
- ⚠️ **论证修正**：原写"全仓库 grep 零结果"**是错的** —— `packages/cli/test/standalone.test.ts:11` 与各国 docs
  **都引用了它**，文档还声称可覆盖 → **属文档与实现不一致**
- 🧪 实测：设 `OPENCODE_SERVER_USERNAME=custom` 后，`custom:pw` → 401、`opencode:pw` → 200（仍只认 `opencode`）
- 📌 **建议保留该设置**（不删除）：dev 分支已实现读取，后续版本可能生效，保留是安全的
- ✅ `OPENCODE_SERVER_PASSWORD` / `OPENCODE_PASSWORD` **有效**（`packages/cli/src/env.ts:10-13`）
- ✅ 实测：设 `OPENCODE_SERVER_PASSWORD=test123` 后，`opencode:test123` → **200**，其他用户名一律 401

#### ④ 依赖本身是坏的（与 V2 无关，但要先修）

见 [§2.3](#23--已存在的隐患与本次迁移无关但应先修)。

---

## 2. 现状：项目如何接入 OpenCode

### 2.1 架构

```
【请求通道】
React 组件/hooks ─► src/api/* ─► getSDKClient() ─► @opencode-ai/sdk ─► HTTP ─► opencode serve
                                     ▲
                          baseUrl + Basic Auth + directory 参数
                          (Tauri 用 plugin-http fetch 绕 CORS)

【事件通道】
opencode serve  GET /global/event (SSE)
   ├─ 浏览器：fetch + ReadableStream + 手写 SSE 解析器
   └─ Tauri：invoke('bridge_connect') → Rust reqwest 透传 → Channel 回传
        └► events.ts: 解析 + delta 合并 + 断线重连 + 代次防串扰
              └► useGlobalEvents → messageStore → useSyncExternalStore → React 重渲染

【启动流程】
main.tsx → invoke('detect_opencode_binary') → invoke('start_opencode_service')
         → Rust spawn `opencode serve` → 解析 stdout 拿 URL → 建立连接
```

### 2.2 关键事实

| 项              | 现状                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| SDK             | `@opencode-ai/sdk`，`package.json` 声明 `^1.16.0`，**实际安装 1.4.1（不一致）**           |
| 类型来源        | `src/types/api/*` 共 17 个文件，16 个是 SDK 类型 re-export；**项目内无任何 codegen 配置** |
| 状态管理        | 自研 store 类 + `useSyncExternalStore`（无 zustand/redux）                                |
| Rust 侧职责     | spawn `opencode serve`、健康检查、SSE/WS 透明代理、WSL 管理                               |
| Rust 数据库访问 | **无**（不碰 SQLite / auth.json / cli.json）                                              |
| 版本探测        | **无**（`ServerHealth.version` 仅用于 UI 展示，无能力分支）                               |
| 历史兼容 shim   | 5 处（见 [§9.3](#93-要删除的历史兼容-shim)）                                              |

### 2.3 ⚠️ 已存在的隐患（与本次迁移无关，但应先修）

1. **依赖不一致**：`package.json` 声明 `^1.16.0`，`package-lock.json` 锁 1.16.0，但 `node_modules` 实装 **1.4.1**
2. **存在会崩溃的调用**（**实为 2 处，非 1 处** —— 阶段 0 实测发现）：
   - `src/api/pty.ts:50` → `sdk.pty.shells()`，该方法在 1.4.1 中**不存在**
   - `src/store/childSessionStore.ts:83` → `Property 'agent' does not exist on type 'Session'`
     （**子会话 subtask 创建链路**在 1.4.1 类型层面同样是坏的，阶段 3 排查 subtask 时的背景信息）
   - ✅ 修依赖后**两者均自愈**，`tsc` **零报错**
3. ~~**Docker 不锁版本**：`docker/Dockerfile.backend:102` 和 `docker/backend-entrypoint.sh:34` 拉取 `releases/latest`，**很可能已经装成 V2**，处于风险中~~
   → 🔴 **阶段 4 实测修正：方向判断反了**。GitHub `releases/latest` 的 `tag_name` = **`v1.18.33`（V1）**，
   所以旧写法**不是「装成 V2」而是「装成 V1」** —— 对一个只支持 V2 的 UI 来说，
   容器起来后**必然连不上**。**已修**（换 `opencode.ai/files/bin/…` 渠道 + 钉 `2.0.19` + sha256），见阶段 4 报告 §1

---

## 3. V2 五个层面的变更

### 3.1 客户端包更换

|              | V1（现在）                                         | V2（目标）                                   |
| ------------ | -------------------------------------------------- | -------------------------------------------- |
| 包名         | `@opencode-ai/sdk`                                 | **`@opencode/client`**                       |
| 版本         | `^1.16.0`（实装 1.4.1）                            | `2.0.19`                                     |
| 入口         | `createOpencodeClient()`                           | `OpenCode.make({ baseUrl, headers, fetch })` |
| 返回值       | `{ data, error, request, response }` 需 `unwrap()` | 直接返回数据                                 |
| 流式事件     | 手写 fetch + SSE 文本解析器                        | `client.event.subscribe()` → async iterable  |
| 浏览器兼容   | ✅                                                 | ✅（官方说明主入口是浏览器兼容的）           |
| 自定义 fetch | ✅                                                 | ✅（Tauri 的 `plugin-http` 可继续注入）      |

```ts
// V2 用法示例
import { OpenCode } from '@opencode/client'

const client = OpenCode.make({
  baseUrl: 'http://127.0.0.1:4096',
  headers: { authorization: `Basic ${btoa(`${user}:${pass}`)}` },
  fetch: tauriFetch, // Tauri 环境注入，绕 CORS
})

const session = await client.session.create({ location: { directory: '/workspace' } })
await client.session.prompt({ sessionID: session.id, text: '...' })

for await (const event of client.event.subscribe()) {
  console.log(event.type)
}
```

> `@opencode/client/service` 另提供 `Service.discover()/ensure()/headers()`，用于管理本地后台服务进程。
> 本项目已自行实现进程管理（Tauri spawn），**暂不需要**，列为可选优化。

### 3.2 接口路径全部加 `/api` 前缀

详见 [§4 完整端点对照表](#4-完整端点对照表)。

### 3.3 目录/位置参数传递方式变化

|              | V1                     | V2                                                                             |
| ------------ | ---------------------- | ------------------------------------------------------------------------------ |
| GET 参数     | `?directory=/path`     | 部分端点仍是 `?directory=`，**部分改为 `?location[directory]=`**（deepObject） |
| 请求头       | `x-opencode-directory` | 🟢 **仍然有效**（见下方实测，**非**"变为 location 对象"）                      |
| 请求体       | `directory: string`    | `location: { directory: string }`                                              |
| Session 字段 | `Session.directory`    | **`Session.location`**（`Session.Info` 含 `location` / `subpath`）             |

#### 🟢 阶段 0 实测确认：`x-opencode-directory` 头**依然是回退方案**（重大利好）

`packages/server/src/location.ts:39-47`（tag `v2.0.19`）：

```ts
export function requestRef(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const directory =
    query.get("location[directory]") ||                                     // 1️⃣ query 最高
    (request.headers["x-opencode-directory"]
      ? decode(request.headers["x-opencode-directory"])                    // 2️⃣ 请求头次之
      : process.cwd())                                                      // 3️⃣ cwd 兜底
```

**三条源码佐证**：`packages/cli/src/run/noninteractive.ts:761`、`packages/client/src/solid/data.ts:141`、
`packages/tui/src/mini/runtime.ts:156` 都在**主动发送**这个头 —— 官方自己也在用。

**更关键：目录参数全部是 `optional`**（对 113 条路径逐一统计）：

| 参数                     |                出现次数 | required |
| ------------------------ | ----------------------: | -------- |
| `location`（deepObject） |                      57 | **0**    |
| `directory`              | 1（`GET /api/session`） | **0**    |
| `location[directory]`    |                       1 | **0**    |

> **组合结论**：参数全可选 + 请求头是第二优先级回退 ⇒ **带 `x-opencode-directory` 头即可定位目录，
> 端点参数可基本不传**。`src/utils/directoryUtils.ts` 的改造量**显著小于原估计** ——
> 阶段 1 应**先验证这一条**，再决定是逐端点补参数还是仅保留请求头。

#### 🔴 阶段 1 实测结论（2026-09-30）：**结论 B —— 头不够，但缺口只有 1 个端点**

> 实测环境：`opencode v2.0.19`，服务 cwd = `/tmp/opencode/v2test/cwd`，
> 夹具目录 `dirA` / `dirB`（各自放 `opencode.json` + `.opencode/agent|command|skill` 探针文件）。
> 完整原始记录见 `docs/opencode-v2-migration-phase0.5.md` §1。

| 端点                                       | 只带 `x-opencode-directory` 头         | 只带 `location[directory]` 参数 | 都不带                                      |
| ------------------------------------------ | -------------------------------------- | ------------------------------- | ------------------------------------------- |
| `GET /api/config`                          | ✅ 读到 dirA 的配置                    | ✅ 读到 dirB 的配置             | ✅ 回落 cwd                                 |
| `GET /api/agent` / `skill` / `command`     | ✅ 目录内 agent/skill/command 正确出现 | ✅ 同上                         | ✅ 回落 cwd                                 |
| `GET /api/location`                        | ✅                                     | ✅                              | ✅ 回落 cwd                                 |
| **`GET /api/session`（会话列表）**         | ❌ **被忽略**                          | ❌ **被忽略**                   | ❌ **返回全局所有项目的会话**               |
| **`GET /api/session`（裸 `?directory=`）** | —                                      | —                               | ✅ **唯一生效的写法**                       |
| `GET /api/session/{id}` 等 session 作用域  | 不适用                                 | 不适用                          | ✅ location 取自 session 行（传了也被忽略） |

**三条结论**：

1. **57 个 locationRef 作用域端点**（config / agent / skill / command / model / provider / location …）：
   **只靠 `x-opencode-directory` 请求头就够了** —— 与阶段 0 的判断一致。
   但阶段 1 的实现**选择显式传 `location[directory]` 参数**（`src/api/v2Convert.ts` 的 `locationInput()`），
   理由：① 这是官方生成客户端自己用的方式（`appendQuery()` 把 `{location:{directory}}` 摊平成 `location[directory]`）；
   ② 显式参数比隐式请求头更容易在抓包/日志里核对；③ 请求头在 `OpenCode.make({headers})` 里是**client 级**配置，
   目录切换时得重建 client，不如按调用传参灵活。

2. **🔴 `GET /api/session`（会话列表）是唯一必须显式传参的端点，而且它只认裸 `directory`**：
   源码依据 `packages/server/src/handlers/session.ts:62-72` 把 `ctx.query` 原样交给 `session.list()`，
   而 `packages/core/src/session/store.ts:105` 只在 `"directory" in input` 时才
   `eq(SessionTable.directory, input.directory)`；该端点的 query schema（`SessionsQuery`）
   **只有裸 `directory`**，没有 `location[directory]` → 头和 deepObject 参数都被静默丢弃。
   **后果比"没过滤"更严重**：不带 `directory` 时它会返回**跨全部项目**的会话列表（实测一次拿到 20+ 条、6 个项目）。
   → 实现见 `src/api/v2Convert.ts` 的 `sessionDirectory()` + `src/api/session.ts` 的 `getSessions()`。

3. **session 作用域端点（`/api/session/{id}/*`）完全不需要目录信息**，
   而且**传了也会被忽略**（实测：给 `GET /api/session/{B}` 带一个指向 dirA 的冲突请求头，返回的仍是 dirB 的 location）。
   → V1 里给这些调用硬塞 `directory` 的做法在迁移时应直接删掉（阶段 1 已删）。

**🔴 另发现一处与请求头/中间件都无关的陷阱（阶段 3 会踩）**：
`POST /api/session`（创建会话）的 handler 是
`location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) }`
（`packages/server/src/handlers/session.ts:136`）—— 它**既不看中间件也不看请求头**，
只认 **body 里的 `location`**；不传就静默落到**服务进程的 cwd**。
实测：只带 `x-opencode-directory: .../dirA` 创建会话，建出来的会话 `location.directory` 是服务端 cwd，`projectID` 也是 cwd 项目的，且**不报错**。

#### 🟡 阶段 3a 实测补充：**「SDK 是否解包 `{data}` 信封」是逐端点决定的**

V2 的 wire 上绝大多数响应都是 `{data: …}` 信封，但 `@opencode/client` 的生成代码**只对一部分端点**做了
`.then(v => v.data)` 解包。实测（同一个 client 实例）：

| 调用                    | 返回值                          | 是否解包                             |
| ----------------------- | ------------------------------- | ------------------------------------ |
| `session.active()`      | 裸 `Record<sid, SessionActive>` | ✅ 解包（线缆上是 `{data:{…}}`）     |
| `session.list()`        | `{data, cursor}`                | ❌ 不解包（声明类型本身就有 `data`） |
| `server.info()`         | 裸 `ServerInfo`                 | ✅                                   |
| `config.shells()`       | 裸数组                          | ✅                                   |
| `session.form.list()`   | **裸 `FormInfo[]`**             | ✅                                   |
| `form.list()`（位置级） | `{location, data}`              | ❌                                   |
| `pty.connect.token()`   | **`{location, data}`**          | ❌（阶段 3a 实测，见报告 §6.4②）     |

→ **不能凭直觉**；写裸 `fetch` 时更要留意（本阶段冒烟就因为直接读顶层而永远拿不到活跃会话）。
**依据**：`@opencode/client` 生成类型（`dist/promise/generated/types.d.ts` 里各 `*Output` 的形状）+ 真机实测。

#### 🔴 但要当心：目录参数写错是**静默失效**的

裸 `directory` 传给 location 作用域端点会被**静默忽略**并回落到 `process.cwd()`，**HTTP 仍返回 200**。
迁移期这类错误**不会暴露**（既不报错也不报 4xx）。
→ **阶段 1 必须对 directory 断言或打日志**，否则"选了 A 目录却读到 B 目录"这类 bug 极难排查。

> ⚠️ **混合使用**：`GET /api/session` 用裸 `directory` query，`GET /api/config` 用 `location[directory]` deepObject。
> 阶段 0 已完成逐端点核对（138 端点：57 用 `location[directory]`、1 用裸 `directory`、80 无需目录参数），
> 全表见 `docs/opencode-v2-migration-phase0.md` 附录 A。

### 3.4 配置字段格式大改（影响可视化配置编辑器）

配置文件本身 V2 **能读 V1 格式并自动归一化**（不重写源文件），所以**用户配置不用改**。
但项目的**配置编辑器**（`src/features/settings/components/configEditor*`）是按 V1 字段渲染的，需要适配：

| V1                                                                          | V2                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `permission: { bash: {...}, edit: "allow" }`                                | `permissions: [{ action, resource, effect }]` **有序数组**                           |
| 工具名 `bash` / `task` / `write` / `patch`                                  | `shell` / `subagent` / `edit`                                                        |
| `agent: { ... }`                                                            | `agents: { ... }`                                                                    |
| agent 字段 `prompt` / `disable` / `variant`                                 | `system` / `disabled` / `model#variant`（variant 拼进模型串）                        |
| `command` / `plugin` / `provider` / `reference` / `snapshot` / `attachment` | `commands` / `plugins` / `providers` / `references` / `snapshots` / `media`          |
| `mcp: { name: {...} }`                                                      | `mcp: { servers: { name: {...} } }`，`enabled` → 反转为 `disabled`                   |
| `skills: { paths, urls }`                                                   | `skills: ["...", "..."]` 一个有序数组                                                |
| `provider.npm` / `api` / `options`                                          | `package`（加 `aisdk:` 前缀）/ `settings.baseURL` / 拆成 `settings`/`headers`/`body` |
| `model.id` / `tool_call` / `cache_read`                                     | `modelID` / `capabilities.*` / `cache.read`                                          |
| `autoshare: true`                                                           | `share: "auto"`                                                                      |

**补充：V2 有「接受但不支持」的字段清单**（migrate-v1 指南），这些字段会被**忽略并给出警告**：
`logLevel`、`server`、`subagent_depth`、compaction 旧字段、provider 的 `id`/`whitelist`/`blacklist` 等。
→ **配置编辑器可在保存后提示用户哪些字段已失效**，避免"改了没反应"的困惑。

### 3.5 启动与环境变量 ✅ 已验证（含实测修正）

**两条启动路径并不相同**：

| 路径                   | 文件                      | 实际命令                                                                           | V2 影响                         |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| **桌面（Tauri 本地）** | `opencode.rs:88`          | `["serve"]`（**不带任何参数**）                                                    | ✅ 无问题，实测正常打印 URL     |
| **WSL**                | `wsl_commands.rs:920-922` | `--print-logs --log-level {INFO\|WARN} serve --hostname 0.0.0.0 --port <随机端口>` | 🔴 **大写会报错退出**，须改小写 |

```
# WSL 路径设置的环境变量（wsl_commands.rs:913-916）
OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true   # ⚠️ v2.0.19 无代码读取，实际无效
OPENCODE_CLIENT=desktop                          # ✅ 被读取
OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD
                                                 # ↑ USERNAME 无效（见下），PASSWORD 有效
```

> ✅ **已实测确认**（完整表格见 [§10.2](#102-启动参数与环境变量)）：
>
> - `--print-logs`、`serve --hostname --port` 均有效；**`--log-level` 必须小写**（大写 `INFO` 会导致服务起不来）
> - `OPENCODE_SERVER_USERNAME` 在 v2.0.19 **实际不可配置**（`src/` 无读取处，用户名硬编码 `"opencode"`），
>   **但 docs 与 test 均引用了它** —— 属文档与实现不一致，保留设置它是安全的
> - `OPENCODE_SERVER_PASSWORD` 有效（备选 `OPENCODE_PASSWORD`）
> - 要真正关闭 filewatcher 应设 **`OPENCODE_FILEWATCHER_DISABLE=true`**（`server-process.ts:120`）
> - 官方桌面版参考实现：`packages/desktop/src/main/wsl/sidecar.ts:31-35`

#### ✅ 阶段 3b 的修复与复核（`src-tauri/**` 本阶段解锁）

| 项                                                   | 结果                                                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔴 **`wsl_commands.rs` 设的 filewatcher 变量名错了** | 原来设 `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true` —— v2.0.19 **零读取处** → **WSL 下 filewatcher 实际一直开着且不报错**。已改为 **`OPENCODE_FILEWATCHER_DISABLE=true`**（旧名删除；理由 + git 溯源写进注释） |
| **非 WSL 路径复核**                                  | ✅ `opencode.rs` 与其它 Rust 文件**没有**硬编码任何 `OPENCODE_*` 变量（只透传用户在设置页手填的键值对）→ 无需修改                                                                                                  |
| **`--log-level` 全仓库复核**                         | ✅ 唯一实际传值处是 `wsl_commands.rs` 的 `if cfg!(debug_assertions) { "info" } else { "warn" }`，**均小写**；描述历史的注释也改了                                                                                  |
| **健康检查复核**                                     | ✅ 单一 `GET /api/info` + `is_opencode_info_body` 形状校验（`version` 非空 + `pid` 数字 + `urls` 数组），保留 503 的 `is_success()` 前置判断                                                                       |
| **环境变量盘点**                                     | ✅ 逐项对照 v2.0.19 源码；唯一保留的无效变量 `OPENCODE_SERVER_USERNAME` 已注明「保留原因」；另发现 `OPENCODE_EXPERIMENTAL_FILEWATCHER` 也是死变量（官方 desktop 在设但没人读）                                     |
| **WSL 脚本整体复核**                                 | ✅ 对照官方 `sidecar.ts`：PATH 清洗 / `WSLENV=` / 随机密码 / `XDG_STATE_HOME` / `exec … serve` 全部一致；**filewatcher 一处比官方正确**（官方仍是旧名，是 `dev→v2` 合并回归）                                      |
| ⚠️ **未实测**                                        | WSL 端到端（容器内无 `wsl.exe`）、Rust 编译（容器缺 `glib-2.0` 开发库）→ 见阶段 3b 报告 §5.4 / §5.6                                                                                                                |

---

## 4. 完整端点对照表

> 「❌ 删除」表示 V2 无对应端点，功能需**移除或另找替代**。
> 「⚠️ 待验证」表示文档不明确，需实测确认。

### 4.1 服务与事件

| 功能     | V1（当前调用）                                   | V2                          | 说明                                                                                                                                                                                      |
| -------- | ------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 健康检查 | `GET /global/health`（Rust 先试 `/api/health`）  | **`GET /api/info`**         | 响应变为 `{version, pid, urls[], paths:{tmp}}`，**无 `healthy` 字段**                                                                                                                     |
| 事件流   | `GET /global/event`                              | **`GET /api/event`**        | SSE 格式与负载全变，见 §6                                                                                                                                                                 |
| 断开实例 | `POST /global/dispose`、`POST /instance/dispose` | ❌ 删除                     | 🟡 **阶段 3a 实测修正：`debug/location` 只能替代 instance 级**（`disposeInstance` 已迁移）。`global/dispose`（释放整个进程资源）**没有等价物** → 已标记 `removedInV2()`（本仓库零调用点） |
| 当前路径 | `GET /path`                                      | **`GET /api/location`**     |                                                                                                                                                                                           |
| 重载配置 | —                                                | `POST /api/location/reload` | 新增                                                                                                                                                                                      |

### 4.2 会话

| 功能                       | V1                                | V2                                                                                               | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表                       | `GET /session`                    | `GET /api/session`                                                                               | 新增 `cursor` 游标分页、`search`/`project`/`subpath`                                                                                                                                                                                                                                                                                                                                                                                        |
| 创建                       | `POST /session`                   | `POST /api/session`                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 详情                       | `GET /session/{id}`               | `GET /api/session/{id}`                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 更新                       | `PATCH /session/{id}`             | `PATCH /api/session/{id}`                                                                        | 🔴 **阶段 3a 实测修正：V2 删除了「归档会话」** —— body 只有 `{title?, metadata?, permissions?}`，没有 `time.archived`（v2.0.19 全仓库 `grep archiv` 零命中）。传了会显式抛 `removedInV2()`。另：V2 的 `update` **返回 void** → 写完必须回读一次                                                                                                                                                                                             |
| 删除                       | `DELETE /session/{id}`            | `DELETE /api/session/{id}`                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **会话状态**               | `GET /session/status`             | **`GET /api/session/active`**                                                                    | 返回 `SessionActive`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 拉消息                     | `GET /session/{id}/message`       | `GET /api/session/{id}/message`                                                                  | **返回结构变了**，见 §5                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **发消息**                 | `POST /session/{id}/message`      | **`POST /api/session/{id}/prompt`**                                                              | 请求体 `{text, files, agents, skills, metadata, delivery, resume}`                                                                                                                                                                                                                                                                                                                                                                          |
| **异步发消息**             | `POST /session/{id}/prompt_async` | ❌ 删除                                                                                          | V2 的 `prompt` **本身就是非阻塞**（"Durably admit one session input and schedule agent-loop execution"，返回 `Session.Inbox.User`）                                                                                                                                                                                                                                                                                                         |
| **阻塞等待一轮结束**       | （prompt_async 的隐含语义）       | **`POST /api/experimental/session/{id}/wait`**                                                   | _"Wait for a session agent loop to become idle"_ —— 需要"等这轮跑完"时用它                                                                                                                                                                                                                                                                                                                                                                  |
| （易混淆）把阻塞工具转后台 | —                                 | `POST /api/session/{id}/background`                                                              | ⚠️ **不是** `prompt_async` 的替代品：_"Move active foreground backgroundable tools into background observation"_                                                                                                                                                                                                                                                                                                                            |
| **停止生成**               | `POST /session/{id}/abort`        | **`POST /api/session/{id}/interrupt`**                                                           | ✅ 阶段 3a 已迁移。返回 `{interrupted: boolean}`；**会话本来就空闲时返回 `false`，不是错误**（openapi 原文："false for the idle no-op"）                                                                                                                                                                                                                                                                                                    |
| 拷贝                       | `POST /session/{id}/fork`         | `POST /api/session/{id}/fork`                                                                    | 🔴 **阶段 3a 实测修正：请求体字段是 `{before?: msg_id}`，不是 `messageID`**。`Session.ForkBoundary = {type:'before'\|'through', messageID}` 是 `Session.Info.fork.boundary` 这个**只读字段**的形状，**不是请求体**                                                                                                                                                                                                                          |
| **回退**                   | `POST /session/{id}/revert`       | **三段式**：`POST .../revert/stage` → `POST .../revert/commit` → `DELETE .../revert`（清除暂存） | ✅ 阶段 3a 已实现（详见 §5.6）。🔴 **三条实测语义**：① **stage 不删消息**（只写 `session.revert` + 恢复文件快照）→ 「回退后消息消失」必须由**前端**按 `revert.messageID` 过滤；② **commit 才真删**（projector `DELETE … WHERE seq >= boundary.seq`，不可逆）；③ **`prompt` / `compact` 会自动 commit 已暂存的回退**（源码 `session.ts:165`）→ 「回退后改一下再发送」不需要前端显式 commit。⚠️ stage 对 **busy 会话返回 `SessionBusyError`** |
| 取消回退                   | `POST /session/{id}/unrevert`     | ❌ 删除                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **分享**                   | `POST/DELETE /session/{id}/share` | ❌ 删除                                                                                          | 配置层有 `share: "auto"` 策略，但无 API                                                                                                                                                                                                                                                                                                                                                                                                     |
| **摘要**                   | `POST /session/{id}/summarize`    | ❌ 删除                                                                                          | 替代：`POST /api/session/{id}/compact`                                                                                                                                                                                                                                                                                                                                                                                                      |
| **子会话**                 | `GET /session/{id}/children`      | ❌ 删除                                                                                          | 替代：`GET /api/session?parentID=<id>`                                                                                                                                                                                                                                                                                                                                                                                                      |
| **待办**                   | `GET /session/{id}/todo`          | ❌ 删除                                                                                          | 事件侧亦无 `todo.updated`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| diff                       | `GET /session/{id}/diff`          | `GET /api/session/{id}/diff`                                                                     | 🔴 **阶段 3a 实测修正：V2 是「按轮次」的，不是全量**。`from` 默认 = **最新一条 user 消息所在轮次**；传 `from`+`to` 才能覆盖多轮。阶段 1 把 V1 的 `getSessionDiff` 直接映成不传参数 → **悄悄退化成「只显示最后一轮」**，阶段 3a 已修（显式传最早/最新 user 消息）                                                                                                                                                                            |
| 切换 agent                 | —                                 | `POST /api/session/{id}/agent`                                                                   | 新增                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 切换模型                   | —                                 | `POST /api/session/{id}/model`                                                                   | 新增                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 移动会话                   | —                                 | `POST /api/session/{id}/move`                                                                    | 新增                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 查看标记                   | —                                 | `POST /api/session/{id}/view`                                                                    | 新增                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 上下文                     | —                                 | `GET /api/session/{id}/context`                                                                  | 新增                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 收件箱                     | —                                 | `GET/PATCH/DELETE /api/session/{id}/inbox[/{inboxID}]`                                           | 新增（排队/转向投递）                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 4.3 权限与提问

| 功能         | V1                                                                         | V2                                                  | 说明                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 权限列表     | `GET /permission`                                                          | **`GET /api/permission/request`**                   | 另有 `GET /api/permission/saved`（已保存规则）                                                                                                                                                                                                                                                   |
| 权限回复     | `POST /session/{id}/permissions/{pid}`                                     | **`POST /api/session/{id}/permission/{rid}/reply`** | ✅ 阶段 3a 已迁移。**实测修正**：`decision` 的枚举**与 V1 完全一致**（`once`/`always`/`reject`），真正会踩的是 **`sessionID` 在 V2 是路径参数（必须提供）** —— V1 有「无 sessionID」的分支，V2 下缺了必然失败。另：`GET /api/permission/request` **没有 sessionId 过滤参数**（拉全量后前端过滤） |
| 删除已存权限 | —                                                                          | `DELETE /api/permission/saved/{id}`                 | 新增                                                                                                                                                                                                                                                                                             |
| **回答提问** | `GET /question`、`POST /question/{id}/reply`、`POST /question/{id}/reject` | ❌ **删除 → 全新 Form 表单体系**                    | `GET /api/session/{id}/form`、`POST .../form`、`POST .../form/{formID}/reply`、`DELETE .../form/{formID}`                                                                                                                                                                                        |
| 待处理表单   | —                                                                          | `GET /api/form`（location 级）                      | 新增                                                                                                                                                                                                                                                                                             |

> **Form 是全新 UI 能力**：支持 string/number/integer/boolean/multiselect/external 六种字段类型，带 `when` 条件与 `metadata`。
> 当前的「问题回答」组件需要**重写为表单渲染器**，属于新增功能而非等价替换。
>
> #### 🔴 阶段 3a 实测修正：Form 的三条硬性语义（文档未覆盖，漏了必然 400）
>
> 依据：v2.0.19 的 `packages/core/src/form.ts`（`validateAnswer` / `isActive` / `matches` / `validateFields`）。
>
> | #   | 语义                                                                                            | 源码原文                                                                |
> | --- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
> | ①   | **`external` 字段必须被「确认」，值是布尔 `true`**（字段里**没有** `required` 也一样）          | `if (value !== true) return 'External form field must be acknowledged'` |
> | ②   | **`when` 只能引用「前面」的字段**（创建期强制）                                                 | `Form field condition must reference an earlier field`                  |
> | ③   | **引用字段「未作答」时 `eq` 与 `neq` 都判 false**（不是「neq 取反」）；多选是「**任一项命中**」 | `if (value === undefined) return false`                                 |
>
> 另两条：`validateAnswer` 会**拒绝答案里的未知 key**（`Unknown form field`）与
> **「条件不成立却带了值」的字段**（`Form field is not active`）→ 提交前必须按可见性过滤；
> `GET /api/form` 与 `GET /api/session/{id}/form` **只列 `state.status === 'pending'`** 的表单。
>
> ✅ 阶段 3a 已实现渲染器（`src/features/chat/FormDialog.tsx`），求值/校验/组装逻辑在 `src/api/form.ts`，
> 与上述语义逐条对齐（含 `external` 的确认位、`when` 的「未作答两 op 皆 false」、闭集选项）。
>
> #### 🔴 阶段 3b 实测修正（推翻 3a 的一条前提）
>
> | #   | 3a 的说法                                                                           | 阶段 3b 实测                                                                                                                                                                                                                                                                                                                                                                    |
> | --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | ①   | 「V2 的 `Form.Info` 只有 `{id, sessionID, title, fields}`，**没有 tool 关联字段**」 | ❌ **不准确**。`packages/schema/src/form.ts` 的 `InfoBase` 含 **`metadata: Metadata.pipe(optional)`**；`question` 工具正是靠它把表单绑回工具调用：`metadata: { kind: "question", tool: { messageID, id } }` → **「按 callID 内联渲染表单」技术上可行**（匹配键 `form.metadata.tool.id === part.callID`）。本项目**有意不做**（YAGNI：底部 `FormDialog` 已覆盖全部待处理表单）   |
> | ②   | 把 `QuestionRenderer.tsx` 归入「V1 question 残留、归 3b 删除」                      | ❌ **前提不成立**。v2.0.19 **仍然有 `question` 工具**（`packages/core/src/tool/plugin/question.ts`，`name = "question"`）；本地库有 **54 条**真实 `question` 工具调用，且所在会话**都在 `session_v2` 里可见** → 删掉渲染器是**功能倒退**。阶段 3b **只删交互侧**（`InlineQuestion` / `QuestionDialog` / `pendingQuestions` / `findQuestionRequestForTool`），**保留只读渲染器** |
>
> 另：`TodoRenderer.tsx` 同理**保留** —— V2 没有待办端点/事件/工具，但本地库有 **328 条** `todowrite`
> 工具调用（V1 历史被迁移进 `session_v2` 可见的会话），会话级待办 UI 才该删。

### 4.4 模型、配置、项目

| 功能                  | V1                                                     | V2                                                 | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 读配置                | `GET /config`                                          | **`GET /api/config`**                              | 参数用 `location[directory]` deepObject；**⚠️ 响应结构变了**：返回 **`Config.Entry[]`**（配置文档+发现来源的**有序数组**，优先级从低到高），**不再是合并后的 Config 对象** → 配置编辑器要适配"多文档"模型                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 改（location 级）配置 | `PATCH /config`                                        | 🔴 **不存在**                                      | `/api/config` **只有 GET**，无写入方法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 改全局配置            | `PATCH /global/config`                                 | **`PATCH /api/experimental/config`**               | ✅ 阶段 3a 复核结论不变（payload 只有 `shell`）；「含其它字段」的分支已标记 `removedInV2()` 归 3b（**阶段 3b 已改为前端 `throw`，见下方「配置编辑器」行**）。**唯一写入口**，仅限全局配置（"Patch supported fields in the highest-precedence global configuration document"）。<br>🔴 **阶段 1 实测修正：它只接受 `{ shell }` 一个字段** —— payload 类型是 `Config.Patch`，而 `packages/schema/src/config.ts:112` 里<br>`export const Patch = Schema.Struct({ shell: Schema.NullOr(Schema.String) })`。<br>→ **V2 实际上没有「写任意配置字段」的 API**，配置编辑器的保存功能无法完整迁移（见下方「配置编辑器」行）                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 读全局配置            | `GET /global/config`                                   | 🔴 **无独立端点**                                  | 由 `GET /api/config` 返回的 `Config.Entry[]` 覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **配置编辑器**        | 用 `updateConfig`（location 级）+ `updateGlobalConfig` | ⚠️ **写侧基本不可迁移**                            | 🔴 **阶段 1 实测修正**：原判断"`updateGlobalConfig` → 可迁移"**是错的**。<br>`PATCH /api/experimental/config` 只能改 `shell`，其余字段一律无法写入 →<br>配置编辑器只能保留「读」与「改 shell」，其余编辑能力需要**改为只读展示 + 引导用户直接编辑配置文件**。<br>（读侧：`GET /api/config` 返回 `Config.Entry[]`，阶段 1 已在 API 层按优先级合并，见 `src/api/config.ts`）<br>✅ **阶段 3b 已落地**：设置页改为「**只读展示 + 仅 shell 可图形化编辑 + 每区块/整份「复制 JSON」**」，**界面上不存在任何「保存其它字段」的入口**；18 个 `configEditor*` 组件与 4 个测试文件整体删除。<br>🔴 **两条实测补充**：① 裸 REST `PATCH {shell, theme}` → **HTTP 200 且 theme 被静默丢弃**（「比报错更害人」的硬证据，所以 `updateGlobalConfig` 现在**前端就抛错**）；② **写完立刻 `GET /api/config` 拿到的是旧值**（服务端 watcher 约 1 秒滞后，`POST /api/location/reload` 也修不好）→ 界面必须**重试回读**。<br>⚠️ **跑配置写冒烟必须先隔离 `XDG_CONFIG_HOME`**，否则会改到用户真实的 `~/.config/opencode/opencode.jsonc`（阶段 3b 踩过，见报告 §0.3） |
| 模型列表              | `GET /config/providers`                                | **`GET /api/model`** + `GET /api/model/default`    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Provider 列表         | 同上                                                   | **`GET /api/provider`** + `GET /api/provider/{id}` |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 可用 shell            | `GET /pty/shells`                                      | **`GET /api/config/shell`**                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Agent 列表            | `GET /agent`                                           | `GET /api/agent` + `GET /api/agent/{agentID}`      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Skill 列表            | `GET /skill`                                           | `GET /api/skill`                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 命令列表              | `GET /command`                                         | `GET /api/command`                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 执行命令              | `POST /session/{id}/command`                           | `POST /api/session/{id}/command`                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 项目列表              | `GET /project`                                         | `GET /api/project`                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **当前项目/目录**     | `GET /project/current`                                 | ✅ **`GET /api/location`**                         | 返回 `Location.PublicInfo` = `{directory, project:{id, directory, canonical}}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 初始化 git            | `POST /project/git/init`                               | ❌ 删除                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 更新项目              | `PATCH /project/{id}`                                  | `PATCH /api/project/{id}`                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **LSP 状态**          | `GET /lsp`                                             | ❌ **删除**                                        | V2 **明确不再运行语言服务器**、不提供 LSP 工具、不产生诊断                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **格式化器状态**      | `GET /formatter`                                       | ❌ **删除**                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 4.5 文件与搜索

| 功能             | V1                  | V2                                | 说明                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 列目录           | `GET /file`         | **`GET /api/fs/list`**            | 🔴 **阶段 3a 实测修正**：V2 返回的目录条目 **`path` 带尾斜杠**（`src/`、`.git/`），必须剥掉，否则 `name` 变空串、且与 `/api/vcs/status` 的裸文件路径对不上（目录改动颜色整片失效）。另：`path=''` / `'.'` / 不传**三者等价**（都返回 location 根）；列表**会包含 `.git/` 与 gitignore 命中项且无 `ignored` 标记** → V1 的 gitignore 灰显能力丢失 |
| 读文件           | `GET /file/content` | **`GET /api/fs/read/*`**          | 路径在 URL 上（通配）。🔴 **阶段 3a 实测修正**：V2 返回**裸 `Uint8Array`**（丢掉 content-type），且**不接受绝对路径**（传了返回 **500**，不在 SDK 声明的状态码里）。mimeType 必须**前端按扩展名推断**（服务端会把 `a.ts` 误判成 `video/mp2t`）                                                                                                   |
| **文件改动状态** | `GET /file/status`  | ❌ 删除                           | 替代：`GET /api/vcs/status`（✅ 阶段 3a 已迁移；字段 `file/additions/deletions` → 内部 `path/added/removed`）                                                                                                                                                                                                                                    |
| 写文件           | —                   | `POST /api/experimental/fs/write` | 新增，experimental                                                                                                                                                                                                                                                                                                                               |
| 内容搜索         | `GET /find`         | 🔴 **无对应端点，功能移除**       | V2 的 115 个路径中**没有任何内容搜索端点**                                                                                                                                                                                                                                                                                                       |
| **文件名搜索**   | `GET /find/file`    | ✅ **`GET /api/fs/find`**         | 描述为 _"Find recursively ranked filesystem entries"_，参数 `query` / `type=file\|directory` / `limit` —— **只搜文件名/目录名**（fuzzysort 文件索引）                                                                                                                                                                                            |
| **符号搜索**     | `GET /find/symbol`  | ❌ 删除                           | 无 UI 使用，移除无影响                                                                                                                                                                                                                                                                                                                           |

### 4.6 终端 PTY

| 功能     | V1                                | V2                                                                                     | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 列表     | `GET /pty`                        | `GET /api/pty`                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 创建     | `POST /pty`                       | `POST /api/pty`                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 详情     | `GET /pty/{id}`                   | `GET /api/pty/{id}`                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 更新     | `PATCH /pty/{id}`                 | **`PUT /api/pty/{id}`**                                                                | 方法从 PATCH 改为 PUT                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 删除     | `DELETE /pty/{id}`                | `DELETE /api/pty/{id}`                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **连接** | `WS /pty/{id}/connect`（带 auth） | **两步**：`POST /api/pty/{id}/connect-token` 换令牌 → 再连 `GET /api/pty/{id}/connect` | ✅ 阶段 3a 已实现。🔴 **四条实测细节（openapi 看不出来）**：① `connect-token` **必须带请求头 `x-opencode-ticket: "1"`**（值是固定字面量 `"1"`，不是票据本身；不带 → **403**）；② **`pty.connect.token()` 的返回值没有被 SDK 解包**（返回完整信封 `{location, data:{ticket, expires_in}}`）；③ WS connect 的目录参数是 **`location[directory]`**（裸 `directory` 被静默忽略 → 404）；④ **手拼 URL 必须带 `/api` 前缀**（`getApiBaseUrl()` 返回裸地址；漏了会打到 SPA 兜底拿到 **200 + text/html**，极具迷惑性）。另：ticket **一次性**（复用 → 403）、**错目录 → 404**、**带 ticket 时服务端跳过 Basic 认证** |
| shells   | `GET /pty/shells`                 | `GET /api/config/shell`                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 持久终端 | —                                 | `POST /api/experimental/persistent-pty/*`                                              | 新增 prototype，暂不接入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 4.7 MCP、VCS、Worktree

| 功能          | V1                                        | V2                                                           | 说明                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP 列表      | `GET /mcp`                                | `GET /api/mcp`                                               | 🔴 **阶段 3a 实测修正**：**结构变了** —— V1 是 `Record<name, status>`，V2 是**数组** `{name, status:{status}, integrationID?}[]`；`Mcp.Status` **新增 `pending`**（启动/握手中）、`NeedsAuth.error` 在 V2 **必填**。另：**全新 location 的第一次调用返回空数组**（MCP 随 location 异步连接）→ UI 首次打开可能显示「尚未配置」，需刷新                         |
| 增删 MCP      | `POST /mcp`、`DELETE /mcp/{name}`         | `PUT/DELETE /api/experimental/mcp/{server}`                  | 转为 experimental + 路径参数                                                                                                                                                                                                                                                                                                                                  |
| 连接/断开     | `POST /mcp/{name}/connect`、`/disconnect` | `POST /api/experimental/mcp/{server}/connect`、`/disconnect` |                                                                                                                                                                                                                                                                                                                                                               |
| **MCP OAuth** | `POST /mcp/{name}/auth*`（4 个端点）      | ❌ 删除 → **`/api/integration/*` 全新体系**                  | ✅ 阶段 3a 已迁移（`getMcpStatus` 的 `integrationID` 是唯一桥梁）。🟡 **实测补充**：attempt 有 **`mode: 'auto' \| 'code'`** 两种 —— `code` 模式永远轮询不到 complete，必须走 `.../complete` 提交授权码；OAuth method 可能带**必填 `form`**（不带 `answer` 会被拒）；删除凭证走 `DELETE /api/credential/{credentialID}`（`connections[].type==='credential'`） |
| MCP 资源      | `GET /experimental/resource`              | `GET /api/mcp/resource`                                      | 转正。🟡 阶段 3a 实测修正：比 V1 **多出 `templates`**；资源来源字段是 `server`（V1 叫 `client`）                                                                                                                                                                                                                                                              |
| VCS 信息      | `GET /vcs`                                | `GET /api/vcs`                                               | 🟡 阶段 3a 实测修正：**非 git 目录返回 `200 + {"branch":{}}`，不是 4xx/5xx** —— 只靠 try/catch 会把「没有 VCS」当成「有 VCS 但分支为空」，必须再判 `branch.current`                                                                                                                                                                                           |
| VCS diff      | `GET /vcs/diff`                           | `GET /api/vcs/diff`                                          | 🔴 **阶段 3a 实测修正**：`mode` 枚举**变了** —— UI 用的是 `git\|branch\|session\|turn`，V2 只认 **`working\|branch\|committed`**（传 `mode=git` → **400 `Expected Vcs.Mode`**）。已加 `toVcsDiffMode()` 做 `git → working` 翻译。**这是本次最容易被漏掉的破坏性变更**                                                                                         |
| **VCS 状态**  | —                                         | `GET /api/vcs/status`                                        | 新增，可替代被删的 `/file/status`                                                                                                                                                                                                                                                                                                                             |
| **VCS 分支**  | —                                         | `GET /api/vcs/branch`                                        | 新增                                                                                                                                                                                                                                                                                                                                                          |
| **评审基线**  | —                                         | `GET /api/vcs/base`                                          | 新增，对 changes 面板有用                                                                                                                                                                                                                                                                                                                                     |
| Worktree 列表 | `GET /experimental/worktree`              | **`GET /api/worktree`**                                      | 转正（不再是 experimental）。🔴 **阶段 3a 实测修正：作用域参数从 `directory` 改成 `projectID`**（文档只写了「转正」）。解析错项目时 HTTP 全 200 → 静默失效；实现里先用 `GET /api/location` 拿 `location.project.id`                                                                                                                                           |
| 新建/删除     | `POST`、`DELETE /experimental/worktree`   | `POST`、`DELETE /api/worktree`                               |                                                                                                                                                                                                                                                                                                                                                               |
| 刷新          | —                                         | `POST /api/worktree/refresh`                                 | 新增                                                                                                                                                                                                                                                                                                                                                          |
| **重置**      | `POST /experimental/worktree/reset`       | ❌ 删除                                                      | ✅ 阶段 3a 已标记 `removedInV2()`，UI 入口归 3b。另两条行为变化：V2 的 create 用 `git worktree add --detach`（**游离 HEAD，不建分支**）；remove **只做 `git worktree remove [--force]`**（不再删 `opencode/<name>` 分支、不再 `rm -rf`）                                                                                                                      |

### 4.8 工具、插件、调试

| 功能       | V1                                                 | V2                                                                      | 说明                                     |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| 工具列表   | `GET /experimental/tool`、`/experimental/tool/ids` | ❌ 删除                                                                 | 替代：`GET /api/plugin`（含 `Features`） |
| 插件       | —                                                  | `GET /api/plugin`、`POST /api/plugin/check`、`POST /api/plugin/update`  | 新增                                     |
| 调试       | —                                                  | `GET /api/debug/location`、`DELETE /api/debug/location`（**无子路径**） | 新增                                     |
| 迁移状态   | —                                                  | `GET /api/experimental/migration/v1`                                    | 可用于检测 V1→V2 配置迁移进度            |
| 网页搜索   | —                                                  | `GET /api/websearch/provider`、`POST /api/websearch`                    | 新增                                     |
| Shell 命令 | —                                                  | `GET/POST/DELETE /api/shell`、`GET /api/shell/{id}/output`              | 新增（位置级）                           |
| 插件 RPC   | —                                                  | `POST /api/rpc/{rpcID}/{method}`                                        | 新增                                     |

---

## 5. 消息模型变更（最大改动）

### 5.1 结构对比

**V1 —— 两层结构**

```ts
// GET /session/{id}/message → MessageWithParts[]
{ info: Message, parts: Part[] }

// Part 联合（12 种）
type Part =
  | TextPart | ReasoningPart | ToolPart | FilePart | AgentPart
  | StepStartPart | StepFinishPart | SnapshotPart | PatchPart
  | SubtaskPart | RetryPart | CompactionPart
```

**V2 —— 扁平联合 + 游标分页**

```ts
// GET /api/session/{id}/message → SessionMessagesResponse
{ data: Session.Message.Info[], cursor: { previous: string|null, next: string|null } }

// 消息类型（11 种，按 type 判别）
type SessionMessageInfo =
  | User | Assistant | System | Skill | Shell | Synthetic
  | Compaction | Idle | AgentSelected | ModelSelected | LocationSwitched

// Assistant 内嵌 content 数组（3 种）
content: (Text | Reasoning | Tool)[]
```

> 🔴 **阶段 2a 实测修正（重要）**：上表的 `User` / `Assistant` / `AgentSelected` … 是
> **TypeScript 类型名**，**不是**线上的 `type` 字符串。判别字段的真实取值是：

| TS 类型名          | 线上 `type` 字符串        |
| ------------------ | ------------------------- |
| `User`             | `"user"`                  |
| `Assistant`        | `"assistant"`             |
| `System`           | `"system"`                |
| `Skill`            | `"skill"`                 |
| `Shell`            | `"shell"`                 |
| `Synthetic`        | `"synthetic"`             |
| `Compaction`       | `"compaction"`            |
| `Idle`             | `"idle"`                  |
| `AgentSelected`    | **`"agent-switched"`**    |
| `ModelSelected`    | **`"model-switched"`**    |
| `LocationSwitched` | **`"location-switched"`** |

即后三个**类型名与取值不一致**（源码 `Schema.tag("agent-switched")`），按类型名去比较会永远匹配不上。

### 5.2 关键字段变化

| 概念           | V1                                        | V2                                                                              |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| 用户文本       | `parts[].type === 'text'`                 | **`User.text`**（直接字段）                                                     |
| 用户附件       | `parts[].type === 'file'`                 | **`User.files`**                                                                |
| 用户指定 agent | `parts[].type === 'agent'`                | **`User.agents`**                                                               |
| 模型输出       | `parts[].type === 'text'`                 | `Assistant.content[].type === 'text'` + `text`                                  |
| 推理过程       | `parts[].type === 'reasoning'`            | `Assistant.content[].type === 'reasoning'`                                      |
| 工具调用       | `parts[].type === 'tool'`（内嵌 `state`） | `Assistant.content[].type === 'tool'`（内嵌 `state`）                           |
| 步骤分隔       | `step-start` / `step-finish`              | ❌ **删除**（改用 `Idle` 消息）                                                 |
| 子任务         | `subtask` part                            | ❌ **删除**（改用 `parentID` 会话树）                                           |
| 快照/补丁      | `snapshot` / `patch` part                 | ❌ 删除                                                                         |
| 重试           | `retry` part                              | `Assistant.retry` 字段                                                          |
| 压缩           | `compaction` part                         | **独立消息类型** `Compaction`（Running/Completed/Failed）                       |
| 成本/用量      | 分散                                      | `Assistant.cost`、`Assistant.tokens`、`Assistant.finish`、`Assistant.rawFinish` |
| 错误           | `Message.error`                           | `Assistant.error` + `Session.StructuredError`                                   |

#### 🔴 阶段 2a 实测补充（逐字段核对真实数据后新增，原表遗漏）

**① 所有消息都没有 `sessionID`**
V1 每条消息都带 `sessionID`；**V2 一律没有**（会话上下文由请求路径给出）。
→ 转换层/消费方必须由调用方把 sessionID 补进去，否则所有按 session 分组的逻辑都会失效。

**② `User` 消息丢得比表里写的更多**

| 概念             | V1  | V2                                                                         |
| ---------------- | --- | -------------------------------------------------------------------------- |
| `sessionID`      | ✅  | ❌ 没有                                                                    |
| `agent`（顶层）  | ✅  | ❌ 没有（实测官方 TUI 写在 **`metadata.agent`**，非契约字段）              |
| `model`（顶层）  | ✅  | ❌ 没有（同上，写在 **`metadata.model`**，且用的是 **V1 命名 `modelID`**） |
| `summary`        | ✅  | ❌ 删除                                                                    |
| `time.completed` | ✅  | ❌ 只剩 `time.created`                                                     |
| `skills`         | —   | ✅ **新增**（`PromptSkillAttachment[]`）                                   |

**③ 用户附件（`files`）与 V1 的 `FilePart` 结构完全不同**

| 概念          | V1 `FilePart`                                          | V2 `PromptFileAttachment`                                       |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| id / filename | ✅ `id`、`filename?`                                   | ❌ 都没有（只有 `name?`）                                       |
| 内容          | `url`（可直接渲染）                                    | **`data`（base64）** + `source`（`inline` \| `uri`）            |
| 来源          | `source?: FilePartSource`（file/symbol/resource 三态） | `source: {type:'inline'} \| {type:'uri',uri}`（两态，语义不同） |
| 文本位置      | `source.text: {value,start,end}`                       | `mention?: {start,end,text}`                                    |

→ 实测本机 22 条带附件的 user 消息**全是 inline base64 图片** → 转换层必须自己拼 `data:<mime>;base64,…`。

**④ `Assistant` 的 `content` 里 `text` / `reasoning` 没有 `id`**
V1 的 `TextPart` / `ReasoningPart` 都有 `id` / `sessionID` / `messageID`；**V2 只有 tool 有 `id`**。
→ UI 用 id 做 React key 与折叠状态，转换层按 `消息id:content:下标` 合成。
⚠️ 下标必须按 **content 数组下标**算，不能按同类型计数，否则插入新块会让已有 id 漂移。

**⑤ 工具状态机字段全变**

| 概念    | V1 `ToolPart`                              | V2 `AssistantTool`                                                                                                   |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 调用 id | `callID`                                   | **`id`**（改名）                                                                                                     |
| 工具名  | `tool`                                     | **`name`**（改名）                                                                                                   |
| 状态    | `pending` \| running \| completed \| error | **`streaming`** \| running \| completed \| error<br>（`pending` → `streaming`，且此时 `input` 是**未解析的字符串**） |
| 时间    | `state.time: {start,end}`                  | **`time: {created,ran?,completed?}`**（移到工具层）                                                                  |
| 产出    | `state.output: string`                     | **`state.content: ToolContent[]`**（`text` \| `file`）                                                               |
| 标题    | `state.title`                              | ❌ **删除**（实测官方把摘要放在 `metadata.title`，非契约）                                                           |
| 附件    | `state.attachments`                        | ❌ 删除（改用 `content` 里的 `file` 项）                                                                             |

**⑥ 错误类型从「判别联合」变成「扁平开放字符串」**
V1 `Message.error` 是 `{name, data}` 的 5 元联合；V2 是 `{type, message, status?}`，`type` 是**开放字符串**。
实测出现过的取值：`aborted`、`unknown`、`provider.error`、`provider.invalid-output`、`tool.execution`。
→ 转换层按关键字映射回 UI 的 5 种；**`aborted` 必须认出来**（UI 靠 `MessageAbortedError` 显示中止态，
本机库里有 57 条）。

**⑦ `finish` 收窄为 6 个字面量**：`stop` \| `length` \| `tool-calls` \| `content-filter` \| `error` \| `unknown`
（V1 是 `string`），并新增 `rawFinish`。

**⑧ 实测各类型真实占比**（本机 17,288 条真实 V2 消息，供渲染分支排优先级参考）：
`assistant` 14,972 · `user` 1,637 · `system` 482 · `idle` 81 · `synthetic` 71 · `compaction` 44 · `location-switched` 1 ·
（`skill` / `shell` / `agent-switched` / `model-switched` 本次样本为 0）

### 5.3 新增的消息类型（需要新写渲染分支）

| 类型               | 含义                                    |
| ------------------ | --------------------------------------- |
| `system`           | 系统消息                                |
| `skill`            | 技能激活记录                            |
| `shell`            | shell 命令消息                          |
| `synthetic`        | 合成消息（`POST .../synthetic` 可写入） |
| `idle`             | 空闲标记（**替代原 step 分隔符**）      |
| `agentSelected`    | 切换 agent 记录                         |
| `modelSelected`    | 切换模型记录                            |
| `locationSwitched` | 切换目录记录                            |

### 5.4 影响的代码

| 文件                             | 改动                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| `src/types/api/message.ts`       | Part 联合重写为 Session.Message.Info 联合                                |
| `src/api/message.ts`             | 请求参数、`buildPromptParams()` 重写（`text`/`files`/`agents`/`skills`） |
| `src/utils/messageConversion.ts` | `toUIMessage` / `toUIPart` **整体重写**                                  |
| `src/types/message.ts`           | UI 侧模型调整                                                            |
| `src/store/messageStore.ts`      | 数据结构 + 增量合并 + **新增游标分页**                                   |
| `src/features/message/**`        | 所有渲染组件适配（parts 目录、tools renderers）                          |
| `src/api/types.ts`               | `SendMessageParams` 等兼容别名                                           |

#### 阶段 2a 实际改动的文件（读侧，2026-09-30 完成）

| 文件                                                    | 改动量   | 说明                                                                                                       |
| ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `src/types/api/message.ts`                              | 重写     | V2 消息模型（11 种）+ 分页类型；**V1 别名保留并标 `@deprecated`**（事件层 2b 才删）                        |
| `src/types/message.ts`                                  | 中       | 新增 `SystemMessageInfo`(role `'system'`)、`SessionMarkerPart`、`SkillPart`；`CompactionPart` 增补 V2 字段 |
| `src/utils/messageConversion.ts`                        | 重写     | V2 扁平消息 → UI 模型（摊平 content、补 sessionID、合成 part id 与 step-finish）                           |
| `src/api/message.ts`                                    | 中       | **`getSessionMessages()` 改为游标分页**（`limit+1` 溢出法 + 钳制 1..200）                                  |
| `src/store/messageStore.ts`                             | 中       | `setMessages`/`prependMessages` 改吃 V2 消息；新增 `historyCursor`、`upsertMessages()`、`keepLocalOnly`    |
| `src/store/messageStoreTypes.ts`                        | 小       | `SessionState.historyCursor`                                                                               |
| `src/hooks/useSessionManager.ts`                        | 中       | 历史加载从「limit 递增」改为**游标**；并发保护；删掉 `cursorRef`                                           |
| `src/hooks/useRevertState.ts`                           | 小       | 适配新 API（该链路整体依赖 V2 已删的 revert 端点，属阶段 3）                                               |
| `src/hooks/useChatSession.ts`                           | 小       | 发消息兜底补齐改用 `upsertMessages()`                                                                      |
| `src/features/message/MessageRenderer.tsx`              | 小       | 新增 `role === 'system'` 分支 + `SystemMessageView`                                                        |
| `src/features/message/parts/SessionMarkerPartView.tsx`  | **新增** | V2 新增消息类型的渲染（system/synthetic/skill/shell/idle/\*-switched）                                     |
| `src/features/message/tools/renderers/TaskRenderer.tsx` | 小       | 子会话加载适配分页返回                                                                                     |
| `src/locales/{zh-CN,en}/message.json`                   | 小       | 新增 `system.marker.*` 文案                                                                                |
| `src/test/fixtures/v2Messages.ts`                       | **新增** | V2 消息测试夹具                                                                                            |
| `src/api/message.test.ts`                               | **新增** | 游标分页单测（14 例）                                                                                      |
| `src/utils/messageConversion.test.ts`                   | **新增** | 转换层单测（35 例）                                                                                        |
| `src/features/message/phase2a.smoke.test.tsx`           | **新增** | 真实服务冒烟（默认 skip，`VITE_OPENCODE_SMOKE=1` 开启）                                                    |

### 5.5 分页

V1 一次性返回全量；V2 返回 `{data, cursor}`。

#### 🔴 阶段 2a 实测修正：`cursor.previous` / `cursor.next` 的方向是**相对于本次排序**的

原文写「滚动到顶部时用 `cursor.previous` 向前加载」——**在默认排序下这是错的，会加载不出任何东西**。
实测（v2.0.19，真实服务 `http://127.0.0.1:4097`）：

| 请求                                    | 结果                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET .../message?limit=3`（不传 order） | 返回**最新 3 条**（新→旧），`cursor.next` = 锚定本页**最后一条**（最旧），`cursor.previous` = 锚定本页**第一条**（最新） |
| 跟 `cursor.next`                        | ✅ 拿到**更旧**的一页（50 条）                                                                                           |
| 跟 `cursor.previous`                    | ❌ **空数组**（最新那条之后没有更新的了）                                                                                |

游标本身是 base64url 的 `{id, order, direction}`，实测解出：
`{"id":"msg_0ee2…","order":"desc","direction":"previous"}`。

**源码依据**（tag v2.0.19）：

- `packages/server/src/handlers/message.ts` —— `previous` 锚定 `messages[0]`、`next` 锚定 `messages.at(-1)`，
  两者都把 `order` 编码进游标；且 **`cursor` 与 `order` 互斥**（同时传 → 400 `InvalidCursorError`）。
- `packages/core/src/session/store.ts` `messages()` ——
  `order = direction === 'previous' ? 反转(requestedOrder) : requestedOrder`，
  即 `previous` 会**把 SQL 排序翻过来**再取，最后把结果 reverse 回原排序。

**推论（服务端默认 `order=desc` = 新→旧）**：
`cursor.next` = **更旧**、`cursor.previous` = **更新**。
→ **滚动到顶部加载更早历史必须用 `cursor.next`。**

#### 🔴 另外三条实测修正

1. **游标不代表「还有没有更多」**：只要本页非空，`previous`/`next` 都会返回一个值，
   哪怕那个方向已经没数据（跟过去只会拿到空数组）。
   → 判断「还有更多」要用 **`limit + 1` 溢出法**（多要一条，多出来就说明还有）。
   ⚠️ 多要的那条**必须保留**，不能丢弃 —— 因为 `cursor.next` 锚定在本页**最后一条**上，
   丢掉它就等于让下一页跳过它，会**永久丢消息**。
2. **`limit` 服务端是 `NumberFromString` 且限定 1..200**（`SessionMessagesQuery`），
   省略时默认 **50**（`DefaultMessagesLimit`）。超过 200 → 400。
3. **`type` 过滤枚举里没有 `idle`**（只有 10 个值），但响应联合**包含** `SessionMessage.Idle`。
   → `idle` 消息会正常返回，只是**不能按它过滤**（`?type=idle` → 400）。这是 V2 自身的枚举不一致。

**已实现**：

- 向前翻页游标存在 `messageStore` 的 `SessionState.historyCursor`（随 session 一起被 LRU 淘汰，
  不再像原来的 `cursorRef` 那样跨 session 泄漏）
- 与现有「加载历史保持滚动位置」逻辑（`fc6ce8e6 fix: preserve scroll position after loading history`）
  协同：`ChatArea` 的 prepend 锚点按 `data-timeline-key`（消息 id）定位，本阶段未改动
- `messageStore` 的 `MAX_CACHED_SESSIONS = 10` LRU 策略**结论：维持原样**
  （游标已并入 `SessionState`，无需额外缓存层）

### 5.6 回退（revert）三段式 —— 阶段 3a 实现口径

V1 的 `revert` / `unrevert` **两个端点都已删除**，V2 换成三段式。源码依据：tag `v2.0.19` 的
`packages/core/src/session/revert.ts` + `packages/core/src/session/projector.ts:739` +
`packages/core/src/session/session.ts:165`。

| 阶段       | 端点                                                                | 实际行为                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **stage**  | `POST /api/session/{id}/revert/stage`<br>body `{messageID, files?}` | 只写 `session.revert = {messageID, snapshot, files}` 并把**文件快照**恢复到该边界（`files:false` 可只挪边界）。**不删任何消息**。返回 `Session.Revert`                               |
| **commit** | `POST /api/session/{id}/revert/commit`                              | 只发 `RevertEvent.Committed`；projector 才真正 `DELETE FROM session_message WHERE seq >= boundary.seq`（+ 删 inbox 项 + 清 `session.revert` + `InstructionState.reset`）。**不可逆** |
| **clear**  | `DELETE /api/session/{id}/revert`                                   | 把 stage 时改动的文件快照恢复回去 + 清空 `session.revert`。消息从未被删 → 清掉标记后**重新可见**（= V1 的 `unrevert`）                                                               |

**三条必须知道的语义**（漏了会做错 UI）：

1. **stage 之后消息仍在服务端**，`GET /api/session/{id}/message` 依然返回它们
   → 「回退后消息消失」必须由**前端**按 `session.revert.messageID` 过滤
   （`messageStore.revertState` 在做这件事，阶段 2a 已实现）。
2. **`prompt` / `compact` 会自动 commit 已暂存的回退**
   （`session.ts:165` 注释原文：_"Commit a staged revert only after preparation succeeds, before admitting new work."_）
   → 「回退 → 改一下 → 重新发送」这条自然流**不需要前端显式 commit**。
3. **stage 对 busy 会话返回 `SessionBusyError`** → 必须等执行结束才能回退。

**本项目的映射**（`useSessionManager` / `useRevertState`）：

| UI 动作           | 调用                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 撤销 undo         | `stageRevert(sessionId, userMessageId)`                                                                                    |
| 重做 redo         | 还有更早历史 → `stageRevert`（边界往前挪一条）<br>没有历史 → `clearRevert`                                                 |
| 全部重做 redo all | `clearRevert`                                                                                                              |
| ——                | **UI 不主动调用 `commitRevert`**（它不可逆，主动 commit 会毁掉 redo 能力）；`commitRevert()` 仍导出供 API 完整性与冒烟使用 |

---

## 6. 事件流变更

> ✅ **本章结论全部来自源码（`v2.0.19` tag）与实机测试，非推测。**
> 源码位置：`packages/server/src/event-feed.ts`、`packages/server/src/handlers/event.ts`、
> `packages/protocol/src/groups/event.ts`、`packages/schema/src/event-manifest.ts`

### 6.1 协议（已实测确认）

|               | V1                                             | V2                                                                              |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| 端点          | `GET /global/event`                            | **`GET /api/event`**                                                            |
| 负载          | `{ directory, payload: { type, properties } }` | **`{ id, created?, metadata?, location?, type, data, durable? }` 扁平结构**     |
| `event:` 字段 | —                                              | ❌ **没有**，只有 `data:` 行                                                    |
| `id:` 字段    | —                                              | ❌ 没有                                                                         |
| 编码层数      | 一层                                           | **一层**，`JSON.parse(data)` 一次即可，**无双层编码**                           |
| 心跳          | —                                              | 每 **15 秒**一行注释 `: heartbeat`；⚠️ **连接后立刻也会收到一行**（见下方修正） |
| 首帧          | —                                              | 连接即刻收到 `{id, type:"server.connected", data:{}}`（**无 `created`**）       |
| 订阅语义      | 可断线重连 + 代次恢复                          | **仅实时、不回放、不自动重连**                                                  |

**权威实现**（`packages/server/src/event-feed.ts:29`）：

```ts
export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}
```

> `V2EventEncoded` 虽然 schema 标了 `contentMediaType: application/json`，但 wire 上就是**普通的一行 JSON**。

#### 🟡 阶段 2b 实测修正：心跳有**两段行为**

原文只说「每 15 秒一行」——实测（`curl -sN` 逐帧打时间戳）：

```
  0.00s  server.connected
  0.01s  HEARTBEAT      ← 连接后几乎立刻一次（文档未提）
 15.00s  HEARTBEAT
 30.00s  HEARTBEAT
 45.00s  HEARTBEAT
```

即：**首帧心跳几乎立刻到达**，之后才是严格 15 秒间隔。
→ 影响：不能用「15 秒后才该有心跳」做判定；也不能把「收到心跳」当作连接就绪的充分条件。
本项目用的是 `onActivity`（任何传输活动都刷新心跳超时），两种行为都能正确覆盖。

#### 🟡 阶段 2b 实测补充：事件结构里的可选字段

实测帧的顶层字段是 `{id, created?, metadata?, location?, type, data, durable?}`：

- `created`：**不是每条都有**（`server.connected` 就没有）
- `location`：只在 location 作用域的事件上有
- `durable`：**durable 事件**才有（`{aggregateID, seq, version}`），ephemeral 事件没有
  —— 实测 `session.text.delta` / `session.tool.progress` / `session.usage.updated` 属 ephemeral（无 `durable`）

### 6.2 🔴 官方契约：流是「易失」的

`packages/protocol/src/groups/event.ts:51` 官方在 API 描述里**原文写明**：

> _"Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed."_
> **契约就是易失的：消费慢会溢出并使流失败，断线期间的事件会丢失。**

实现层面（`packages/server/src/event-feed.ts`）：

- 订阅队列容量 **`SubscriberCapacity = 4096`**
- 溢出时 `Queue.failCauseUnsafe(subscriber, ...)` —— 抛 `SubscriberOverflowError`
- 一旦编码失败，会 `fail` 掉**全部订阅者**（`fail()` 函数遍历 subscribers 清空）
- 编码时若 `isOpenCodeEvent(event)` 为 false，事件被**静默丢弃**

**→ 对前端的硬性要求：事件回调里绝不能做耗时操作**，必须先把事件入队再异步处理。

> 项目现有的 `coalesceEvents()` 批量合并逻辑**必须保留甚至加强** —— 这正是应对快消费的正确做法。

### 6.3 对本项目的冲击（`src/api/events.ts` 1060 行）

1. **断线重连 + 代次(generation)防串扰** → 必须改为「重连后**重新拉一次全量消息**」，否则丢消息
2. **delta 合并（`coalesceEvents`）** → 事件名与字段路径全变（见 6.4），但**思路可保留**
3. **心跳/退避重连（`RECONNECT_DELAYS`）** → 连接管理逻辑保留，恢复动作改为"重订阅 + 重拉数据"
4. **`@opencode/client` 自带订阅**：`client.event.subscribe()` 返回 async iterable，内部共享一条懒连接，最后一个订阅者退出才关闭 → 可大幅简化手写连接管理
5. **队列溢出会断流** → 需要保留并加强批量合并/背压

> **建议改用官方订阅**，能删掉大量手写连接管理代码；但需确认在 Tauri 的 `plugin-http` fetch 下流式表现正常。

#### ✅ 阶段 2b 决策：**采用了官方订阅**

官方实现（`@opencode/client` 的 `SharedEvents.make`）已经做好：共享懒连接、每订阅者 4096 容量队列、
SSE 文本解析（多行 `data:` / `\r\n` 归一 / 增量 UTF-8）、`onActivity`（含心跳的传输活动回调）。
**没做**的是：自动重连、状态机、代次防串扰、退避、后台保活 —— 这些由本项目保留。

取舍与实现细节见 `docs/opencode-v2-migration-phase2b.md` §2。要点：

- 传输层被隔离成单个函数 `createEventTransport()` —— Tauri 真机若发现 `plugin-http` 流式异常，
  只需换掉它，其余（分发 / 合并 / 重连 / 状态机）**一行都不用改**
- ⚠️ **Tauri 下未实测**（容器内无 Tauri 运行时），如实记录
- 官方 `subscribe()` 的共享连接是**按 client 实例**的；`sdk.ts` 按 `serverId → baseUrl+auth`
  缓存 client，所以「每服务器一条流」的语义保持不变

### 6.4 事件类型：存活判定（逐个查源码）

**判定依据**：`packages/schema/src/event-manifest.ts:71` 的 `ServerDefinitions`
= `foundation(Location, ModelsDev, Credential, Integration, Provider, Model, Agent, Session)`

- `feature(FileSystem, Reference, Permission, Plugin, Project, Worktree, Command, Config, Skill, Pty, PersistentPty, Shell, Form, WebSearch)`
- `SessionStatus` + `Tui` + `Installation` + `Vcs` + `Mcp(status, resources)`

**明确不包含**：`LspEvent`、`WorktreeEvent`、`LegacyEventV1`、`FileSystemV1`、`SessionCompactionEvent`、`WorkspaceEvent`、`McpEvent`（除 status/resources）

#### `events.ts` 实际处理的 21 个事件（本表 `question.*` 三合一，故为 19 行 + 1 个非实际项）

> **口径**：`src/api/events.ts` 中通过 `EventTypes.X` 实际引用的常量，**共 21 个**
> （`message.part.delta/removed/updated`、`message.updated`、`permission.asked/replied`、`project.updated`、
> `question.asked/rejected/replied`、`server.connected`、`session.created/deleted/error/idle/status/updated`、
> `todo.updated`、`vcs.branch.updated`、`worktree.failed/ready`）

| 事件                              | 判定                | 定义位置                  | 迁移去向                                                                                                       |
| --------------------------------- | ------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `message.part.updated`            | ❌                  | `v1/session.ts`           | → `session.text.*` / `session.tool.*` 等新事件族                                                               |
| `message.part.delta`              | ❌                  | `v1/session.ts`           | → `session.text.delta` / `session.reasoning.delta` / `session.tool.input.delta`                                |
| `message.part.removed`            | ❌                  | `v1/session.ts`           | → 取消/回退需重新拉消息                                                                                        |
| `message.updated`                 | ❌                  | `v1/session.ts`           | → `session.message.content.updated`                                                                            |
| `session.updated`                 | ❌                  | `v1/session.ts`           | → 拆成 `session.renamed` / `session.metadata.updated` / `session.agent.selected` / `session.model.selected`    |
| `session.error`                   | ❌                  | `v1/session.ts`           | → **`session.execution.failed`**                                                                               |
| `question.asked/replied/rejected` | ❌                  | `v1/question.ts`          | → **`form.created` / `form.replied` / `form.cancelled`**                                                       |
| `todo.updated`                    | ❌                  | **源码中根本不存在**      | → 待办功能移除                                                                                                 |
| `worktree.ready`                  | ❌                  | `worktree-event.ts`       | 不在 `ServerDefinitions` → 改用 **`worktree.updated`**（`worktree.ts:56`，在 `Worktree.Event.Definitions` 中） |
| `worktree.failed`                 | ❌                  | `worktree-event.ts`       | 不在 `ServerDefinitions` → 改用 **`worktree.resolved`**（`worktree.ts:61`）                                    |
| `session.created`                 | ✅                  | `session-event.ts`        | ⚠️ 事件载荷字段与 REST 的 `Session.Info` **不一致**（无 `time`、有 `slug`/`version`）→ 见下方修正 ⑤            |
| `session.deleted`                 | ✅                  | `session-event.ts`        | 载荷是 `{sessionID}`（V1 是裸字符串）                                                                          |
| `session.idle`                    | ⚠️ **保留但不下发** | `session-status-event.ts` | 🔴 **阶段 2b 实测：从未下发**（schema 里已标 `// deprecated`）→ 见下方修正 ①                                   |
| `session.status`                  | ⚠️ **保留但不下发** | `session-status-event.ts` | 🔴 **阶段 2b 实测：从未下发** → 见下方修正 ①                                                                   |
| `project.updated`                 | ✅                  | `project.ts`              |                                                                                                                |
| `permission.asked`                | ✅                  | `permission.ts`           | ⚠️ 载荷字段名变了：`permission/patterns/always` → `action/resources/save` → 见下方修正 ③                       |
| `permission.replied`              | ✅                  | `permission.ts`           |                                                                                                                |
| `vcs.branch.updated`              | ✅                  | `vcs-event.ts`            |                                                                                                                |
| `server.connected`                | ✅                  | `server-event.ts`         | ⚠️ `data` 是**空对象**，V1 的 `properties.timestamp` 没有了 → 见下方修正 ④                                     |
| `lsp.updated`                     | ❌                  | `lsp-event.ts`            | ⚠️ **仅存在于 `EventTypes` 常量表，`events.ts` 无处理分支**（V2 不跑 LSP）→ 一并清理                           |

#### 🎉 V2 新的流式事件族（阶段 2 核心）

**好消息：概念上与 V1 的 part 模型高度接近，`coalesceEvents` 思路可保留。**

| V2 事件                                                                                          | 对应 V1 概念                                          |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `session.text.started` / **`session.text.delta`** / `session.text.ended`                         | TextPart + `message.part.delta`                       |
| `session.reasoning.started` / **`session.reasoning.delta`** / `session.reasoning.ended`          | ReasoningPart                                         |
| `session.tool.input.started` / **`session.tool.input.delta`** / `session.tool.input.ended`       | ToolPart 输入流                                       |
| `session.tool.called` / `session.tool.progress` / `session.tool.success` / `session.tool.failed` | ToolPart 状态机                                       |
| `session.step.started` / `session.step.streamed` / `session.step.ended` / `session.step.failed`  | `step-start` / `step-finish`                          |
| `session.message.content.updated`                                                                | `message.updated`（⚠️ **实测不下发** → 见下方修正 ②） |

**其他可用事件**（`session-event.ts`，53 个）：`session.revert.staged/committed/cleared`、
`session.inbox.*`、`session.execution.started/succeeded/failed/interrupted`、
`session.agent.selected`、`session.model.selected`、`session.moved`、`session.renamed`、
`session.compaction.started/delta/ended/failed`、`session.shell.started/ended`、
`session.skill.activated`、`session.usage.updated`、`session.viewed`、`session.retry.scheduled` …

**V2 新增的 form 事件**：`form.created` / `form.replied` / `form.cancelled`

> `src/types/api/event.ts` 的 `EventTypes` 常量表（被 `satisfies Record<string, SDKGlobalEvent['payload']['type']>`
> 约束，SDK 一变编译即报错）需整体按上表重做。

---

#### 🔴🔴 阶段 2b 实测修正 ①：`session.idle` / `session.status` **从未下发**（两者都在 `ServerDefinitions` 里）

**实测**：三次抓包（22~100 秒窗口），含一次带工具调用的完整回合 + 一次 interrupt，
逐帧核对 —— `session.idle` 与 `session.status` **一帧都没有**。

**源码依据**：两者确实在 `ServerDefinitions` 里（`event-manifest.js` 的
`...SessionStatusEvent.Definitions`），所以类型与常量都在；但
`@opencode/schema/dist/session-status-event.js` 里 `Idle` 上明确标了 **`// deprecated`**
→ **没有生产者**。

**后果（严重，照文档实现必然踩）**：

- `useGlobalEvents.onSessionIdle` 负责 `messageStore.handleSessionIdle()`（把 `isStreaming` 落回
  false、给流式消息补 `completed`）与 `childSessionStore.markIdle`
- `useGlobalEvents.onSessionStatus` 负责 `activeSessionStore.updateStatus`（"Working" 列表 + busy→idle 通知）
- **两者永不触发 → 界面会一直停在「生成中」，侧栏永远有「工作中」**

**处理**：改用**确实会下发**的 `session.execution.*`：

| V2 事件                         | 映射                                                    |
| ------------------------------- | ------------------------------------------------------- |
| `session.execution.started`     | 状态 `busy`                                             |
| `session.execution.succeeded`   | 状态 `idle` + `onSessionIdle`                           |
| `session.execution.failed`      | 状态 `idle` + `onSessionError`                          |
| `session.execution.interrupted` | 状态 `idle` + `onSessionIdle` + `onMessagesInvalidated` |

⚠️ `interrupted` **必须**带 `onSessionIdle`：实测用户中断后不会有 `execution.succeeded`，
只 reset 状态码不够，`isStreaming` 会一直停在 true。

#### 🔴 阶段 2b 实测修正 ②：`session.message.content.updated` 有类型、但**不在 `V2Event` 联合里**，且不下发

- **类型层**：`@opencode/client` 里有 `SessionMessageContentUpdated` 类型（`types.d.ts:3257`），
  也在事件日志联合 `SessionEventDurable` 里，但 **`V2Event`（`types.d.ts:3310`）的联合里没有它**
  → `client.event.subscribe()` 的静态类型不包含该事件，
  直接 `satisfies Record<string, V2Event['type']>` 会**编译失败**
- **运行时**：三次抓包**一帧都没有**
- **处理**：`V2EventUnion = V2Event | SessionMessageContentUpdated`（把 SDK 漏掉的一支手工并回来）；
  `handleMessageUpdated` 分支**保留**（API 完整），但注明「有分支、无生产者」
- **性质**：V2 自身的**枚举/联合不一致**（与阶段 2a 发现的「`idle` 能返回但不能过滤」同一类）

#### 🔴 阶段 2b 实测修正 ③：权限载荷是 `permission→action` + `patterns→resources`

V2 `permission.asked.data` 实测是 `{id, sessionID, action, resources, save?, source?, message?}`：
`permission` 改叫 **`action`**、`patterns` 改叫 **`resources`**、`always` 改叫 **`save`**、
`tool:{messageID,callID}` 改叫 **`source:{type:'tool',messageID,id}`**。
（阶段 1 的注释写「多了 patterns」是不准确的 —— `patterns` 是 V1 的名字。）
→ 已加 `v2Convert.toInternalPermissionRequest()` 做映射。

#### 🟡 阶段 2b 实测修正 ④：`server.connected` 没有时间戳

`data` 是**空对象**，且该事件连 `created` 都没有 → V1 用 `properties.timestamp` 做的
**服务器时钟校准能力在 V2 丢失**。事件层尽力而为传 `created`（没有就是 `undefined`），
`serverStore.applyServerConnectedTimestamp` 对非数字静默返回 false。

#### 🟡 阶段 2b 实测修正 ⑤：`session.created` 事件与 REST `Session.Info` 字段不一致

| 概念           | 事件 `session.created.data` | REST `Session.Info`    |
| -------------- | --------------------------- | ---------------------- |
| id             | **`sessionID`**             | `id`                   |
| slug / version | **有**                      | ❌ 没有                |
| **时间**       | ❌ **完全没有 `time`**      | `time.created/updated` |
| 成本 / 用量    | ❌ 没有                     | `cost` / `tokens`      |

→ 事件层新增映射，时间用**事件自身的 `created`** 兜底。

#### 🟡 阶段 2b 实测修正 ⑥：`session.step.started` 带 `agent` / `model`（文档未提）

`session.text.started` 只给 `assistantMessageID` + `ordinal`，**拿不到 agent/model**；
而 UI 的助手页脚要显示模型名。`session.step.started` 的实测载荷是
`{sessionID, assistantMessageID, agent, model:{id,providerID,variant?}, snapshot?, started}`
→ 它才是「新建 assistant 消息」的权威信号，已据此新增 `kind: 'step-start'` 的分发分支。

#### 🟡 阶段 2b 实测修正 ⑦：工具事件的三个「载荷不全」

| 事件                       | 实测现象                                   | 处理                        |
| -------------------------- | ------------------------------------------ | --------------------------- |
| `session.tool.input.ended` | **不带 `name`**（只有 `input.started` 带） | store 合并时保留已有的 name |
| `session.tool.called`      | 实测帧里**没有 `state`** 字段              | 按可选处理                  |
| `session.tool.success`     | 实测帧里**没有 `resultState`**             | 同上                        |

#### 🟡 阶段 2b 实测修正 ⑧：`worktree.resolved` 不是「失败」

语义是「目录被解析/采用」（`{projectID, directory, previous, adopted?}`），
**没有 `message` 字段** → 原 `onWorktreeFailed` 里的错误提示要删掉，只刷新列表。

#### 🟡 阶段 2b 实测修正 ⑨：`session.step.failed` 会带 `aborted` 错误（用户中断时）

实测 interrupt 的帧序列：`session.execution.interrupted`（`reason:"user"`）+
`session.step.failed`（`error: {type:"aborted", message:"Step interrupted"}`，
**无 `finish` / `cost` / `tokens`**）。阶段 2a 的 `toMessageError()` 会把 `aborted` 映射成
`MessageAbortedError` → UI 的中止态能正确显示；`finish` 缺失时**不合成** step-finish part，与读侧一致。

---

## 7. 文件改动清单

### 🔴 P0 —— 主流程打通

| 文件                             | 改动量 | 说明                                                              |
| -------------------------------- | ------ | ----------------------------------------------------------------- |
| `package.json`                   | 小     | `@opencode-ai/sdk` → `@opencode/client`；先修依赖不一致           |
| `src/api/sdk.ts`                 | 中     | 换 client 工厂（保留 Tauri 自定义 fetch + Basic Auth + 缓存失效） |
| `src/api/*.ts`（约 20 个）       | 大     | 全部端点路径 + 方法 + 参数（`directory` → `location`）            |
| `src/api/events.ts`              | 大     | 换事件订阅，重写恢复策略                                          |
| `src/types/api/message.ts`       | 大     | 消息模型重写                                                      |
| `src/utils/messageConversion.ts` | 大     | 转换层重写                                                        |
| `src/store/messageStore.ts`      | 大     | 数据结构 + 合并 + 分页                                            |
| `src/utils/directoryUtils.ts`    | 中     | `formatPathForApi` 适配新参数形态                                 |

> ✅ 阶段 2b 已完成的额外项（原表未列）：
> `src/types/api/event.ts`（整体重写：V2 `EventTypes` + `EventCallbacks`）、
> `src/types/api/v1Model.ts`（A/C 桶删除，189 → 104 导出）、
> `src/api/session.ts` 的 `createSession`（body 里的 `location`）、
> `src/api/v2Convert.ts` 的 `toInternalPermissionRequest`、
> `vite.config.ts` 的 dev proxy 修正。

### 🟠 P1 —— 功能对齐

| 文件                                         | 改动量 | 说明                                                      |
| -------------------------------------------- | ------ | --------------------------------------------------------- |
| `src/features/message/**`                    | 大     | 渲染组件按新结构改                                        |
| `src/hooks/useGlobalEvents.ts`               | 中     | 事件回调对接                                              |
| `src/api/pty.ts` + `ptyBridge.ts`            | 中     | 改「先换 connect-token 再连」；`PATCH` → `PUT`            |
| `src-tauri/src/app/commands/opencode.rs`     | 中     | 健康检查 → `/api/info`；启动参数验证                      |
| `src-tauri/src/app/commands/wsl_commands.rs` | 中     | WSL 启动脚本参数验证                                      |
| `src/store/serverStore.ts`                   | 小     | 健康响应无 `healthy` 字段（`checkHealth` + 3 处 UI 展示） |
| `src/api/session.ts`                         | 中     | revert 三段式、去掉 share/summarize/children/todo/abort   |

### 🟡 P2 —— 周边能力

| 文件                                                    | 改动量 | 说明                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/config.ts` + `features/settings/configEditor*` | 中     | ① 配置字段格式大改（`permissions` 数组、`agents`、`mcp.servers`…）② **`GET /api/config` 响应改为 `Config.Entry[]` 多文档有序数组**，编辑器需适配"多文档"模型 ③ 写入口改为 `PATCH /api/experimental/config`（`PATCH /api/config` 不存在） |
| `src/api/permission.ts` + 权限 UI                       | 中     | `decision` 字段；**question → Form 表单渲染器（新 UI）**                                                                                                                                                                                 |
| `src/api/mcp.ts`                                        | 中     | OAuth → `/api/integration/*` 体系                                                                                                                                                                                                        |
| `src/api/file.ts` + 搜索 UI                             | 中     | 文件名搜索 → `/api/fs/find`；🔴 **内容搜索 `searchText` 无 V2 端点，`FileExplorer.tsx:327` 会失效 → 功能移除**；符号搜索移除；`file/status` → `vcs/status`                                                                               |
| `src/api/vcs.ts`、`worktree.ts`                         | 小     | 路径改名；**worktree reset 移除**                                                                                                                                                                                                        |
| LSP / formatter 相关 UI                                 | 小     | **功能删除**，移除入口与状态展示                                                                                                                                                                                                         |
| `src/api/client.ts`                                     | 小     | `/config/providers` → `/api/model` + `/api/provider`                                                                                                                                                                                     |

### ⚪ P3 —— 清理

| 对象                                         | 说明                                                                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openapi_doc.json`、`openapi_formatted.json` | ~~孤儿文件（全仓库无引用），更新为 V2 或删除~~ → ✅ **阶段 4 已删除**（V1 时代快照，含 V1 独有的 `/global/health`；删前再 grep 确认代码零引用）。**V2 的权威 spec 请用二进制导出**（115 路径 / 247 schema），不要再用静态快照 |
| ~~`src-tauri/src/app/commands/git.rs`~~      | **该文件已不存在**（曾为孤儿文件，审查过程中已删除；`mod.rs` 从未声明、未编译、git 历史中也无记录）→ 无需处理                                                                                                                 |
| 历史兼容 shim（5 处）                        | 见 §9.3，本次一并清理                                                                                                                                                                                                         |
| `core.filemode` 权限位噪音                   | 容器文件系统会给新写入文件加执行位，可加 `.gitattributes` 或文档说明                                                                                                                                                          |

---

## 8. 分阶段实施计划

> 建议按阶段提交，每阶段结束时主流程可用。

### 阶段 0：依赖修复 + 冒烟 🟢 小

> ✅ **阶段 0 已完成**（报告：`docs/opencode-v2-migration-phase0.md`，642 行）。
> 原计划的"抓包"环节已取消 —— 事件格式、启动参数、鉴权、环境变量均已通过源码（`v2.0.19` tag）+ 实测确认。

- [x] 修复 `package.json` / `node_modules` 版本不一致（1.16.0 vs 1.4.1）
      → 实装 **1.4.1 → 1.16.0**；`package-lock.json` 本就正确，**零仓库文件改动**
- [x] 确认 `sdk.pty.shells()` 缺失导致的当前故障状态
      → **实为 2 处坏调用**（+ `childSessionStore.ts:83` `Session.agent`）；修依赖后**自愈，`tsc` 零报错**，
      467 文件参与检查；**667 个单测全绿**
- [x] **修复 WSL 启动命令大小写**：`wsl_commands.rs:920-922` 的 `"INFO"` → `"info"`、`"WARN"` → `"warn"` + 中文注释
      （`opencode.rs` **未动**；大小写两方向均实测：大写 exit=1、小写正常起服务）
- [x] 端到端冒烟：`/api/info` 200+JSON、无凭证 401、`/global/health` 确认失效、`/api/location` 返回 `{directory, project}`
      `parse_listening_url()` **用真实 Rust 代码编译验证**可解析 `server listening on http://127.0.0.1:4097`；
      日志走 stderr、stdout 干净
- [x] 填补 §10 中仍标 ❗ 的接口细节 → **138 个端点全部核对**（57 `location[directory]` / 1 裸 `directory` / 80 无需目录参数）
      并**新发现**：目录参数全 optional + `x-opencode-directory` 头仍有效（§3.3）、目录参数写错**静默失效**

**产出**：✅ 服务能起、能连、依赖一致。
**未做（如实）**：Rust 未编译验证（改动仅 2 个字符串）、WSL 真实链路未跑（容器无 WSL）、
`@opencode/client` 的 `subscribe()` 在 Tauri 下的表现未验证（**留给阶段 1**）。

### 阶段 1：换 SDK + 迁移端点 🟡 中

> 🔴 **三条开工前提醒**（来自阶段 0 实测）：
>
> 1. **`tsc` 零报错 ≠ 可以依赖类型检查** —— 修好依赖后类型检查不报任何错，
>    **不能指望它告诉我们哪些调用点要改**，必须按 [§4](#4-完整端点对照表) 端点表**逐个手工迁移**。
> 2. **先验证 `x-opencode-directory` 够不够用** —— 目录参数全 `optional` 且该头是第二优先级回退（§3.3），
>    若验证通过，`directoryUtils.ts` 可能只需保留请求头 + 少量补参数，**改造量远小于原估计**。
> 3. **目录参数写错是静默失效的**（HTTP 仍 200，回落 `process.cwd()`）→ **必须加断言/日志**，
>    否则"选了 A 目录却读到 B 目录"的 bug 极难排查。

> ✅ **阶段 1 已完成**（报告：`docs/opencode-v2-migration-phase0.5.md`，1458 行，10 条实测差异）
>
> - **任务 1 结论 = B（头不够），但缺口只有 1 个端点**：`GET /api/session` 只认裸 `?directory=`，
>   头与 `location[directory]` 被**静默忽略**且**返回跨项目数据**（不报错、不 4xx）
> - 换包 `@opencode-ai/sdk ^1.16.0` → **`@opencode/client@2.0.19`**（精确锁定），20 文件 import 路径已改
> - `src/api/sdk.ts` 重写为 `OpenCode.make()`，保留 Tauri fetch + Basic Auth（用户名固定 `opencode`）
> - **21 处**真实调用迁移完成；**58 处**未迁移功能改为**调用即显式抛错**（`src/api/notMigrated.ts`，
>   不静默失败，带中文说明 + V2 替代方案，且有测试覆盖）
> - 类型检查 **0 报错**（换包后 336 → 适配后 95 → 迁移完 0）；**683 单测全绿**；冒烟 **12/12**

- [x] `@opencode-ai/sdk` → `@opencode/client`
      （⚠️ 原 import 路径 `@opencode-ai/sdk/v2/client` 里的 `v2` 是 **SDK 第二代**、打的仍是 V1 端点 →
      `src/types/api/*` 的 import 路径**已一并改掉**，非"自动跟随"）
- [x] 🔑 先做：验证 `x-opencode-directory` 策略 → **结论 B**，缺口 1 个端点，已回填 §3.3
- [x] 重写 `src/api/sdk.ts`（`OpenCode.make`，保留 Tauri fetch + Basic Auth）
- [x] 迁移 §4 中无删除项的端点 → **21 处**已迁移，其余 58 处显式报错
- [x] 迁移 `directory` → `location` 参数（按结论 B 最小方案）
- [x] `src/types/api/*` 适配新 SDK 类型导出
- [x] 健康检查改 `GET /api/info`（Rust `opencode.rs`、`serverStore.ts`、UI 3 处）
- [x] ⚠️ `openapi.json` 已过期一事已在文首标注

**产出**：✅ 会话列表、模型列表、配置读取可用（冒烟 12/12，真实 V2 服务验证）。
**未做（如实）**：Rust 未编译（依赖过重，改动仅 1 函数体 + 1 辅助函数）、Tauri/WSL 真实链路未跑、**写操作全部留阶段 3**。

### 阶段 2：消息模型 + 事件流 🔴 大（最难）

> **拆成 2a（读侧）/ 2b（写侧 + 事件流）两批做**。
> ✅ **阶段 2a（读侧：历史加载与渲染）已完成**（报告：`docs/opencode-v2-migration-phase2a.md`）：
>
> - [x] 重写 `src/types/api/message.ts`（Session.Message.Info 联合 + 分页类型）
> - [x] 重写 `src/utils/messageConversion.ts`（V2 扁平 → UI 模型）
> - [x] 实现游标分页（向前加载 + 滚动位置保持；`cursor.next` 而非 `previous`）
> - [x] `messageStore` 数据结构与合并逻辑重写（含 `historyCursor` / `upsertMessages`）
> - [x] 渲染层适配（新增 `role:'system'` 分支 + `SessionMarkerPartView`）
> - [x] 类型检查 0 报错；**744 单测全绿**（原 683 + 新增 49 + 冒烟 8 skip）；真实 V2 服务冒烟 8/8
>
> ✅ **阶段 2b（写侧 + 事件流）已完成**（报告：`docs/opencode-v2-migration-phase2b.md`）：
>
> - [x] 重写 `src/api/events.ts` —— 传输层改用官方 `client.event.subscribe()`（隔离成单个函数便于回退），
>       V2 事件分发 + `coalesceEvents` 字段路径重写（1060 → 1378 行）
> - [x] 实现「断线后重订阅 + 重拉一次全量」（`onReconnected` → `markAllSessionsStale()` + 各 pane 强制重载）
> - [x] 重写 `EventTypes` 常量表（45 个 V2 常量）与 `handleEventForSubscriber`
> - [x] `messageStore` 的 4 个事件处理器改 V2 形状（`session.text.*` / `session.tool.*` / `session.step.*` /
>       `session.message.content.updated`）
> - [x] 删除 `v1Model.ts` 的 A 桶 66 + C 桶 17（另 2 个降级为非导出）→ **189 → 104 个顶层导出**
> - [x] 发消息链路：`prompt`（非阻塞）+ `prompt` & `wait`（等这轮跑完），附件 / agent / skill 按 openapi 构造
> - [x] **决策 1：内容搜索 = 移除 UI**（V2 无端点）→ `searchText` / `searchSymbols` 与 UI 一并删除
> - [x] **决策 2：等待语义 = `POST /api/experimental/session/{id}/wait`**（`.../background` 不是替代品）
> - [x] 修正 `vite.config.ts` 的 dev proxy（删掉会削掉 V2 必需 `/api` 前缀的 V1 rewrite）
> - [x] 类型检查 0 报错；**803 单测通过 + 19 skip**（基线 741 零回归）；真实 V2 服务冒烟 **11/11**
> - [x] 🔴 实测发现并修正 9 处与文档不符（最关键：`session.idle` / `session.status` **从未下发**，
>       「一轮结束」必须改用 `session.execution.*`）→ 已回填 §6.1 / §6.3 / §6.4

**产出**：**聊天主流程可用**（发消息、流式回复、工具卡片、历史加载）。

### 阶段 3：功能补齐与裁撤 🟠 中大

> **拆成 3a（功能补齐）/ 3b（裁撤与清理）两批做**（与阶段 2 拆 2a/2b 同一思路：
> 补齐是「加法、可验证」，裁撤是「减法、动 UI」，混在一起会让 diff 难以审查）。

#### ✅ 阶段 3a：功能补齐（已完成，报告：`docs/opencode-v2-migration-phase3a.md`）

- [x] 中止：`abort` → `interrupt`（`session.interrupt`，返回 `{interrupted}`）
- [x] 回退：改造为 `stage` / `commit` / `clear` 三段式（口径见 §5.6）
- [x] 权限：`/api/permission/request` + `{decision}` 回复 + **saved 规则管理**（新增 2 个函数）
- [x] **Form 表单渲染器**（替代 question，六种字段类型 + `when` 联动 + `external` 确认位）
- [x] PTY：connect-token 两步流程、`PATCH` → `PUT`、`/api/config/shell`（阶段 1 已迁）
- [x] MCP：OAuth 迁移到 `/api/integration/*`（+ runtime add/connect/disconnect）
- [x] 文件/搜索：fs 路径迁移、`file/status` → `vcs/status`、`fs/read` 裸字节 → `FileContent`
- [x] VCS/Worktree：路径迁移 + **`mode` 枚举翻译** + **worktree 作用域 `directory` → `projectID`**
- [x] `api/tool.ts` / `lsp.ts` / `global.ts` / `config.ts` / `client.ts` / `command.ts` 的 12 处（实为 15 处）
- [x] **51 处 `notMigratedYet` 清零**（38 迁移 + 13 标记 `removedInV2()`）
- [x] 类型检查 0 报错；全量测试 **967 passed / 0 failed**（服务未启动；启动时 980）；
      真实服务冒烟 **6/6**（中断 / 回退三段式 / 权限回复 / 表单 / PTY / MCP）
- [x] 🔴 实测发现 **16 处与文档不符**（最关键：`session.diff` 是「按轮次」的、
      fork 字段是 `before`、**V2 删除了归档会话**、PTY 四条连接细节、`Vcs.Mode` 枚举变了、
      worktree 作用域改成 `projectID`）→ 已回填本文档（12 处标注）

**产出**：**功能与 V2 对齐**（除 3b 要移除的项）。

#### ✅ 阶段 3b：裁撤与清理（已完成，报告：`docs/opencode-v2-migration-phase3b.md`）

- [x] **移除 13 处 `removedInV2()` 对应的 UI 与代码**（清单见阶段 3a 报告 §7）：
      share / 归档会话 / todo / worktree reset / project git init / 配置写入 /
      tool 端点 / LSP 状态 / formatter 状态 / `disposeGlobal`
      → `grep -rn "removedInV2(" src/` = **0**，`notMigratedYet(` = **0**，`src/api/notMigrated.ts` **已删除**；
      并做成 **21 例静态「裁撤守卫」测试**（`src/features/phase3b.removal.test.ts`）防止被加回来
- [x] 删除 V1 question 体系的**交互**残留（`InlineQuestion` / `QuestionDialog` /
      `findQuestionRequestForTool` / `InlineToolRequestContext.pendingQuestions`）
      ⚠️ **但 `QuestionRenderer` 保留** —— 实测 V2 仍有 `question` 工具、本地库 54 条真实调用（见 §4.3 修正 ②）
- [x] 删除 `src/hooks/useRevertState.ts`（**零消费点**已逐个 grep 确认）+ 连带清理 `types/ui.ts` 的重复 Revert 类型
- [x] 配置编辑器**降级落地**：只读展示 + **仅 shell 可图形化编辑** + 每区块/整份「复制 JSON」+
      明确的「为什么改不了」用户文案；**界面上不存在任何「保存其它字段」的入口**；
      18 个 `configEditor*` 组件与 4 个测试文件整体删除
- [x] 收敛 `v1Model.ts` 的 B 桶：**104 → 42 个导出、1492 → 920 行**（用「传递闭包 + 集合差」校验，
      并对 62 个被删名字做**误删反向核查**）；`types/api/file.ts` 改为就地定义 V2 形状（去掉 `ignored` / `patch`）
- [x] Rust 启动参数与环境变量验证/调整（含 WSL）：**修掉 filewatcher 的静默 bug**
      （`OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` → `OPENCODE_FILEWATCHER_DISABLE`）、
      `--log-level` 小写复核、`/api/info` 健康检查复核、环境变量逐项盘点（见阶段 3b 报告 §5）
- [x] 另完成：`useFileExplorer` 根目录 TTL 的 `force` 绕开、`fs/read` 50MB 上限、
      `prettier` 全仓库格式化（含拦下一次 Markdown 内容损坏）、§9.3 的 patch 回退死代码清理
- [x] 类型检查 0 报错；全量测试 **958 passed / 0 failed**；真实服务冒烟 **6/6**
      （配置读 / shell 写 / **「传其它字段被静默丢弃」实证** / 客户端防线 / API 下架 / 数据卫生）
- [x] ✅ **已做（阶段 4）**：删除孤儿文件 `openapi_doc.json` / `openapi_formatted.json`
      （删前再 grep 确认**代码零引用**，命中的 5 处全在 `docs/` 里「把它们列为待删」的记录中；
      内容确认是 V1 快照 —— 含 V1 独有的 `/global/health`）→ 见阶段 4 报告 §3
      （不在本轮任务书范围，且属仓库根目录的跟踪文件 → 留阶段 4）

**产出**：代码与 UI 都不再引用 V2 已删除的能力（并有自动化守卫防回退）。

> ⚠️ **阶段 3b 的事故与教训**（如实记录）：第一次跑配置写冒烟时**没有隔离 `XDG_CONFIG_HOME`**，
> 于是 `PATCH /api/experimental/config` 把 `"shell": "/bin/sh"` 写进了**用户的真实全局配置**
> （`~/.config/opencode/opencode.jsonc` → 宿主机映射目录）。
> 已向用户说明并取得许可后删除该键恢复原状；测试已整改为**强制隔离 `XDG_CONFIG_HOME`**。
> 详见阶段 3b 报告 §0.3。

### 阶段 4：收尾 🟡 中

> ✅ **阶段 4 已完成**（报告：`docs/opencode-v2-migration-phase4.md`）。

- [x] 删除 5 处历史兼容 shim（§9.3）→ **逐条复核，5 条全部落实**（报告 §4.1）
- [x] Docker：**锁定 opencode 版本**（不再拉 `latest`）
      → 🔴 **实测确认旧写法一定装成 V1**（GitHub `latest` = `v1.18.33`）：
      换 `https://opencode.ai/files/bin/${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz` +
      `ARG OPENCODE_VERSION=2.0.19` + **双架构 sha256 校验** + ENV 透传给 entrypoint；
      `docker-compose.build.yml` 的死参数 `OPENCODE_INSTALL_URL` 换成 `OPENCODE_VERSION`；
      entrypoint 另加**非致命的版本守卫**（不是 `v2.*` 就 `WARNING`）
      ⚠️ **未真跑 `docker build`**（容器内无 docker daemon）—— 用「重新下载 + 哈希复核 + 逻辑模拟 + 拿该产物跑完整冒烟」替代
- [x] 全量单测 + 手工回归（多服务器、WSL、Docker 三形态）
      → 单测 **958 passed / 44 skipped / 0 failed**（与 3b 基线逐位一致）；
      **真实 v2.0.19 服务冒烟 5 套件 44/44**（phase1 13 · 2a 8 · 2b 11 · 3a 6 · 3b 6）；
      **手工回归清单已产出交给用户**（`docs/opencode-v2-migration-regression-checklist.md`），
      浏览器/WSL/Tauri 真机三项**如实标注未实测**
- [x] 更新 README 中的 opencode 版本要求（**明确要求 v2**）
      → `README.md` / `README_EN.md` 各在「快速体验」与「本地开发」两处写明
      「**需要 v2，本 UI 只支持 V2，不支持 v1.x**」+ `opencode --version` 确认方法
- [x] **额外完成（任务书外但同属「收尾」）**：
      ① **删除孤儿文件** `openapi_doc.json` / `openapi_formatted.json`（零引用已复核）；
      ② **Rust `cargo check` 0 报错**（装齐 Tauri Linux 依赖后跑了**从零开始的完整编译**，692 crate）；
      ③ **修掉 WSL「安装 opencode」装成 V1 的 bug**（换 `opencode.ai/v2/install`）；
      ④ 清理 8 处**过时注释**（「属阶段 3」「归 3b 决定」等已不成立的说法）；
      ⑤ 修掉 `phase1Smoke` 的**隐性环境依赖**与 2 个**偶发失败**用例；
      ⑥ `.prettierignore` 忽略 `src-tauri/gen/schemas`（Rust 编译产物，否则 prettier 必红）

**产出**：可发布（真机三项回归清单见交付文档）。

#### 8.5 迁移完成总结

> 本迁移**从阶段 0 到阶段 4 全部完成**。下面是各阶段产出与关键指标。

**① 各阶段产出**

| 阶段    | 报告                         | 主要产出                                                                                                                                |
| ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0 / 0.5 | `-phase0.md`、`-phase0.5.md` | 依赖修复（`@opencode-ai/sdk` 1.4.1 → `@opencode/client@2.0.19`）；**138 端点逐条核对目录参数**；事件/启动参数/鉴权/环境变量全部实测确认 |
| 1       | `-phase2a.md`（含 1 的内容） | **端点迁移**：全部 `/api` 前缀、`location[directory]` 传参、`GET /api/session` 的裸 `directory` 特例、健康检查换 `GET /api/info`        |
| 2a      | `-phase2a.md`                | **消息模型重写**（V1 `{info,parts}` → V2 扁平联合 + 游标分页）；转换层、store、渲染分支                                                 |
| 2b      | `-phase2b.md`                | **事件流重写**（`/global/event` → `/api/event`，1060 行 `events.ts`）；修掉 `session.idle` 从未下发等重大认知错误                       |
| 3a      | `-phase3a.md`                | **功能补齐**：51 处 `notMigratedYet` 清零；中断/回退三段式/权限回复/表单/PTY/MCP；`v1Model` B 桶待收敛                                  |
| 3b      | `-phase3b.md`                | **功能裁撤 + 配置编辑器降级**：13 处 `removedInV2()` 与对应 UI 全下架；`v1Model.ts` 104→42 导出；Rust WSL filewatcher 静默 bug 修复     |
| **4**   | `-phase4.md`                 | **收尾**：Docker 锁版本 + sha256（**修「装成 V1」bug ×2**）；README v2 要求；孤儿文件删除；shim 终审；**Rust 编译验证通过**；44/44 冒烟 |

**② 关键指标**

| 指标             | 数值                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API 端点**     | V2 权威 spec = **115 路径 / 247 schema**（本机二进制导出；docs 站点快照 113/245 **已过期**，差 `POST /api/pair` 等 2 条）                                                                  |
| **事件类型**     | V2 `EventTypes` **45 个**；重写后的 `src/api/events.ts` **全部 45 个都处理**（V1 时代只处理 21 个，且其中 8 个在 V2 已不存在）                                                             |
| **消息模型**     | V1 `{info, parts}` 两层 + 12 种 Part → **V2 扁平联合 + 游标分页**；新增 **8 种**消息类型（`system`/`skill`/`shell`/`synthetic`/`idle`/`agentSelected`/`modelSelected`/`locationSwitched`） |
| **测试**         | **1002 个用例 / 113 个文件**：**958 passed / 44 skipped / 0 failed**；另有 **5 个真实服务冒烟套件 44/44**                                                                                  |
| **静态检查**     | `tsc` **0 报错**；`prettier` **全仓库通过**；`eslint` **0 error / 43 warning**（警告全为既有）                                                                                             |
| **Rust**         | `cargo check` **0 报错**（含一次**从零完整编译**：692 crate / 495 rmeta / 1.4G target）；1 条 Linux-only 既有警告                                                                          |
| **迁移占位符**   | `notMigratedYet(` **0**、`removedInV2(` **0**（生产代码；`src/api/notMigrated.ts` 已删除），并有 **21 例静态守卫测试**防回退                                                               |
| **删除规模**     | **删除跟踪文件 33 个**（含 `api/{lsp,tool,todo}.ts`、18 个 `configEditor*`、3 个对话组件、2 个孤儿 openapi 快照）；新增 29 个                                                              |
| **整体 diff**    | `264 files changed, 11681 insertions(+), 27700 deletions(-)`（阶段 0→4 全部未提交）—— **净减 1.6 万行**                                                                                    |
| **`v1Model.ts`** | **104 → 42 个导出、1492 → 920 行**（用「传递闭包 + 集合差」校验 + 误删反向核查）                                                                                                           |

**③ 本次迁移最值得记住的三条经验**

1. **V2 的分发渠道换了，`latest` 会骗你** —— GitHub Releases 的 `latest` 停在 v1.18.33，
   而 v2 只在 `opencode.ai/files/bin/…` 与 npm 的 `@opencode/cli-*` 上。
   凡「自动取最新」的地方（Docker 构建、WSL 安装按钮）**都必须显式钉版本 + 校验**，
   否则表现为「界面能开、一发消息就失败」这种**零报错**的故障。
2. **`{data}` 信封是逐端点决定的** —— 同一个 SDK 实例，`session.active()` 解包、
   `session.list()` 不解包、`GET /api/config` 干脆是裸数组。
   不能凭直觉，必须以「生成类型 + 真机实测」为准（本项目为此踩过多次）。
3. **写全局配置的测试必须先隔离 `XDG_CONFIG_HOME`** —— 阶段 3b 因此写脏过用户的真实配置。
   本轮所有冒烟实例**全部隔离**，并复核「零残留」。

### 工作量参考

| 阶段        | 相对量  | 粗估（单人）  |
| ----------- | ------- | ------------- |
| 0 环境      | 🟢 小   | 0.5–1 天      |
| 1 端点迁移  | 🟡 中   | 2–4 天        |
| 2 消息+事件 | 🔴 大   | 5–8 天        |
| 3 功能对齐  | 🟠 中大 | 3–5 天        |
| 4 收尾      | 🟡 中   | 2–3 天        |
| **合计**    |         | **约 2–3 周** |

> 含联调与回归；Form 表单、配置编辑器两块存在不确定性，可能超预期。

---

## 9. 决策记录

### 9.1 只支持 V2，直接切换 ✅

**决定**：迁移后**只支持 opencode V2**，不做 V1/V2 双栈兼容。

**理由**：

- 双栈需要启动时版本探测 + 两套端点 + 两套消息模型，代码量约多 30–50%，且长期双份维护
- V1 已停止演进，opencode 本机已是 **v2.0.19**（源码 tag `v2.0.19` 与之一致）
- 项目当前**本就没有版本分支**，保持简单符合 KISS

**代价**：用户必须把 opencode 升级到 v2，否则无法使用。→ 在 README 明确标注版本要求。

### 9.2 不做的事

- **不保留** `/global/health`、`/global/event` 等 V1 端点的双端点兜底
- **不保留** V1 消息结构的适配层
- **不迁移**配置文件为 V2 原生格式（V2 自动归一化 V1 配置，保持现状即可；配置编辑器只改 UI 渲染）
- **暂不接入** persistent-pty、plugin RPC、shell、websearch 等 V2 新增能力（YAGNI，需要时再加）

### 9.3 要删除的历史兼容 shim

| 位置                                                                     | 现状                                        | 处理                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/api/events.ts:578`                                                  | `properties.info ?? properties.message`     | ✅ **阶段 2b 已删除**（`getMessageInfo` 整个函数随事件层重写一起消失，按 V2 真实字段）                                                                                                                                                                                                                                                                                         |
| `src/api/events.ts` `normalizeSessionError()`                            | 兼容 `{name,data}` 与 `{error:{name,data}}` | ✅ **阶段 2b 已删除**，`session.execution.failed` 直接透传 V2 的 `{type,message,status?}`                                                                                                                                                                                                                                                                                      |
| ~~`src/api/pty.ts:27 normalizePty()`~~                                   | ~~`running: boolean` → `status`~~           | ✅ **阶段 3a 核实：该函数早已不存在**（本条已过期）。`src/types/api/pty.ts` 已就地按 V2 形状重定义 `Pty`（含 `status`/`exitCode`），仓库内**没有任何消费方读 `.running`** → 无需改动                                                                                                                                                                                           |
| `src/components/SessionChangesPanel.tsx`、`src/hooks/useFileExplorer.ts` | patch 优先、回退 `before/after`             | ✅ **阶段 3b 已删除**（3 处回退分支；依据：V2 的 `FileDiff.Info` 是 `{file, patch, additions, deletions, status}` —— **`patch` 必填、且没有 before/after**）。另见阶段 3a 报告 §6.6 的 `Vcs.Mode` 枚举修正。⚠️ **未动** `InlinePermission.tsx` 读 `metadata.filediff` 的同类写法：它读的是**权限请求的 `metadata`（`Record<string,unknown>` 开放字段）**，不是 `FileDiff.Info` |
| `src-tauri/src/app/commands/opencode.rs`                                 | 先试 `/api/health` 再试 `/global/health`    | ✅ **阶段 1 已改为单一 `GET /api/info`**；**阶段 3b 复核**：端点正确 + 响应体形状校验（`is_opencode_info_body`：`version` 非空字符串 + `pid` 数字 + `urls` 数组），且保留 503 的 `is_success()` 前置判断（服务未就绪时 `/api/info` 返回 503）                                                                                                                                  |

> **阶段 3a 新增的兼容物 —— 阶段 3b 的处置结果**：
> `src/types/api/session.ts` 的 `SessionRevert = NonNullable<SDKSession['revert']> & { files?: FileDiff[] }`
> —— 用**交叉类型**在 V1 形状上追加 V2 的 `files`（原目的是不动 `v1Model.ts` 的 B 桶）。
> **阶段 3b 复核后仍保留该写法**：B 桶收敛后 `SDKSession`（= `v1Model.Session`）**仍在 42 个保留导出之列**，
> 交叉类型的注释已更新为「V2 原生形状 + V2 新增的 `files`」，不再是「为了避开禁改约束」的权宜之计。
> → 结论：**不是遗留兼容物**，是当前的正确定义。

> #### ✅ 阶段 4 的最终复核（**本节关闭**）
>
> 上表 5 条**逐条实跑复核，全部落实**（命令与输出见阶段 4 报告 §4.1）：
> `getMessageInfo` / `normalizeSessionError` / `normalizePty` 三个函数名全仓库 **0 命中**；
> patch 回退分支已删（剩下的 `before/after` 是从 `patch` 解析出的**局部变量**，不是读 API 字段）；
> Rust 侧**只发 `GET /api/info`**（`/global/health` 仅存在于解释历史的注释里）。
>
> **另清理 8 处过时注释**（「属阶段 3」「归 3b 决定」等已不成立的说法）——见阶段 4 报告 §4.2。
>
> 🟡 **阶段 4 顺带推翻了 3b 的一条结论**（**WSL `resolve_opencode` 不需要改**）：
> 3b §5.5 说「官方 `discoverScript()` 还会先试 `command -v opencode`」——
> 逐行读 v2.0.19 源码后**该说法不成立**：`packages/desktop/src/main/wsl/runtime.ts:339` 调用
> `RemoteCli.discoverScript()` **不传任何 options** → `fromPath` 为 `undefined` → 第一行就是 `cli=""`，
> **根本不会执行 `command -v`**；那条分支只有 **SSH** 会走
> （`ssh/bootstrap.ts:20` 传 `fromPath: true`）。**3b 把 SSH 的行为错当成 WSL 的。**
> → 本项目「只查 `$HOME/.opencode/bin/opencode`」**正是官方 WSL 语义**，保持现状；
> 并**不该**顺手加 `command -v` 兜底：WSL 默认继承 Windows PATH，而本项目的启动脚本要**专门剔除 `/mnt/*`**
> 才敢 `exec`，探测里不剔就会解析到 Windows 的 `opencode.exe` → 更糟。详见阶段 4 报告 §6。

> **阶段 2b 顺带清掉的其它兼容物**（不在原表里，但同属「V1 遗留」）：
> `src/utils/messageConversion.ts` 的 `toLegacyUIMessage` / `toLegacyUIMessageInfo` / `toUIPart` /
> `toApiMessageWithParts`（V1 形状适配，已无引用）；
> `src/types/index.ts` 的 4 个 V1 类型守卫（`isUserMessage` / `isAssistantMessage` /
> `hasVisibleContent` / `getMessageText`，与 `types/message.ts` 的同名函数重复且零引用）；
> `src/types/ui.ts` 的 `UIMessage`（V1 的 `{info, parts}` 形状，零引用）。

### 9.4 要移除的功能（V2 已删除）

LSP 状态 · 格式化器状态 · 符号搜索 · 会话分享 · 手动摘要 · 子会话列表 · 待办事项 · `prompt_async` · `unrevert` · worktree reset · `file/status`（改用 `vcs/status`）· `project/git/init` · `find/symbol` · **内容搜索 `GET /find`**（V2 无对应端点，`FileExplorer.tsx:327` 的 `searchText` 会失效）

> ✅ **阶段 2b 已移除的**：**符号搜索**（`searchSymbols`，无 UI 使用）、**内容搜索**
> （`searchText` + `FileExplorer` 的内容匹配 UI，决策 1 = A）。
> ✅ **阶段 2b 已移除的事件层功能**：`todo.updated`（V2 源码中不存在 → `EventTypes.TODO_UPDATED`、
> `onTodoUpdated` 回调、`todoStore` 的事件写入分支全部删除；**待办 UI 与读取链路仍属阶段 3**）、
> `lsp.updated`（不在 `ServerDefinitions` → 常量删除）。
> ⚠️ `prompt_async` 的**语义**已由 `prompt` 本身承担（V2 的 prompt 就是非阻塞的），
> 不是「功能移除」而是「不需要了」。
>
> #### 阶段 3a 对这张表的**逐项复核**（重要修正）
>
> | 原表项                                                | 阶段 3a 复核结果                                                                                                                                                                                                                                    |
> | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 子会话列表                                            | ❌ **不是移除项** —— V2 用 `GET /api/session?parentID=` 完整替代，**阶段 3a 已迁移**（`SessionChildrenSlot` 照常工作）                                                                                                                              |
> | 手动摘要                                              | ❌ **不是移除项** —— V2 用 `POST /api/session/{id}/compact` 替代，**阶段 3a 已迁移**（`/compact` 命令可用）                                                                                                                                         |
> | `unrevert`                                            | ✅ 确实删除，但**功能有替代**：三段式的 `clear`（`DELETE .../revert`）→ **阶段 3a 已迁移**                                                                                                                                                          |
> | `file/status`                                         | ✅ 改用 `vcs/status` → **阶段 3a 已迁移**                                                                                                                                                                                                           |
> | LSP 状态 / 格式化器状态                               | ✅ 端点确已删除，但**本仓库零调用点、零 UI**（`grep getLspStatus\|getFormatterStatus` 只有定义处）。⚠️ 设置面板里的 `lsp`/`formatters` 是**配置字段编辑器**，且 **V2 的 config schema 里这两个字段仍在** → 属「配置编辑器」那条线，**不是**状态展示 |
> | 会话分享 / 待办 / worktree reset / `project/git/init` | ✅ 确认移除 → 阶段 3a 已用 `removedInV2()` 标记，UI 清理归 3b                                                                                                                                                                                       |
> | **归档会话**                                          | 🆕 **本表漏了它**：V2 删除了 `time.archived`（见 §4.2）→ 阶段 3a 已标记 `removedInV2()`                                                                                                                                                             |
>
> → **结论**：原表把「子会话列表 / 手动摘要 / unrevert」误列为移除项，实际都有 V2 替代且阶段 3a 已迁移；
> 同时**漏列了「归档会话」**。3b 的移除清单以**阶段 3a 报告 §7** 为准（13 处 `removedInV2()`）。
>
> #### 🔴 阶段 3b 的**执行结果与两处前提修正**
>
> **执行结果**：13 处 `removedInV2()` **全部下架**（**生产代码**里 `removedInV2(` = 0、
> `notMigratedYet(` = 0；`src/api/notMigrated.ts` 整文件删除。
> ⚠️ 不加 `grep -v '\.test\.'` 时会命中 2 处，全部来自**守卫测试自己的断言字符串**，非生产代码），
> 并新增 **21 例静态「裁撤守卫」测试**防止回退。逐项去向见阶段 3b 报告 §2.2。
>
> **两处前提修正（重要 —— 照 3a 的清单删会出事）**：
>
> | #   | 3a 的清单项                                                  | 阶段 3b 修正                                                                                                                                                                                                                                                                                               |
> | --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | ①   | 「删除 V1 question 体系的残留（含 **`QuestionRenderer`**）」 | ❌ **不能删**。v2.0.19 **仍有 `question` 工具**（`packages/core/src/tool/plugin/question.ts`），本地库 **54 条**真实调用且会话都在 `session_v2` 里可见 → 删了是**功能倒退**。**只删交互侧**（`InlineQuestion` / `QuestionDialog` / `pendingQuestions` / `findQuestionRequestForTool`），**保留只读渲染器** |
> | ②   | 原表只把「待办」列为移除项（未提渲染器）                     | ⚠️ **`TodoRenderer` 同理必须保留**：V2 没有待办端点/事件/工具，但本地库有 **328 条** `todowrite` 工具调用（V1 历史被迁进 `session_v2` 可见的会话）→ **只删会话级待办 UI**（面板 / `todoStore` / `api/todo.ts`），**保留历史工具卡片渲染器**                                                                |
>
> 另：**「归档会话」的 UI 入口比 3a 列的多 4 处**（命令面板项、快捷键 `Alt+Backspace`、
> 设置页快捷键列表/搜索、`paneControllerStore` 的控制器字段）。只按 3a 的清单删，
> 会残留两个「点了就报错」的死入口（命令面板 + 快捷键）→ 阶段 3b 5 处一并清理。
>
> #### ✅ 阶段 4 终态（**本节关闭**）
>
> **13 处 `removedInV2()` 全部下架**，生产代码 `removedInV2(` = **0**、`notMigratedYet(` = **0**，
> `src/api/notMigrated.ts` 已删除，并有 **21 例静态守卫测试**（`src/features/phase3b.removal.test.ts`）防回退。
> 13 处的逐个去向见阶段 3b 报告 §2.2。
>
> ⚠️ **两处「不能删」的前提修正仍然有效**（照 3a 原清单删会出事）：
> `QuestionRenderer`（V2 仍有 `question` 工具、本地库 54 条真实调用）与
> `TodoRenderer`（V2 无待办能力，但本地库有 328 条历史 `todowrite` 调用）**必须保留**。
>
> **阶段 4 新增的移除项**：孤儿文件 `openapi_doc.json` / `openapi_formatted.json`（V1 时代 openapi 快照，零引用）**已删除**。

### 9.5 阶段 2 必须做的两个决策（开工前拍板）

| 决策点             | 选项                                                              | 影响                                                 |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------------- |
| **内容搜索怎么办** | A. 移除 UI（推荐，改动小）<br>B. 自研：前端拉文件列表后在内存里搜 | 决定 `FileExplorer.tsx` 搜索框是否保留               |
| **等待语义**       | 用 `POST /api/experimental/session/{id}/wait` 实现"等这轮跑完"    | 决定 `sendMessage`/`sendMessageAsync` 两条链路如何走 |

#### ✅ 阶段 2b 落地结果

| 决策                 | 结论                                                      | 落地                                                                                                                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **决策 1：内容搜索** | **选 A —— 移除 UI**                                       | `src/api/file.ts` 删除 `searchText()`；`FileExplorer.tsx` 删除内容搜索分支、「Content」分组、`getSearchMatchRanges()` / `byteOffsetToCodeUnitIndex()` / `textEncoder`；**不留置灰按钮**。顺带删除同样无 V2 端点的 `searchSymbols()`（原本也无 UI 使用）。**保留** `searchFiles()`（文件名搜索，V2 可用，已实现并加真实服务冒烟） |
| **决策 2：等待语义** | **`prompt` + `POST /api/experimental/session/{id}/wait`** | `sendMessageAsync` = 只 `prompt`（V2 的 prompt 本身非阻塞）；`sendMessage` = `prompt` → `wait`。⚠️ `POST /api/session/{id}/background` **不是**替代品（它是「把前台阻塞工具转后台观察」），已在代码注释里写明                                                                                                                    |

> 阶段 2b 额外发现：V2 的 `prompt` **不接受 model 参数**（模型是会话级的）——
> 详见 `docs/opencode-v2-migration-phase2b.md` §7.7 与主文档 §6.4 修正 ⑦ 相关说明。

---

## 10. 开工前必须验证的事项

> **状态更新**：本章原为"必须实测"清单。现已通过**读源码（`v2.0.19` tag）+ 实机测试**完成大部分验证。
> 标 ✅ 的**已确认，无需再查**；标 ❗ 的**仍需实做/实测**。

### 10.1 依赖 ✅ 已完成（阶段 0/1）

- [x] 修复 `node_modules` 与 `package.json` 不一致（实装 1.4.1 / 声明 1.16.0）
      → 实装 **1.16.0**；后续阶段 1 换成 `@opencode/client@2.0.19`（精确锁定）
- [x] 确认 `sdk.pty.shells()` 缺失造成的当前故障 → **实为 2 处坏调用**，修依赖后自愈
- [x] `@opencode/client` 在**浏览器 fetch** 下的流式表现 → ✅ 阶段 2b 真实服务实测正常
- [ ] ❗ `@opencode/client` 在 **Tauri `plugin-http`** 下的流式表现 → **仍未实测**（容器内无 Tauri 运行时）；
      传输层已隔离成单个函数便于回退，见阶段 2b 报告 §2.2 / §8#1

### 10.2 启动参数与环境变量 ✅ 已验证

| 项                                             | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 依据                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| ✅ `opencode serve --hostname --port`          | **有效**                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 实测 `serve --help`                          |
| ✅ `serve` 其他参数                            | `--cors` / `--service` / `--stdio` 均有效                                                                                                                                                                                                                                                                                                                                                                                                                   | 实测                                         |
| ✅ `--print-logs`                              | **有效**，结构化日志（`timestamp=... level=INFO ...`）走 stderr，不污染 stdout<br>**⚠️ 规律修正（阶段 0 复测）**：**只有失败请求才打日志** —— 4×401 → **4 行**、4×200 → **0 行**、<br>首个 location 作用域请求 → 约 27 行（一次性 watcher 噪音）；不带 `--print-logs` → 恒 0 行<br>（原"3 请求 3 行"是**恰好 3 个 401** 的偶然，不可当作"每请求 1 行"通用规律）<br>⚠️ `serve --help` 中 "server logs require --standalone" 与实际不符，属**过时 help 文本** | 阶段 0 实测                                  |
| ✅ `--log-level`                               | **有效**，但可选值为**小写** `all\|trace\|debug\|info\|warn\|warning\|error\|fatal\|none`                                                                                                                                                                                                                                                                                                                                                                   | 实测                                         |
| 🔴 **`--log-level INFO`（大写）**              | **报错退出，服务起不来**（仅影响 WSL 路径，桌面路径不带参数）                                                                                                                                                                                                                                                                                                                                                                                               | 实测（见 §1.3①）                             |
| 🔴 `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` | **无任何代码读取它**（v2.0.19 中仅 CI 与官方 sidecar 在**设置**，零读取处）<br>**真正被读取的是** `OPENCODE_FILEWATCHER_DISABLE ?? OPENCODE_DISABLE_FILEWATCHER`<br>→ 项目 WSL 脚本设的变量**无害但无效**；要真关 filewatcher 得换变量名                                                                                                                                                                                                                    | `packages/cli/src/server-process.ts:120`     |
| ✅ `OPENCODE_CLIENT=desktop`                   | **被识别**                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `packages/cli/src/index.ts` 等 3 处          |
| ✅ `OPENCODE_SERVER_PASSWORD`                  | **有效**（备选 `OPENCODE_PASSWORD`）                                                                                                                                                                                                                                                                                                                                                                                                                        | `packages/cli/src/env.ts:10-13` + 实测       |
| ⚠️ `OPENCODE_SERVER_USERNAME`                  | **v2.0.19 实际不可配置**（`src/` 零读取处，用户名硬编码 `"opencode"`）<br>**但措辞需注意**：`test/standalone.test.ts:11` 与各国 docs **都引用了它**并声称可改 —— **文档与实现不一致**<br>实测：设 `OPENCODE_SERVER_USERNAME=custom` 后仍只认 `opencode`<br>→ **结论：当前不可配置；后续版本可能生效，保持设置该变量是安全的**                                                                                                                               | `packages/server/src/auth.ts:20` + 实测      |
| ✅ `OPENCODE_LOG_LEVEL`                        | **存在**                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `packages/util/src/observability/logging.ts` |
| ✅ stdout 打印 URL                             | 格式为 `server listening on http://127.0.0.1:<port>`                                                                                                                                                                                                                                                                                                                                                                                                        | 实测                                         |
| ✅ `parse_listening_url()` 兼容                | **能正确解析**该格式                                                                                                                                                                                                                                                                                                                                                                                                                                        | 读 `opencode.rs:139` + 实测对照              |
| ✅ 鉴权                                        | `opencode:<password>` → 200，其他用户名 → 401；**与项目实现一致，零改动**                                                                                                                                                                                                                                                                                                                                                                                   | 实测 + `auth.ts:33-36`                       |
| ✅ 官方参考实现                                | `packages/desktop/src/main/wsl/sidecar.ts:31-35` 启动方式与项目几乎一致                                                                                                                                                                                                                                                                                                                                                                                     | 源码                                         |
| [ ] ❗ **WSL 启动脚本**                        | `wsl_commands.rs:920-922` 的 `"INFO"`/`"WARN"` 需改小写（**1 个文件 2 个值**），改后回归                                                                                                                                                                                                                                                                                                                                                                    | 待改                                         |
| —                                              | `opencode.rs:88` **不带任何参数**，桌面路径无此问题，**无需改动**                                                                                                                                                                                                                                                                                                                                                                                           | 读码确认                                     |

### 10.3 事件 payload 真实形状 ✅ 已验证

| 项                                                           | 结论                                                                                                          | 依据                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| ✅ 是否双层编码                                              | **否，一层**，`JSON.parse(data)` 一次                                                                         | `event-feed.ts:29` `frame()`          |
| ✅ `event:` 字段                                             | **没有**，只有 `data:` 行                                                                                     | 同上                                  |
| ✅ `id:` 字段                                                | **没有**                                                                                                      | 同上                                  |
| ✅ 事件结构                                                  | **`{ id, metadata?, location?, type, data }` 扁平**                                                           | `protocol/groups/event.ts:8-12`       |
| ✅ 心跳                                                      | 每 **15 秒** `: heartbeat` 注释                                                                               | `handlers/event.ts:22`                |
| ✅ 首帧                                                      | `{id, type:"server.connected", data:{}}`                                                                      | `handlers/event.ts:14-18`             |
| ✅ 完整事件类型清单                                          | **见 §6.4 存活判定表**（21 个逐个判定）                                                                       | `event-manifest.ts:71`                |
| ✅ 流式增量机制                                              | `session.text.delta` / `session.reasoning.delta` / `session.tool.input.delta`                                 | `session-event.ts` 行 408 / 447 / 491 |
| ✅ 流是否易失                                                | **是**，队列容量 4096，溢出断流                                                                               | `event-feed.ts:8` + 官方契约原文      |
| ✅ **阶段 2b 实测**：`subscribe()` 在浏览器 fetch 下         | **正常**：真实服务上收到 `server.connected` 首帧、15 秒心跳、完整流式回合（11/11 冒烟用例通过）               | 阶段 2b 冒烟                          |
| ⚠️ **阶段 2b 实测**：`subscribe()` 在 Tauri `plugin-http` 下 | **仍未实测**（容器内无 Tauri 运行时）。传输层已隔离成 `createEventTransport()` 单个函数，真机异常时只需换掉它 | 阶段 2b 报告 §2.2 / §8#1              |
| ✅ **阶段 2b 实测**：`session.idle` / `session.status`       | 🔴 **从未下发**（`idle` 已标 deprecated）→ 「一轮结束」改用 `session.execution.succeeded`                     | 阶段 2b 报告 §7.1                     |
| ✅ **阶段 2b 实测**：`session.message.content.updated`       | 🔴 **有 schema 类型但不在 `V2Event` 联合里，且从不下发**                                                      | 阶段 2b 报告 §7.2                     |
| ✅ **阶段 2b 实测**：心跳节律                                | 连接后**立刻**一次，之后严格 15 秒                                                                            | 阶段 2b 报告 §7.3                     |

**阶段 3a 新增的实测条目**（完整推导见 `docs/opencode-v2-migration-phase3a.md` §6）：

| 项                               | 结论                                                                                                                                                                       | 依据                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **SDK 是否解包 `{data}` 信封**   | **逐端点决定**：`session.active()` / `server.info()` / `config.shells()` / `session.form.list()` 解包；`session.list()` / `form.list()` / `pty.connect.token()` **不解包** | 生成类型 + 真机                                                |
| **`GET /api/session/{id}/diff`** | 是「**按轮次**」的，`from` 默认 = 最新一条 user 消息所在轮次（不是全量）                                                                                                   | openapi 描述 + 源码 `session/diff.ts`                          |
| **回退三段式**                   | stage 只写标记（**不删消息**）、commit 才真删、**`prompt`/`compact` 自动 commit**；stage 对 busy 会话报 `SessionBusyError`                                                 | 源码 `session/revert.ts`、`projector.ts:739`、`session.ts:165` |
| **V2 删除了「归档会话」**        | `SessionUpdateInput` 无 `time.archived`；v2.0.19 全仓库 `grep archiv` 零命中                                                                                               | openapi + 源码 grep                                            |
| **fork 请求体**                  | 是 `{before?: msg_id}`；`Session.ForkBoundary` 是只读字段形状，不是请求体                                                                                                  | openapi                                                        |
| **权限 `decision` 枚举**         | `once`/`always`/`reject`，**与 V1 一致**（任务提醒的「别照 V1 惯性」在本项上结论相同）；真正变了的是 **sessionID 成为路径参数**                                            | openapi `Permission.Reply`                                     |
| **Form 三条硬性语义**            | `external` 必须确认为 `true`；`when` 只能引用前面的字段；引用字段未作答时 `eq`/`neq` 都判 false、多选是「任一项命中」                                                      | 源码 `core/src/form.ts`                                        |
| **PTY 连接四条细节**             | `x-opencode-ticket: "1"` 头必填；`connect.token()` 不解包；WS 用 `location[directory]`；手拼 URL 必须带 `/api`；ticket 一次性（复用 403）                                  | 真机握手                                                       |
| **`fs/list` 目录条目带尾斜杠**   | `src/`、`.git/`；必须剥掉，否则与 `vcs/status` 的路径对不上                                                                                                                | 真机                                                           |
| **`fs/read` 返回裸字节**         | 且**不接受绝对路径**（500）；mimeType 需前端推断                                                                                                                           | 真机                                                           |
| **`Vcs.Mode` 枚举变了**          | UI 的 `git` → V2 的 `working`（传 `mode=git` → 400）；非 git 目录返回 `200 + {branch:{}}`                                                                                  | 真机                                                           |
| **worktree 作用域参数**          | 从 `directory` 改成 **`projectID`**（文档只写了「转正」）                                                                                                                  | openapi + 真机                                                 |
| **MCP schema 变化**              | 列表从 Record 变**数组**；新增 `pending`；`NeedsAuth.error` 必填；resource 多出 `templates`；OAuth attempt 有 `mode: auto\|code`；**全新 location 首次返回空数组**         | openapi + 真机                                                 |
| **`disposeGlobal` 无替代**       | `debug/location` 只能驱逐单个 location                                                                                                                                     | openapi                                                        |

**阶段 3b 新增的实测条目**（完整推导见 `docs/opencode-v2-migration-phase3b.md` §8）：

| 项                                                              | 结论                                                                                                                                                           | 依据                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 🔴 **`Form.Info` 有可选 `metadata`**                            | 3a 说「没有 tool 关联字段」**是错的**；`question` 工具用 `metadata: {kind:"question", tool:{messageID,id}}` 绑回工具调用 → **表单内联渲染技术上可行**          | `packages/schema/src/form.ts` 的 `InfoBase`      |
| 🔴 **V2 仍有 `question` 工具**                                  | `name = "question"` 仍在；本地库 **54 条**真实调用、会话都在 `session_v2` 里可见 → `QuestionRenderer` **必须保留**                                             | 源码 + 本地库                                    |
| 🔴 **历史里仍有 `todowrite` 工具卡片**                          | 本地库 **328 条**、最后一条 2026-09-24（V1 历史被迁进 V2 可见会话）；`todo` 表 287 行但 V2 时代**零写入** → `TodoRenderer` **必须保留**、会话级待办 UI 才该删  | 本地库                                           |
| 🔴 **「归档」UI 入口有 5 处**（3a 只列 1 处）                   | 还有命令面板项、快捷键 `Alt+Backspace`、设置页快捷键列表/搜索、`paneControllerStore` 字段                                                                      | 源码 grep                                        |
| 🔴 **`GET /api/config` 的线缆形状是裸数组**                     | **不是** `{data:[…]}` 信封（与 `session/active` 相反）—— 又一条「逐端点决定」                                                                                  | 真机                                             |
| 🟡 **配置写入后立刻读会拿到旧值**                               | `PATCH /api/experimental/config` → 紧接着 `GET /api/config` 的 `info` 是 `{}`（旧值），约 1 秒后才是新值；`POST /api/location/reload` 也修不好                 | 真机（冒烟 + 配置编辑器都被咬过）                |
| 🔴 **`--log-level` 是 effect/cli 的「内置全局 flag」**          | 所以 `git grep log-level v2.0.19 -- packages/` **查不到取值表** → 别误判为「参数不存在」                                                                       | 编译后二进制 + 实测                              |
| 🟡 **`prettier --write` 会损坏 Markdown 里的裸 `prompt_async`** | 输出 `prompt*async` + `\_`；**仓库级 `--write` 恰好不触发、单文件会触发** → 极难发现                                                                           | 实测（已用反引号根治 + 全量 grep 复核 0 处损坏） |
| 🟡 **`XDG_CONFIG_HOME` 是跑「配置写」冒烟的前置条件**           | `PATCH /api/experimental/config` 写的是「最高优先级的全局配置文档」，默认落到**用户真实**的 `~/.config/opencode/opencode.jsonc`                                | 实测事故（见 §8 阶段 3b 清单的教训块）           |
| 🟡 **官方 WSL sidecar 的 filewatcher 变量 bug**                 | 根因是 `302e9b45ab`「merge dev into v2」**把已改对的名字改回去了**；且 `OPENCODE_EXPERIMENTAL_FILEWATCHER` 同样零读取处 → 官方**两条路径**的文件监听变量都无效 | 源码 + git log                                   |
| 🟡 **`v1Model.ts` B 桶收敛结果**                                | **104 → 42 个导出、1492 → 920 行**；用「传递闭包 + 集合差」校验，并对 62 个被删名字做**误删反向核查**（命中 10 处**全是假阳性**：同名但就地重定义在别的模块）  | 脚本 + 全量测试                                  |

**阶段 4 新增的实测条目**（完整推导见 `docs/opencode-v2-migration-phase4.md` §1 / §5 / §7）：

| 项                                                            | 结论                                                                                                                                                                                                                                                                                | 依据                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 🔴 **GitHub `releases/latest` = `v1.18.33`（V1）**            | `api.github.com/.../releases/latest` → `"tag_name": "v1.18.33"`。**凡是「自动取最新」的地方都会装成 V1**（旧 Dockerfile、旧 WSL 安装按钮）                                                                                                                                          | 真机 curl                           |
| 🔴 **`opencode.ai/install` 是 V1 安装脚本**                   | 它第 184 行就是 `releases/latest/download/…` → **同一 bug 类**。v2 的脚本是 `opencode.ai/v2/install`（与官方桌面版用的 raw 地址**逐字节一致**，`diff` 为空）                                                                                                                        | 下载源码逐行读 + diff               |
| ✅ **V2 真实分发渠道**                                        | `https://opencode.ai/files/bin/<版本>/opencode-linux-<架构>.tar.gz`；tarball 内是**单个 `opencode`**，解压命令与旧 GitHub tarball 一致；解包实跑 → `opencode v2.0.19`                                                                                                               | 真机下载 + sha256 + 实跑            |
| ✅ **`OPENCODE_VERSION` 对 CLI 无运行时读取**（但**有例外**） | CLI 里它是 bun 的**构建期 `define`**（`declare const`），二进制 `grep -a` **0 命中**（对照 `OPENCODE_SERVER_PASSWORD` 4 命中 → 方法有效）。⚠️ 但 `packages/desktop/**`（Electron）**会读** `process.env.OPENCODE_VERSION`（3 处）→ 「无任何读取处」的绝对说法**不准确**             | 源码 + 二进制 grep                  |
| 🔴 **WSL `resolve_opencode` 无需改**（推翻 3b §5.5）          | 官方 **WSL** 路径调 `discoverScript()` **不传 options** → `fromPath` 为 `undefined` → 第一行 `cli=""`，**不执行 `command -v opencode`**；那条分支**只有 SSH** 走（`bootstrap.ts:20` 传 `fromPath: true`）→ **3b 把 SSH 的行为错当成 WSL 的**                                        | 源码逐行读                          |
| 🟡 **不该给 WSL 探测加 `command -v` 兜底**                    | WSL 默认继承 Windows PATH，而本项目的启动脚本要**专门剔除 `/mnt/*`** 才敢 `exec`；探测里不剔会解析到 Windows 的 `opencode.exe` → 更糟                                                                                                                                               | 源码（两条路径对比）                |
| 🟡 **`cargo check` 会让 prettier 全仓库失败**                 | `tauri-build` 生成 `src-tauri/gen/schemas/*.json`（`.gitignore` 已忽略但 `.prettierignore` 没覆盖）→ 任何人跑一次 Rust 编译，`prettier --check` 就红。已加 `.prettierignore` 一行（**只忽略生成物**，`gen/android/**` 是跟踪源码不能一起忽略）                                      | 实测（4 个文件被报）                |
| 🟡 **`phase1Smoke` ⑤ 有隐性环境依赖**                         | 原断言假定「全局配置里有 providers」，**只在跑在用户真实 `~/.config/opencode` 上时**成立；按安全要求隔离 `XDG_CONFIG_HOME` 后必然失败 → 已改为「启动前置条件 + 明确失败」，**不静默跳过**                                                                                           | 实测（隔离后红）                    |
| 🟡 **`phase1Smoke` ⑥⑧ 是偶发失败**                            | V2 的 **location 首次被访问时目录扫描可能未完成** → 第一次只返回内置 agent/command。同文件的 ④（模型）与 ⑦（skill）**早就**写了预热重试，⑥⑧ 漏了 → 已按既有写法补齐，**连跑 3 次都 13/13**                                                                                          | 实测（第一次红、重跑绿 → 复现并修） |
| ✅ **从零 `cargo check` 的规模**                              | `CARGO_TARGET_DIR` 指向全新目录 + `CARGO_INCREMENTAL=0` → **692 个 crate fingerprint / 495 个 `.rmeta` / 1.4G**，`Finished in 1m 03s`，**exit 0**                                                                                                                                   | 真机                                |
| 🟡 **`v1Model.ts` 头部有 2 处过时注释 + 1 处数字笔误**        | 「阶段 2/3 完成后**应整体删除**」与「B 桶**留给阶段 3**」都**已不成立**（该文件被有意保留并收敛到 42 个导出，同文件下方已写「剩余 42 个均有活跃引用」→ 自相矛盾）；且「1492 → **880** 行」是**错的**（实测 **920 行**，本文档其它 4 处都写 920）→ 三处已修，**刻意保持 920 行不变** | `wc -l` + 逐行读头部                |

### 10.4 接口细节

- [ ] ✅ 鉴权方式：**Basic 即可**，用户名固定 `opencode`；**不支持** Bearer（`authorization.ts:35` 只匹配 `^Basic`）
- [ ] ✅ `auth_token` query 参数也支持（`authorization.ts:11,33`）
- [ ] ✅ 浏览器 fetch 不会收到 `WWW-Authenticate` challenge（避免弹原生登录框，`authorization.ts:44-47`）
- [ ] ✅ 若不设密码 → `ServerAuth.required()` 返回 false → **完全不鉴权**（`auth.ts:28-30`）
- [ ] ✅ ~~`PATCH /api/config` 是否存在~~ → **不存在**，`/api/config` 仅 GET；写入口是 `PATCH /api/experimental/config`（仅全局）
- [ ] ✅ ~~`GET /global/config` 替代~~ → `GET /api/config` 返回 **`Config.Entry[]`** 多文档数组
- [ ] ✅ ~~`GET /project/current` 的替代~~ → **`GET /api/location`**（返回 `Location.PublicInfo`）
- [ ] ✅ ~~`GET /find/file` 是否并入 `/api/fs/find`~~ → **是**，但仅文件名搜索；**内容搜索无端点**
- [ ] ✅ ~~`worktree.ready/failed` 替代~~ → 用 **`worktree.updated` / `worktree.resolved`**（均在 `ServerDefinitions`，会真实下发）
      ⚠️ 阶段 2b 实测补充：`worktree.resolved` **不是「失败」**语义（是「目录被解析/采用」，
      载荷 `{projectID, directory, previous, adopted?}`，没有 `message` 字段）→ 原错误提示已删除
- [ ] ✅ ~~`directory` vs `location[directory]` 逐端点核对~~ → **阶段 0 已完成**：138 端点（57 用 `location[directory]`、1 用裸 `directory`、80 无需目录参数），全表见 `docs/opencode-v2-migration-phase0.md` 附录 A
      🟢 **且目录参数全部 `optional`、`x-opencode-directory` 头仍是第二优先级回退** → `directoryUtils.ts` 改造量小于原估计（见 §3.3）
- [ ] ✅ ~~`@opencode/client` 的 `subscribe()` 在 Tauri 环境下的表现~~ → **浏览器下阶段 2b 已实测正常**；**Tauri 仍未实测**（见 §10.1）
- [ ] ✅ ~~`POST /api/session/{id}/prompt` 的请求体到底有哪些字段~~ → **阶段 2b 已核实**：
      `PromptInput.Prompt` 只有 `{text, files?, agents?, skills?}`，外加 `{id?, metadata?, delivery?, resume?}`；
      🔴 **没有 `model`**（模型是会话级的）→ 见 §6.4 相关说明与阶段 2b 报告 §7.7
- [ ] ✅ ~~`permission.asked` 的载荷字段~~ → **阶段 2b 已核实**：`{id, sessionID, action, resources, save?, source?, message?}`
      （`permission`→`action`、`patterns`→`resources`、`always`→`save`、`tool`→`source`）
- [ ] ✅ ~~`session.created` 事件的字段是否与 REST 一致~~ → **不一致**：事件用 `sessionID`（REST 用 `id`）、
      有 `slug`/`version`、**没有 `time`**（REST 有）→ 见 §6.4 修正 ⑤
- [ ] ✅ ~~V2 的 dev proxy 是否要改~~ → **要**。`vite.config.ts` 里 `rewrite: path => path.replace(/^\/api/, '')`
      是 V1 遗留（V1 端点不带 `/api`），会把 V2 必需的 `/api` 前缀削掉 → **阶段 2b 已删除该 rewrite**

### 10.5 部署 ✅ 已完成（阶段 4）

- [x] ✅ **Docker 锁定 opencode 版本** —— 🔴 **实测确认旧写法一定装成 V1**：
      GitHub `releases/latest` 的 `tag_name` = **`v1.18.33`**（全仓库 500 个 release 零个 v2，
      `v2.0.x` 无 release 资源，npm `opencode-ai` 也无 v2）。
      已换成 `https://opencode.ai/files/bin/${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz` + `ARG OPENCODE_VERSION=2.0.19` + **双架构 sha256 校验** + ENV 透传 + entrypoint 版本守卫。
      顺带**彻底摆脱 GitHub 限流**（新渠道不经过 GitHub）。详见阶段 4 报告 §1
- [x] ✅ **Rust 编译验证**（3b 遗留）—— 装齐 Tauri Linux 依赖后 `cargo check` **0 报错**，
      含一次**从零完整编译**（692 crate）。**顺带修掉 WSL「安装 opencode」装成 V1 的 bug**（阶段 4 报告 §5）
- [x] ✅ **反代配置修正（由真实部署发现，2026-09-30）** —— 🔴 迁移时修了 vite 开发代理，
      但**生产反代配置漏改**：`docker/Caddyfile.standalone`、`docker/Caddyfile.gateway`、
      `docker/nginx.host.conf.example` 仍在**削 `/api` 前缀**（V1 写法）。
      V2 端点本身带 `/api` 前缀 → 削掉后请求命中 SPA 兜底 HTML（实测 `200 + text/html`），
      前端拿 HTML 当 JSON 解析 → 整条链路坏。已全部改为**原样透传**
      （Caddy `handle_path` → `handle`；nginx `proxy_pass` 去尾斜杠，`/api/pty/` 同步修正），
      并给 gateway 补上 `Authorization` 透传（后端开 `OPENCODE_SERVER_PASSWORD` 时必需，
      否则所有 `/api/*` 请求 401）。**该问题单测/冒烟均无法发现**，由 NAS 真实部署暴露。
- [x] ✅ **默认服务器 URL 修正（同一部署暴露，2026-09-30 追加）** —— Docker 构建注入的
      `VITE_API_BASE_URL=/api` 是 **V1 语义**（相对 base + 反代削前缀）；V2 下：
      ① 健康检查拼成 `/api/api/info`（实测 401，界面显示「401」）；
      ② SDK `new URL(baseUrl)` 对相对地址直接抛 `Invalid URL`。
      已修：`src/constants/api.ts` 把相对 base 解析为**页面 origin**；
      `serverStore` 读取持久化数据时把历史遗留的相对地址**就地升级**（老用户无需手动重加服务器）。
      另确认：内置 `Local` 服务器**故意不可编辑**（`isDefault` 隐藏编辑/删除按钮）——
      带密码的后端请通过「**添加服务器**」+「添加认证」使用（用户名固定 `opencode`）。
- [ ] ❗ **三形态真机回归：Tauri 本地 / WSL / Docker** —— **环境限制未实测**（容器内无 docker daemon、
      非 Windows、无 Tauri 运行时）；清单与「已知未验证项 9 条」见
      `docs/opencode-v2-migration-regression-checklist.md`

### 10.6 模型切换修复（真实使用发现，2026-09-30 追加）

- [x] ✅ **「界面切换模型不生效」修复** —— 真实使用中反馈：**切换模型后回复仍来自默认模型**。
      根因：V2 的 `prompt` **不接受 model 参数**（模型是**会话级**的，见 §10.4 的核实结论），
      而迁移时只把所选模型写进消息 `metadata` 供历史显示、**从未同步到会话**
      （阶段 2b 报告 §7#6「换模型不生效」即此缺口）。修复分两处：
      ① `src/api/message.ts`：发送前调用 `session.switchModel` —— **幂等**（与会话当前模型一致时
      服务端直接返回、不插记录、不发事件），所以每次发送前调用是安全的；只有真正变化时才在
      转录里留下一条 `model-switched` 记录（UI 渲染为会话标记，与官方 TUI 行为一致）。
      ② `src/contexts/SessionContext.tsx` + `src/hooks/useChatSession.ts`：新建会话时带上界面所选模型
      （避免新会话起在服务端默认模型上、转录顶部出现多余的「切换模型」标记）。
      已在真实后端（v2.0.19）端到端实测：创建会话带模型 A → `switchModel` 切到 B → 发消息，
      assistant 消息的 `model` 为 B ✅（同时验证 `model-switched` 记录与幂等重复切换）。
      遗留（次要）：`/compact`（压缩）与 slash 命令走会话当前模型 —— 发过消息后即为界面所选，
      仅「改选择后不发消息、直接跑命令/压缩」这一瞬时不跟随（`compact`/`command` 端点均无模型参数）。

---

## 附录 A：主要参考

- V2 文档索引：<https://opencode.ai/v2/llms.txt>
- 迁移指南：<https://opencode.ai/v2/docs/migrate-v1>
- API 参考：<https://opencode.ai/v2/docs/api>
- JavaScript 客户端：<https://opencode.ai/v2/docs/build/client>
- OpenAPI 契约：<https://opencode.ai/v2/openapi.json>

## 附录 B：本机实测环境

| 项              | 值                                                                        |
| --------------- | ------------------------------------------------------------------------- |
| opencode 版本   | `v2.0.19`（`/home/coder/.opencode/bin/opencode`）                         |
| OpenCodeUI 版本 | `0.6.46`                                                                  |
| V2 client 包    | `@opencode/client@2.0.19`                                                 |
| V1 SDK（当前）  | `@opencode-ai/sdk` 声明 `^1.16.0` / 实装 `1.4.1`                          |
| V2 鉴权实测     | `401` + `www-authenticate: Basic realm="Secure Area"`（**Basic 仍可用**） |
