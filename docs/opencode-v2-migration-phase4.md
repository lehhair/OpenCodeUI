# OpenCodeUI 迁移 V2 —— 阶段 4 报告（收尾）

> 状态：**阶段 4 已完成**（2026-09-30）——**迁移全部阶段结束**
> 目标环境：opencode `v2.0.19`（本轮用**新渠道重新下载的 tarball** 实跑）、`@opencode/client@2.0.19`
> 验收：`tsc` **0 报错**；`prettier --check` **全仓库通过**；`eslint` **0 error / 43 warning**（与 3b 持平）；
> 全量测试 **958 passed / 44 skipped / 0 failed**（1002 个用例 / 113 个文件）；
> 真实服务冒烟 **5 个套件 44/44 全通过**（phase1 13 · phase2a 8 · phase2b 11 · phase3a 6 · phase3b 6）；
> **Rust `cargo check` 0 报错**（含一次**从零开始的完整编译**，692 个 crate）
> 前置报告：`docs/opencode-v2-migration-phase{0,0.5,2a,2b,3a,3b}.md`
> 配套交付：`docs/opencode-v2-migration-regression-checklist.md`（手工回归清单）

---

## 0. 三件必须先交代的事

### 0.1 硬性约束逐条对照

| 约束                                                      | 实际执行                                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **允许改** `docker/`、README、`src-tauri/`、测试、`docs/` | ✅ 改动集中在这几处（另有 4 个源文件 + 1 个测试文件只改**注释**，清单见 §9.2）                                                                                                                   |
| **禁止 git commit / push / reset / checkout / worktree**  | ✅ 只用了 `git status` / `git diff` / `git ls-files` / `git show` / `git grep`（只读）                                                                                                           |
| **禁止删除 `docs/` 下任何文件**                           | ✅ 只新增（`phase4.md`、回归清单）+ 追加修订。⚠️ **实测发现 `docs/` 整个目录本来就未被 git 跟踪**（`git ls-files docs/` 为空，且未被 ignore）—— 9 个报告文件全部是**未提交**状态，不是本轮造成的 |
| **apt-get 装依赖**（用户已许可）                          | ✅ 装了 `libwebkit2gtk-4.1-dev` 等 10 个包（见 §5.1）                                                                                                                                            |
| **删两个孤儿文件**（用户已许可）                          | ✅ `rm openapi_doc.json openapi_formatted.json`（见 §3）                                                                                                                                         |
| 测试 **120–180s 超时**                                    | ✅ 全量 `timeout 180 npx vitest run`；单套件冒烟用 `timeout 180~240`                                                                                                                             |
| 测试服务用完**必须关闭**；零会话残留                      | ✅ 三个临时服务实例（4097）**逐个 kill 并确认无响应**；sqlite 只读复核**零残留**（见 §8.3）；**用户自己的 4096 服务全程未触碰**（实测仍 `401` = 存活）                                           |
| 配置写冒烟**必须 `XDG_CONFIG_HOME` 隔离**                 | ✅ 三个服务实例**全部**带 `XDG_CONFIG_HOME` 指向 `/tmp/opencode/**`（见 §8.4）                                                                                                                   |
| 全程简体中文注释与报告                                    | ✅                                                                                                                                                                                               |
| **失败项如实汇报，不要编造**                              | ✅ 见 §7（与文档不符之处）、§9.2（改动规模）、§10（遗留项 12 条）                                                                                                                                |

### 0.2 本阶段**没有**做的事

1. **没有提交任何 git 事务**（整个迁移自阶段 0 起就未提交，本次沿用）。
2. **没有做浏览器人工点击回归** —— 沿用前几轮做法（单测 + 真实服务 API 冒烟 + 静态守卫），
   人工回归清单**已产出交给用户**（`docs/opencode-v2-migration-regression-checklist.md`）。
3. **没有接入** V2 新增的 `persistent-pty` / `plugin RPC` / `/api/shell` / `/api/websearch` /
   `/api/rpc` / `session.inbox` / `session.instructions` / `/api/vcs/base` / `/api/vcs/branch` / `fs/write`
   （YAGNI，与 3a §9.2、3b §0.2 一致）。
4. **没有真正 `docker build`**（容器内**无 docker daemon**，只有 CLI）—— 用「重新下载 + 哈希复核 +
   逻辑模拟」代替，见 §1.5。
5. **没有实测 WSL 端到端 / Tauri 桌面**（容器内无 `wsl.exe`、无 Tauri 运行时）—— 但**编译验证已补齐**（§5）。

### 0.3 本轮的**最高价值产出**：修掉两个「静默装成 V1」的真 bug

两个 bug 是**同一类**：都用了「GitHub 的 `latest`」或「V1 的安装脚本」，而 GitHub 的 `latest`
**已经停在 v1.18.33**。这类 bug 的可怕之处是**不报错**，只表现为「界面能打开、一发消息就失败」。

|   # | 位置                                               | 原来的行为                                 | 后果                                                                       | 本轮处置                          |
| --: | -------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------- |
|   ① | `docker/Dockerfile.backend`（镜像构建）            | 拉 `releases/latest/download/…`            | **构建出的镜像里是 V1**                                                    | ✅ 换渠道 + 钉版本 + sha256（§1） |
|   ② | `src-tauri/…/wsl_runtime.rs::install_wsl_opencode` | `curl https://opencode.ai/install \| bash` | **用户在 UI 点「安装 opencode」装的是 V1**（那个脚本也是拉 GitHub latest） | ✅ 换成 v2 安装脚本（§5.3）       |

> 任务书只点名了 ①（Docker）。**② 是本轮新发现的**，见 §5.3 —— 属同一 bug 类，已一并修掉。

---

## 1. 任务 A：Docker 锁版本

### 1.1 事实复核（**没有直接信任任务书给的数字**）

任务书给了两个哈希与字节数，并要求「自己重新下载 + `sha256sum` 复核」。**已重做**：

```bash
$ cd /tmp/opencode/p4/dl
$ for a in x64 arm64; do curl -fsSL -o opencode-linux-$a.tar.gz \
    "https://opencode.ai/files/bin/2.0.19/opencode-linux-$a.tar.gz"; done
$ ls -l; sha256sum opencode-linux-*.tar.gz
-rw-r--r-- 1 coder coder 90200781 Sep 30 13:36 opencode-linux-x64.tar.gz
-rw-r--r-- 1 coder coder 89050785 Sep 30 13:36 opencode-linux-arm64.tar.gz
1a9f7184292035a56b6cf22439762930b3a3ed13812f7360c33bb7ae07ef4075  opencode-linux-x64.tar.gz
d0138dd9b43910c28166cfc4da4a53a1b99b07931a37afa749bde812cd02e5a4  opencode-linux-arm64.tar.gz
```

