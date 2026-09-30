# OpenCodeUI 迁移 V2 —— 阶段 0 报告

> 状态：**已完成**（阶段 0：依赖修复 + WSL 启动修复 + 端到端冒烟 + §10.4 剩余项核对）
> 执行环境：容器内 Linux，opencode `v2.0.19`（`/home/coder/.opencode/bin/opencode`），OpenCodeUI `0.6.46`
> 参照文档：`docs/opencode-v2-migration.md`（下文简称「迁移文档」）
> 日期：2026-09-30

## 结论摘要

| 任务            | 结果                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| 1. 依赖不一致   | ✅ 已修复，`node_modules` 从 1.4.1 → **1.16.0**；`package.json` / `package-lock.json` **无需改动** |
| 1. 类型检查     | ✅ **零报错**（467 个 `src` 文件参与检查）—— 与"记录一批报错留给后续阶段"的预期不同                |
| 1. 单元测试     | ✅ 全绿（96 文件 / 667 用例），依赖变更无回归                                                      |
| 2. WSL 启动命令 | ✅ 已修复（1 个文件、2 个值 + 中文注释）；`opencode.rs` 未动                                       |
| 3. 端到端冒烟   | ✅ 服务正常起、鉴权正常、`/api/info` 与 `/api/location` 正常；V1 端点确认失效                      |
| 4. §10.4 剩余项 | ✅ `directory` vs `location[directory]` 已逐端点核对完（138 个端点）；**发现 1 个文档结论错误**    |
| 5. 与文档不符   | ⚠️ 共 **8 处**，其中 1 处会影响阶段 1 的改造量估算（见 §5）                                        |

---

## 1. 任务 1：依赖不一致修复

### 1.1 修复前后版本对比

| 项                          | 修复前                      | 修复后                                    |
| --------------------------- | --------------------------- | ----------------------------------------- |
| `package.json` 声明         | `@opencode-ai/sdk: ^1.16.0` | `^1.16.0`（**未改**）                     |
| `package-lock.json` 锁定    | `1.16.0`                    | `1.16.0`（**未改**）                      |
| `node_modules` 实装         | **`1.4.1`** ❌              | **`1.16.0`** ✅                           |
| `sdk.pty.shells()` 是否存在 | ❌ 不存在                   | ✅ 存在（`dist/v2/gen/sdk.gen.d.ts:755`） |

**执行的命令与结果**：

```bash
npm install
# added 15 packages, removed 114 packages, changed 21 packages, and audited 495 packages in 8s
# 14 vulnerabilities (1 low, 6 moderate, 7 high)
```

**关键事实**：`package-lock.json` 本来就已经正确锁定 `1.16.0`，只是 `node_modules` 与之不符。
所以本次 `npm install` **只改了 `node_modules`，没有改任何仓库文件**（`git status` 可证：只有 `wsl_commands.rs` 被修改 + `docs/` 未跟踪）。

> 因此「允许改 `package.json` / `package-lock.json`」这条授权**实际未使用** —— 没有需要改的地方。

### 1.2 类型检查结果

- `package.json` 自带脚本：`"typecheck": "tsc -b"`（另有别名 `type-check`），所以按脚本执行。
- ⚠️ `tsc -b` 是**增量构建**（缓存 `node_modules/.tmp/*.tsbuildinfo`），可能直接命中缓存。
  因此额外跑了强制全量：`npx tsc -b --force`。
- 另用 `npx tsc --noEmit -p tsconfig.app.json --listFiles` 确认 **467 个 `src` 文件**确实参与检查（不是空跑）。

**结果：退出码 0，零报错。**

```
$ npm run typecheck
> opencodeui@0.6.46 typecheck
> tsc -b
（无任何输出）

$ npx tsc -b --force
（无任何输出，退出码 0）
```

> 📌 **这是阶段 0 最重要的一条"输入缺失"**：迁移文档预期阶段 0 能产出一份「类型报错清单」供后续阶段使用，
> 但依赖修好之后**一条报错都没有** —— 后续阶段的改造清单只能来自文档的端点对照表，不能指望类型检查报错来导航。

### 1.3 修复前的坏调用：实际是 **2 处**，不是 1 处

迁移文档 §2.3 只列了 `src/api/pty.ts:50` 的 `sdk.pty.shells()`。实际用 1.4.1 的类型复现后有 **2 处**：

```
src/api/pty.ts(50,31): error TS2339: Property 'shells' does not exist on type 'Pty'.
src/store/childSessionStore.ts(83,22): error TS2339: Property 'agent' does not exist on type 'Session'.
```

- 第 1 处（`pty.shells`）：与文档一致。已确认 1.4.1 的 `dist/` 里 `grep -r shells` **零命中**；1.16.0 中有。
- 第 2 处（`Session.agent`）：**文档未提及**。`src/store/childSessionStore.ts:83` 读取 `session.agent`，
  该字段在 1.4.1 的 `Session` 类型中不存在，1.16.0 的 `Session.Info` 中有 `agent?: string`。
  → 也就是说 1.4.1 下**子会话（subtask）创建链路**在类型层面也是坏的，不只是 PTY shells。

**复现方法（透明说明）**：项目当时的 `node_modules` 已经是修好之后的 1.16.0，无法直接回滚复现。
所以采用**不改动项目任何文件**的旁路复现：
把 npm 上的 `@opencode-ai/sdk@1.4.1` 解包到 `/tmp/opencode/sdk141/`，
再写一个临时 tsconfig（`/tmp/opencode/repro-project/tsconfig.json`，`extends` 项目自己的 `tsconfig.app.json`），
用 `compilerOptions.paths` 把 `@opencode-ai/sdk/*` 指向那份 1.4.1 副本，`include` 指向项目的 `src`，然后跑 `tsc`。

