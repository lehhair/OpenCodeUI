# OpenCodeUI 迁移 V2 —— 阶段 0.5 报告（换 SDK + 迁移端点）

> 状态：**已完成**
> 执行环境：容器内 Linux，opencode `v2.0.19`（`/home/coder/.opencode/bin/opencode`），OpenCodeUI `0.6.46`
> 参照文档：`docs/opencode-v2-migration.md`（下文简称「迁移文档」）
> 日期：2026-09-30
> 命名说明：本报告文件名沿用任务要求（`phase0.5`）。它对应迁移文档 §8 的**阶段 1**
> （换 SDK + 迁移端点），不是「阶段 0 的补充」。

## 结论摘要

| 任务                    | 结果                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **1. 目录定位策略实测** | 🔴 **结论 B —— 头不够**，但缺口**只有 1 个端点**（`GET /api/session`，且它只认裸 `directory`）<br>已回填到迁移文档 §3.3 |
| 2. 换客户端包           | ✅ `@opencode-ai/sdk ^1.16.0` → **`@opencode/client` 精确锁定 `2.0.19`**；20 个文件的 import 路径已改                   |
| 3. 端点迁移             | ✅ 21 个真实 SDK 调用点已迁移（含健康检查）；**58 处**未迁移功能改为**显式报错**而非静默失败                            |
| 4. 类型检查             | ✅ **零报错**（换包后曾 **336 条** → 适配类型层后 **95 条** → 迁移完 **0 条**）                                         |
| 4. 单元测试             | ✅ 全绿（**97 文件 / 683 用例**，比阶段 0 的 96/667 **多 1 文件 16 用例**）                                             |
| 4. 冒烟（真实服务）     | ✅ **12/12 通过** —— 会话列表 / 模型列表 / 配置读取三条验收标准全部达成                                                 |
| 5. 与文档不符           | ⚠️ 共 **10 处**，其中 **2 处会改变阶段 3 的做法**（见 §5 第 1、2 条）                                                   |

**阶段 1 产出（迁移文档 §8 的验收标准）**：✅ 会话列表、✅ 模型列表、✅ 配置读取 —— 均已在真实 V2 服务上跑通。

---

## 1. 任务 1：目录定位策略实测（最重要）

> 原始记录：`/tmp/opencode/v2test/TASK1-EVIDENCE.md`（含逐条 curl 输出）

### 1.1 实测设置

```
服务：cd /tmp/opencode/v2test/cwd && OPENCODE_SERVER_PASSWORD=t1 \
      opencode --log-level info serve --hostname 127.0.0.1 --port 4097
服务进程 cwd = /tmp/opencode/v2test/cwd
凭证：opencode:t1
```

夹具（三个目录，互相可区分）：

| 目录   | `opencode.json`                  | `.opencode/` 下的探针                                         |
| ------ | -------------------------------- | ------------------------------------------------------------- |
| `dirA` | `{"username":"MARK_FROM_DIR_A"}` | `agent/probe-a.md`、`command/probe-a.md`、`skill/probe-dirA/` |
| `dirB` | `{"username":"MARK_FROM_DIR_B"}` | `agent/probe-b.md`、`command/probe-b.md`、`skill/probe-dirB/` |
| `cwd`  | （无）                           | （无）                                                        |

> 📌 夹具最初用的是 `{"theme": ...}`，但实测**拿不到** —— 见 §5 第 4 条。
> 改用 V2 schema 里真实存在的 `username` 才生效。

### 1.2 逐项实测结果

#### `GET /api/config`（locationRef 作用域）→ 用返回的 `Config.Entry[].path` 判定

| 方式                                                              | 返回的文档条目                                                                    | 结论          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------- |
| a) 只带 `x-opencode-directory: %2Ftmp%2Fopencode%2Fv2test%2FdirA` | 全局 jsonc + `~/.config/opencode` + **`/tmp/opencode/v2test/dirA/opencode.json`** | ✅ **头生效** |
| b) 只带 `?location[directory]=/tmp/opencode/v2test/dirB`          | 全局 jsonc + `~/.config/opencode` + **`/tmp/opencode/v2test/dirB/opencode.json`** | ✅ 参数生效   |
| c) 都不带                                                         | 只有全局两条（cwd 下无 `opencode.json`）                                          | ✅ 回落 cwd   |

#### `GET /api/agent` / `GET /api/command` / `GET /api/skill`（locationRef 作用域）→ 用探针文件判定

| 方式                                | `/api/agent`     | `/api/command`   | `/api/skill`        |
| ----------------------------------- | ---------------- | ---------------- | ------------------- |
| a) 只带请求头(dirA)                 | 只多出 `probe-a` | 只多出 `probe-a` | 只多出 `probe-dirA` |
| b) 只带 `location[directory]`(dirB) | 只多出 `probe-b` | 只多出 `probe-b` | 只多出 `probe-dirB` |
| c) 都不带                           | 两者都没有       | 两者都没有       | 两者都没有          |

→ ✅ **头足够**（与阶段 0 的判断一致）

#### 🔴 `GET /api/session`（会话列表）→ 头**不够**

数据准备：dirA 1 个会话、dirB 1 个会话、cwd 2 个会话，另有本机其它项目的历史会话。

| 方式                                                  | 返回内容                                                |
| ----------------------------------------------------- | ------------------------------------------------------- |
| a) 只带请求头(dirA)                                   | ❌ **未过滤** —— 返回**全局 20+ 条、跨 6 个项目**的会话 |
| b) 只带 `?location[directory]=dirB`                   | ❌ **未过滤** —— 同上                                   |
| **b2) 只带裸 `?directory=/tmp/opencode/v2test/dirB`** | ✅ **正确过滤** —— 只返回 dirB 的那 1 条                |
| c) 都不带                                             | ❌ **未过滤** —— 返回全局所有会话                       |
| d) 请求头(dirA) + 裸 `directory`(dirB) 同时带         | ✅ 裸 `directory` 胜出，只返回 dirB                     |

**源码依据**（tag `v2.0.19`）：

- `packages/server/src/handlers/session.ts:62-72` —— 把 `ctx.query` 原样交给 `session.list()`
- `packages/core/src/session/store.ts:105` —— 只在 `"directory" in input` 时才
  `eq(SessionTable.directory, input.directory)`
- 该端点的 query schema（`SessionsQuery`，`packages/protocol/src/groups/session.ts:165`）
  **只有裸 `directory`**，没有 `location[directory]`
  → 头和 deepObject 参数都被**静默丢弃**

> ⚠️ 后果比「没过滤」更严重：不带 `directory` 时会返回**跨全部项目**的会话列表，
> 属于**跨目录数据泄露 + 列表错乱**，而且**不报错、不 4xx**。

#### session 作用域端点（`/api/session/{id}/*`）→ 与目录无关

| 请求                                                 | 返回的 location                                   |
| ---------------------------------------------------- | ------------------------------------------------- |
| `GET /api/session/{B}` 不带目录信息                  | `/tmp/opencode/v2test/dirB`                       |
| `GET /api/session/{B}` 带**冲突**请求头（指向 dirA） | `/tmp/opencode/v2test/dirB`（头被忽略，结果正确） |
| `GET /api/session/{B}/message` 带 / 不带冲突头       | 两次返回**完全相同**                              |

→ location 取自 **session 行本身**，请求里的目录信息**不应传、传了也被忽略**。

### 1.3 🎯 结论：**结论 B（头不够）**，但缺口只有 1 个端点

| 端点类别                                                                                                                                     | 请求头够吗  | 阶段 1 的处理                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| **locationRef 作用域（57 个）**：`/api/config`、`/api/agent`、`/api/skill`、`/api/command`、`/api/location`、`/api/model`、`/api/provider` … | ✅ **够**   | 但实现上**改为显式传 `location[directory]`**（见下方说明）                    |
| **`GET /api/session`（会话列表）**                                                                                                           | ❌ **不够** | 必须显式传**裸 `directory`** → `src/api/v2Convert.ts` 的 `sessionDirectory()` |
| **session 作用域（`/api/session/{id}/*`）**                                                                                                  | 不适用      | **不传任何目录信息**（V1 里硬塞 `directory` 的做法已删除）                    |

**为什么「头够」却仍然选择显式传参数？**

虽然结论是 B（有例外），但阶段 1 对 locationRef 端点统一采用了**显式传 `location[directory]`**，理由：

1. 这正是**官方生成客户端自己用的方式** —— `@opencode/client` 的 `appendQuery()`
   会把 `{location:{directory}}` 摊平成 `location[directory]=`；
2. 显式参数在**抓包 / 日志 / 断点**里可核对，请求头是隐式的、容易漏看；
3. 请求头在 `OpenCode.make({ headers })` 里是 **client 级**配置 —— 目录一变就得重建 client，
   而按调用传参天然支持「一个 client 打多个目录」；
4. 代码里可以直接加开发期告警（见下），请求头方式反而不好加断言。

> 实现：`src/api/v2Convert.ts` 的 `locationInput()` / `sessionDirectory()`。

### 1.4 🔴 额外发现：`POST /api/session` 忽略请求头**和**中间件（阶段 3 会踩）

`packages/server/src/handlers/session.ts:136`：

```ts
location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) },
```

- **既不看 location 中间件，也不看 `x-opencode-directory` 请求头**，只认 **body 里的 `location`**
- 实测：`POST /api/session` 只带 `x-opencode-directory: .../dirA` →
  建出来的会话 `location.directory` = **服务进程 cwd**，`projectID` 也是 cwd 项目的，**且不报错**
- 必须显式在 body 里写 `{"location":{"directory":"..."}}` 才会落在目标目录

→ 已写进 `src/api/session.ts` 的 `createSession()` 占位错误信息，阶段 3 实现时不会再踩。

### 1.5 目录写错的防护（任务要求的「断言或开发期日志」）

`src/api/v2Convert.ts` 里所有构造目录入参的函数，在目录缺失时都会在**开发环境**打印告警：

```
[OpenCode V2] GET /api/config 未指定目录（serverId=活动服务器）。服务端会回落到它自己的
process.cwd()，可能导致「选了 A 目录却读到 B 目录」而不报错。
```

- 用 `import.meta.env.DEV` 判断 → **生产构建里会被 tree-shake 掉**，不产生运行时噪音
- 冒烟测试里已实测触发（见 §4.3 第 ⑤ 项的 stderr）

### 1.6 已回填到迁移文档

`docs/opencode-v2-migration.md` §3.3 已新增小节
**「🔴 阶段 1 实测结论（2026-09-30）：结论 B —— 头不够，但缺口只有 1 个端点」**，
含上表 + 三条结论 + `POST /api/session` 陷阱。

---

## 2. 任务 2：换客户端包

### 2.1 依赖变更

```diff
  "dependencies": {
-   "@opencode-ai/sdk": "^1.16.0",
+   "@opencode/client": "2.0.19",
```

- **精确锁定 `2.0.19`（不带 `^`）**：客户端与服务端是**协议同版本**的生成代码，
  用 caret 范围可能在下次 `npm install` 时拉到 2.1.x 而静默不兼容
- `npm install` 结果：`added 10 packages, and audited 504 packages`
- 传递依赖变化：