| 架构  | 字节数（实测） | 任务书给的字节数 | 一致？ | sha256（实测）                                                     | 与任务书一致？ |
| ----- | -------------: | ---------------: | ------ | ------------------------------------------------------------------ | -------------- |
| x64   |     90,200,781 |       90,200,781 | ✅     | `1a9f7184292035a56b6cf22439762930b3a3ed13812f7360c33bb7ae07ef4075` | ✅             |
| arm64 |     89,050,785 |       89,050,785 | ✅     | `d0138dd9b43910c28166cfc4da4a53a1b99b07931a37afa749bde812cd02e5a4` | ✅             |

**tarball 结构**（与旧 GitHub tarball 一致 → 解压命令不用改）：

```
$ tar -tzvf opencode-linux-x64.tar.gz
-rwxr-xr-x 0/0 203761120 1970-01-01 08:00 opencode
$ tar -tzvf opencode-linux-arm64.tar.gz
-rwxr-xr-x 0/0 199477544 1970-01-01 08:00 opencode
```

**解包实跑**：`./x64root/opencode --version` → `opencode v2.0.19` ✅

**另外复核的两条任务书事实**：

| 事实                                                                      | 复核结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub `latest` = v1.18.33                                                | ✅ `curl -s https://api.github.com/repos/anomalyco/opencode/releases/latest` → `"tag_name": "v1.18.33"`                                                                                                                                                                                                                                                                                                                                                                                                           |
| `OPENCODE_VERSION` 在 v2.0.19 **运行时无读取处**（作为 ENV 烘焙是安全的） | ✅ **成立，但有一个必须说清的例外**：CLI 二进制里它是 **bun 的构建期 `define`**（`packages/cli/src/version.ts` 是 `declare const`），运行时**不读环境变量**；`grep -a OPENCODE_VERSION` 在二进制里 **0 命中**（对照：`OPENCODE_SERVER_PASSWORD` 4 命中、`OPENCODE_DISABLE_AUTOUPDATE` 2 命中 → 方法有效）。⚠️ 但 **`packages/desktop/**`（Electron 桌面版）确实会读 `process.env.OPENCODE_VERSION`**（`desktop/src/main/constants.ts:6` 等 3 处）。**本项目烘焙的是 Docker 镜像里的 CLI，不涉及 Electron** → 安全 |

### 1.2 改动对照（`docker/Dockerfile.backend`）

| 项             | 改前                                                                                              | 改后                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **URL**        | `https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-${OC_ARCH}.tar.gz` | `https://opencode.ai/files/bin/${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz` |
| **版本**       | 隐式（= 当时 GitHub 的 latest，**不可控**）                                                       | `ARG OPENCODE_VERSION=2.0.19`（第 19 行）                                            |
| **完整性**     | 无校验                                                                                            | 每个架构一组 `OC_SHA256` + `sha256sum -c -`（第 114–123 行）                         |
| **注释**       | 「绕开 install 脚本 / GitHub 限流」                                                               | 改写为「**为什么必须换渠道**」（GitHub latest 已是 V1、v2 真实渠道、升级步骤）       |
| **构建期冒烟** | `opencode --version`                                                                              | **保留**（不变）                                                                     |
| **ENV**        | —                                                                                                 | 新增 `OPENCODE_VERSION=${OPENCODE_VERSION}`（第 138 行，供 entrypoint 复用）         |

```dockerfile
# 安装 opencode（**钉死版本 + 校验哈希**）。
# …（省略：为什么必须换渠道 / 新渠道是什么 / 升级步骤）
RUN case "${TARGETARCH}" in \
      amd64) OC_ARCH=x64 \
             OC_SHA256=1a9f7184292035a56b6cf22439762930b3a3ed13812f7360c33bb7ae07ef4075 ;; \
      arm64) OC_ARCH=arm64 \
             OC_SHA256=d0138dd9b43910c28166cfc4da4a53a1b99b07931a37afa749bde812cd02e5a4 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/opencode.tar.gz \
      "https://opencode.ai/files/bin/${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz" \
    && echo "${OC_SHA256}  /tmp/opencode.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin opencode \
    && rm -f /tmp/opencode.tar.gz \
    && chmod +x /usr/local/bin/opencode \
    && opencode --version
```

### 1.3 `docker/backend-entrypoint.sh`（兜底下载路径）

| 项       | 改前                                                               | 改后                                                                                                  |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| URL      | `https://github.com/anomalyco/opencode/releases/latest/download/…` | `https://opencode.ai/files/bin/${OPENCODE_VERSION:-2.0.19}/opencode-linux-${OC_ARCH}.tar.gz`          |
| 注释     | 「绕开 install 脚本 / GitHub 限流」                                | 「**不能用 GitHub latest**：已停在 v1.18.33；本 UI 只支持 V2」                                        |
| 下载后   | 静默 `chmod`                                                       | **多一次 `opencode --version`**（装错时立刻在日志里可见）                                             |
| **新增** | —                                                                  | **版本守卫**：不是 `v2.*` 就打 `WARNING`（**警告不是退出**，避免 `--version` 格式变化导致容器起不来） |

> **关于「版本守卫」**：这一条**超出任务书 A-2 的字面要求**，是本轮主动加的 —— 因为它正是
> 「装成 V1」这类 bug 的**最后一道拦网**（否则表现为「界面能开、发消息失败」，排查成本极高）。
> 有意做成**非致命**：只 `echo` 到 stderr，不 `exit 1`。

### 1.4 `docker-compose.build.yml` + `.env.example`

**`OPENCODE_INSTALL_URL` 是死参数 —— 已核实并替换**：

```bash
$ grep -rn "OPENCODE_INSTALL_URL" . --exclude-dir=node_modules --exclude-dir=.git
./.env.example:46:OPENCODE_INSTALL_URL=https://opencode.ai/install
./docker-compose.build.yml:31:        OPENCODE_INSTALL_URL: ${OPENCODE_INSTALL_URL:-https://opencode.ai/install}
```

只有「定义处」两处，**Dockerfile 从未声明/使用它**（`ARG`/`ENV`/`RUN` 里都没有）→ 确认是死参数，替换为：

| 文件                       | 改后                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `docker-compose.build.yml` | `OPENCODE_VERSION: ${OPENCODE_VERSION:-2.0.19}`（透传给构建参数） |
| `.env.example`             | `OPENCODE_VERSION=2.0.19`（附注释：本 UI 只支持 V2，别改成 v1.x） |

> `.env` 里的 `OPENCODE_VERSION` **只影响构建参数**，不会注入容器运行时环境
> （`docker-compose.yml` 的 backend `environment:` 是**显式列举**的，没有它）。
> 容器里那份来自 Dockerfile 的 `ENV`。

### 1.5 验证（**如实：没有真跑 docker build**）

容器内**没有 docker daemon**（只有 CLI），无法 `docker build`。做了能做的**最强验证**：