> 局限：这是"用 1.4.1 的类型定义检查项目源码"，能准确反映**类型层面**的坏调用；
> 但它不等价于"在 1.4.1 运行时实际跑一遍"，运行时的报错点可能更多（例如动态调用）。

### 1.4 单元测试（依赖变更后的回归确认）

依赖从 1.4.1 换到 1.16.0 属于运行时行为变更，因此补跑了一次单测：

```bash
timeout 180 npm run test:run     # = vitest run（npm test 是 watch 模式，非交互环境下会挂住，故用 run 变体）
```

结果：**全绿** —— `Test Files 96 passed (96)` / `Tests 667 passed (667)`，耗时 16.96s，退出码 0。

> ⚠️ 但**不要**据此认为"依赖问题会被单测发现"。经查：只有 `src/api/sdk.test.ts` 对
> `@opencode-ai/sdk/v2/client` 做了 `vi.mock`；`ConfigSettings.search.test.tsx` mock 的是项目自己的
> `api` 模块（`listAvailableShells: vi.fn()`），**从未真正调用到 `sdk.pty.shells()`**。
> 两处坏调用都是"属性不存在"，只有**真的调用到**才会在运行时抛 `not a function`。
> → 推断（未实测）：1.4.1 状态下这套单测很可能同样是绿的。**这类依赖不一致问题只能靠类型检查或人工比对发现。**

---

## 2. 任务 2：WSL 启动命令修复

### 2.1 改动点（文件 : 行号 + 改动前后）

**唯一改动文件**：`src-tauri/src/app/commands/wsl_commands.rs`

|                    | 修改前                                                     | 修改后                         |
| ------------------ | ---------------------------------------------------------- | ------------------------------ |
| 行号               | 918–924 行                                                 | 918–928 行                     |
| 值（debug 分支）   | `"INFO"`                                                   | **`"info"`**                   |
| 值（release 分支） | `"WARN"`                                                   | **`"warn"`**                   |
| 注释               | `// 打包版 WARN / 开发版 INFO（官方 app.isPackaged 分支）` | 改写为小写 + 追加 4 行警示注释 |

实际 diff：

```diff
-        // 打包版 WARN / 开发版 INFO（官方 app.isPackaged 分支）
+        // 打包版 warn / 开发版 info（官方 app.isPackaged 分支）
+        // ⚠️ opencode V2 的 --log-level 只接受**小写**取值
+        // （all|trace|debug|info|warn|warning|error|fatal|none）；
+        // 传大写 "INFO"/"WARN" 会被 effect/cli 判为非法值并直接报错退出，
+        // 导致 WSL 路径的 opencode serve 根本起不来（stdout 永远等不到监听 URL）。
         format!(
             "exec {} --print-logs --log-level {} serve --hostname 0.0.0.0 --port {}",
             wsl_runtime::shell_escape(&opencode_path),
-            if cfg!(debug_assertions) { "INFO" } else { "WARN" },
+            if cfg!(debug_assertions) { "info" } else { "warn" },
             port
         ),
```

### 2.2 遵守的边界

- ✅ **`opencode.rs` 未改动**（`git status` 证实：仅 `wsl_commands.rs` 被修改）。它只 spawn `["serve"]`，不带参数，无此问题。
- ✅ **`OPENCODE_SERVER_USERNAME` 保留**（`wsl_commands.rs:915` 原样未动），符合迁移文档 §1.3③「保留是安全的」。
- ✅ 未改任何 `src/` 下业务代码，未 commit / push / reset / checkout。

### 2.3 验证（CLI 层面，实测）

| 场景                                  | 结果                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--log-level INFO`（改前 debug 值）   | ❌ 退出码 **1**，stderr：`~effect/cli/CliError/InvalidValue: Invalid value for flag --log-level: "INFO". Expected: "all" \| "trace" \| ... \| "none"` |
| `--log-level WARN`（改前 release 值） | ❌ 退出码 **1**，同样报错（仅值不同）                                                                                                                 |
| `--log-level info`（改后 debug 值）   | ✅ 正常启动，stdout：`server listening on http://127.0.0.1:4097`，`/api/info` → 200                                                                   |
| `--log-level warn`（改后 release 值） | ✅ 正常启动，stdout：`server listening on http://127.0.0.1:4101`，`/api/info` → 200                                                                   |

### 2.4 未验证事项（如实说明）

- ⚠️ **Rust 未编译验证**：`src-tauri/target/` 不存在（从未构建过），全量 `cargo check` 需要拉取整套 Tauri 依赖树，
  在 12G 内存约束下代价大且耗时长，故**未执行**。
  判断依据：本次改动仅为 **2 个字符串字面量**（`"INFO"`→`"info"`、`"WARN"`→`"warn"`）+ 注释，不涉及类型/借用/控制流，编译风险极低。
- ⚠️ **WSL 真实路径未跑**：容器内没有 WSL。已验证的是「CLI 是否接受该参数值」这一**根因**，
  而不是「WSL 里整条启动链路能通」。后者需在 Windows 桌面环境下回归。

---

## 3. 任务 3：端到端冒烟

### 3.1 启动

```bash
OPENCODE_SERVER_PASSWORD=test123 opencode --print-logs --log-level info serve --hostname 127.0.0.1 --port 4097
```

- **stdout 打印**：✅ `server listening on http://127.0.0.1:4097`（与迁移文档 §10.2 描述一致）
- 端口按任务要求用 **4097**（容器内另有常驻服务占着 4096，pid 8，全程未打扰）

### 3.2 逐项 curl 结果

基准地址 `http://127.0.0.1:4097`。

#### ① `GET /api/info`（带凭证 `opencode:test123`）→ 预期 200 + JSON

```
HTTP/1.1 200 OK
content-type: application/json
content-length: 97

{"version":"2.0.19","pid":68513,"urls":["http://127.0.0.1:4097"],"paths":{"tmp":"/tmp/opencode"}}
```