| 新增                                                                                              | 说明                                                |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@opencode/schema` / `@opencode/protocol` `2.0.19`                                                | `@opencode/client` 的直接依赖                       |
| `effect` `4.0.0-rc.112`                                                                           | `@opencode/protocol` 的依赖（peer 标记为 optional） |
| `fast-check` / `pure-rand` / `msgpackr` / `msgpackr-extract` / `node-gyp-build-optional-packages` | `effect` 的依赖                                     |
| `@msgpackr-extract/*` × 6                                                                         | 平台二进制（可选依赖）                              |

| 移除               | 说明   |
| ------------------ | ------ |
| `@opencode-ai/sdk` | 被替换 |

**✅ 已验证 `effect` 不会进浏览器 bundle**：
`@opencode/client` 的 **promise 入口**（`dist/promise/index.js`）只引用
`gc472t4a → h9cy5hnk / frbwqjmf / 1tbj6z39` 这几个 chunk；
含 `effect` 的 chunk（`0fn08bwv`、`qonqb2tyr` 等）**不在 promise 入口的引用链上**
（它们服务于 `./effect` 与 `./solid` 子入口）。
实测 `vite build` 成功，主 bundle 里搜 `effect/unstable` **0 命中**。

> ⚠️ 但那 10 个包**会装进 `node_modules`**（约多占磁盘）。这是 `@opencode/client` 的固有代价。

### 2.2 import 路径改动清单（20 个文件）

统一替换：`'@opencode-ai/sdk/v2/client'` → `'@opencode/client'`

| #   | 文件                          | 改后来源                                                                    |
| --- | ----------------------------- | --------------------------------------------------------------------------- |
| 1   | `src/api/global.ts`           | `@opencode/client`（后来改为 V2 原生 `ServerInfo`）                         |
| 2   | `src/api/lsp.ts`              | `../types/api/v1Model`（V2 无此类型）                                       |
| 3   | `src/api/sdk.test.ts`         | `@opencode/client`（同时改 mock：`createOpencodeClient` → `OpenCode.make`） |
| 4   | `src/api/todo.ts`             | `../types/api/v1Model`（V2 无 `Todo`）                                      |
| 5   | `src/types/api/agent.ts`      | `./v1Model`                                                                 |
| 6   | `src/types/api/common.ts`     | `./v1Model`                                                                 |
| 7   | `src/types/api/config.ts`     | `./v1Model`                                                                 |
| 8   | `src/types/api/event.ts`      | `./v1Model`                                                                 |
| 9   | `src/types/api/file.ts`       | `./v1Model`                                                                 |
| 10  | `src/types/api/mcp.ts`        | `./v1Model`                                                                 |
| 11  | `src/types/api/message.ts`    | `./v1Model`                                                                 |
| 12  | `src/types/api/model.ts`      | `./v1Model`                                                                 |
| 13  | `src/types/api/permission.ts` | `./v1Model`                                                                 |
| 14  | `src/types/api/project.ts`    | `./v1Model`                                                                 |
| 15  | `src/types/api/pty.ts`        | `./v1Model`                                                                 |
| 16  | `src/types/api/session.ts`    | `./v1Model`                                                                 |
| 17  | `src/types/api/skill.ts`      | `./v1Model`                                                                 |
| 18  | `src/types/api/tool.ts`       | `./v1Model`                                                                 |
| 19  | `src/types/api/vcs.ts`        | `./v1Model`                                                                 |
| 20  | `src/types/api/worktree.ts`   | `./v1Model`                                                                 |

**为什么不是「自动跟随」**（与迁移文档 §1.2 的预判一致）：
旧 import 路径里的 `v2` 指 **SDK 自身第二代**，打的仍是 **V1 端点**；
而新包的 `@opencode/client` 的 102 个类型名里**只有 12 个与旧包同名**，
其余 90 个（消息 / Part / 事件 / question / todo / tool / lsp / formatter …）**V2 已整体删除**。

### 2.3 `src/api/sdk.ts` 重写

| 项         | 改前                                             | 改后                                                     |
| ---------- | ------------------------------------------------ | -------------------------------------------------------- |
| 包         | `@opencode-ai/sdk`                               | `@opencode/client`                                       |
| 工厂       | `createOpencodeClient({...})`                    | `OpenCode.make({ baseUrl, headers, fetch })`             |
| 返回类型   | `OpencodeClient`                                 | `OpenCodeClient`（= `ReturnType<typeof OpenCode.make>`） |
| 返回值约定 | `{data, error, request, response}` 需 `unwrap()` | **直接返回数据**，失败直接 throw（`ClientError`）        |
| `unwrap()` | 必需                                             | **已删除**（V2 不再有 envelope）                         |

**保留的两项能力**：

1. **Tauri `plugin-http` fetch**（绕 CORS）—— 原样保留，含：
   - 懒加载 + 缓存（`getTauriFetch()`）
   - **代次（generation）防串扰**：`abortInFlightApiRequests()` 会让旧 client 的新请求立刻抛 `AbortError`
   - `trackedFetch()` 把外部 `AbortSignal` 与内部 `AbortController` 串起来
2. **Basic Auth** —— 🔴 **用户名改为固定 `opencode`**（新增 `makeOpencodeBasicAuthHeader(password)`）

**为什么用户名要固定**：V2 服务端把用户名**硬编码为 `"opencode"`**
（`packages/server/src/auth.ts:20`），`OPENCODE_SERVER_USERNAME` 在 v2.0.19 中**零读取处**。
实测：`custom:pw` → 401、`opencode:pw` → 200。
所以 `sdk.ts` 现在**忽略** `serverStore` 里存的 `auth.username`。
（`serverStore.makeBasicAuthHeader()` 保留未动，因为它是对外导出的 API；健康检查已改用新函数。）

### 2.4 运行时验证

```bash
node -e "import('@opencode/client').then(m => console.log(typeof m.OpenCode.make))"
# → function
```

✅ **不需要 `solid-js`、也不需要手动安装 `effect`** 即可 `import` 主入口（promise 版）。
（阶段 0 遗留的 ❗「`@opencode/client` 在 Tauri 下的流式表现」**仍属阶段 2** —— 本次只用到 promise 方法，未用 `event.subscribe()`。）

---

## 3. 任务 3：端点迁移

### 3.1 总览

| 类别                           |   数量 | 说明                                                                                         |
| ------------------------------ | -----: | -------------------------------------------------------------------------------------------- |
| **真实 SDK 调用点（已迁移）**  | **21** | 打的是 V2 端点                                                                               |
| **未迁移功能（显式报错占位）** | **58** | 调用即抛「阶段 3 待办」错误，**不静默**                                                      |
| 纯函数（不碰 SDK，原样保留）   |      4 | `extractUserMessageContent`、`getPtyConnectUrl`、`createSseTextParser`、`normalizeTodoItems` |

> 阶段 3 的待办清单可直接 `grep -rn "notMigratedYet" src/api/` 得到。

### 3.2 端点迁移对照表（迁移文档 §4 逐行 → 实际改动位置）

> 图例：✅ 已迁移（打 V2 端点）｜⛔ 显式报错占位（阶段 2/3）｜➖ V2 已删除且无替代

#### §4.1 服务与事件

| 功能         | V1                                              | V2                          | 阶段 1 处理                                 | 位置                                                                                                       |
| ------------ | ----------------------------------------------- | --------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **健康检查** | `GET /global/health`（Rust 先试 `/api/health`） | `GET /api/info`             | ✅                                          | `src/api/global.ts:31`<br>`src-tauri/.../opencode.rs:66`（Rust）<br>`src/store/serverStore.ts:676`（前端） |
| 事件流       | `GET /global/event`                             | `GET /api/event`            | ⛔ 阶段 2（`src/api/events.ts` **未改动**） | —                                                                                                          |
| 断开实例     | `POST /global/dispose`、`/instance/dispose`     | ➖ 删除                     | ⛔                                          | `src/api/global.ts:40`、`:53`                                                                              |
| 当前路径     | `GET /path`                                     | `GET /api/location`         | ✅                                          | `src/api/client.ts:174`（`getPath`）、`:187`（`getLocation`）                                              |
| 重载配置     | —                                               | `POST /api/location/reload` | ➖ 未接入（YAGNI）                          | —                                                                                                          |

#### §4.2 会话

| 功能                                           | V1                                | V2                                         | 阶段 1 处理                       | 位置                             |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------ | --------------------------------- | -------------------------------- |
| **列表**                                       | `GET /session`                    | `GET /api/session`                         | ✅ **（裸 `directory`！）**       | `src/api/session.ts:103`         |
| **详情**                                       | `GET /session/{id}`               | `GET /api/session/{id}`                    | ✅                                | `src/api/session.ts:119`         |
| 创建                                           | `POST /session`                   | `POST /api/session`                        | ⛔（body 必须带 `location`）      | `src/api/session.ts:138`         |
| 更新                                           | `PATCH /session/{id}`             | `PATCH /api/session/{id}`                  | ⛔                                | `src/api/session.ts:159`         |
| 删除                                           | `DELETE /session/{id}`            | `DELETE /api/session/{id}`                 | ⛔                                | `src/api/session.ts:178`         |
| **会话状态**                                   | `GET /session/status`             | `GET /api/session/active`                  | ✅（语义变为「只列活跃」）        | `src/api/session.ts:45`          |
| 拉消息                                         | `GET /session/{id}/message`       | `GET /api/session/{id}/message`            | ⛔ 阶段 2（返回 `{data,cursor}`） | `src/api/message.ts:68`          |
| **发消息**                                     | `POST /session/{id}/message`      | `POST /api/session/{id}/prompt`            | ⛔ 阶段 2                         | `src/api/message.ts:160`         |
| **异步发消息**                                 | `POST /session/{id}/prompt_async` | ➖ 删除（prompt 本身非阻塞）               | ⛔                                | `src/api/message.ts:181`         |
| 阻塞等待                                       | —                                 | `POST /api/experimental/session/{id}/wait` | ➖ 未接入                         | —                                |
| 把阻塞工具转后台                               | —                                 | `POST /api/session/{id}/background`        | ➖ 未接入                         | —                                |
| **停止生成**                                   | `POST /session/{id}/abort`        | `POST /api/session/{id}/interrupt`         | ⛔                                | `src/api/session.ts:195`         |
| 拷贝                                           | `POST /session/{id}/fork`         | `POST /api/session/{id}/fork`              | ⛔                                | `src/api/session.ts:267`         |
| **回退**                                       | `POST /session/{id}/revert`       | 三段式 stage/commit/clear                  | ⛔                                | `src/api/session.ts:208`         |
| 取消回退                                       | `POST /session/{id}/unrevert`     | ➖ 删除                                    | ⛔                                | `src/api/session.ts:228`         |
| **分享**                                       | `POST/DELETE /session/{id}/share` | ➖ 删除                                    | ⛔                                | `src/api/session.ts:241`、`:254` |
| **摘要**                                       | `POST /session/{id}/summarize`    | ➖ 删除（用 `/compact`）                   | ⛔                                | `src/api/session.ts:286`         |
| **子会话**                                     | `GET /session/{id}/children`      | ➖ 删除（用 `?parentID=`）                 | ⛔                                | `src/api/session.ts:306`         |
| **待办**                                       | `GET /session/{id}/todo`          | ➖ 删除                                    | ⛔                                | `src/api/session.ts:328`         |
| diff                                           | `GET /session/{id}/diff`          | `GET /api/session/{id}/diff`               | ✅（字段完全兼容）                | `src/api/session.ts:61`          |
| 新增（切 agent/model/move/view/context/inbox） | —                                 | 若干                                       | ➖ 未接入（YAGNI）                | —                                |

#### §4.3 权限与提问

| 功能         | V1                                     | V2                                | 阶段 1 处理 | 位置                                      |
| ------------ | -------------------------------------- | --------------------------------- | ----------- | ----------------------------------------- |
| 权限列表     | `GET /permission`                      | `GET /api/permission/request`     | ⛔          | `src/api/permission.ts:31`                |
| 权限回复     | `POST /session/{id}/permissions/{pid}` | `POST .../permission/{rid}/reply` | ⛔          | `src/api/permission.ts:48`                |
| **回答提问** | `GET /question` + reply/reject         | ➖ 删除 → **Form 表单体系**       | ⛔          | `src/api/permission.ts:74`、`:92`、`:110` |
| 待处理表单   | —                                      | `GET /api/form`                   | ➖ 未接入   | —                                         |

#### §4.4 模型、配置、项目

| 功能                  | V1                           | V2                                         | 阶段 1 处理                              | 位置                    |
| --------------------- | ---------------------------- | ------------------------------------------ | ---------------------------------------- | ----------------------- |
| **读配置**            | `GET /config`                | `GET /api/config`（返回 `Config.Entry[]`） | ✅（按优先级合并）                       | `src/api/config.ts:85`  |
| 读全局配置            | `GET /global/config`         | ➖ 无独立端点                              | ✅（从 Entry[] 里筛出非项目文档）        | `src/api/config.ts:101` |
| 改（location 级）配置 | `PATCH /config`              | ➖ **不存在**                              | ⛔                                       | `src/api/config.ts:119` |
| 改全局配置            | `PATCH /global/config`       | `PATCH /api/experimental/config`           | ⛔ **（只支持 `shell`，见 §5 第 2 条）** | `src/api/config.ts:137` |
| **模型列表**          | `GET /config/providers`      | `GET /api/model` + `/api/provider`         | ✅（前端 join）                          | `src/api/client.ts:50`  |
| 默认模型              | 同上 `default` 字段          | `GET /api/model/default`                   | ✅（形状变化，见 §5 第 5 条）            | `src/api/client.ts:65`  |
| Provider 列表         | 同上                         | `GET /api/provider`                        | ✅                                       | `src/api/client.ts:50`  |
| **可用 shell**        | `GET /pty/shells`            | `GET /api/config/shell`                    | ✅（类型完全一致）                       | `src/api/pty.ts:61`     |
| **Agent 列表**        | `GET /agent`                 | `GET /api/agent`                           | ✅                                       | `src/api/agent.ts:16`   |
| **Skill 列表**        | `GET /skill`                 | `GET /api/skill`                           | ✅                                       | `src/api/skill.ts:16`   |
| **命令列表**          | `GET /command`               | `GET /api/command`                         | ✅                                       | `src/api/command.ts:57` |
| 执行命令              | `POST /session/{id}/command` | `POST /api/session/{id}/command`           | ⛔（body 形态变了）                      | `src/api/command.ts:87` |
| **项目列表**          | `GET /project`               | `GET /api/project`                         | ✅（去掉 directory 参数）                | `src/api/client.ts:109` |
| **当前项目/目录**     | `GET /project/current`       | `GET /api/location`                        | ✅（+ 补查 project.list）                | `src/api/client.ts:87`  |
| 初始化 git            | `POST /project/git/init`     | ➖ 删除                                    | ⛔                                       | `src/api/client.ts:122` |
| 更新项目              | `PATCH /project/{id}`        | `PATCH /api/project/{id}`                  | ⛔                                       | `src/api/client.ts:137` |
| **LSP 状态**          | `GET /lsp`                   | ➖ **删除**                                | ⛔                                       | `src/api/lsp.ts:29`     |
| **格式化器状态**      | `GET /formatter`             | ➖ **删除**                                | ⛔                                       | `src/api/lsp.ts:46`     |

#### §4.5 文件与搜索

| 功能           | V1                  | V2                              | 阶段 1 处理  | 位置                 |
| -------------- | ------------------- | ------------------------------- | ------------ | -------------------- |
| 列目录         | `GET /file`         | `GET /api/fs/list`              | ⛔           | `src/api/file.ts:45` |
| 读文件         | `GET /file/content` | `GET /api/fs/read/*`            | ⛔           | `src/api/file.ts:62` |
| 文件改动状态   | `GET /file/status`  | ➖ 删除（用 `/api/vcs/status`） | ⛔           | `src/api/file.ts:74` |
| 内容搜索       | `GET /find`         | ➖ **无端点**                   | ⛔（待决策） | `src/api/file.ts:99` |
| **文件名搜索** | `GET /find/file`    | `GET /api/fs/find`              | ⛔           | `src/api/file.ts:24` |
| **符号搜索**   | `GET /find/symbol`  | ➖ 删除                         | ⛔           | `src/api/file.ts:86` |

#### §4.6 终端 PTY

| 功能       | V1                     | V2                                  | 阶段 1 处理 | 位置                                                                         |
| ---------- | ---------------------- | ----------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| 列表       | `GET /pty`             | `GET /api/pty`                      | ⛔          | `src/api/pty.ts:42`                                                          |
| 创建       | `POST /pty`            | `POST /api/pty`                     | ⛔          | `src/api/pty.ts:70`                                                          |
| 详情       | `GET /pty/{id}`        | `GET /api/pty/{id}`                 | ⛔          | `src/api/pty.ts:82`                                                          |
| 更新       | `PATCH /pty/{id}`      | **`PUT /api/pty/{id}`**             | ⛔          | `src/api/pty.ts:94`                                                          |
| 删除       | `DELETE /pty/{id}`     | `DELETE /api/pty/{id}`              | ⛔          | `src/api/pty.ts:112`                                                         |
| 连接       | `WS /pty/{id}/connect` | **两步**（connect-token → connect） | ⛔          | `src/api/pty.ts:136`（`getPtyConnectUrl` 保留但**V2 下连不上**，已注释说明） |
| **shells** | `GET /pty/shells`      | `GET /api/config/shell`             | ✅          | `src/api/pty.ts:61`                                                          |

#### §4.7 MCP、VCS、Worktree

| 功能                    | V1                                  | V2                                | 阶段 1 处理 | 位置                                        |
| ----------------------- | ----------------------------------- | --------------------------------- | ----------- | ------------------------------------------- |
| MCP 列表                | `GET /mcp`                          | `GET /api/mcp`                    | ⛔          | `src/api/mcp.ts:24`                         |
| MCP 资源                | `GET /experimental/resource`        | `GET /api/mcp/resource`           | ⛔          | `src/api/mcp.ts:37`                         |
| 增删 / 连接 / 断开      | `POST /mcp` 等                      | `/api/experimental/mcp/{server}`  | ⛔          | `src/api/mcp.ts:49`、`:63`、`:75`           |
| **MCP OAuth（4 端点）** | `/mcp/{name}/auth*`                 | ➖ 删除 → `/api/integration/*`    | ⛔          | `src/api/mcp.ts:88`、`:101`、`:113`、`:125` |
| VCS 信息 / diff         | `GET /vcs`、`/vcs/diff`             | `GET /api/vcs`、`/api/vcs/diff`   | ⛔          | `src/api/vcs.ts:22`、`:35`                  |
| Worktree 列表/新建/删除 | `/experimental/worktree`            | `/api/worktree`（改用 projectID） | ⛔          | `src/api/worktree.ts:23`、`:36`、`:48`      |
| Worktree 重置           | `POST /experimental/worktree/reset` | ➖ 删除                           | ⛔          | `src/api/worktree.ts:60`                    |

#### §4.8 工具、插件、调试

| 功能                                                 | V1                             | V2                              | 阶段 1 处理        | 位置                        |
| ---------------------------------------------------- | ------------------------------ | ------------------------------- | ------------------ | --------------------------- |
| 工具列表                                             | `GET /experimental/tool[/ids]` | ➖ 删除（用 `GET /api/plugin`） | ⛔                 | `src/api/tool.ts:22`、`:34` |
| 插件 / 调试 / 迁移状态 / 网页搜索 / Shell / 插件 RPC | —                              | 新增                            | ➖ 未接入（YAGNI） | —                           |

### 3.3 类型层适配（`src/types/api/*`）

这是本次改动**最容易被低估**的一块。结论：**类型层必须从「转发层」变成「定义层」**。

**问题**：`src/types/api/*` 原本 16 个文件几乎全是 `export type X = SDKX` 的**转发**。
换包后旧包的 102 个类型名里**只剩 12 个**在新包中存在（`Project`、`Pty`、`UnknownError`、
`McpResource`、`VcsInfo`、`PermissionRequest`、`WorktreeCreateInput/RemoveInput`、`SessionStatus`、
`McpStatusConnected/Disabled/Failed/NeedsAuth`），其余 **90 个 V2 已整体删除**。

**而下游的 UI / store / 渲染层仍然按 V1 模型编写，且阶段 1 禁止改动它们**
→ 唯一出路是**让类型层自给自足**。

**做法**：新增 `src/types/api/v1Model.ts`（**3286 行 / 189 个声明**）

- 用脚本从 `@opencode-ai/sdk@1.16.0` 的 `dist/v2/gen/types.gen.d.ts` 里
  **按「项目实际引用的 102 个类型名 + 传递闭包」逐字抽取**（未手写、未改写形状）
- 文件头有醒目的中文说明：**这是阶段 1 的临时兼容层，阶段 2/3 完成迁移后应整体删除**
- 各 `src/types/api/*.ts` 的 import 从 `@opencode/client` 改为 `./v1Model`

**效果**：类型错误从 **336 → 95**（一次性消掉 241 条，含 `FileExplorer.tsx` 的 23 条、
`QuestionDialog.tsx` 的 14 条等**全部下游渲染组件报错**，实现了「渲染层零改动」）。

**新增的转换层**：`src/api/v2Convert.ts`（V2 响应 → 内部 V1 形状）

| 函数                           | 作用                                               | 关键差异                                                                          |
| ------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `locationInput()`              | 构造 `{location:{directory}}`                      | 缺目录时开发期告警                                                                |
| `sessionDirectory()`           | 构造**裸 `directory`**                             | 🔴 `GET /api/session` 专用                                                        |
| `toInternalSession()`          | `Session.Info` → `Session`                         | `directory` → **`location.directory`**；`slug`/`version`/`summary`/`share` 已删除 |
| `toInternalSessionStatusMap()` | `/api/session/active` → `SessionStatusMap`         | 语义变为「只列活跃」，缺失补 `idle`                                               |
| `toInternalAgent()`            | `Agent.Info` → `Agent`                             | `permissions`→`permission`、`system`→`prompt`；**权限规则模型整个换了，填 `[]`**  |
| `toInternalSkill()`            | `Skill.Info` → `Skill`                             | `path` → `location`                                                               |
| `toInternalProject()`          | `Project` → `Project`                              | **`canonical` → `worktree`**                                                      |
| `toUiModelInfos()`             | `Model.Info[]` + `Provider.Info[]` → `ModelInfo[]` | 两个平铺列表 join；`capabilities.input: string[]` → 4 个布尔                      |

### 3.4 未迁移项为什么用「显式报错」而不是留着编译错误

新增 `src/api/notMigrated.ts`：

```ts
notMigratedYet('创建会话（POST /session）', 'POST /api/session', '⚠️ 必须把目录写进 body 的 location 字段…')
// → throw new Error('[OpenCode V2 迁移 · 阶段 3 待办] 创建会话… 尚未迁移到 OpenCode V2。\nV2 替代方案：…')
```

**理由**：

1. **类型检查必须通过**（阶段 1 验收要求），但 58 处功能确实没迁移
2. **不能假装能用**：如果为了编译而 `as any`，运行时会静默 404 或拿到错数据
3. **不能只是删掉**：删掉会让调用方直接 `undefined is not a function`，且丢失「这里曾经有什么功能」
4. **显式抛错** → 编译过、失败**大声**、且**待办清单可 grep**
   （`grep -rn "notMigratedYet" src/api/`）

每条占位错误都写明了：**功能名** + **V2 替代端点** + **本次调用的实际参数**（便于复现）。

### 3.5 健康检查改造（一并完成）

#### 改前的问题：**静默假阳性**

| 链路                             | 改前逻辑                                                                             | V2 下的实际行为                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rust**（`opencode.rs:42-76`）  | 先试 `/api/health`，再试 `/global/health`，**只看状态码** `is_success()`             | `/api/health` → 404（非 2xx）→ 继续；`/global/health` → **200 + SPA 兜底 HTML** → `is_success()` = **true** → **判「服务健康」**<br>🔴 于是**任何**在该路径返回 200 的 HTTP 服务都算「opencode 健康」，**校验能力归零且不报错** |
| **前端**（`serverStore.ts:643`） | 打 `/global/health`，检查 `content-type: application/json` + `data.healthy === true` | 拿到 `text/html` → `status:'error'` → 界面显示服务异常                                                                                                                                                                          |

#### 改后：单一 `GET /api/info` + **结构校验**

**Rust**（`src-tauri/src/app/commands/opencode.rs`）：

```rust
let response = client.get(format!("{}/api/info", base)) ... .send().await?;
if !response.status().is_success() { return false; }
// 关键：不能只看状态码
serde_json::from_str::<serde_json::Value>(&body).map(|v| is_opencode_info_body(&v))
```

`is_opencode_info_body()` 判据（与前端**同一套**）：
`version` 是非空字符串 + `pid` 是数字 + `urls` 是数组。

> 📌 实现细节：Cargo.toml 里 `reqwest` 关了默认特性、**没启用 `json` feature**，
> 所以用 `response.text()` + `serde_json::from_str` 手动解析，**零额外依赖**。

**前端**（`src/store/serverStore.ts`）：

- `checkHealth()` 端点：`${server.url}/global/health` → **`${server.url}/api/info`**（第 676 行）
- 新增 `isOpencodeInfoResponse()`，替换原来的 `data.healthy !== true` 判断
- **删除了 `healthy` 字段依赖** —— V2 的 `/api/info` 没有这个字段

**UI（3 处 version 展示 + 1 处诊断文案）**：

| 位置                                                         | 内容                                                               | 是否需改                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------- |
| `src/features/settings/components/ServerHealthButton.tsx:20` | `· OpenCode v${health.version}`                                    | ✅ **无需改** —— `/api/info` 仍有 `version` |
| `src/features/chat/sidebar/MultiServerFolderList.tsx:229`    | `· v${health.version}`                                             | ✅ **无需改**                               |
| `src/features/chat/sidebar/SearchResults.tsx:232`            | `· v${health.version}`                                             | ✅ **无需改**                               |
| `src/features/chat/ChatPane.tsx:371`                         | 硬编码 `'Expected /global/health to return OpenCode health JSON.'` | ✅ **已改为 `/api/info`**                   |

> ⚠️ **透明说明**：`ChatPane.tsx` 属于聊天/渲染组件。这次只改了**1 行、且是健康检查的诊断文案**，
> 依据是任务允许的「健康检查相关（…、对应 UI）」。如果认为越界，**单独 revert 这一行即可**，
> 不影响其它任何改动（它只是错误提示里的一句话）。

**新增/更新的测试**（`src/store/serverStore.test.ts`，+4 用例）：

1. ✅ V2 `/api/info` 响应 → `online`，`version` 正确
2. ✅ **请求的 URL 是 `/api/info`**，且不含 `global/health`
3. ✅ **旧 V1 形状 `{healthy:true,version}` 现在被拒绝**（防止回退）
4. ✅ 非 OpenCode JSON（`{ok:true}`）仍被拒绝

### 3.6 阶段 1 未做（按任务边界，属阶段 3）

写操作一律未迁移：创建/更新/删除会话、发消息、中止、回退、权限回复、PTY 增删改、MCP 增删、
worktree 增删、配置文件写入（`updateGlobalConfig` 的 `shell` 以外字段）。
原因：任务明确「**只做 GET/读取类**，写操作和删除项留到阶段 3」。

---

## 4. 任务 4：验证

### 4.1 类型检查

```bash
npx tsc -b --force     # 退出码 0，零报错
```

**三个快照**（完整清单见附录 A / B）：

| 快照  | 状态                                                    |  错误数 |
| ----- | ------------------------------------------------------- | ------: |
| **A** | 换包 + 改 import 路径 + 重写 `sdk.ts`，**类型层未适配** | **336** |
| **B** | 再适配 `src/types/api/*`（引入 `v1Model.ts`）           |  **95** |
| **C** | 端点迁移完成后（最终）                                  |   **0** |

### 4.2 单元测试

```bash
timeout 180 npm run test:run     # = vitest run（npm test 是 watch 模式，非交互环境下会挂住）
```

```
Test Files  97 passed (97)
     Tests  683 passed (683)
  Duration  17.54s
```

- 基线（阶段 0）：96 文件 / 667 用例
- 现在：**97 文件 / 683 用例**（+1 文件 = 新增冒烟套件；+16 用例 = 4 条健康检查 + 12 条冒烟）
- **服务不可达时**（把临时服务停掉后复跑）：
  ```
  Test Files  96 passed | 1 skipped (97)
       Tests  671 passed | 12 skipped (683)
  ```
  → 671 = 667（阶段 0 基线）+ 4（新增健康检查用例）✅；冒烟套件整体跳过，**不会让 `npm test` 变红**

### 4.3 冒烟测试（真实 V2 服务 + 真实迁移代码）

`src/api/phase1Smoke.test.ts` —— 12 项全部通过。**不是 mock**：打的是真实运行的 `opencode v2.0.19`。

| #   | 验证项                           | 实测结果                                                                                            |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| ①   | 健康检查走 `/api/info`           | `{"version":"2.0.19","pid":76002,"urls":["http://127.0.0.1:4097"],"paths":{"tmp":"/tmp/opencode"}}` |
| ②   | **会话列表按目录过滤**           | dirA → `PAYLOAD_A@…/dirA`；dirB → `PAYLOAD_B@…/dirB`（**两条互不相同**）                            |
| ③   | 会话详情 location 正确           | `ses_f11f1f19affed5wRJII4fsEl4e /tmp/opencode/v2test/dirB PAYLOAD_B`                                |
| ④   | **模型列表**                     | 15 个模型，`providerName` 来自 `/api/provider` 的 join（未退化为 providerID）                       |
| ⑤   | **配置读取按目录合并**           | dirA → `username=MARK_FROM_DIR_A`；dirB → `MARK_FROM_DIR_B`；不带目录 → 无标记（回落 cwd）          |
| ⑥   | Agent 列表按目录过滤             | dirA 含 `probe-a` 不含 `probe-b`；dirB 反之                                                         |
| ⑦   | Skill 列表按目录过滤             | dirA 含 `probe-dirA`；dirB 含 `probe-dirB`                                                          |
| ⑧   | 命令列表按目录过滤               | dirA 含 `probe-a`；dirB 含 `probe-b`                                                                |
| ⑨   | 当前项目 / 路径                  | `worktree=/tmp/opencode/v2test/dirA`（V2 `canonical` 正确映射）；项目总数 44                        |
| ⑩   | Shell 列表走 `/api/config/shell` | 9 个 shell，`{path,name,acceptable}` 结构正确                                                       |
| ⑪   | 会话状态走 `/api/session/active` | `{}`（当前无活跃会话）                                                                              |
| ⑫   | **未迁移功能显式报错**           | `searchText` / `getSessionTodos` 均抛「阶段 3 待办」错误，**不静默**                                |

**复现方式**（已写进测试文件头部注释）：

```bash
mkdir -p /tmp/opencode/v2test/{cwd,dirA,dirB}
echo '{ "username": "MARK_FROM_DIR_A" }' > /tmp/opencode/v2test/dirA/opencode.json
echo '{ "username": "MARK_FROM_DIR_B" }' > /tmp/opencode/v2test/dirB/opencode.json
# …（agent/command/skill 探针见文件头）
cd /tmp/opencode/v2test/cwd && \
  OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097
npx vitest run src/api/phase1Smoke.test.ts --reporter=verbose
```

### 4.4 其它检查

| 检查                                  | 结果                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx eslint <我改动的文件>`           | ✅ 零告警                                                                                                                                                                          |
| `npx prettier --check <我改动的文件>` | ✅ 全部符合                                                                                                                                                                        |
| `npm run format:check`（全仓库）      | ⚠️ **失败，但属既有问题** —— 报告 160 个文件格式不符，**其中包含大量我从未触碰的文件**（`src/store/themeStore.ts`、`vite.config.ts` 等）。已逐一验证：**我改动的文件全部是干净的** |
| `npx vite build`                      | ✅ 成功；主 bundle **不含 `effect`**（`effect/unstable` 0 命中）                                                                                                                   |
| `cargo check`（Rust）                 | ❌ **未执行** —— 见 §6                                                                                                                                                             |

---

## 5. 🔴 与文档预测不符之处（本节最重要）

### ① 🔴 `GET /api/session` 只认裸 `directory`，头和 `location[directory]` 都被**静默忽略**（文档 §3.3 未覆盖）

**文档原文**（§3.3）：

> **组合结论**：参数全可选 + 请求头是第二优先级回退 ⇒ **带 `x-opencode-directory` 头即可定位目录，端点参数可基本不传**。

**实际**：这条对 **57 个 locationRef 端点成立**，但 **`GET /api/session` 是例外**：

| 方式                       | 结果                                   |
| -------------------------- | -------------------------------------- |
| 只带请求头                 | ❌ 被忽略 → **返回全局所有项目的会话** |
| 只带 `location[directory]` | ❌ 被忽略 → 同上                       |
| 只带**裸 `directory`**     | ✅ 正确过滤                            |

**影响**：这是本次唯一**必须显式补参数**的端点，且失败方式是「**静默返回跨项目数据**」而非报错
→ 若按文档「参数可基本不传」实现，会出现「会话列表混进别的项目」这种极难排查的 bug。
已回填 §3.3，并在 `src/api/v2Convert.ts` 里用 `sessionDirectory()` 单独处理。

**⚠️ 一个重要的补充（实现时才发现）**：「不带 `directory`」**本身是合法用法** ——
多服务器模式的全局搜索（`SearchResults.tsx:121`）就是要跨目录搜整个服务器。
所以 `sessionDirectory()` **不能抛错**，只能记一条开发期提示。
这也意味着**这个端点无法用断言防呆**，只能靠日志 + code review。
→ 阶段 3 若改动会话列表相关调用，请特别留意**目录是否漏传**。

### ② 🔴 V2 **没有**「写任意配置字段」的 API —— 配置编辑器的保存功能无法迁移（文档 §4.4 判断错误）

**文档原文**（§4.4）：

> | **配置编辑器** | 用 `updateConfig` + `updateGlobalConfig` | ✅ 有对应端点 | UI 实际用的是 `updateGlobalConfig` → **可迁移** |

**实际**：`PATCH /api/experimental/config` 的 payload 类型是 `Config.Patch`，而
`packages/schema/src/config.ts:112`（tag `v2.0.19`）里它**只有一个字段**：

```ts
export const Patch = Schema.Struct({ shell: Schema.NullOr(Schema.String) })
```

→ **V2 唯一能写的配置字段是 `shell`**。配置编辑器（`ConfigSettings.tsx:272` 调 `updateGlobalConfig`）
的**保存功能无法迁移**，只能：
① 保留读 + 改 `shell`；② 其余字段改为只读展示并引导用户直接编辑配置文件。

**阶段 1 的处理**：`src/api/config.ts:137` 的 `updateGlobalConfig()` 只在 patch **仅含 `shell`** 时放行，
其余字段一律**显式报错并列出不支持哪些字段**，避免「以为保存了其实被静默忽略」。
文档 §4.4 对应行已修正。

### ③ `GET /api/config` 的 `Config.Entry.info` 是 **schema 归一化后的视图**，未知字段被**静默丢弃**

**文档原文**（§3.4）：

> 配置文件本身 V2 **能读 V1 格式并自动归一化**（不重写源文件），所以**用户配置不用改**。

**实际**：这句话对**已知字段**成立，但 `GET /api/config` 返回的 `info` **不是原始文档**，
而是**过了 V2 schema 的归一化结果** —— schema 里没有的字段**直接消失**。

**实测**：夹具里写 `{"theme": "THEME_FROM_DIR_A"}` → API 返回的该条目 `info` 是 **`{}`**（空对象）。
换成 V2 schema 里存在的 `username` 才拿得到值。

**影响**：

- 配置编辑器通过 API 读到的是**有损视图**，用户在文件里手写的未知/旧字段在界面上「看不见」
- 阶段 1 的冒烟测试就因此**先失败了一次**（用 `theme` 做标记拿不到），换 `username` 后通过
- 阶段 3 适配配置编辑器时必须考虑这一点（否则会出现「界面上没有 = 会被覆盖掉」的风险）

### ④ 文档 §3.3 说「请求头仍然有效」是对的，但**没提它和中间件是两套东西**

`POST /api/session`（创建会话）的 handler 是
`ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) }`
（`packages/server/src/handlers/session.ts:136`）—— 它**既不看中间件也不看请求头**，
只认 **body 里的 `location`**。

**实测**：只带 `x-opencode-directory: .../dirA` 创建会话 → 建出来的会话在**服务进程 cwd**，
`projectID` 也是 cwd 项目的，**且不报错**。

→ 属阶段 3，但**提前记录**避免届时踩坑（已写进 `createSession()` 的占位错误信息）。

### ⑤ `GET /api/model/default` 只返回**单个**模型，不是「每个 provider 的默认模型」映射

**文档原文**（§4.4）：

> | 模型列表 | `GET /config/providers` | **`GET /api/model`** + `GET /api/model/default` | |

**实际**：

- V1 `config.providers()` 的 `default` 字段是 **`{ [providerID]: modelID }` 映射**
- V2 `GET /api/model/default` 返回 `{ location, data: ModelInfo | null }` —— **单个模型**

→ 阶段 1 把单个默认模型包装成「只含一个键」的映射以保持内部 `Record<string,string>` 约定
（`src/api/client.ts:65`）。该函数当前**全仓库无调用点**，属保留接口。

### ⑥ `GET /api/session/active` 的语义是「**只列活跃会话**」，不是 V1 的「全量状态表」

**文档原文**（§4.2）：

> | **会话状态** | `GET /session/status` | **`GET /api/session/active`** | 返回 `SessionActive` |

**实际**：V1 的 `/session/status` 返回 **全部会话**的状态（4 态：`idle`/`busy`/`retry`/…）；
V2 的 `/api/session/active` **只返回活跃的那些**（`{type:'running'}`），**不在表里 = 空闲**。

→ 阶段 1 在 `toInternalSessionStatusMap()` 里把缺失的会话补成 `idle`，让下游判断逻辑不变。
文档没写这个语义差异，属**文档缺口**。

### ⑦ `GET /path` → `GET /api/location` 有**字段缺失**，文档未提示

**文档原文**（§4.1）：

> | 当前路径 | `GET /path` | **`GET /api/location`** | |

**实际**：

|                          | 字段                                                   |
| ------------------------ | ------------------------------------------------------ |
| V1 `Path`                | `{ home, state, config, worktree, directory }`         |
| V2 `Location.PublicInfo` | `{ directory, project: { id, directory, canonical } }` |

V2 **没有任何端点能拿到 `home` / `state` / `config`**
（`GET /api/info` 的 `paths` **只有 `tmp`**）。

**影响**：`home` 被「目录选择器」当作默认起始路径（`ProjectDialog.tsx` 的 `path = p.home`），
给空串会让它落到**文件系统根目录**，体验很差。
→ 阶段 1 用**当前目录**兜底（`src/api/client.ts:174` 的 `getPath()`），并在代码里注明原因。
文档 §4.1 应补上这条字段缺失。

### ⑧ `GET /api/project` **不接受** `directory` 参数（文档表格未提）

**文档原文**（§4.4）：`GET /project` → `GET /api/project`（看起来只是路径改名）

**实际**：V1 的 `project.list({ directory })` 接受目录参数；
V2 的 `project.list()` **完全没有入参**（是**全局**项目表，实测返回 44 条跨所有项目）。
传 `directory` 会被当成 `RequestOptions` 而类型报错。

→ `getProjects()` 已去掉该参数（`src/api/client.ts:109`）。
另外 `getCurrentProject()` 因为 V2 的 `location.get()` **不含 `vcs` / `time` / `sandboxes`**
（而 `project.vcs` 是 UI 判断「要不要显示 git diff 选项」的依据），
所以额外补查了一次 `project.list()` 按 id 取完整对象（`src/api/client.ts:87`，**2 次请求**）。

### ⑨ `V1` 的 `Agent.permission` 与 V2 的 `permissions` **不是改名，是换了模型**

**文档原文**（§3.4 提到过配置层的权限改动，但**没说 Agent 列表接口也受影响**）

**实际**：

|                     | 结构                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| V1 `PermissionRule` | `{ permission: string; pattern: string; action: 'allow'\|'deny'\|'ask' }` |
| V2 `PermissionRule` | `{ action: string; resource: string; effect: 'allow'\|'deny' }`           |

字段与语义都不同 → **无法直接映射**。
阶段 1 在 `toInternalAgent()` 里填空数组 `[]`，并已**全仓库核对：下游没有任何地方读取
`agent.permission`**（只有 `request.permission`，那是 PermissionRequest 的字段，另一回事），
所以不造成行为差异。已写进代码注释。

### ⑩ 🔴 **新发现**：`GET /api/model` / `GET /api/provider` 在 location **首次被访问**时可能返回**空数组**

**文档未提及**（§4.4 只说这两个端点替代了 `/config/providers`）。

**实测**（opencode v2.0.19，同一台服务）：

| 场景                                    | `GET /api/model` 返回                               |
| --------------------------------------- | --------------------------------------------------- |
| 全新目录 `dirC` 的**第 1 次**请求       | `{"location":…,"data":[]}` ← **空**                 |
| `dirC` 的**第 2 次**请求                | 15 条                                               |
| 全新目录 `dirD` 第 1 次 / 第 2 次       | **0 条** / 78 条                                    |
| 全新目录 `dirE`：先打 `/api/provider`   | `/api/provider` **也是 0 条**                       |
| 全新目录 `dirF`：先打 `/api/agent` 预热 | 再打 `/api/model` → 正常                            |
| 服务刚启动时的第 1 次并发请求           | `/api/model` 与 `/api/provider` **都是 `data: []`** |
| 同一 location 稳定后连打 6 次           | 全部 15 条（稳定）                                  |

→ **结论**：V2 的 location 是**惰性初始化**的，provider/model 目录在初始化完成前会返回**空数组**
（而且**不报错、不 503**）。这正是「静默失效」的另一种形态。

**影响**：

1. **阶段 1 的冒烟测试曾因此失败一次** —— 服务刚起时 `getActiveModels()` 拿到 0 个模型。
   处理方式：测试里先做一次预热（并在注释里写明原因），把断言聚焦在「迁移后的 join 逻辑是否正确」。
2. **产品层面需要处理**：UI 首次打开某个目录时，模型列表可能为空。
   阶段 2/3 应加**重试**（或等 location 就绪）—— 否则用户会看到「没有可用模型」。
3. 也解释了为什么 `getActiveModels()` 用 `Promise.all([model.list, provider.list])` 是**有风险**的：
   两个请求都可能在 location 未就绪时返回空。

> 补充观察：`dirD` 第 2 次返回的是 **78 条**（而不是稳定的 15 条），
> 疑似「完整的 models.dev 目录」与「按配置过滤后的目录」之间的中间态。
> 因为很快收敛到 15 条、且不影响阶段 1 的验收，**未深究**，仅记录现象供阶段 3 参考。

---

## 6. 未做 / 未验证事项（如实汇报）

| 项                                                   | 状态        | 原因                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rust 编译验证（`cargo check`）**                   | ❌ **未做** | `src-tauri/target/` 不存在（从未构建过），全量 `cargo check` 需拉整套 Tauri 依赖树，在 12G 内存约束下代价大。改动是**单个函数体 + 1 个私有辅助函数**，不涉及类型/借用/控制流以外的风险。**阶段 0 同样未做。** |
| **Rust 健康检查的运行时验证**                        | ❌ 未做     | 需要 `cargo run`/真实 Tauri 运行时；逻辑已与前端**保持同一套判据**，前端那套已有 4 条单测覆盖                                                                                                                 |
| **WSL 真实链路**                                     | ❌ 未做     | 容器内无 WSL（阶段 0 同样未做）                                                                                                                                                                               |
| **Tauri `plugin-http` 下的真实请求**                 | ❌ 未做     | 容器内无 Tauri 运行时。本次只验证了「注入自定义 fetch 的机制」在类型与 mock 层正确                                                                                                                            |
| **`client.event.subscribe()` 在 Tauri 下的流式表现** | ❌ 未做     | **属阶段 2**（本次未使用事件订阅）。阶段 0 遗留的 ❗ 仍然开放                                                                                                                                                 |
| **阶段 3 的全部写操作**                              | ❌ 未做     | 按任务边界（只做 GET/读取类）                                                                                                                                                                                 |
| **配置编辑器适配 V2 字段**                           | ❌ 未做     | 属阶段 3（P2）。且发现 V2 根本没有通用写接口（见 §5 ②）                                                                                                                                                       |
| **Docker 锁版本 / 三形态回归**                       | ❌ 未做     | 属阶段 3/4                                                                                                                                                                                                    |

**清理说明**：

- 冒烟测试启动的临时服务（端口 **4097**）**已停止**
- 容器内原有的 **4096** 常驻服务（pid 8）**全程未受影响**
- 临时夹具在 `/tmp/opencode/v2test/`（含 `TASK1-EVIDENCE.md`），**不在仓库内**
- `dist/` 是 `.gitignore` 忽略的构建产物，`vite build` 的输出不影响仓库
- 顺带修掉了容器文件系统给文件误加执行位的噪音（21 个文件 `chmod 644`），
  **`git diff` 里已无 mode change**

---

## 7. 阶段 3 开工前的提醒（从本次实测沉淀）

1. **`POST /api/session` 必须把目录写进 body**（`{location:{directory}}`），头与 query 都会被忽略（§5 ④）
2. **配置写入只能改 `shell`**，其余字段要么引导用户编辑文件、要么放弃（§5 ②）
3. **`GET /api/session` 必须传裸 `directory`**，否则静默返回全局数据（§5 ①）
4. **`Config.Entry.info` 是有损视图**，未知字段会消失 → 配置编辑器要按「只读展示」设计（§5 ③）
5. **`/api/session/active` 只列活跃会话**，缺省即空闲（§5 ⑥）
6. `grep -rn "notMigratedYet" src/api/` 就是阶段 3 的待办清单（**58 处**）
7. **模型/Provider 列表在 location 首次访问时可能是空的** → UI 要加重试（§5 ⑩）
8. 阶段 2 开始前先决定：`src/types/api/v1Model.ts`（3286 行临时兼容层）里
   **消息 / Part / 事件**那部分应优先删除，其余留到阶段 3

---

## 附录 A：类型报错全量清单（快照 A —— 换包后，类型层未适配）

> 状态：已完成 `npm install @opencode/client@2.0.19` + 改 20 个文件的 import 路径 + 重写 `src/api/sdk.ts`，
> **尚未**适配 `src/types/api/*`。
> 命令：`npx tsc -b --force`　**共 336 条**
>
> 错误码分布：`TS2339` × 136、`TS2305` × 94、`TS7006` × 36、`TS2353` × 31、
> `TS2724` × 15、`TS2345` × 13、`TS2322` × 5、`TS2551` × 3、`TS2352` × 2、`TS2349` × 1

按文件统计（完整逐条见下）：

| 文件                                     | 条数 |     | 文件                                                  | 条数 |
| ---------------------------------------- | ---: | --- | ----------------------------------------------------- | ---: |
| `src/components/FileExplorer.tsx`        |   23 |     | `src/api/lsp.ts`                                      |    5 |
| `src/types/api/message.ts`               |   20 |     | `src/api/global.ts`                                   |    5 |
| `src/api/session.ts`                     |   18 |     | `src/types/api/common.ts`                             |    4 |
| `src/hooks/useChatSession.ts`            |   16 |     | `src/features/message/parts/ToolPartView.tsx`         |    4 |
| `src/types/api/event.ts`                 |   14 |     | `src/types/api/tool.ts`                               |    3 |
| `src/features/chat/QuestionDialog.tsx`   |   14 |     | `src/features/chat/EmptyState.tsx`                    |    3 |
| `src/features/chat/PermissionDialog.tsx` |   14 |     | `src/api/vcs.ts`                                      |    3 |
| `src/features/chat/InlineQuestion.tsx`   |   14 |     | `src/api/tool.ts`                                     |    3 |
| `src/types/api/config.ts`                |   13 |     | `src/api/command.ts`                                  |    3 |
| `src/features/chat/InlinePermission.tsx` |   11 |     | `src/types/api/worktree.ts`                           |    2 |
| `src/hooks/useFileExplorer.test.tsx`     |   10 |     | `src/types/api/pty.ts`                                |    2 |
| `src/api/mcp.ts`                         |   10 |     | `src/types/api/project.ts`                            |    2 |
| `src/api/file.ts`                        |    8 |     | `src/hooks/usePermissionHandler.test.tsx`             |    2 |
| `src/api/client.ts`                      |    8 |     | `src/hooks/useGitWorkspaceCatalog.ts`                 |    2 |
| `src/hooks/useFileExplorer.ts`           |    7 |     | `src/features/settings/components/ConfigSettings.tsx` |    2 |
| `src/api/permission.ts`                  |    7 |     | `src/features/sessions/ProjectSelector.tsx`           |    2 |
| `src/types/api/mcp.ts`                   |    6 |     | `src/features/sessions/ProjectSelector.test.tsx`      |    2 |
| `src/types/api/file.ts`                  |    6 |     | `src/components/McpPanel.tsx`                         |    2 |
| `src/hooks/useGlobalEvents.ts`           |    6 |     | `src/api/skill.ts`                                    |    2 |
| `src/components/WorktreePanel.tsx`       |    6 |     | `src/api/agent.ts`                                    |    2 |
| `src/api/pty.ts`                         |    6 |     | `src/types/api/vcs.ts`                                |    1 |
| `src/api/config.ts`                      |    6 |     | `src/types/api/skill.ts`                              |    1 |
| `src/types/api/session.ts`               |    5 |     | `src/types/api/agent.ts`                              |    1 |
| `src/types/api/permission.ts`            |    5 |     | `src/features/chat/sidebar/FolderRecentList.tsx`      |    1 |
| `src/types/api/model.ts`                 |    5 |     | `src/features/chat/InlineToolRequestContext.tsx`      |    1 |
| `src/components/SessionChangesPanel.tsx` |    5 |     | `src/features/chat/InlineToolRequestContext.test.tsx` |    1 |
| `src/api/worktree.ts`                    |    5 |     | `src/features/chat/ChatPane.tsx`                      |    1 |
| `src/api/message.ts`                     |    5 |     | `src/api/todo.ts`                                     |    1 |

**关键观察**：这 336 条里**绝大多数（约 240 条）根本不在 `src/api/` 里**，
而是散落在 **UI / hooks / 渲染组件**（`FileExplorer.tsx` 23 条、`QuestionDialog.tsx` 14 条、
`useChatSession.ts` 16 条…）。
→ 这直接证明了「**类型层必须自给自足**」这个判断：只要 `src/types/api/*` 一天还转发 V2 类型，
下游就一天编译不过，而阶段 1 又禁止改动这些组件。

### 快照 A 逐条清单（逐条，共 336 条）

```text
── src/api/agent.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  15:27  error TS2339  Property 'app' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise<...

── src/api/client.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  56:29  error TS2339  Property 'providers' does not exist on type '{ get: (input?: ConfigGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConfigGetOut...
  101:29  error TS2339  Property 'providers' does not exist on type '{ get: (input?: ConfigGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConfigGetOut...
  118:35  error TS2339  Property 'current' does not exist on type '{ list: (requestOptions?: RequestOptions | undefined) => Promise<ProjectListOutput>; update: (input: ProjectUpdate...
  126:67  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'RequestOptions'.
  134:35  error TS2339  Property 'initGit' does not exist on type '{ list: (requestOptions?: RequestOptions | undefined) => Promise<ProjectListOutput>; update: (input: ProjectUpdate...
  152:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'ProjectUpdateInput'.
  164:41  error TS2339  Property 'path' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...

── src/api/command.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  42:51  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'CommandListInput'.
  94:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionCommandInput'.

── src/api/config.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  15:40  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'ConfigGetInput'.
  23:27  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  31:43  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'ConfigUpdateInput'.
  40:27  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  48:34  error TS2339  Property 'providers' does not exist on type '{ get: (input?: ConfigGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConfigGetOut...

── src/api/file.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  29:41  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'FileListInput'.
  32:45  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'FileListInput'.
  49:15  error TS2339  Property 'find' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...
  100:45  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'FileReadInput'.
  108:32  error TS2339  Property 'status' does not exist on type '{ read: (input: FileReadInput, requestOptions?: RequestOptions | undefined) => Promise<FileReadOutput>; list: (inpu...
  116:27  error TS2339  Property 'find' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...
  124:27  error TS2339  Property 'find' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...

── src/api/global.ts ──
  5:15  error TS2305  Module '"@opencode/client"' has no exported member 'GlobalHealthResponse'.
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:27  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  22:20  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  31:20  error TS2339  Property 'instance' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...

── src/api/lsp.ts ──
  5:15  error TS2305  Module '"@opencode/client"' has no exported member 'FormatterStatus'.
  5:54  error TS2305  Module '"@opencode/client"' has no exported member 'LspStatus'.
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  20:51  error TS2339  Property 'lsp' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise<...
  42:57  error TS2339  Property 'formatter' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pr...

── src/api/mcp.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:31  error TS2339  Property 'status' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; ...
  22:40  error TS2339  Property 'resource' does not exist on type '{ persistentPty: { read: (input: ExperimentalPersistentPtyReadInput, requestOptions?: RequestOptions | undefined)...
  30:30  error TS2353  Object literal may only specify known properties, and 'name' does not exist in type 'McpAddInput'.
  38:34  error TS2353  Object literal may only specify known properties, and 'name' does not exist in type 'McpConnectInput'.
  46:37  error TS2353  Object literal may only specify known properties, and 'name' does not exist in type 'McpDisconnectInput'.
  54:39  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....
  64:24  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....
  72:24  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....
  80:24  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....

── src/api/message.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  63:23  error TS2551  Property 'messages' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRe...
  164:41  error TS2339  Property 'parts' does not exist on type 'SessionPromptInput'.
  218:5  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionPromptInput'.
  241:28  error TS2339  Property 'promptAsync' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<Session...

── src/api/permission.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  24:58  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PermissionListInput'.
  46:28  error TS2339  Property 'respond' does not exist on type '{ request: { list: (input?: PermissionRequestListInput | undefined, requestOptions?: RequestOptions | undefined) =...
  59:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PermissionReplyInput'.
  80:38  error TS2339  Property 'question' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...
  97:15  error TS2339  Property 'question' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...
  112:15  error TS2339  Property 'question' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...

── src/api/pty.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  40:38  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyListInput'.
  40:95  error TS7006  Parameter 'pty' implicitly has an 'any' type.
  50:31  error TS2339  Property 'shells' does not exist on type '{ list: (input?: PtyListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<PtyListOutput>; ...
  66:64  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyGetInput'.
  89:47  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyRemoveInput'.

── src/api/session.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  31:35  error TS2551  Property 'status' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsResp...
  50:9  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionDiffInput'.
  79:27  error TS7006  Parameter 'message' implicitly has an 'any' type.
  99:9  error TS2353  Object literal may only specify known properties, and 'roots' does not exist in type 'SessionListInput'.
  114:70  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionGetInput'.
  132:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionCreateInput'.
  153:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionUpdateInput'.
  165:28  error TS2339  Property 'delete' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsResp...
  179:28  error TS2339  Property 'abort' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRespo...
  196:23  error TS2349  This expression is not callable.
  211:35  error TS2551  Property 'unrevert' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRe...
  220:35  error TS2339  Property 'share' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRespo...
  229:35  error TS2339  Property 'unshare' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRes...
  241:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionForkInput'.
  259:23  error TS2339  Property 'summarize' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsR...
  274:35  error TS2339  Property 'children' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRe...
  289:42  error TS2339  Property 'todo' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRespon...

── src/api/skill.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:27  error TS2339  Property 'app' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise<...

── src/api/todo.ts ──
  1:15  error TS2305  Module '"@opencode/client"' has no exported member 'Todo'.

── src/api/tool.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:27  error TS2339  Property 'tool' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...
  22:27  error TS2339  Property 'tool' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...

── src/api/vcs.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  17:39  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'VcsGetInput'.
  29:63  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'VcsDiffInput'.

── src/api/worktree.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:43  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'WorktreeListInput'.
  22:85  error TS2353  Object literal may only specify known properties, and 'worktreeCreateInput' does not exist in type 'WorktreeCreateInput'.
  30:38  error TS2322  Type 'string | undefined' is not assignable to type 'string'.
  39:29  error TS2339  Property 'reset' does not exist on type '{ list: (input: WorktreeListInput, requestOptions?: RequestOptions | undefined) => Promise<WorktreeList>; create: (i...

── src/components/FileExplorer.tsx ──
  109:10  error TS7006  Parameter 'submatch' implicitly has an 'any' type.
  113:13  error TS7006  Parameter 'range' implicitly has an 'any' type.
  202:16  error TS2339  Property 'type' does not exist on type 'FileTreeNode'.
  203:27  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  205:50  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  205:67  error TS2339  Property 'name' does not exist on type 'FileTreeNode'.
  486:29  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  734:45  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  735:28  error TS2339  Property 'type' does not exist on type 'FileTreeNode'.
  737:38  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  737:67  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  759:20  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  760:24  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  761:20  error TS2339  Property 'name' does not exist on type 'FileTreeNode'.
  765:11  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  765:22  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  765:37  error TS2339  Property 'name' does not exist on type 'FileTreeNode'.
  774:61  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  774:72  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  779:18  error TS2339  Property 'ignored' does not exist on type 'FileTreeNode'.
  794:40  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  808:72  error TS2339  Property 'name' does not exist on type 'FileTreeNode'.
  821:26  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.

── src/components/McpPanel.tsx ──
  304:39  error TS2339  Property 'client' does not exist on type 'McpResource'.
  306:25  error TS2339  Property 'client' does not exist on type 'McpResource'.

── src/components/SessionChangesPanel.tsx ──
  136:53  error TS2339  Property 'default_branch' does not exist on type 'VcsInfo'.
  136:98  error TS2339  Property 'default_branch' does not exist on type 'VcsInfo'.
  141:47  error TS2339  Property 'default_branch' does not exist on type 'VcsInfo'.
  152:77  error TS2339  Property 'default_branch' does not exist on type 'VcsInfo'.
  166:18  error TS2339  Property 'default_branch' does not exist on type 'VcsInfo'.

── src/components/WorktreePanel.tsx ──
  60:43  error TS2339  Property 'worktree' does not exist on type 'Project'.
  61:44  error TS2339  Property 'worktree' does not exist on type 'Project'.
  166:41  error TS2345  Argument of type '{ name: string; }' is not assignable to parameter of type 'WorktreeCreateInput'.
  197:30  error TS2345  Argument of type '{ directory: string; }' is not assignable to parameter of type 'WorktreeRemoveInput'.
  275:91  error TS2322  Type 'VcsBranch' is not assignable to type 'string'.
  276:15  error TS2322  Type 'VcsBranch' is not assignable to type 'ReactI18NextChildren | Iterable<ReactI18NextChildren>'.

── src/features/chat/ChatPane.tsx ──
  971:62  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.

── src/features/chat/EmptyState.tsx ──
  68:106  error TS2339  Property 'worktree' does not exist on type 'Project'.
  96:41  error TS2339  Property 'worktree' does not exist on type 'Project'.
  97:17  error TS2339  Property 'worktree' does not exist on type 'Project'.

── src/features/chat/InlinePermission.tsx ──
  55:30  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  55:63  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  56:31  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  56:51  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  57:46  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  57:59  error TS7006  Parameter 'p' implicitly has an 'any' type.
  61:41  error TS2339  Property 'always' does not exist on type 'PermissionRequest'.
  61:68  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  64:62  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  79:28  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  88:28  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.

── src/features/chat/InlineQuestion.tsx ──
  30:32  error TS7006  Parameter '_' implicitly has an 'any' type.
  30:35  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  36:32  error TS7006  Parameter '_' implicitly has an 'any' type.
  36:35  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  42:32  error TS7006  Parameter '_' implicitly has an 'any' type.
  42:35  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  100:61  error TS7006  Parameter 'q' implicitly has an 'any' type.
  100:64  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  112:46  error TS7006  Parameter '_q' implicitly has an 'any' type.
  112:50  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  142:33  error TS7006  Parameter 'question' implicitly has an 'any' type.
  142:43  error TS7006  Parameter 'qIdx' implicitly has an 'any' type.
  237:32  error TS7006  Parameter 'option' implicitly has an 'any' type.
  237:40  error TS7006  Parameter 'idx' implicitly has an 'any' type.

── src/features/chat/InlineToolRequestContext.test.tsx ──
  60:7  error TS2353  Object literal may only specify known properties, and 'permission' does not exist in type 'PermissionRequest'.

── src/features/chat/InlineToolRequestContext.tsx ──
  69:49  error TS2339  Property 'tool' does not exist on type 'PermissionRequest'.

── src/features/chat/PermissionDialog.tsx ──
  55:30  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  55:63  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  96:75  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  145:24  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  145:44  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  148:36  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  148:49  error TS7006  Parameter 'p' implicitly has an 'any' type.
  156:24  error TS2339  Property 'always' does not exist on type 'PermissionRequest'.
  156:42  error TS2339  Property 'always' does not exist on type 'PermissionRequest'.
  159:36  error TS2339  Property 'always' does not exist on type 'PermissionRequest'.
  184:55  error TS2339  Property 'always' does not exist on type 'PermissionRequest'.
  184:82  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  188:76  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  189:66  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.

── src/features/chat/QuestionDialog.tsx ──
  34:32  error TS7006  Parameter '_' implicitly has an 'any' type.
  34:35  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  41:32  error TS7006  Parameter '_' implicitly has an 'any' type.
  41:35  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  48:32  error TS7006  Parameter '_' implicitly has an 'any' type.
  48:35  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  116:61  error TS7006  Parameter 'q' implicitly has an 'any' type.
  116:64  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  139:46  error TS7006  Parameter 'q' implicitly has an 'any' type.
  139:49  error TS7006  Parameter 'idx' implicitly has an 'any' type.
  225:39  error TS7006  Parameter 'question' implicitly has an 'any' type.
  225:49  error TS7006  Parameter 'qIdx' implicitly has an 'any' type.
  330:32  error TS7006  Parameter 'option' implicitly has an 'any' type.
  330:40  error TS7006  Parameter 'idx' implicitly has an 'any' type.

── src/features/chat/sidebar/FolderRecentList.tsx ──
  1018:15  error TS2322  Type 'string | VcsBranch' is not assignable to type 'ReactI18NextChildren | Iterable<ReactI18NextChildren>'.

── src/features/message/parts/ToolPartView.tsx ──
  114:33  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  114:86  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  121:24  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  121:68  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.

── src/features/sessions/ProjectSelector.test.tsx ──
  6:24  error TS2352  Conversion of type '{ id: string; name: string; worktree: string; }' to type 'Project' may be a mistake because neither type sufficiently overlaps with the o...
  12:21  error TS2352  Conversion of type '{ id: string; name: string; worktree: string; }' to type 'Project' may be a mistake because neither type sufficiently overlaps with the o...

── src/features/sessions/ProjectSelector.tsx ──
  77:32  error TS2339  Property 'worktree' does not exist on type 'Project'.
  88:22  error TS2339  Property 'worktree' does not exist on type 'Project'.

── src/features/settings/components/ConfigSettings.tsx ──
  191:26  error TS7006  Parameter 'shell' implicitly has an 'any' type.
  275:17  error TS7006  Parameter 'current' implicitly has an 'any' type.

── src/hooks/useChatSession.ts ──
  402:73  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  402:93  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  415:34  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  415:64  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  415:87  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  415:111  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  687:29  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  691:44  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  695:65  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  702:13  error TS2322  Type 'string | null' is not assignable to type 'string'.
  713:35  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  720:54  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  725:30  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  1018:29  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  1030:13  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.
  1043:29  error TS2345  Argument of type 'string | null' is not assignable to parameter of type 'string'.

── src/hooks/useFileExplorer.test.tsx ──
  116:53  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  122:38  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  123:53  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  130:38  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  132:53  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  165:38  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  175:38  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  183:53  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  192:36  error TS2339  Property 'absolute' does not exist on type 'FileTreeNode'.
  193:65  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.

── src/hooks/useFileExplorer.ts ──
  247:28  error TS2339  Property 'type' does not exist on type 'FileTreeNode'.
  265:24  error TS2339  Property 'type' does not exist on type 'FileTreeNode'.
  422:14  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  437:14  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  455:16  error TS2339  Property 'type' does not exist on type 'FileTreeNode'.
  457:34  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.
  459:29  error TS2339  Property 'path' does not exist on type 'FileTreeNode'.

── src/hooks/useGitWorkspaceCatalog.ts ──
  92:46  error TS2339  Property 'worktree' does not exist on type 'Project'.
  93:65  error TS2339  Property 'worktree' does not exist on type 'Project'.

── src/hooks/useGlobalEvents.ts ──
  412:53  error TS2345  Argument of type 'PermissionRequest[]' is not assignable to parameter of type '{ id: string; sessionID: string; permission: string; patterns?: string[] | und...
  415:58  error TS2345  Argument of type 'PermissionRequest[]' is not assignable to parameter of type '{ id: string; sessionID: string; permission: string; patterns?: string[] | und...
  647:32  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  647:62  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.
  647:85  error TS2339  Property 'patterns' does not exist on type 'PermissionRequest'.
  647:109  error TS2339  Property 'permission' does not exist on type 'PermissionRequest'.

── src/hooks/usePermissionHandler.test.tsx ──
  49:11  error TS2353  Object literal may only specify known properties, and 'permission' does not exist in type 'PermissionRequest'.
  78:11  error TS2353  Object literal may only specify known properties, and 'permission' does not exist in type 'PermissionRequest'.

── src/types/api/agent.ts ──
  1:15  error TS2305  Module '"@opencode/client"' has no exported member 'Agent'.

── src/types/api/common.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'ApiError'.
  3:3  error TS2305  Module '"@opencode/client"' has no exported member 'MessageAbortedError'.
  4:3  error TS2305  Module '"@opencode/client"' has no exported member 'MessageOutputLengthError'.
  5:3  error TS2305  Module '"@opencode/client"' has no exported member 'ProviderAuthError'.

── src/types/api/config.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'AgentConfig'.
  3:3  error TS2305  Module '"@opencode/client"' has no exported member 'Config'.
  4:3  error TS2305  Module '"@opencode/client"' has no exported member 'LayoutConfig'.
  5:3  error TS2305  Module '"@opencode/client"' has no exported member 'LogLevel'.
  6:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpLocalConfig'.
  7:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpOAuthConfig'.
  8:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpRemoteConfig'.
  9:3  error TS2305  Module '"@opencode/client"' has no exported member 'PermissionActionConfig'.
  10:3  error TS2305  Module '"@opencode/client"' has no exported member 'PermissionConfig'.
  11:3  error TS2305  Module '"@opencode/client"' has no exported member 'PermissionObjectConfig'.
  12:3  error TS2724  '"@opencode/client"' has no exported member named 'PermissionRuleConfig'. Did you mean 'PermissionRule'?
  13:3  error TS2305  Module '"@opencode/client"' has no exported member 'ProviderConfig'.
  14:3  error TS2305  Module '"@opencode/client"' has no exported member 'ServerConfig'.

── src/types/api/event.ts ──
  7:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventMessagePartDelta'.
  8:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventMessagePartRemoved'.
  9:3  error TS2724  '"@opencode/client"' has no exported member named 'EventPermissionReplied'. Did you mean 'PermissionReplied'?
  10:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventQuestionRejected'.
  11:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventQuestionReplied'.
  12:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventSessionDiff'.
  13:3  error TS2724  '"@opencode/client"' has no exported member named 'EventSessionIdle'. Did you mean 'SessionIdle'?
  14:3  error TS2724  '"@opencode/client"' has no exported member named 'EventSessionStatus'. Did you mean 'SessionStatus'?
  15:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventTodoUpdated'.
  16:3  error TS2724  '"@opencode/client"' has no exported member named 'EventVcsBranchUpdated'. Did you mean 'VcsBranchUpdated'?
  17:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventWorktreeFailed'.
  18:3  error TS2305  Module '"@opencode/client"' has no exported member 'EventWorktreeReady'.
  19:3  error TS2305  Module '"@opencode/client"' has no exported member 'GlobalEvent'.
  20:3  error TS2305  Module '"@opencode/client"' has no exported member 'Todo'.

── src/types/api/file.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'File'.
  3:3  error TS2305  Module '"@opencode/client"' has no exported member 'FileContent'.
  4:3  error TS2305  Module '"@opencode/client"' has no exported member 'FileNode'.
  5:3  error TS2305  Module '"@opencode/client"' has no exported member 'SnapshotFileDiff'.
  6:3  error TS2305  Module '"@opencode/client"' has no exported member 'Symbol'.
  7:3  error TS2305  Module '"@opencode/client"' has no exported member 'FindTextResponse'.

── src/types/api/mcp.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpLocalConfig'.
  3:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpOAuthConfig'.
  5:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpRemoteConfig'.
  6:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpStatusResponse'.
  7:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpStatus'.
  12:3  error TS2305  Module '"@opencode/client"' has no exported member 'McpStatusNeedsClientRegistration'.

── src/types/api/message.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'AgentPart'.
  3:3  error TS2724  '"@opencode/client"' has no exported member named 'AgentPartInput'. Did you mean 'AgentGetInput'?
  4:3  error TS2305  Module '"@opencode/client"' has no exported member 'AssistantMessage'.
  5:3  error TS2305  Module '"@opencode/client"' has no exported member 'CompactionPart'.
  6:3  error TS2305  Module '"@opencode/client"' has no exported member 'FilePart'.
  7:3  error TS2724  '"@opencode/client"' has no exported member named 'FilePartInput'. Did you mean 'FileWriteInput'?
  8:3  error TS2305  Module '"@opencode/client"' has no exported member 'FilePartSource'.
  9:3  error TS2305  Module '"@opencode/client"' has no exported member 'PatchPart'.
  10:3  error TS2305  Module '"@opencode/client"' has no exported member 'ReasoningPart'.
  11:3  error TS2305  Module '"@opencode/client"' has no exported member 'RetryPart'.
  12:3  error TS2305  Module '"@opencode/client"' has no exported member 'SnapshotPart'.
  13:3  error TS2305  Module '"@opencode/client"' has no exported member 'StepFinishPart'.
  14:3  error TS2305  Module '"@opencode/client"' has no exported member 'StepStartPart'.
  15:3  error TS2305  Module '"@opencode/client"' has no exported member 'SubtaskPart'.
  16:3  error TS2305  Module '"@opencode/client"' has no exported member 'SubtaskPartInput'.
  17:3  error TS2305  Module '"@opencode/client"' has no exported member 'TextPart'.
  18:3  error TS2305  Module '"@opencode/client"' has no exported member 'TextPartInput'.
  19:3  error TS2305  Module '"@opencode/client"' has no exported member 'ToolPart'.
  20:3  error TS2305  Module '"@opencode/client"' has no exported member 'ToolState'.
  21:3  error TS2305  Module '"@opencode/client"' has no exported member 'UserMessage'.

── src/types/api/model.ts ──
  2:3  error TS2724  '"@opencode/client"' has no exported member named 'ConfigProvidersResponse'. Did you mean 'ConfigProviderSettings'?
  3:3  error TS2305  Module '"@opencode/client"' has no exported member 'Model'.
  4:3  error TS2305  Module '"@opencode/client"' has no exported member 'Provider'.
  5:3  error TS2305  Module '"@opencode/client"' has no exported member 'ProviderAuthAuthorization'.
  6:3  error TS2305  Module '"@opencode/client"' has no exported member 'ProviderAuthMethod'.

── src/types/api/permission.ts ──
  3:3  error TS2305  Module '"@opencode/client"' has no exported member 'QuestionAnswer'.
  4:3  error TS2305  Module '"@opencode/client"' has no exported member 'QuestionInfo'.
  5:3  error TS2305  Module '"@opencode/client"' has no exported member 'QuestionOption'.
  6:3  error TS2305  Module '"@opencode/client"' has no exported member 'QuestionRequest'.
  9:67  error TS2339  Property 'tool' does not exist on type 'PermissionRequest'.

── src/types/api/project.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'Path'.
  4:3  error TS2724  '"@opencode/client"' has no exported member named 'ProjectUpdateData'. Did you mean 'ProjectUpdated'?

── src/types/api/pty.ts ──
  3:3  error TS2724  '"@opencode/client"' has no exported member named 'PtyCreateData'. Did you mean 'PtyCreated'?
  4:3  error TS2724  '"@opencode/client"' has no exported member named 'PtyUpdateData'. Did you mean 'PtyUpdated'?

── src/types/api/session.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'Session'.
  3:3  error TS2724  '"@opencode/client"' has no exported member named 'SessionCreateData'. Did you mean 'SessionCreated'?
  4:3  error TS2724  '"@opencode/client"' has no exported member named 'SessionForkData'. Did you mean 'SessionForked'?
  5:3  error TS2724  '"@opencode/client"' has no exported member named 'SessionListData'. Did you mean 'SessionMetadata'?
  7:3  error TS2305  Module '"@opencode/client"' has no exported member 'SessionUpdateData'.

── src/types/api/skill.ts ──
  1:15  error TS2305  Module '"@opencode/client"' has no exported member 'AppSkillsResponse'.

── src/types/api/tool.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'ToolIds'.
  3:3  error TS2305  Module '"@opencode/client"' has no exported member 'ToolList'.
  4:3  error TS2305  Module '"@opencode/client"' has no exported member 'ToolListItem'.

── src/types/api/vcs.ts ──
  1:15  error TS2305  Module '"@opencode/client"' has no exported member 'VcsDiffData'.

── src/types/api/worktree.ts ──
  2:3  error TS2305  Module '"@opencode/client"' has no exported member 'Worktree'.
  5:3  error TS2724  '"@opencode/client"' has no exported member named 'WorktreeResetInput'. Did you mean 'WorktreeListInput'?
```

## 附录 B：类型报错全量清单（快照 B —— 类型层适配后）

> 状态：已新增 `src/types/api/v1Model.ts` 并把各类型文件指向它，**尚未**迁移端点。
> 命令：`npx tsc -b --force`　**共 95 条**，**全部集中在 `src/api/`**（下游 0 条 ✅）

| 文件                    | 条数 |
| ----------------------- | ---: |
| `src/api/session.ts`    |   17 |
| `src/api/mcp.ts`        |   10 |
| `src/api/pty.ts`        |    8 |
| `src/api/file.ts`       |    8 |
| `src/api/client.ts`     |    8 |
| `src/api/permission.ts` |    7 |
| `src/api/config.ts`     |    6 |
| `src/api/worktree.ts`   |    5 |
| `src/api/message.ts`    |    5 |
| `src/api/global.ts`     |    5 |
| `src/api/vcs.ts`        |    3 |
| `src/api/tool.ts`       |    3 |
| `src/api/lsp.ts`        |    3 |
| `src/api/command.ts`    |    3 |
| `src/api/skill.ts`      |    2 |
| `src/api/agent.ts`      |    2 |

→ 这批就是任务 3 的待办清单，已全部处理（21 处迁移 + 58 处显式占位）。

### 快照 B 逐条清单（逐条，共 95 条）

```text
── src/api/agent.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  15:27  error TS2339  Property 'app' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise<...

── src/api/client.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  56:29  error TS2339  Property 'providers' does not exist on type '{ get: (input?: ConfigGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConfigGetOut...
  101:29  error TS2339  Property 'providers' does not exist on type '{ get: (input?: ConfigGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConfigGetOut...
  118:35  error TS2339  Property 'current' does not exist on type '{ list: (requestOptions?: RequestOptions | undefined) => Promise<ProjectListOutput>; update: (input: ProjectUpdate...
  126:67  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'RequestOptions'.
  134:35  error TS2339  Property 'initGit' does not exist on type '{ list: (requestOptions?: RequestOptions | undefined) => Promise<ProjectListOutput>; update: (input: ProjectUpdate...
  152:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'ProjectUpdateInput'.
  164:41  error TS2339  Property 'path' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...

── src/api/command.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  42:51  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'CommandListInput'.
  94:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionCommandInput'.

── src/api/config.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  15:40  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'ConfigGetInput'.
  23:27  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  31:43  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'ConfigUpdateInput'.
  40:27  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  48:34  error TS2339  Property 'providers' does not exist on type '{ get: (input?: ConfigGetInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<ConfigGetOut...

── src/api/file.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  29:41  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'FileListInput'.
  32:45  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'FileListInput'.
  49:15  error TS2339  Property 'find' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...
  100:45  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'FileReadInput'.
  108:32  error TS2339  Property 'status' does not exist on type '{ read: (input: FileReadInput, requestOptions?: RequestOptions | undefined) => Promise<FileReadOutput>; list: (inpu...
  116:27  error TS2339  Property 'find' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...
  124:27  error TS2339  Property 'find' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...

── src/api/global.ts ──
  5:15  error TS2305  Module '"@opencode/client"' has no exported member 'GlobalHealthResponse'.
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:27  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  22:20  error TS2339  Property 'global' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promi...
  31:20  error TS2339  Property 'instance' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...

── src/api/lsp.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  20:51  error TS2339  Property 'lsp' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise<...
  42:57  error TS2339  Property 'formatter' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pr...

── src/api/mcp.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:31  error TS2339  Property 'status' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; ...
  22:40  error TS2339  Property 'resource' does not exist on type '{ persistentPty: { read: (input: ExperimentalPersistentPtyReadInput, requestOptions?: RequestOptions | undefined)...
  30:36  error TS2322  Type 'McpServerConfig' is not assignable to type '{ readonly type: "local"; readonly command: readonly string[]; readonly cwd?: string | undefined; readonly ...
  38:34  error TS2353  Object literal may only specify known properties, and 'name' does not exist in type 'McpConnectInput'.
  46:37  error TS2353  Object literal may only specify known properties, and 'name' does not exist in type 'McpDisconnectInput'.
  54:39  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....
  64:24  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....
  72:24  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....
  80:24  error TS2339  Property 'auth' does not exist on type '{ list: (input?: McpListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<McpListOutput>; .....

── src/api/message.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  63:23  error TS2551  Property 'messages' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRe...
  164:41  error TS2339  Property 'parts' does not exist on type 'SessionPromptInput'.
  218:5  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionPromptInput'.
  241:28  error TS2339  Property 'promptAsync' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<Session...

── src/api/permission.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  24:58  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PermissionListInput'.
  46:28  error TS2339  Property 'respond' does not exist on type '{ request: { list: (input?: PermissionRequestListInput | undefined, requestOptions?: RequestOptions | undefined) =...
  59:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PermissionReplyInput'.
  80:38  error TS2339  Property 'question' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...
  97:15  error TS2339  Property 'question' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...
  112:15  error TS2339  Property 'question' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Pro...

── src/api/pty.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  40:38  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyListInput'.
  40:95  error TS7006  Parameter 'pty' implicitly has an 'any' type.
  50:31  error TS2339  Property 'shells' does not exist on type '{ list: (input?: PtyListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<PtyListOutput>; ...
  58:53  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyCreateInput'.
  66:64  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyGetInput'.
  80:49  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyUpdateInput'.
  89:47  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'PtyRemoveInput'.

── src/api/session.ts ──
  6:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  31:35  error TS2551  Property 'status' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsResp...
  50:9  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionDiffInput'.
  99:9  error TS2353  Object literal may only specify known properties, and 'roots' does not exist in type 'SessionListInput'.
  114:70  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionGetInput'.
  132:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionCreateInput'.
  153:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionUpdateInput'.
  165:28  error TS2339  Property 'delete' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsResp...
  179:28  error TS2339  Property 'abort' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRespo...
  196:23  error TS2349  This expression is not callable.
  211:35  error TS2551  Property 'unrevert' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRe...
  220:35  error TS2339  Property 'share' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRespo...
  229:35  error TS2339  Property 'unshare' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRes...
  241:7  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'SessionForkInput'.
  259:23  error TS2339  Property 'summarize' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsR...
  274:35  error TS2339  Property 'children' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRe...
  289:42  error TS2339  Property 'todo' does not exist on type '{ list: (input?: SessionListInput | undefined, requestOptions?: RequestOptions | undefined) => Promise<SessionsRespon...

── src/api/skill.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:27  error TS2339  Property 'app' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise<...

── src/api/tool.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:27  error TS2339  Property 'tool' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...
  22:27  error TS2339  Property 'tool' does not exist on type '{ rpc: RpcApi<RpcCallOptions> & { call: (input: RpcCallInput, requestOptions?: RequestOptions | undefined) => Promise...

── src/api/vcs.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  17:39  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'VcsGetInput'.
  29:57  error TS2322  Type '"git" | "branch"' is not assignable to type '"branch" | "working" | "committed"'.

── src/api/worktree.ts ──
  5:24  error TS2305  Module '"./sdk"' has no exported member 'unwrap'.
  14:43  error TS2353  Object literal may only specify known properties, and 'directory' does not exist in type 'WorktreeListInput'.
  22:85  error TS2353  Object literal may only specify known properties, and 'worktreeCreateInput' does not exist in type 'WorktreeCreateInput'.
  30:38  error TS2322  Type 'string | undefined' is not assignable to type 'string'.
  39:29  error TS2339  Property 'reset' does not exist on type '{ list: (input: WorktreeListInput, requestOptions?: RequestOptions | undefined) => Promise<WorktreeList>; create: (i...
```