|   # | 验证手段                                                                                      | 结果                                                                                            |
| --: | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
|   ① | **重新下载双架构 tarball + `sha256sum` 复核**                                                 | ✅ 与任务书给的值**完全一致**（§1.1）                                                           |
|   ② | **tarball 结构 + 解包实跑**                                                                   | ✅ 单个 `opencode` 文件；x64 实跑输出 `opencode v2.0.19`（arm64 在 x64 主机上无法执行，属预期） |
|   ③ | **把 Dockerfile 的 `case` 块逻辑原样抄出来跑**（`/tmp/opencode/p4/verify-dockerfile-run.sh`） | ✅ 两个架构都 `OK`、解压出 `opencode`、版本正确                                                 |
|   ④ | **负向验证**：故意把哈希最后一位 `5` 改成 `4`                                                 | ✅ `sha256sum: FAILED` → **证明校验不是恒真**                                                   |
|   ⑤ | **交叉验证**：拿 x64 的哈希去校验 arm64 包                                                    | ✅ `FAILED` → 证明两个架构哈希确实不同                                                          |
|   ⑥ | `bash -n docker/backend-entrypoint.sh`                                                        | ✅ 语法通过（exit 0）                                                                           |
|   ⑦ | 全仓库 `grep OPENCODE_INSTALL_URL`                                                            | ✅ **0 命中**（死参数清干净）                                                                   |
|   ⑧ | 🔥 **拿新渠道下载的二进制当真实服务跑完整冒烟**                                               | ✅ **5 个套件 44/44**（§8）—— 这直接证明了**钉住的这个产物本身可用**                            |

**如实标注**：**未做 `docker build`**。回归清单 §1.1/§1.3 已给用户一条**明确的构建验证步骤**
（构建后先跑 `docker compose exec backend opencode --version`，**必须**以 `v2.` 开头）。

### 1.6 升版本备忘（已写进 Dockerfile 注释）

```bash
# ① 改 ARG OPENCODE_VERSION 的默认值
# ② 重算两个架构的哈希：
curl -fsSL -o t.tar.gz https://opencode.ai/files/bin/<新版本>/opencode-linux-x64.tar.gz
sha256sum t.tar.gz
curl -fsSL -o t.tar.gz https://opencode.ai/files/bin/<新版本>/opencode-linux-arm64.tar.gz
sha256sum t.tar.gz
```

> 版本索引可查 `https://update.opencode.ai/api/dev`（v2 分支快照）与 `/api/beta`。
> 实测 `/api/dev` 与 `/api/beta` 之外的 `/api/latest/cli/npm` 返回 `2.0.20`（本轮写报告时）。

---

## 2. 任务 B：README 版本要求

**改动（最小）**：在**两处入口**加「需要 v2」的显式要求 —— `README.md` 与 `README_EN.md` 各 +6 / −1 行。

| 文件 / 位置             | 改动                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`「快速体验」 | 标题下新增引用块：**需要 OpenCode v2**（如 `v2.0.19`）／**本 UI 只支持 V2，不支持 v1.x**／用 `opencode --version` 确认以 `v2.` 开头 |
| `README.md`「本地开发」 | 「需要一个运行中的 OpenCode 后端」→ 补 **v2** + 「只支持 V2，不支持 v1.x」+ 确认命令                                                |
| `README_EN.md` 同两处   | 英文对应文案                                                                                                                        |

**顺带扫 V1 时代过时说法**：`grep -n "v1\|V1\|1\.16\|latest\|releases" README*.md` → 命中的
只有「从 Releases 下载安装包」（指**本项目的**安装包，不是 opencode 的）→ **没有过时说法需要改**。

> 有意**没有**在 README 里写「Docker 镜像钉的是 2.0.19」：那是实现细节，且会随升级漂移；
> 需要改版本的人会去看 `docker-compose.build.yml` / `.env.example`（那里有注释）。

---

## 3. 任务 C：孤儿文件删除

**删前再 grep 一次**（确认零引用）：

```bash
$ grep -rn "openapi_doc\.json" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist
./docs/opencode-v2-migration.md:1144:  ← 只在文档里被「列为待删」
./docs/opencode-v2-migration.md:1291
./docs/opencode-v2-migration-phase3b.md:32,460,696
```

→ **代码零引用**；命中的 5 处**全部**是 `docs/` 里「把它们列为待删」的记录。

**内容确认是 V1 快照**：

```json
{ "openapi": "3.1.1", "info": { "title": "opencode", "version": "0.0.3" },
  "paths": { "/global/health": { … } } }
```

`/global/health` 是 **V1 独有**端点（V2 已彻底移除，二进制里 0 命中）→ 确认是 V1 时代的导出物。

**执行**：

```bash
$ rm openapi_doc.json openapi_formatted.json
$ git status --porcelain | grep openapi
 D openapi_doc.json
 D openapi_formatted.json