✅ **通过**。注意响应**没有 `healthy` 字段**（与迁移文档 §4.1 描述一致），后续健康检查不能靠它判活。

#### ② `GET /api/info`（无凭证）→ 预期 401

```
HTTP/1.1 401 Unauthorized
www-authenticate: Basic realm="Secure Area"
content-type: application/json
content-length: 64

{"_tag":"UnauthorizedError","message":"Authentication required"}
```

✅ **通过**。与迁移文档附录 B 记录完全一致（含 `www-authenticate` 头）。

#### ③ `GET /global/health`（带凭证）→ 确认 V1 端点已失效

```
HTTP/1.1 200 OK                    ← ⚠️ 注意：是 200，不是 404
content-type: text/html
transfer-encoding: chunked

<!doctype html>
<html lang="en" ...>
  <title>OpenCode</title>
  ...（完整的 SPA 首页 HTML）...
</html>
```

✅ **确认 V1 端点已失效** —— 返回的是 SPA 兜底页面而非 `{healthy, version}` JSON。
⚠️ **但状态码是 `200` 而不是 `404`**，这一细节对判断"谁会坏"很关键，见 §5 第 3 条。

#### ④ `GET /api/location`（带凭证）→ 预期 `{directory, project:{...}}`

```
HTTP/1.1 200 OK
content-type: application/json
content-length: 163

{"directory":"/tmp/opencode/smoke","project":{"id":"d1892a84326cadabd9f919e9affd0922d9510e89","directory":"/tmp/opencode/smoke","canonical":"/tmp/opencode/smoke"}}
```

✅ **通过**，形状与预期一致。

#### ⑤ 补充：`GET /api/health`（V1 的另一个健康端点，Rust 健康检查的第一顺位）

```
HTTP/1.1 404 Not Found          （带凭证时）
HTTP/1.1 401 Unauthorized       （不带凭证时——鉴权中间件先于路由生效）
```

✅ 确认 `404`（**这个才是 404**，与 `/global/health` 的 200 形成对比）。

### 3.3 `parse_listening_url()`（`opencode.rs:139`）兼容性验证

验证方式：**把该函数逐字照抄**到 `/tmp/opencode/urlcheck/` 的一个独立 Rust 小程序里编译运行
（唯一改动：`reqwest::Url` → `url::Url`，二者是同一个类型，`reqwest` 只是 re-export `url::Url`），
喂入**实测抓到的真实 stdout/stderr 行**：

```
"server listening on http://127.0.0.1:4097"              =>  Some("http://127.0.0.1:4097")   ✅
"server listening on http://127.0.0.1:4098"              =>  Some("http://127.0.0.1:4098")   ✅
"server listening on http://0.0.0.0:4096"                =>  Some("http://127.0.0.1:4096")   ✅（0.0.0.0 归一化生效）
"INFO server listening on http://127.0.0.1:4097"         =>  Some("http://127.0.0.1:4097")   ✅（前缀干扰不影响）
[真实 stderr 日志行]                                       =>  None                          ✅（不会误判）
```

✅ **结论：`parse_listening_url()` 能正确解析 V2 的 stdout 格式**，与迁移文档 §10.2 一致。

> 补充：Rust 侧把 stdout 与 stderr **合并进同一个 channel**（`opencode.rs:112-118`），
> 所以需要确认 stderr 里不会出现 `http://` 造成误判。实测带 `--print-logs` 的 stderr 中
> `grep -c "http://"` = **0**，`grep "listening"` = **无** → 合并安全。

### 3.4 stdout / stderr 日志分离记录

| 场景                                                                       | stderr 行数                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 带 `--print-logs`，刚启动（未发请求）                                      | **0**                                                          |
| 带 `--print-logs`，发 3 个 `GET /api/info`（成功 200）                     | **0**（新增 0）                                                |
| 带 `--print-logs`，发 3 个 `GET /api/location`（首次，触发 location 启动） | **27**                                                         |
| 带 `--print-logs`，location 预热后再发 3 个请求                            | **0**（新增 0）                                                |
| 带 `--print-logs`，发 3 个**无凭证**请求（401）                            | **+3**（每请求 1 行 `Sent HTTP response ... http.status=401`） |
| **不带** `--print-logs`，发 3 个请求                                       | **0** ✅                                                       |

✅ **核心结论成立**：日志走 stderr、**不污染 stdout**（stdout 只有那行监听 URL）；
不带 `--print-logs` 时 stderr 为 0 行。
⚠️ 但日志**行数的量级与迁移文档描述不符**，详见 §5 第 5 条。

stderr 日志格式示例：

```
timestamp=2026-09-29T16:30:59.777Z level=INFO run=18218ba4 message="watcher subscribe" path=/tmp type=entries ignores=0 http.span=75 role=server
timestamp=2026-09-29T16:31:15.458Z level=INFO run=18218ba4 message="Sent HTTP response" http.span=0 role=server http.method=GET http.url=/api/info http.status=401
```

---

## 4. 任务 4：§10.4 剩余项结论

### 4.1 已关闭：`directory` vs `location[directory]` 逐端点核对

**核对方法**（三重交叉，全部指定 tag `v2.0.19`，未读 HEAD）：

1. **源码**：`git -C /home/coder/project/opencode show v2.0.19:packages/protocol/src/groups/*.ts`
   —— 逐个端点读 `query:` / `payload:` 的 schema 定义。
2. **机器生成的契约**：`git show v2.0.19:packages/protocol/openapi.json`（113 paths / 136 operations），
   按参数的 `style: deepObject` 判定。
3. **中间件挂载**：`packages/protocol/src/api.ts` 的 `makeApiFromGroup`，确认每个组用哪个 location 中间件。

