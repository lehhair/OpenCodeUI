# OpenCodeUI

[中文](./README.md) | English

A third-party Web frontend for [OpenCode](https://github.com/anomalyco/opencode).

**This project is entirely built with AI-assisted programming (Vibe Coding)** — from the first line of code to the final release, all features were developed through conversations with AI.

> **Disclaimer**: This project is for learning and communication purposes only. We are not responsible for any issues arising from the use of this project. The project is in its early stages and may contain bugs and instabilities.

## Preview

<img width="2298" height="1495" alt="image" src="https://github.com/user-attachments/assets/dc68837b-0560-4701-b6ab-ecb13fdc1f4f" />
<img width="2296" height="1500" alt="image" src="https://github.com/user-attachments/assets/7a8d9754-69c4-49c5-99ee-6452d94f5420" />

## Features

- **Full Chat Interface** — Message streaming, Markdown rendering, code highlighting (Shiki)
- **Built-in Terminal** — Web terminal based on xterm.js with WebGL rendering
- **File Browsing & Diff** — Browse workspace files, multi-file diff comparison
- **Theme System** — 3 built-in themes (Eucalyptus / Claude / Breeze), light/dark mode toggle and custom CSS
- **PWA Support** — Installable as a desktop/mobile app
- **Mobile Friendly** — Safe area handling, touch optimization, responsive layout
- **Browser Notifications** — Push notifications when AI replies are complete
- **@ Mentions & / Slash Commands** — Quickly reference files and execute commands in conversations
- **Custom Shortcuts** — Configurable key bindings
- **Docker Deployment** — Containerized frontend and backend separation, ready to use out of the box
- **Desktop App** — Native client based on Tauri (macOS / Linux / Windows)
- **Dynamic Port Routing** — Auto-discovery of dev services inside containers, generates preview links

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | React 19 + TypeScript |
| Build | Vite 7 |
| Styling | Tailwind CSS v4 |
| Code Highlighting | Shiki |
| Terminal | xterm.js (WebGL) |
| Markdown | react-markdown + remark-gfm |
| Desktop | Tauri 2 |
| Deployment | Docker (Caddy + Python Router) |

## Quick Start

No deployment needed — after starting the OpenCode backend locally, access the hosted frontend directly:

```bash
opencode serve --cors "https://lehhair.github.io"
```

Then open https://lehhair.github.io/OpenCodeUI/

## Docker Deployment (Frontend Only)

For scenarios where `opencode serve` is already running, you only need a frontend UI container to connect to the existing backend.

```bash
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI

# Start (connects to host's opencode serve :4096 by default)
docker compose -f docker-compose.standalone.yml up -d
```

Visit `http://localhost:3000`.

**Connect to a remote backend:**

```bash
BACKEND_URL=your-server.com:4096 PORT=8080 docker compose -f docker-compose.standalone.yml up -d
```

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `BACKEND_URL` | `host.docker.internal:4096` | opencode serve address (without protocol prefix) |
| `PORT` | `3000` | Frontend listening port |

## Docker Deployment

### Architecture & Ports

The deployment consists of three services, unified through the Gateway:

| Service | Port | Description |
|---------|------|-------------|
| Gateway | 6658 (`GATEWAY_PORT`) | Unified entry point, reverse proxy for all requests |
| Gateway | 6659 (`PREVIEW_PORT`) | Dev service preview |
| Frontend | 3000 (internal) | Static frontend |
| Backend | 4096 (internal) | OpenCode API |
| Router | 7070 (internal) | Dynamic port routing (built into Gateway) |

### Gateway Routing Rules

Requests on port `6658` are forwarded according to these rules:

| Path | Target | Description |
|------|--------|-------------|
| `/api/*` | Backend :4096 | OpenCode API, supports SSE |
| `/routes` | Router :7070 | Dynamic route management panel |
| `/preview/*` | Router :7070 | Preview port switching API |
| Other | Frontend :3000 | Frontend static assets |

Port `6659` is used to access dev services inside the container. The Router automatically scans ports `3000-9999` and generates preview links via the `/p/{token}/` path.

### Deployment Steps

```bash
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI

# Copy and edit environment variables, fill in at least one LLM API Key
cp .env.example .env

# Start
docker compose up -d
```

Visit `http://localhost:6658`.

### Environment Persistence (Simplified)

The backend now retains only one core persistent volume: `opencode-home` (mounted at `/root`).

The backend entry script automatically verifies and supplements `opencode` / `mise` on startup to prevent toolchain loss after container rebuilds.

- OpenCode configuration and session cache
- npm / cargo / pip and other user-space caches
- Node / Python multi-version runtimes installed via `mise`

All of the above will be preserved after container rebuilds — no need to split into multiple small volumes.

When upgrading from older versions, the original `opencode-data/opencode-config/opencode-cache/opencode-npm/opencode-cargo/opencode-local/opencode-opt` volumes become orphaned and can be manually cleaned up after confirming data has been migrated.

First time entering the backend container, you can install and persist runtime versions directly:

```bash
docker compose exec backend mise use -g node@22 python@3.12
docker compose exec backend node -v
docker compose exec backend python -V
```

The `gateway` still retains a separate volume `opencode-router-data` for storing dynamic routing state.

### Environment Variables

Edit the `.env` file with the key configuration:

```env
# LLM API Key (fill in at least one)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Ports
GATEWAY_PORT=6658
PREVIEW_PORT=6659

# Working directory (mounted to /workspace in the container)
WORKSPACE=./workspace

# Must be set for public deployment
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=your-strong-password

# Router service
ROUTER_SCAN_INTERVAL=5
ROUTER_PORT_RANGE=3000-9999
ROUTER_EXCLUDE_PORTS=4096
```

### Reverse Proxy

Docker listens on `127.0.0.1` by default; public deployment requires a reverse proxy in front.

**Nginx:**

```nginx
server {
    listen 443 ssl;
    server_name opencode.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:6658;
        proxy_http_version 1.1;

        # SSE (required)
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

# Preview (optional, recommended to use a separate domain)
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

**Caddy:**

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

> **Important**: SSE requires buffering to be disabled. Nginx needs `proxy_buffering off`, Caddy needs `flush_interval -1`.

## Local Development

Requires a running [OpenCode](https://github.com/anomalyco/opencode) backend.

```bash
opencode serve

# In another terminal
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI
npm install
npm run dev
```

Vite starts at `http://localhost:5173`, `/api` is automatically proxied to `http://127.0.0.1:4096`.

## Desktop App

Download the installer from [Releases](https://github.com/lehhair/OpenCodeUI/releases), or build locally:

```bash
npm install
npm run tauri build
```

## Project Structure

```
src/
├── api/                 # API request wrappers
├── components/          # Common components (Terminal, DiffView, etc.)
├── features/            # Business modules
│   ├── chat/            #   Chat interface
│   ├── message/         #   Message rendering
│   ├── sessions/        #   Session management
│   ├── settings/        #   Settings panel
│   ├── mention/         #   @ mentions
│   └── slash-command/   #   Slash commands
├── hooks/               # Custom Hooks
├── store/               # State management
├── themes/              # Theme presets
└── utils/               # Utility functions

src-tauri/               # Tauri desktop app (Rust)
docker/                  # Docker config (Gateway / Frontend / Backend)
```

## Design Notes

Some UI styles are inspired by the [Claude](https://claude.ai) interface design.

## License

[GPL-3.0](./LICENSE)

## Star History

<a href="https://www.star-history.com/#lehhair/OpenCodeUI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=lehhair/OpenCodeUI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=lehhair/OpenCodeUI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=lehhair/OpenCodeUI&type=Date" />
 </picture>
</a>

---

*This project is driven by Vibe Coding. If you're also interested in AI-assisted programming, feel free to connect.*