```

| 文件                     |   大小 | 处置                                  |
| ------------------------ | -----: | ------------------------------------- |
| `openapi_doc.json`       | 213 KB | ✅ 已删除（git 跟踪文件，显示为 `D`） |
| `openapi_formatted.json` | 283 KB | ✅ 已删除（同上）                     |

> 后续若需要 V2 的 openapi，权威来源是**二进制导出**（`opencode` 自带的 spec，
> 115 路径 / 247 schema），不是仓库里的静态快照 —— 这也是阶段 0 的结论。

---

## 4. 任务 D：兼容 shim 复核 + 过时注释清理

### 4.1 §9.3 五条 shim 逐条复核（**全部已解决，逐条勾选**）

|   # | shim                                                                 | 复核方式（本轮实跑）                                                                   | 结果                                                                                                                                                   |
| --: | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   ① | `src/api/events.ts:578` 的 `properties.info ?? properties.message`   | `grep -rn "getMessageInfo\|properties\.info\|properties\.message" src/`                | ✅ **0 命中**（`getMessageInfo` 整个函数已随事件层重写消失）                                                                                           |
|   ② | `normalizeSessionError()`（兼容 `{name,data}` / `{error:{…}}`）      | `grep -rn "normalizeSessionError" src/`                                                | ✅ **0 命中**（`session.execution.failed` 直接透传 V2 的 `{type,message,status?}`）                                                                    |
|   ③ | `src/api/pty.ts:27` 的 `normalizePty()`（`running` → `status`）      | `grep -rn "normalizePty" src/`                                                         | ✅ **0 命中**（3a 已核实该函数早已不存在；`Pty` 就地按 V2 形状定义）                                                                                   |
|   ④ | `SessionChangesPanel` / `useFileExplorer` 的 patch 回退 before/after | 读 `SessionChangesPanel.tsx:968-978` + `useFileExplorer.ts:501-502`                    | ✅ **回退分支已删**；剩下的 `before/after` 是从 **`patch` 解析出来的局部变量**（`extractContentFromUnifiedDiff`），不是「读 API 的 before/after 字段」 |
|   ⑤ | `opencode.rs` 的「先试 `/api/health` 再试 `/global/health`」         | `grep -n "api/health\|global/health\|api/info" src-tauri/src/app/commands/opencode.rs` | ✅ **只发 `GET /api/info`**；`/global/health` 只出现在**解释历史的注释**里（第 69–78 行）                                                              |

> 结论：**主文档 §9.3 的 5 条全部落实**，无遗留。

### 4.2 过时注释清理（任务 D 的第二半）

**目标**：全仓库找「`notMigratedYet` / 阶段 2a 未迁移 / 类似措辞」的**已不成立**的说法。

`grep -rn "notMigratedYet"`（排除 docs）命中 7 处，逐条判定：

| 位置                                             | 判定                      | 处置                                                                                    |
| ------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------- |
| `src/api/pty.ts:6`、`vcs.ts:18`、`worktree.ts:6` | ✅ **成立**（历史叙述）   | 保留 —— 它们说的是「本文件原有 N 处占位已全部落地」，是**已完成**的说明，不是「还没做」 |
| `src/api/phase1Smoke.test.ts:271`                | ✅ 成立（历史叙述）       | 保留                                                                                    |
| `src/features/phase3b.removal.test.ts:114-115`   | ✅ 成立（**断言字符串**） | 保留 —— 那是守卫测试**故意**写的字符串                                                  |
| **`src/api/v2Convert.ts:227`**                   | 🔴 **已不成立**           | **已改**（见下）                                                                        |

**另外发现 7 处同类过时措辞并一并改掉**（都在**注释**里，不涉及逻辑）：

| 文件:行                                  | 过时原文                                                               | 改成                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/v2Convert.ts:226-228`           | 「权限的**回复 API** 属阶段 3（`permission.ts` 仍是 notMigratedYet）」 | 「✅ 阶段 3a 已把回复 API 迁移完成；本函数仍是事件载荷 → 内部模型的唯一入口」                                                                        |
| `src/types/api/event.ts:318`             | 「权限的**回复 API** 仍属阶段 3」                                      | 「回复 API 已在阶段 3a 迁移」                                                                                                                        |
| `src/types/api/event.ts:501`             | 「V1 形状，permission 链路**整体属阶段 3**」                           | 「回复 API 已在阶段 3a 迁移到 V2」                                                                                                                   |
| `src/types/api/event.ts:504`             | 「V2 的 Form 体系，**渲染器属阶段 3**」                                | 「渲染器 `FormDialog` 已在阶段 3a 落地」                                                                                                             |
| `src/types/api/event.ts:507`             | 「V1 形状，**project 链路属阶段 3**」                                  | 「project 链路已在阶段 1/3a 迁移，见 `src/api/client.ts`」                                                                                           |
| `src/types/api/mcp.ts:107`               | 「先原样带出来，**归阶段 3b 决定要不要展示**」                         | 「阶段 3b 已决定**不做**模板展示；模板保留在类型层备用」                                                                                             |
| `src/hooks/useGlobalEvents.test.tsx:534` | 「**表单渲染属阶段 3**」                                               | 「表单渲染走底部 `FormDialog`，阶段 3a 已落地」                                                                                                      |
| `src/api/message.ts:226`                 | 「『用户换模型 → 切会话模型』的 UI 联动**属阶段 3**」                  | 改成**当前事实**：UI 走本地选择（`useModelSelection` → `serverStorage`），发送时写 `metadata.model`；**有意不调用** `session.switchModel`（见 §4.3） |

> `grep -rn "归 3b\|归阶段 3\|属阶段 3\|留待阶段 4\|待阶段"` 复查后 **0 命中**（剩余 2 处命中是
> `QuestionRenderer.tsx` 与 `phase3a.smoke.test.ts` 里的**历史叙述**，成立 → 保留）。

### 4.3 顺带核实的一条「文档没写的事」：`session.switchModel` 本项目**有意不用**

改 `message.ts` 注释时去 SDK 里核了一遍：

- V2 SDK **确实提供** `session.switchModel`（`SessionSwitchModelInput` → `POST /api/session/{id}/model`，返回 `void`）。
- 但本项目**从未调用它**：模型选择是**本地偏好**（`useModelSelection` → `perServerStorage`），
  发送时只把所选模型写进 `metadata.model`。
- 3a 的注释写成「属阶段 3（需要 `session.switchModel`）」，**容易被误读为「漏做了」** →
  已改成明确写出「**有意不调用（YAGNI）**」并给理由。

> **修订（2026-09-30）**：此结论**已推翻** —— 真实使用中「切换模型不生效」暴露了该缺口：
> 不调 `switchModel` 时服务端永远使用会话当前模型（新会话 = 默认模型），界面选择形同虚设。
> 现已改为**发送前必调**（幂等：模型不变时零开销），并在建会话时带上所选模型，
> 见主文档 §10.6。

### 4.4 额外发现：`v1Model.ts` 头部有 2 处过时/错误注释（**已修**）

扫「过时注释」时把 `src/types/api/v1Model.ts` 的头部也逐行看了一遍（它未被前几轮清理到）：

| #   | 位置         | 原文                                                              | 问题                                                                                                                                           | 处置                                                                                                     |
| --- | ------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ①   | 头部第 5 行  | 「🔴 这个文件是**临时过渡物**…**阶段 2/3 完成迁移后应整体删除**」 | **已不成立**：阶段 2/3 都已完成，而该文件被**有意保留并收敛**（3b 明确写了「剩余 42 个均有活跃引用」）→ 两句话**自相矛盾**，会误导后来者去删它 | 改成「阶段 2b/3b 已把无用部分删净，剩下的 42 个全部有活跃引用 → **不会再被整体删除**，是在用的类型契约」 |
| ②   | 头部第 27 行 | 「104 → 42 个顶层导出，**1492 → 880 行**」                        | **数字错了**：`wc -l` 实测 **920 行**（主文档与 3b 报告都写 920）→ 只有这一处是 880                                                            | 改成 **920 行**                                                                                          |
| ③   | 头部第 80 行 | 「剩下的 104 个就是 B 桶，**留给阶段 3**」                        | **已不成立**：B 桶收敛是 3b 做的且已完成 → 读起来像「还有待办」                                                                                | 改成「✅ 阶段 3b 已收敛到 **42 个**（见上方）」                                                          |

> ⚠️ **刻意保持 920 行不变**：①②③ 三处都用「1 行换 1 行」的改法（该文件本来就有 154 字符的长注释行），
> 免得把主文档里 4 处「920 行」的指标改旧 —— 改完实测 `wc -l` = **920**、导出数 = **42**，与文档一致。

---

## 5. 任务 E：Rust 编译验证（**本轮从「未验证」变成「已验证」**）

### 5.1 装依赖（用户已许可）

容器内以 `coder` 用户跑 `apt-get` 会 `Permission denied`（`/var/lib/apt/lists/partial` 不存在且不可写）
→ 改用 `sudo`（`sudo -n true` 可用，**无需密码**）：

```bash
sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libssl-dev patchelf libxdo-dev pkg-config build-essential
```

✅ **全部装成功**（含 `libwebkit2gtk-4.1-dev 2.52.6-1~deb13u1`、`libgtk-3-dev 3.24.49-3`、
`libayatana-appindicator3-dev 0.5.94-1`）。**任务书给的起步清单一次就够，没有缺包**。

### 5.2 `cargo check`（**跑了三次，全部通过**）