**交叉校验结果**：源码 136 个 operation 与 openapi.json **完全一致**（`:param` 与 `{param}` 仅记法差异），
另加 spec 未收录的 2 个 pairing 端点 = **138 个端点**。

#### 结论

| 目录参数写法                          | 端点数量 | 说明                                      |
| ------------------------------------- | -------: | ----------------------------------------- |
| `?location[directory]=`（deepObject） |   **57** | location 作用域端点的标准写法             |
| `?directory=`（裸参数）               |    **1** | **仅** `GET /api/session`（session 列表） |
| 无任何目录参数                        |   **80** | 含全部 session 作用域端点 + 服务级端点    |
| **合计**                              |  **138** |                                           |

**四条关键规则**：

1. **裸 `directory` 只有 1 个端点**：`GET /api/session`（`SessionsQuery`，`directory` 与 `project`+`subpath` 是互斥的两种筛选方式）。
2. **其余 location 作用域端点一律用 `?location[directory]=`**（deepObject），共 57 个。
3. **`/api/session/:sessionID/*` 这类 session 作用域端点完全不需要目录参数** ——
   location 由 **session 行本身**决定（`SessionLocationMiddleware` → `sessionInfo()` → `instances.provide(session)`）。
   这对阶段 1/2 很省事：V1 里给这些调用硬塞 `directory` 的做法可以直接删掉。
4. **`x-opencode-directory` 请求头在 v2.0.19 仍然有效**（优先级：`location[directory]` > 该请求头 > `process.cwd()`），
   依据 `packages/server/src/location.ts:40-47` 的 `requestRef()`。**这一点与迁移文档 §3.3 相悖，见 §5 第 1 条。**

**补充实测**：裸 `directory` 传给 location 作用域端点会被**静默忽略**（不报错、不 400）：

```
GET /api/location                         → directory = /tmp/opencode/smoke   (cwd)
GET /api/location?directory=/tmp          → directory = /tmp/opencode/smoke   (被忽略！)
GET /api/location?location[directory]=/tmp→ directory = /tmp
```

⚠️ 这意味着**迁移期参数写错不会立刻报错**，而是静默回落到 `process.cwd()`，容易造成"看起来正常但数据不对"的隐蔽 bug。
建议阶段 1 在 `directoryUtils.ts` 改造时配一个断言/日志。

### 4.2 仍未关闭的项

§10.4 共 11 条，10 条已 ✅，本次关闭 1 条（`directory` vs `location[directory]`）。**剩 1 条仍未关闭**：

| 项                                                           | 状态         | 原因                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ❗ `@opencode/client` 的 `subscribe()` 在 Tauri 环境下的表现 | **仍未验证** | 该问题**无法靠读源码回答**：它取决于 Tauri `plugin-http` 的流式（streaming）行为与 WebView 的 `ReadableStream` 支持，必须在真实 Tauri 运行时里跑。且阶段 0 的授权范围不含引入 `@opencode/client`（那是阶段 1 的事），故留到阶段 1。 |

> 另外，§10.4 之外仍标 ❗ 的还有：§10.1（`@opencode/client` 在浏览器/Tauri 下的流式表现）、
> §10.5（Docker 锁版本、三形态回归）。这些按迁移文档归属阶段 1/3/4，不在阶段 0 范围。

---

## 5. 🔴 与文档预测不符之处（本节最重要）

### ① `x-opencode-directory` 请求头在 V2 **仍然有效**（文档 §3.3 说法不准确）

**文档原文**（§3.3 表格）：`请求头 | x-opencode-directory | 变为 location 对象`

**实际情况**：该请求头**在 v2.0.19 里依然被读取**，是 `location[directory]` 之后的第二优先级。

- 源码依据 `packages/server/src/location.ts:40-47`：

  ```ts
  export function requestRef(request: HttpServerRequest.HttpServerRequest): Location.Ref {
    const query = new URL(request.url, 'http://localhost').searchParams
    const directory =
      query.get('location[directory]') ||
      (request.headers['x-opencode-directory'] ? decode(request.headers['x-opencode-directory']) : process.cwd())
    return Location.Ref.make({ directory: AbsolutePath.make(directory) })
  }
  ```

- **实测依据**（对运行中的 V2 服务）：

  ```
  GET /api/location                                   → {"directory":"/tmp/opencode/smoke", ...}   (cwd)
  GET /api/location   -H "x-opencode-directory: /tmp/opencode"
                                                      → {"directory":"/tmp/opencode", ...}        ✅ 头生效
  GET /api/location?location[directory]=/tmp          → {"directory":"/tmp", ...}
  ```

**影响（正面）**：阶段 1 中 `src/utils/directoryUtils.ts` 的改造量**可能远小于文档预估** ——
现有基于请求头的 `formatPathForApi()` 逻辑对 57 个 location 作用域端点**可以继续工作**。
是否要用新的 `location[directory]` 写法，可以按"更贴近官方 SDK 生成代码"的偏好来定，而不是被逼着改。

### ② 依赖不一致造成的坏调用是 **2 处**，文档只列了 1 处（§2.3）

文档只列 `src/api/pty.ts:50` 的 `sdk.pty.shells()`；实际还有：

```
src/store/childSessionStore.ts(83,22): error TS2339: Property 'agent' does not exist on type 'Session'.
```

→ 1.4.1 下**子会话（subtask）创建链路**在类型层面同样是坏的。虽然修依赖后两者都自愈，
但这条说明「1.4.1 的损坏面比文档记录的大」，可作为阶段 3 排查 subtask 相关功能时的背景信息。

### ③ `/global/health` 返回 **200 + HTML**，不是 404 —— 因此 Rust 健康检查会**假阳性**（文档 §1.3② 只覆盖了前端）

