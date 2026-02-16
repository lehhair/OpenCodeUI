# OpenCodeUI

一个为 [OpenCode](https://github.com/anomalyco/opencode) 打造的第三方 Web 前端界面。

**本项目完全由 AI 辅助编程（Vibe Coding）完成**——从第一行代码到最终发布，所有功能均通过与 AI 对话驱动开发。

> **免责声明**：本项目仅供学习交流使用，不对因使用本项目导致的任何问题承担责任。项目处于早期阶段，可能存在 bug 和不稳定之处。

## 预览

<img width="2298" height="1495" alt="image" src="https://github.com/user-attachments/assets/dc68837b-0560-4701-b6ab-ecb13fdc1f4f" />
<img width="2296" height="1500" alt="image" src="https://github.com/user-attachments/assets/7a8d9754-69c4-49c5-99ee-6452d94f5420" />

## 特性

- **完整的 Chat 界面** — 消息流、Markdown 渲染、代码高亮（Shiki）
- **内置终端** — 基于 xterm.js 的 Web 终端，支持 WebGL 渲染
- **文件浏览与 Diff** — 查看工作区文件、多文件 diff 对比
- **主题系统** — 3 套内置主题（Eucalyptus / Claude / Breeze），支持明暗模式切换和自定义 CSS
- **PWA 支持** — 可安装为桌面/移动端应用
- **移动端适配** — 安全区域、触摸优化、响应式布局
- **浏览器通知** — AI 回复完成时推送通知
- **@ 提及与 / 斜杠命令** — 对话中快速引用文件和执行命令
- **自定义快捷键** — 可配置的键位绑定
- **Docker 部署** — 前后端分离容器化，开箱即用
- **桌面应用** — 基于 Tauri 的原生客户端（macOS / Linux / Windows）
- **动态端口路由** — 容器内开发服务自动发现，生成预览链接

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 7 |
| 样式 | Tailwind CSS v4 |
| 代码高亮 | Shiki |
| 终端 | xterm.js (WebGL) |
| Markdown | react-markdown + remark-gfm |
| 桌面 | Tauri 2 |
| 部署 | Docker (Caddy + Python Router) |

## 快速体验

无需部署，在本地启动 OpenCode 后端后直接访问托管版前端：

```bash
opencode serve --cors "https://lehhair.github.io"
```

然后打开 https://lehhair.github.io/OpenCodeUI/

## Docker 部署

### 架构与端口

部署包含三个服务，由 Gateway 统一对外：

| 服务 | 端口 | 说明 |
|------|------|------|
| Gateway | 6658（`GATEWAY_PORT`） | 统一入口，反代所有请求 |
| Gateway | 6659（`PREVIEW_PORT`） | 开发服务预览专用 |
| Frontend | 3000（内部） | 静态前端 |
| Backend | 4096（内部） | OpenCode API |
| Router | 7070（内部） | 动态端口路由（内置于 Gateway） |

### Gateway 路由规则

端口 `6658` 上的请求按以下规则转发：

| 路径 | 转发目标 | 说明 |
|------|---------|------|
| `/api/*` | Backend :4096 | OpenCode API，支持 SSE |
| `/routes` | Router :7070 | 动态路由管理面板 |
| `/preview/*` | Router :7070 | 预览端口切换 API |
| 其他 | Frontend :3000 | 前端静态资源 |

端口 `6659` 用于访问容器内开发服务，Router 自动扫描 `3000-9999` 端口，通过 `/p/{token}/` 路径生成预览链接。

### 部署步骤

```bash
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI

# 复制并编辑环境变量，至少填写一个 LLM API Key
cp .env.example .env

# 启动
docker compose up -d
```

访问 `http://localhost:6658`。

### 环境变量

编辑 `.env` 文件，关键配置：

```env
# LLM API Key（至少填一个）
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# 端口
GATEWAY_PORT=6658
PREVIEW_PORT=6659

# 工作目录（挂载到容器 /workspace）
WORKSPACE=./workspace

# 公网部署务必设置
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=your-strong-password

# 路由服务
ROUTER_SCAN_INTERVAL=5
ROUTER_PORT_RANGE=3000-9999
ROUTER_EXCLUDE_PORTS=4096
```

### 反向代理

Docker 默认监听 `127.0.0.1`，公网部署需在前面加反向代理。

**Nginx：**

```nginx
server {
    listen 443 ssl;
    server_name opencode.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:6658;
        proxy_http_version 1.1;

        # SSE（必须）
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;

        # WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
}

# 预览（可选，建议绑独立域名）
server {
    listen 443 ssl;
    server_name preview.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:6659;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

**Caddy：**

```caddyfile
opencode.example.com {
    reverse_proxy 127.0.0.1:6658 {
        flush_interval -1
    }
}

preview.example.com {
    reverse_proxy 127.0.0.1:6659
}
```

> **重要**：SSE 要求禁用缓冲。Nginx 需 `proxy_buffering off`，Caddy 需 `flush_interval -1`。

## 本地开发

需要一个运行中的 [OpenCode](https://github.com/anomalyco/opencode) 后端。

```bash
opencode serve

# 另一个终端
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI
npm install
npm run dev
```

Vite 启动在 `http://localhost:5173`，`/api` 自动代理到 `http://127.0.0.1:4096`。

## 桌面应用

从 [Releases](https://github.com/lehhair/OpenCodeUI/releases) 下载安装包，或本地构建：

```bash
npm install
npm run tauri build
```

## 项目结构

```
src/
├── api/                 # API 请求封装
├── components/          # 通用组件（Terminal、DiffView 等）
├── features/            # 业务模块
│   ├── chat/            #   聊天界面
│   ├── message/         #   消息渲染
│   ├── sessions/        #   会话管理
│   ├── settings/        #   设置面板
│   ├── mention/         #   @ 提及
│   └── slash-command/   #   斜杠命令
├── hooks/               # 自定义 Hooks
├── store/               # 状态管理
├── themes/              # 主题预设
└── utils/               # 工具函数

src-tauri/               # Tauri 桌面应用（Rust）
docker/                  # Docker 配置（Gateway / Frontend / Backend）
```

## 设计说明

部分 UI 风格参考了 [Claude](https://claude.ai) 的界面设计。

## 许可证

[GPL-3.0](./LICENSE)

---

*本项目由 Vibe Coding 驱动开发，如果你也对 AI 辅助编程感兴趣，欢迎交流。*