| 轮次                  | 命令                                                                                  | 结果                                                                       |
| --------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ① 增量（共享缓存）    | `cd src-tauri && cargo check -j 4`                                                    | ✅ **exit 0**，`Finished dev profile in 41.20s`                            |
| ② **从零开始**        | `CARGO_TARGET_DIR=/tmp/opencode/p4/cargo-target CARGO_INCREMENTAL=0 cargo check -j 4` | ✅ **exit 0**，`Finished dev profile in 1m 03s`                            |
| ③ 改完 WSL 代码后增量 | `CARGO_TARGET_DIR=…/p4/cargo-target cargo check -j 4`                                 | ✅ **exit 0**，`Finished dev profile in 3.42s`（只重编 `opencodeui` 自己） |

**从零那次的规模证据**（证明不是「缓存命中空跑」）：

```
$ ls /tmp/opencode/p4/cargo-target/debug/.fingerprint | wc -l   → 692   （检查过的 crate 数）
$ find …/deps -name '*.rmeta' | wc -l                            → 495
$ ls …/.fingerprint | grep -cE "^tauri|^gtk|^webkit|^glib|^wry"  → 57
$ du -sh /tmp/opencode/p4/cargo-target                           → 1.4G
```

**唯一的警告**（**与本项目改动无关，是既有的**）：

```
warning: unused variable: `window`
  --> src/app/mod.rs:242:32
   fn finish_desktop_window_setup(window: &tauri::WebviewWindow) {
```

- 该文件**不在本阶段（也不在 3b）的改动清单里**（`git status` 只显示 `opencode.rs` / `wsl_commands.rs` / `wsl_runtime.rs` 被改）。
- 成因：函数体在 `#[cfg(windows)]` / `#[cfg(target_os="macos")]` 下才用 `window`，
  **在 Linux 上编译时该参数确实未使用** → Linux-only 的编译警告，**不是缺陷**。
- **未修**：属无关改动（改它会产生与本轮无关的 diff），如实记录。

### 5.3 🔴 顺带发现的第二个「装成 V1」bug（WSL 安装按钮）

任务 F 让我核对 WSL 的 `resolve_opencode`。核的过程中发现**同一个文件里**还有个更严重的 bug：

```rust
// 改前（src-tauri/src/app/commands/wsl_runtime.rs:212）
"curl -fsSL https://opencode.ai/install | bash"
```

**为什么这是 bug**（把 `opencode.ai/install` 下载下来逐行看）：

```bash
$ curl -fsSL https://opencode.ai/install -o install-opencodeai.sh
$ grep -n "github\|releases" install-opencodeai.sh
184:  url="https://github.com/anomalyco/opencode/releases/latest/download/$filename"
185:  specific_version=$(curl -s https://api.github.com/repos/anomalyco/opencode/releases/latest | …)
```

→ 它就是**拉 GitHub 的 `latest`**，而 `latest` = **v1.18.33** → **用户点「安装 opencode」装的是 V1**。

**对照官方 v2.0.19 的做法**（`packages/desktop/src/main/wsl/runtime.ts:302` + `remote/cli.ts:76`）：

```ts
// 官方 installScript（source.type === "installer"）
curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/v2/install | bash -s -- --version '<版本>'
```

**修复**：

```rust
// 改后
"curl -fsSL https://opencode.ai/v2/install | bash"
```

**为什么用 `opencode.ai/v2/install` 而不是官方那个 raw 地址**：

```bash
$ diff <(curl -fsSL https://opencode.ai/v2/install) install-v2.sh   # ← 从 raw.githubusercontent 下的
内容完全一致 ✅        # 二者逐字节相同
$ curl -sI https://opencode.ai/v2/install | head -1
HTTP/2 200            # 可用
```

→ 用**官方安装脚本自己在 help 里宣传的**短地址（`opencode.ai/v2/install`），
内容与官方桌面版用的 raw 地址**完全一致**。

**为什么不传 `--version`**：官方桌面版钉的是「**它自己捆绑的 CLI 版本**」以便比对；
而 **OpenCodeUI 不捆绑 CLI**（`expected_version` 恒为 `null`，`wsl_types.rs:47-49` 有说明），
钉死某个版本反而可能把用户已装好的新版 v2 **降级**。需要钉版本时的写法已写进注释。

**落点核对**（保证装完能被 `resolve_opencode` 找到）：

```
v2 安装脚本第 69 行：INSTALL_DIR=$HOME/.opencode/bin
→ 正是 resolve_opencode 查找的 $HOME/.opencode/bin/opencode ✅
```

**已知代价（如实）**：v2 安装脚本从 **npm 官方源**取包，**没有可切换的镜像参数** → 国内网络可能较慢。
已写进注释与回归清单 §2.4（让用户遇到时报网络信息）。

---

## 6. 任务 F：WSL `resolve_opencode` 行为差异 —— **复核结论：不改（且 3b 的结论是错的）**

### 6.1 3b 的说法 vs 源码事实

**3b 报告 §5.5 原文**：「`resolve_opencode` 只检查 `$HOME/.opencode/bin/opencode`；
而官方 `remote/cli.ts:26` 的 `discoverScript()` 还会先试 `command -v opencode`、
再试缓存目录 → **用 npm/bun 全局安装 opencode 的 WSL 用户会被本项目误判为「未安装」**」

**逐行读 v2.0.19 源码后：该结论不成立。**

```ts
// packages/desktop/src/main/remote/cli.ts:26
export function discoverScript(options: { fromPath?: boolean; cache?: {…} } = {}) {
  return `cli=${options.fromPath ? "$(command -v opencode || true)" : '""'}
if [ -z "$cli" ] && [ -x "$HOME/.opencode/bin/opencode" ]; then cli="$HOME/.opencode/bin/opencode"; fi
${options.cache ? `…for binary in "$HOME"/…/opencode; do …` : ""}
if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
`
}
```

关键在**调用点**：

```ts
// packages/desktop/src/main/wsl/runtime.ts:339  ← WSL 路径
export async function resolveWslCli(distro: string, opts?: RunWslOptions) {
  return firstLine((await runWslSh(RemoteCli.discoverScript(), distro, opts)).stdout)
}                                    // ↑↑↑ 不传任何 options → fromPath 为 undefined

// packages/desktop/src/main/ssh/bootstrap.ts:20   ← SSH 路径（**唯一**传 fromPath 的地方）
${RemoteCli.discoverScript({ fromPath: true, cache: { directory: ".opencode/desktop-ssh", … } })}
```

→ **WSL 路径下 `fromPath` 未设置** ⇒ 第一行就是 `cli=""`，**根本不会执行 `command -v opencode`**；
`cache` 分支同理（只有 SSH 传）。**官方 WSL 的语义 = 只查 `$HOME/.opencode/bin/opencode`。**

**3b 是把 SSH 的行为错当成 WSL 的行为。**

### 6.2 本项目的实现（**逐字节等价**）

```rust
// src-tauri/src/app/commands/wsl_runtime.rs（未改）
r#"if [ -x "$HOME/.opencode/bin/opencode" ]; then printf "%s\n" "$HOME/.opencode/bin/opencode"; fi"#
```