**文档原文**（§1.3②）：`→ 健康检查会拿到 HTML SPA 页面而非 {healthy, version} JSON，解析必然失败，界面会认为服务挂了。`

**实际分两条链路，结论相反**：

| 链路     | 代码位置                                                                              | 判活依据                                       | V2 下的实际行为                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **前端** | `src/store/serverStore.ts:643`（打 `/global/health`）→ `:678-691` 检查 `content-type` | 必须 `application/json`                        | ✅ **文档成立**：拿到 `text/html` → `status: 'error'`，提示 "Server returned HTML instead of OpenCode health JSON" → 界面显示服务异常      |
| **Rust** | `opencode.rs:42-76` `is_service_running_with_auth()`                                  | **只看 HTTP 状态码** `r.status().is_success()` | ❌ **文档不成立**：`/api/health` → 401/404（非 2xx）→ 继续试 `/global/health` → **200** → `is_success()` = **true** → **返回"服务在运行"** |

**这带来两个反直觉后果**：

1. Rust 侧**不会**因为 V2 而判活失败（歪打正着地返回 `true`），所以
   `start_opencode_service`（`opencode.rs:309/351`）的"服务已就绪"判定**不会被挡住**，桌面路径仍能起来。
   → 文档"健康检查解析必然失败"的说法**只对前端成立**。
2. 但它同时也**失去了校验能力**：以前能验证 `{healthy:true, version}`，现在只要**任何** HTTP 服务在该路径返回 200 就算"健康"。
   → §9.3 里"改为单一 `GET /api/info`"的整改**仍然必要**，而且**优先级比文档暗示的更高**（它是静默失效，不是显式报错）。

### ④ openapi 计数差异（115/247 vs 113/245）可**精确定位**到 2 个端点（文档仅注"计数差异"）

**文档原文**（文首计数说明）：`本机 v2.0.19 二进制导出的权威 openapi 为 115 路径 / 247 schema，比 docs 站点快照多 2 条；端点逐一核对全部通过，仅计数差异，不影响结论。`

**实际原因已查明**：差的 2 条正是 **ServerGroup 的 pairing 端点**：

| 差异项             | 内容                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| 多出的 2 条路径    | `POST /api/pair`（`server.pair`）、`GET /auth/connect/{code}`（`server.connect`） |
| 多出的 2 个 schema | `PairingCode`、`PairingSession`                                                   |

证据链：

1. `packages/protocol/src/groups/server.ts`（tag `v2.0.19`）里这两个端点**存在**，但
   仓库内提交的 `packages/protocol/openapi.json` 里**没有**（`'/api/pair' in spec.paths === false`，
   且该 spec 中**没有任何非 `/api` 开头的 path**）。
2. 该 spec 的 245 个 schema 中也**不含** `PairingCode` / `PairingSession` → 245 + 2 = **247**，113 + 2 = **115**，**严丝合缝**。
3. 为什么 spec 缺？—— `openapi.json` 最后一次更新是 `53179daefa`，而这两个端点由 `eccf0b3b7b`
   （"feat(server): pair with one-time connect links (#50970)"）加入，且已验证 `53179daefa` 是 `eccf0b3b7b` 的**祖先**。
   → **tag 里提交的 openapi.json 是过期的（生成后未随 pairing 功能重新生成）。**

**影响**：结论不变（不影响任何端点的判定），但**阶段 1 用 openapi.json 做代码生成/对照时要当心这 2 条缺失**；
同时说明「docs 站点快照 = 仓库里的 openapi.json = 113/245」三者一致，而**二进制才是权威的 115/247**。

### ⑤ §10.2 的 stderr 行数描述不准确（"发 3 个请求 → stderr 3 行"）

**文档原文**（§10.2）：`实测：带它发 3 个请求 → stderr 3 行；不带 → 0 行`

**实测真实行为**（见 §3.4 表）：

- 成功的请求（200）→ **0 行**（不是每请求 1 行）
- **401 的请求 → 每请求 1 行**（`message="Sent HTTP response" ... http.status=401`）
- **首个 location 作用域请求 → 约 27 行**（watcher/event 启动噪音，一次性）
- location 预热后 → 又是 0 行

→ 文档的 "3 行" 最可能来自**3 个鉴权失败（401）的请求**；把它当作"每请求 1 行"的通用规律会误判。
**真正要记住的结论不变**：`--print-logs` 让日志走 **stderr**，stdout 干净，不带则为 0 行。

### ⑥ 阶段 0 预期产出的「类型报错清单」实际为空

文档 §8 阶段 0 把"确认 `sdk.pty.shells()` 缺失导致的当前故障状态"列为待办，隐含预期是能捞出一批类型错误。
实际：**修好依赖后 `tsc` 零报错**。后续阶段**不能**依赖类型检查来发现需要改造的调用点，
必须按 §4 的端点对照表逐个手工迁移。

### ⑦ `npm install` 无需改动 `package.json` / `package-lock.json`

任务描述把这两个文件列为"允许改"，但实际上 `package-lock.json` 早已正确锁定 `1.16.0`，
`node_modules` 只是**没按 lock 安装**。所以本次修复**零仓库文件改动**（只有 `wsl_commands.rs` 一处）。

### ⑧ 新增发现：目录参数写错是**静默失效**，不会报错

（文档未提及）裸 `directory` 传给 location 作用域端点会被**静默忽略**并回落到 `process.cwd()`，HTTP 仍是 200。
迁移期这类错误不会暴露，建议阶段 1 显式加日志/断言。详见 §4.1 末的实测记录。

---

## 6. 未做 / 未验证事项（如实汇报）