官方（WSL，无参）展开后：

```sh
cli=""
if [ -z "$cli" ] && [ -x "$HOME/.opencode/bin/opencode" ]; then cli="$HOME/.opencode/bin/opencode"; fi
if [ -n "$cli" ]; then printf '%s\n' "$cli"; fi
```

→ **语义完全一致**（`cli` 恒为空串，第一个 `if` 恒真，最后原样打印）✅

**旁证**：官方安装脚本（`wslCliInstallCommand` → `RemoteCli.installScript`）的落点也是
`$HOME/.opencode/bin/opencode`（`v2/install` 第 69 行 `INSTALL_DIR=$HOME/.opencode/bin`）
→ **「只认这个路径」正是官方设计**：WSL 里要的是**受管安装**，这样版本可控、能被安装/升级按钮修复。

### 6.3 结论：**不改**，并给出两条「改了反而更糟」的理由

**结论：`resolve_opencode` 保持现状**（已加**30 行注释**把上面这套依据写进代码，避免后来者再误判）。

**为什么不顺手加 `command -v opencode` 兜底**：

1. **会偏离官方 WSL 语义** —— 官方设计意图明确：WSL 用受管安装，SSH 才允许走 PATH 里的任意 opencode。
2. **有实际风险（这条更硬）**：WSL **默认把 Windows 的 PATH 追加进 Linux PATH**，
   而本项目的**启动脚本要专门剔除 `/mnt/*`** 才敢 `exec`：

   ```rust
   r#"PATH=$(awk -v RS=: -v ORS=: '$0 !~ /^\/mnt\//' <<<"$PATH" | sed "s/:$//")"#
   ```

   而 `resolve_opencode` 走的探测命令**没有**剔 `/mnt/*` → `command -v opencode` 很可能
   解析到 **Windows 侧的 `opencode.exe`**（例如 `/mnt/c/Users/…/opencode.exe`），
   接着 `read_command_version` 会去执行它、启动脚本还会 `exec` 这个 Windows 路径 → **更糟**。

> 因此 3b §5.5 的「建议单开任务评估」**可以关闭**：不是「暂缓」，是**不该做**。

---

## 7. 与文档不符之处（照例，本节最重要）

> 共 **7 条**：2 条是**任务书/前序报告写错**的，4 条是本轮**新发现**的，1 条是**源码注释里的数字错误**（§4.4）。

### 7.1 🔴 3b §5.5 / §9#7 的 WSL `resolve_opencode` 结论**是错的**

见 §6。**官方 WSL 路径也不查 `command -v opencode`**（那是 SSH 专有行为）。
→ 本项目**无需修改**；已回填主文档。

### 7.2 🔴 **任务书说「`OPENCODE_VERSION` 运行时无任何读取处」——对 CLI 成立，但要补一句例外**

- ✅ CLI 二进制：**不读**环境变量（是 bun 构建期 `define`；二进制里 `grep -a` **0 命中**）。
- ⚠️ **但 `packages/desktop/**`（Electron 桌面版）会读 `process.env.OPENCODE_VERSION`**：
`desktop/src/main/constants.ts:6`、`desktop/src/main/service/desktop-cli.ts:51`、
`desktop/scripts/\*`。
- **对本项目无影响**（烘焙的是 Docker 镜像里的 **CLI**，不涉及 Electron），但「无任何读取处」这个
  绝对说法**不准确** —— 后续若有人在 Tauri 侧设这个变量，要留意。

### 7.3 🔴 新发现：WSL「安装 opencode」按钮装的是 **V1**（见 §5.3）

任务书只点名了 Docker 那处。**这是同一 bug 类的第二处**，已修。

### 7.4 🟡 新发现：`phase1Smoke.test.ts` 的 ⑤ 有**隐性环境依赖**（隔离后必然失败）

|          | 内容                                                                                                                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **现象** | 按要求用 `XDG_CONFIG_HOME` 隔离后，⑤ 断言 `expect(configA).toHaveProperty('providers')` **失败**                                                                                                                                                                                        |
| **原因** | 该断言的前提是「**全局配置里有 providers**」。它此前能通过，只是因为它跑在**用户真实的 `~/.config/opencode`** 上（那里配了 provider）；换成空的 scratch 全局配置就必然失败                                                                                                              |
| **性质** | **不是迁移回归**，是用例耦合了运行环境（新机器 / CI 上同样会红）                                                                                                                                                                                                                        |
| **处置** | ① 把「全局配置要有 providers 探针」写成**启动前置条件**（文件头 + 一个真实的探针文件示例）；② ⑤ 里加 `assertGlobalProviderProbe()`：**缺了就明确失败并打印补救命令**，**不静默跳过**（避免「断言恒真」）；③ 探针用 `providers.smoke-probe` 且**实测能通过 V2 归一化并出现在合并视图里** |
| **安全** | 探针**由启动前的外部步骤写入**，测试**只读不写** —— 因为 `tsconfig.app.json` 的 `types` 只有 `["vite/client"]`，`src/**` **不能** import `node:fs`（全仓库零使用），且 `POST /api/fs/write` 是 location 作用域、写全局配置属越界                                                        |

### 7.5 🟡 新发现：`phase1Smoke.test.ts` 的 ⑥⑧ 是**偶发失败**（V2 location 惰性扫描）

|          | 内容                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **现象** | ⑥「Agent 列表」**第一次跑红、重跑绿**；⑧「命令列表」同类风险                                                                                            |
| **原因** | V2 的 **location 首次被访问时目录扫描可能还没完成** → 第一次只返回内置 agent/command，第二次才带出目录内的                                              |
| **旁证** | 同文件的 ④（模型）与 ⑦（skill）**早就**为同一行为写了「预热 + 重试」；⑥⑧ 漏了 → 所以它对「location 缓存是否已热」敏感（而缓存又受前面用例执行顺序影响） |
| **处置** | 按 ⑦ 的**既有写法**给 ⑥⑧ 加同样的预热重试（注释里写明是**阶段 4 实测复现**的偶发，不是新 bug）                                                          |
| **验证** | 修完**连跑 3 次 phase1 → 3 次都 13/13**（§8.2）                                                                                                         |

### 7.6 🟡 新发现：`cargo check` 会在 `src-tauri/gen/schemas/` 生成文件，**让 prettier 全仓库失败**

|          | 内容                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **现象** | 跑完 `cargo check` 后 `npx prettier . --check` **失败**，报 4 个文件：`src-tauri/gen/schemas/{acl-manifests,capabilities,desktop-schema,linux-schema}.json`       |
| **性质** | 这 4 个是 `tauri-build` 的**生成物**，`src-tauri/.gitignore:4` 已忽略 `/gen/schemas`（**未跟踪**），但 `.prettierignore` 没覆盖 → prettier 会去检查它们           |
| **后果** | 任何人跑一次 Rust 编译，`prettier --check` 就会红 —— **而 3b 报告声称「prettier 全仓库通过」是在没跑过 cargo check 的环境下得出的**                               |
| **处置** | `.prettierignore` 加一行 `src-tauri/gen/schemas`（**只忽略生成物**，`src-tauri/gen/android/**` 是**已跟踪**的源码，不能一起忽略）→ 复查 `prettier . --check` 通过 |