| 项                                                  | 状态      | 原因                                                                            |
| --------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| Rust 侧编译验证（`cargo check`）                    | ❌ 未做   | 无 `target/` 目录，全量构建代价大；改动仅为 2 个字符串字面量，风险极低          |
| WSL 真实链路回归                                    | ❌ 未做   | 容器内无 WSL，仅验证了 CLI 层参数取值这一根因                                   |
| `npm test`（vitest）                                | ✅ 已跑   | 见 §1.4：96 文件 / 667 用例全绿（用 `vitest run`，因 `npm test` 是 watch 模式） |
| `@opencode/client` 的 `subscribe()` 在 Tauri 下表现 | ❌ 未验证 | 需真实 Tauri 运行时；属阶段 1 范围                                              |
| Docker 锁版本 / 三形态回归（§10.5）                 | ❌ 未做   | 属阶段 3/4 范围                                                                 |

**清理说明**：冒烟测试启动的 4 个临时服务（端口 4097 / 4098 / 4100 / 4101 / 4103）**已全部停止**；
容器内原有的 4096 常驻服务（pid 8）**全程未受影响**。

---

## 附录 A：逐端点全表（`directory` vs `location[directory]`）

> 数据来源：`packages/protocol/openapi.json`（tag `v2.0.19`，已验证与源码 136 operation 一致）
>
> - `packages/protocol/src/api.ts` 的中间件挂载 + 补录 spec 缺失的 2 个 pairing 端点。
>   已验证 spec 与源码 136 个 operation 完全一致（`:param` 与 `{param}` 仅记法差异）。

### 结论汇总

| 写法                                  | 端点数量 |
| ------------------------------------- | -------: |
| `?location[directory]=`（deepObject） |   **57** |
| `?directory=`（裸参数）               |    **1** |
| 无目录参数                            |   **80** |
| 合计                                  |  **138** |

### 关键结论

1. **裸 `directory` 只有 1 个端点**：`GET /api/session`（session 列表）。
2. **`location[directory]` 是绝大多数 location 作用域端点的写法**，共 57 个。
3. **session 作用域端点（`/api/session/:sessionID/*`）不需要任何目录参数** —— location 由 session 行决定（`SessionLocationMiddleware`）。
4. **`x-opencode-directory` 请求头在 v2.0.19 仍然有效**（`packages/server/src/location.ts:40-47`），作为 `location[directory]` 之后的第二优先级，已实测确认。
5. 裸 `directory` 传给 location 作用域端点会被**静默忽略**（实测 `GET /api/location?directory=/tmp` 仍返回 cwd），不报错。

### 全表