### 7.7 🟡 新发现：`v1Model.ts` 头部有 **2 处过时/错误注释**（含一个**数字错误**）

见 §4.4 的逐条表。摘要：

1. 「阶段 2/3 完成迁移后**应整体删除**」—— 已不成立（2/3 都完成了，而该文件被**有意保留并收敛**到 42 个导出），
   与同文件下方「剩余 42 个均有活跃引用」**自相矛盾**，会误导后来者去删。
2. 「1492 → **880 行**」—— **数字错了**，`wc -l` 实测 **920 行**（主文档与 3b 报告都写 920，
   只有这一处是 880）→ 属**源码注释里的笔误**。
3. 「剩下的 104 个就是 B 桶，**留给阶段 3**」—— 已不成立（B 桶收敛是 3b 做的且已完成）。

> 三处都已用「1 行换 1 行」改掉，**刻意保持 920 行不变**，免得把主文档里 4 处「920 行」的指标改旧。
> 改完实测：`wc -l` = **920**、顶层导出 = **42**（与文档一致）。

---

## 8. 任务 G：最终验证

### 8.1 静态检查（全部在**服务未启动**时跑）

| 项                    | 命令                         | 结果                                                                                   |
| --------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| 类型检查              | `npx tsc -b --force`         | ✅ **0 报错**（exit 0）                                                                |
| 格式化                | `npx prettier . --check`     | ✅ **All matched files use Prettier code style!**（含 §7.6 的 `.prettierignore` 修正） |
| Lint                  | `npx eslint .`               | ✅ **0 errors / 43 warnings**（与 3b 的 43 条**完全持平**，无新增）                    |
| 全量单测（180s 超时） | `timeout 180 npx vitest run` | ✅ **958 passed / 44 skipped / 0 failed**（108 文件通过 / 5 跳过 / 113 总计）          |

> 单测数字与 3b 基线**逐位一致**（958 / 44 / 1002）—— **零回归、零用例增减**。
> 说明：本轮改了 `phase1Smoke.test.ts`，但该文件在**没有服务**时整组 skip，故计数不变。

### 8.2 真实服务冒烟（**5 个套件 44/44**）

**服务用的是「本轮为新渠道下载并校验过哈希的那个二进制」**（`/tmp/opencode/p4/dl/x64root/opencode`），
不是本机原有的那份 —— 这同时构成 §1.5 ⑧ 的「产物可用」证据。

```bash
# 三个实例，全部带 XDG_CONFIG_HOME 隔离；端口固定 4097；用完逐个 kill
① cd /tmp/opencode/v2test/cwd && OPENCODE_SERVER_PASSWORD=t1 \
     XDG_CONFIG_HOME=/tmp/opencode/v2test/config \
     /tmp/opencode/p4/dl/x64root/opencode --log-level warn serve --hostname 127.0.0.1 --port 4097
   → 用于 phase1 / phase2a / phase2b / phase3a
② cd /tmp/opencode/p3b/ws && OPENCODE_SERVER_PASSWORD=t1 \
     XDG_CONFIG_HOME=/tmp/opencode/p3b/config \
     /tmp/opencode/p4/dl/x64root/opencode --log-level warn serve --hostname 127.0.0.1 --port 4097
   → 用于 phase3b（它的 ① 硬断言全局配置目录落在 /tmp/opencode/p3b/ 下）
③ 再起一次 ① 的配置，用于「prettier 重排后复跑 phase1」确认改动没被格式化破坏
```

服务身份实测：`GET /api/info` → `{"version":"2.0.19","pid":…,"urls":["http://127.0.0.1:4097"],…}` ✅

| 套件        | 命令                                                                                                                    | 结果                                  | 关键覆盖                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **phase1**  | `npx vitest run src/api/phase1Smoke.test.ts`                                                                            | ✅ **13/13**（**连跑 3 次都 13/13**） | 健康检查 / 会话列表按目录过滤 / 会话详情 / 模型 / **配置合并** / agent / skill / command / project / shell / 会话状态 / 已删能力 / 文件名搜索 |
| **phase2a** | `VITE_OPENCODE_SMOKE=1 npx vitest run src/features/message/phase2a.smoke.test.tsx`                                      | ✅ **8/8**                            | 游标分页 → 转换层 → **真实渲染 DOM**（含工具卡片 / 推理 / 整页 51 条消息、14.4 万字符不抛错）                                                 |
| **phase2b** | `VITE_OPENCODE_SMOKE=1 npx vitest run src/features/message/phase2b.smoke.test.tsx`                                      | ✅ **11/11**                          | **SSE 真连**（`[SSE] smoke connected (transport: browser-fetch)`）、事件流、流式增量、附件参数                                                |
| **phase3a** | `VITE_OPENCODE_SMOKE=1 npx vitest run src/api/phase3a.smoke.test.ts`                                                    | ✅ **6/6**                            | 中断（`interrupted=true`）/ 回退三段式 / 权限回复 / 表单 / PTY / MCP                                                                          |
| **phase3b** | `VITE_OPENCODE_SMOKE=1 VITE_OPENCODE_SMOKE_DIRECTORY=/tmp/opencode/p3b/ws npx vitest run src/api/phase3b.smoke.test.ts` | ✅ **6/6**                            | 配置读 / **shell 唯一可写** / 「传其它字段被静默丢弃」实证 / 客户端防线 / 已下架 API / 数据卫生                                               |

> **合计 44 个冒烟用例全部通过。**

### 8.3 数据卫生（**零残留，只读复核**）

服务全部关闭后，用 python3 的 `sqlite3` **以 `mode=ro` 只读**打开用户数据库复核：

```
=== 最终数据卫生复核 ===
  session_v2 总数: 661
  smoke/phase 特征标题             = 0
  /tmp/opencode 下的会话目录         = 0

（更细的分项，全部 = 0）
  title like '%phase1-smoke%'                = 0
  title like '%phase3a%'                     = 0
  title like '%phase3b%'                     = 0
  title like '%smoke%'                       = 0
  directory like '/tmp/opencode/v2test%'     = 0
  directory like '/tmp/opencode/p3b%'        = 0
  directory like '/tmp/opencode/p4%'         = 0
```

**关于 660 → 661 的那 1 条**：核对「按更新时间倒序前 12 条」后确认是**本对话自身**
（`ses_f0f3088b1ffdn0d3` / 标题「OpenCodeUI V2 迁移阶段 4 收尾」/ 创建于 13:35:23 = 本会话开始时刻）
→ **不是冒烟残留**。

**进程与端口**：

```
4097 → http=000（无响应）✅ 已停
4096 → http=401（用户自己的服务，**全程未触碰**，仍存活）✅
残留 opencode 进程：只剩 PID 8 的 `opencode serve --hostname 0.0.0.0 --port 4096`
```

### 8.4 配置隔离（**三个实例全部隔离**）

| 实例 | `XDG_CONFIG_HOME`             | 全局配置落点（实测 `GET /api/config` 的 `type:'directory'` 条目） |
| ---- | ----------------------------- | ----------------------------------------------------------------- |
| ①    | `/tmp/opencode/v2test/config` | `/tmp/opencode/v2test/config/opencode`                            |
| ②    | `/tmp/opencode/p3b/config`    | `/tmp/opencode/p3b/config/opencode`（phase3b 的硬断言要求）       |
| ③    | `/tmp/opencode/v2test/config` | 同 ①                                                              |

→ **没有一次写到用户的 `~/.config/opencode`**（3b 事故的整改要求已落实）。

---

## 9. 任务 H / I：产出与主文档收尾

### 9.1 交付物

| 文件                                                 | 内容                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docs/opencode-v2-migration-regression-checklist.md` | **手工回归清单**（面向非专业用户）：Docker / WSL / Tauri / 多服务器 四形态 + 已知未验证项 9 条 |
| `docs/opencode-v2-migration-phase4.md`               | 本文件                                                                                         |
| 主文档 `docs/opencode-v2-migration.md`               | §8 阶段 4 勾选 + 状态行改「全部阶段已完成」+ 新增「迁移完成总结」+ §9.3/§9.4/§10.5 终态        |

### 9.2 本轮改动规模

**阶段 4 独占的文件**（`git diff --numstat`，与前面阶段无重叠）：

```
.env.example                  2 +  1 -
.prettierignore               2 +  0 -
README.md                     6 +  1 -
README_EN.md                  6 +  1 -
docker-compose.build.yml      2 +  1 -
docker/Dockerfile.backend    29 +  7 -
docker/backend-entrypoint.sh 22 +  3 -
openapi_doc.json              （整文件删除，213 KB）
openapi_formatted.json        （整文件删除，283 KB）
```

**另有 7 个文件只改注释 / 只改测试 / 只改一行 URL**（行数**无法与前面阶段分离** —— 整个迁移自阶段 0 起从未提交，
`git diff --stat` 会把 0/1/2a/2b/3a/3b 的改动一起算进来）：

| 文件                                 | 本轮改了什么                                       | 规模（本轮）                                                                                     |
| ------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/api/v2Convert.ts`               | 过时注释                                           | −3 / +4 行注释                                                                                   |
| `src/api/message.ts`                 | 过时注释（模型切换口径）                           | −1 / +4 行注释                                                                                   |
| `src/types/api/v1Model.ts`           | 🔴 **2 处过时/错误注释**（见 §4.4）                | **净 0 行**（1→1、1→1 替换，刻意保持 920 行不变）                                                |
| `src/types/api/event.ts`             | 4 处过时注释                                       | 注释                                                                                             |
| `src/types/api/mcp.ts`               | 1 处过时注释                                       | 注释                                                                                             |
| `src/hooks/useGlobalEvents.test.tsx` | 1 处过时注释                                       | 注释                                                                                             |
| `src/api/phase1Smoke.test.ts`        | ⑤ 环境依赖修正 + ⑥⑧ 预热重试 + 文件头前置条件      | 测试健壮性                                                                                       |
| `src-tauri/…/wsl_runtime.rs`         | **install URL 修复** + `resolve_opencode` 依据注释 | **+56 行**（实测：install 注释 26 行、resolve 注释 31 行；另有 1 行 URL 是**就地替换**，不增行） |

**整个迁移（阶段 0 → 4，全部未提交）的总规模**（仅供参考）：

```
264 files changed, 11681 insertions(+), 27700 deletions(-)
删除的跟踪文件 33 个；新增文件 29 个
```

---

## 10. 遗留项（如实，**没有隐藏**）

|   # | 事项                                                   | 性质                                                                                                                                                                                  | 谁来收                                                                                   |
| --: | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
|   1 | **未真跑 `docker build`**                              | 环境限制（容器内无 docker daemon）                                                                                                                                                    | 用户按回归清单 §1.1 跑一次，**并先验 `opencode --version`**                              |
|   2 | **未实测 WSL 端到端**                                  | 环境限制（非 Windows、无 `wsl.exe`）                                                                                                                                                  | 用户按回归清单 §2                                                                        |
|   3 | **未实测 Tauri 桌面的 PTY 终端「先取 ticket 再连」**   | 环境限制（无 Tauri 运行时）—— **本轮已补齐 `cargo check` 编译验证**，但**运行时行为仍未验证**                                                                                         | 用户按回归清单 §3.2（**重点**）                                                          |
|   4 | **未实测 Tauri 桌面 SSE 流式（`plugin-http`）**        | 同上                                                                                                                                                                                  | 用户按回归清单 §3.3（**重点**）                                                          |
|   5 | **未做浏览器人工点击回归**                             | 沿用前几轮做法；已用「单测 + 真实服务冒烟 + 静态守卫」三重替代                                                                                                                        | 用户按回归清单全篇                                                                       |
|   6 | **多服务器并发未实测**                                 | 只跑了单服务器                                                                                                                                                                        | 用户按回归清单 §4.2                                                                      |
|   7 | **WSL 安装按钮的真实网络未验证**                       | v2 安装脚本从 npm 官方源取包，国内网络表现未知                                                                                                                                        | 用户按回归清单 §2.4                                                                      |
|   8 | **`cargo check` 的 1 条 Linux-only 警告未修**          | `src/app/mod.rs:242` 的 `unused variable: window`（`#[cfg(windows)]`/`macos` 才用）—— 与本轮改动无关                                                                                  | 可留待需要时顺手修（改了会产生无关 diff）                                                |
|   9 | **配置编辑器「shell 当前值来自全局、只读区来自合并」** | 3b 交接 §9#9 的**有意语义选择**（写入口写的是全局，所以显示「会被写入的值」更有用）—— 已在文案写明                                                                                    | 保持现状（如需改口径再调整）                                                             |
|  10 | **`OPENCODE_SERVER_USERNAME` 仍是 no-op**              | v2.0.19 零读取处，**有意保留 + 注释**（官方 test/docs 都引用它，后续可能恢复读取）                                                                                                    | 保持现状                                                                                 |
|  11 | **V2 新增能力未接入**                                  | `persistent-pty` / `plugin RPC` / `/api/shell` / `/api/websearch` / `/api/rpc` / `session.inbox` / `session.instructions` / `/api/vcs/base` / `/api/vcs/branch` / `fs/write`（YAGNI） | 需要时再开新阶段                                                                         |
|  12 | **整个迁移从未 git 提交**                              | 硬性约束（禁止 commit）。⚠️ **`docs/` 整个目录也未被跟踪**（`git ls-files docs/` 为空且未被 ignore）—— 9 个报告都是未提交状态                                                         | **用户自行提交**（提交时留意：本轮含 2 个文件删除；`docs/` 需要 `git add` 才会进版本库） |