| 方法   | 路径                                                                  | 端点 ID                                        | 组            | 作用域                                                                              | 目录参数写法          | query 参数                                                          |
| ------ | --------------------------------------------------------------------- | ---------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| GET    | `/api/agent`                                                          | agent.list                                     | agent         | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/agent/{agentID}`                                                | agent.get                                      | agent         | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/command`                                                        | command.list                                   | command       | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/config`                                                         | config.get                                     | config        | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/config/shell`                                                   | config.shells                                  | config        | locationRef                                                                         | 无                    | —                                                                   |
| DELETE | `/api/credential/{credentialID}`                                      | credential.remove                              | credential    | none（服务级）                                                                      | 无                    | —                                                                   |
| PATCH  | `/api/credential/{credentialID}`                                      | credential.update                              | credential    | none（服务级）                                                                      | 无                    | —                                                                   |
| POST   | `/api/credential/{credentialID}/activate`                             | credential.activate                            | credential    | none（服务级）                                                                      | 无                    | —                                                                   |
| DELETE | `/api/debug/location`                                                 | debug.location.evict                           | debug         | locationRef（handler 内 requestRef）                                                | `location[directory]` | location                                                            |
| GET    | `/api/debug/location`                                                 | debug.location.list                            | debug         | locationRef（handler 内 requestRef）                                                | 无                    | —                                                                   |
| GET    | `/api/event`                                                          | event.subscribe                                | event         | none（服务级全量）                                                                  | 无                    | —                                                                   |
| PATCH  | `/api/experimental/config`                                            | experimental.config.update                     | config        | locationRef                                                                         | 无                    | —                                                                   |
| POST   | `/api/experimental/fs/write`                                          | experimental.fs.write                          | filesystem    | locationRef                                                                         | `location[directory]` | location, path                                                      |
| POST   | `/api/experimental/generate`                                          | experimental.generate.text                     | generate      | none（服务级）                                                                      | 无                    | —                                                                   |
| POST   | `/api/experimental/integration/wellknown`                             | experimental.integration.wellknown.add         | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| DELETE | `/api/experimental/mcp/{server}`                                      | experimental.mcp.remove                        | mcp           | locationRef                                                                         | `location[directory]` | location                                                            |
| PUT    | `/api/experimental/mcp/{server}`                                      | experimental.mcp.add                           | mcp           | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/experimental/mcp/{server}/connect`                              | experimental.mcp.connect                       | mcp           | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/experimental/mcp/{server}/disconnect`                           | experimental.mcp.disconnect                    | mcp           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/experimental/migration/v1`                                      | experimental.migration.v1.status               | migration     | none（服务级）                                                                      | 无                    | —                                                                   |
| DELETE | `/api/experimental/persistent-pty/{ptyID}`                            | server.experimental.persistentPty.remove       | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| GET    | `/api/experimental/persistent-pty/{ptyID}`                            | server.experimental.persistentPty.get          | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| PUT    | `/api/experimental/persistent-pty/{ptyID}`                            | server.experimental.persistentPty.update       | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| GET    | `/api/experimental/persistent-pty/{ptyID}/connect`                    | persistentPty.connect                          | persistentPty | none（服务级）                                                                      | 无                    | cursor, role, attachment_id, takeover, input_protocol, ticket       |
| POST   | `/api/experimental/persistent-pty/{ptyID}/connect-token`              | server.experimental.persistentPty.connectToken | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| GET    | `/api/experimental/persistent-pty/{ptyID}/snapshot`                   | server.experimental.persistentPty.snapshot     | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| POST   | `/api/experimental/persistent-pty/handoff`                            | server.experimental.persistentPty.handoff      | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| POST   | `/api/experimental/persistent-pty/shutdown`                           | server.experimental.persistentPty.shutdown     | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| GET    | `/api/experimental/session/{sessionID}/export`                        | experimental.session.export                    | session       | sessionRef（从 session 行取 location）                                              | 无                    | sanitize                                                            |
| GET    | `/api/experimental/session/{sessionID}/instructions/entries`          | experimental.session.instructions.entry.list   | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| DELETE | `/api/experimental/session/{sessionID}/instructions/entries/{key}`    | experimental.session.instructions.entry.remove | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| PUT    | `/api/experimental/session/{sessionID}/instructions/entries/{key}`    | experimental.session.instructions.entry.put    | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/experimental/session/{sessionID}/log`                           | session.log                                    | session       | sessionRef（从 session 行取 location）                                              | 无                    | after, follow                                                       |
| POST   | `/api/experimental/session/{sessionID}/skill`                         | experimental.session.skill                     | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/experimental/session/{sessionID}/terminal`                      | server.experimental.persistentPty.list         | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| POST   | `/api/experimental/session/{sessionID}/terminal`                      | server.experimental.persistentPty.create       | persistentPty | none（服务级）                                                                      | 无                    | —                                                                   |
| GET    | `/api/experimental/session/{sessionID}/terminal/read`                 | server.experimental.persistentPty.read         | persistentPty | none（服务级）                                                                      | 无                    | lines                                                               |
| POST   | `/api/experimental/session/{sessionID}/wait`                          | experimental.session.wait                      | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/experimental/session/import`                                    | experimental.session.import                    | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/experimental/session/stats`                                     | experimental.session.stats                     | session       | sessionRef（从 session 行取 location）                                              | 无                    | from, to, project, timezone, tools                                  |
| GET    | `/api/form`                                                           | form.list                                      | form          | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/fs/find`                                                        | fs.find                                        | filesystem    | locationRef                                                                         | `location[directory]` | location, query, type, limit                                        |
| GET    | `/api/fs/list`                                                        | fs.list                                        | filesystem    | locationRef                                                                         | `location[directory]` | location, path                                                      |
| GET    | `/api/fs/read/*`                                                      | fs.read                                        | filesystem    | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/info`                                                           | server.info                                    | server        | none（服务级）                                                                      | 无                    | —                                                                   |
| GET    | `/api/integration`                                                    | integration.list                               | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/integration/{integrationID}`                                    | integration.get                                | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/integration/{integrationID}/connect/command`                    | integration.command.connect                    | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| DELETE | `/api/integration/{integrationID}/connect/command/{attemptID}`        | integration.command.cancel                     | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/integration/{integrationID}/connect/command/{attemptID}`        | integration.command.status                     | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/integration/{integrationID}/connect/key`                        | integration.connect.key                        | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/integration/{integrationID}/connect/oauth`                      | integration.oauth.connect                      | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| DELETE | `/api/integration/{integrationID}/connect/oauth/{attemptID}`          | integration.oauth.cancel                       | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/integration/{integrationID}/connect/oauth/{attemptID}`          | integration.oauth.status                       | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/integration/{integrationID}/connect/oauth/{attemptID}/complete` | integration.oauth.complete                     | integration   | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/location`                                                       | location.get                                   | location      | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/location/reload`                                                | location.reload                                | location      | locationRef                                                                         | 无                    | —                                                                   |
| GET    | `/api/mcp`                                                            | mcp.list                                       | mcp           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/mcp/resource`                                                   | mcp.resource.catalog                           | mcp           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/model`                                                          | model.list                                     | model         | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/model/default`                                                  | model.default                                  | model         | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/pair`                                                           | server.pair                                    | server        | none（服务级）                                                                      | 无                    | —                                                                   |
| GET    | `/api/permission/request`                                             | permission.request.list                        | permission    | 混合：/api/permission/_ 走 locationRef；/api/session/:id/permission/_ 走 sessionRef | `location[directory]` | location                                                            |
| GET    | `/api/permission/saved`                                               | permission.saved.list                          | permission    | 混合：/api/permission/_ 走 locationRef；/api/session/:id/permission/_ 走 sessionRef | 无                    | projectID                                                           |
| DELETE | `/api/permission/saved/{id}`                                          | permission.saved.remove                        | permission    | 混合：/api/permission/_ 走 locationRef；/api/session/:id/permission/_ 走 sessionRef | 无                    | —                                                                   |
| GET    | `/api/plugin`                                                         | plugin.list                                    | plugin        | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/plugin/check`                                                   | plugin.check                                   | plugin        | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/plugin/update`                                                  | plugin.update                                  | plugin        | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/project`                                                        | project.list                                   | project       | locationRef                                                                         | 无                    | —                                                                   |
| PATCH  | `/api/project/{projectID}`                                            | project.update                                 | project       | locationRef                                                                         | 无                    | —                                                                   |
| GET    | `/api/provider`                                                       | provider.list                                  | provider      | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/provider/{providerID}`                                          | provider.get                                   | provider      | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/pty`                                                            | pty.list                                       | pty           | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/pty`                                                            | pty.create                                     | pty           | locationRef                                                                         | `location[directory]` | location                                                            |
| DELETE | `/api/pty/{ptyID}`                                                    | pty.remove                                     | pty           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/pty/{ptyID}`                                                    | pty.get                                        | pty           | locationRef                                                                         | `location[directory]` | location                                                            |
| PUT    | `/api/pty/{ptyID}`                                                    | pty.update                                     | pty           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/pty/{ptyID}/connect`                                            | pty.connect                                    | pty           | locationRef                                                                         | 无                    | location[directory], cursor, ticket                                 |
| POST   | `/api/pty/{ptyID}/connect-token`                                      | pty.connect.token                              | pty           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/reference`                                                      | reference.list                                 | reference     | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/rpc/{rpcID}/{method}`                                           | rpc.call                                       | rpc           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/session`                                                        | session.list                                   | session       | sessionRef（从 session 行取 location）                                              | **`directory`（裸）** | limit, order, search, parentID, directory, project, subpath, cursor |
| POST   | `/api/session`                                                        | session.create                                 | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| DELETE | `/api/session/{sessionID}`                                            | session.remove                                 | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}`                                            | session.get                                    | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| PATCH  | `/api/session/{sessionID}`                                            | session.update                                 | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/agent`                                      | session.switchAgent                            | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/background`                                 | session.background                             | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/command`                                    | session.command                                | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/compact`                                    | session.compact                                | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}/context`                                    | session.context                                | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}/diff`                                       | session.diff                                   | session       | sessionRef（从 session 行取 location）                                              | 无                    | from, to, context                                                   |
| PUT    | `/api/session/{sessionID}/environment`                                | session.environment                            | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/fork`                                       | session.fork                                   | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}/form`                                       | session.form.list                              | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/form`                                       | session.form.create                            | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| DELETE | `/api/session/{sessionID}/form/{formID}`                              | session.form.cancel                            | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}/form/{formID}`                              | session.form.get                               | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/form/{formID}/reply`                        | session.form.reply                             | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/generate`                                   | session.generate                               | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}/inbox`                                      | session.inbox.list                             | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| DELETE | `/api/session/{sessionID}/inbox/{inboxID}`                            | session.inbox.cancel                           | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| PATCH  | `/api/session/{sessionID}/inbox/{inboxID}`                            | session.inbox.update                           | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/interrupt`                                  | session.interrupt                              | session       | sessionRef（从 session 行取 location）                                              | 无                    | resume                                                              |
| GET    | `/api/session/{sessionID}/message`                                    | session.message.list                           | session       | sessionRef（从 session 行取 location）                                              | 无                    | limit, order, cursor, type                                          |
| GET    | `/api/session/{sessionID}/message/{messageID}`                        | session.message.get                            | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/model`                                      | session.switchModel                            | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/move`                                       | session.move                                   | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}/permission`                                 | session.permission.list                        | permission    | 混合：/api/permission/_ 走 locationRef；/api/session/:id/permission/_ 走 sessionRef | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/permission`                                 | session.permission.create                      | permission    | 混合：/api/permission/_ 走 locationRef；/api/session/:id/permission/_ 走 sessionRef | 无                    | —                                                                   |
| GET    | `/api/session/{sessionID}/permission/{requestID}`                     | session.permission.get                         | permission    | 混合：/api/permission/_ 走 locationRef；/api/session/:id/permission/_ 走 sessionRef | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/permission/{requestID}/reply`               | session.permission.reply                       | permission    | 混合：/api/permission/_ 走 locationRef；/api/session/:id/permission/_ 走 sessionRef | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/prompt`                                     | session.prompt                                 | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| DELETE | `/api/session/{sessionID}/revert`                                     | session.revert.clear                           | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/revert/commit`                              | session.revert.commit                          | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/revert/stage`                               | session.revert.stage                           | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/shell`                                      | session.shell                                  | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/synthetic`                                  | session.synthetic                              | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| POST   | `/api/session/{sessionID}/view`                                       | session.view                                   | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/session/active`                                                 | session.active                                 | session       | sessionRef（从 session 行取 location）                                              | 无                    | —                                                                   |
| GET    | `/api/shell`                                                          | shell.list                                     | shell         | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/shell`                                                          | shell.create                                   | shell         | locationRef                                                                         | `location[directory]` | location                                                            |
| DELETE | `/api/shell/{id}`                                                     | shell.remove                                   | shell         | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/shell/{id}`                                                     | shell.get                                      | shell         | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/shell/{id}/output`                                              | shell.output                                   | shell         | locationRef                                                                         | `location[directory]` | location, cursor, limit                                             |
| GET    | `/api/skill`                                                          | skill.list                                     | skill         | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/vcs`                                                            | vcs.get                                        | vcs           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/vcs/base`                                                       | vcs.base                                       | vcs           | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/vcs/branch`                                                     | vcs.branch.list                                | vcs           | locationRef                                                                         | `location[directory]` | location, search, limit                                             |
| GET    | `/api/vcs/diff`                                                       | vcs.diff                                       | vcs           | locationRef                                                                         | `location[directory]` | location, mode, base, context                                       |
| GET    | `/api/vcs/status`                                                     | vcs.status                                     | vcs           | locationRef                                                                         | `location[directory]` | location                                                            |
| POST   | `/api/websearch`                                                      | websearch.query                                | websearch     | locationRef                                                                         | `location[directory]` | location                                                            |
| GET    | `/api/websearch/provider`                                             | websearch.providers                            | websearch     | locationRef                                                                         | `location[directory]` | location                                                            |
| DELETE | `/api/worktree`                                                       | worktree.remove                                | worktree      | none（用 projectID）                                                                | 无                    | —                                                                   |
| GET    | `/api/worktree`                                                       | worktree.list                                  | worktree      | none（用 projectID）                                                                | 无                    | projectID                                                           |
| POST   | `/api/worktree`                                                       | worktree.create                                | worktree      | none（用 projectID）                                                                | 无                    | —                                                                   |
| POST   | `/api/worktree/refresh`                                               | worktree.refresh                               | worktree      | none（用 projectID）                                                                | 无                    | —                                                                   |
| GET    | `/auth/connect/{code}`                                                | server.connect                                 | server        | none（服务级）                                                                      | 无                    | —                                                                   |
