<p align="center">
  <strong>anyterm</strong>
</p>

<p align="center">
  Stream your terminal anywhere. Zero-knowledge encrypted.
</p>

<p align="center">
  <a href="https://anyterm.dev">Website</a> · <a href="#quick-start">Quick Start</a> · <a href="#self-hosting">Self-Host</a> · <a href="https://github.com/anyterm/anyterm#readme">Docs</a>
</p>

---

anyterm streams your local terminal to the web with **end-to-end encryption**. Run any command — Claude Code, vim, htop — and access it from any browser with full interactivity. The server never sees your data.

```bash
npm i -g anyterm
anyterm login
anyterm run claude
# → Open browser → interact from anywhere
```

## How It Works

```
Your Machine                    Cloud                         Browser
┌──────────────┐          ┌──────────────┐          ┌──────────────────┐
│ node-pty      │  encrypt │ WebSocket    │  decrypt │ xterm.js         │
│ captures PTY  │────────→│ relay only   │────────→│ renders terminal  │
│ output        │          │ sees nothing │          │ full colors/input│
└──────────────┘          └──────────────┘          └──────────────────┘
```

1. **Your machine** captures raw terminal output via a pseudo-terminal
2. **Every byte** is encrypted with XChaCha20-Poly1305 before leaving your machine
3. **The server** relays ciphertext — it cannot decrypt anything
4. **The browser** decrypts and renders using xterm.js — full colors, unicode, interactive apps

## Features

- **Zero-Knowledge Encryption** — Argon2id key derivation, X25519 key exchange, XChaCha20-Poly1305 chunk encryption. The server stores only ciphertext.
- **Full Terminal Fidelity** — Colors, unicode, box drawing, interactive TUIs. Everything your terminal can show, anyterm streams.
- **Bidirectional Input** — Type in the browser, keystrokes arrive at the real PTY. Not just a viewer — a full remote terminal.
- **Session Persistence** — Terminal state is saved encrypted. Reconnect to any session and pick up where you left off.
- **Works with AI Tools** — Stream Claude Code, Cursor, Copilot CLI sessions live. Watch and interact from anywhere.
- **Self-Hostable** — Run on your own infrastructure for free. No vendor lock-in.

## Quick Start

### Cloud (anyterm.dev)

```bash
# Install the CLI
npm i -g anyterm

# Log in to your account
anyterm login

# Stream any command
anyterm run "claude"
anyterm run "htop"
anyterm run "vim project.ts"

# List active sessions
anyterm list
```

Open [anyterm.dev/dashboard](https://anyterm.dev/dashboard) to view and interact with your sessions.

### Self-Hosting

See the [Self-Hosting](#self-hosting) section below.

## Encryption Design

anyterm uses a layered key hierarchy so the server never has access to plaintext:

```
Password
  └─ Argon2id ──→ masterKey (32B, never leaves your device)
                    └─ encrypts X25519 privateKey → stored on server as ciphertext

Per session:
  random sessionKey (32B) → sealed with user's publicKey → stored on server

Terminal data:
  XChaCha20-Poly1305(chunk, sessionKey) → relayed as ciphertext
```

**What the server stores:**
| Data | Encrypted? |
|------|-----------|
| Email, username | No |
| Session metadata (name, command) | No |
| Public key | No (by design) |
| Private key | Yes (with masterKey) |
| Session key | Yes (with publicKey) |
| Terminal output | Yes (with sessionKey) |
| Keyboard input | Yes (with sessionKey) |

The server cannot decrypt your private key (needs your password), cannot decrypt session keys (needs your private key), and cannot decrypt terminal data (needs the session key).

## Architecture

```
packages/
  db/           @anyterm/db         Drizzle ORM schema, DB client factory, migrations
  utils/        @anyterm/utils      Crypto, types, binary WS protocol
  cli/          anyterm             CLI (login, run, list, logout)
apps/
  web/          @anyterm/web        Next.js app (UI, API routes, auth)
  server/       @anyterm/server     Node.js server (Next.js + WebSocket + Redis)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, xterm.js |
| Auth | better-auth (email/password, drizzle adapter) |
| Database | PostgreSQL (drizzle-orm) |
| Realtime | WebSocket (ws), Redis pub/sub |
| Encryption | @noble/ciphers, @noble/curves, @noble/hashes (Argon2id, X25519, XChaCha20-Poly1305) |
| Terminal | node-pty (CLI), xterm.js + WebGL (browser) |
| CLI | Commander.js, conf |

### Binary WebSocket Protocol

All WebSocket communication uses a compact binary protocol — no JSON overhead:

```
"VC" (2B) | version (1B) | type (1B) | sessionIdLen (4B) | sessionId | payloadLen (4B) | payload
```

Frame types: `SUBSCRIBE`, `UNSUBSCRIBE`, `ENCRYPTED_CHUNK`, `ENCRYPTED_INPUT`, `EVENT`, `RESIZE`, `PING`, `PONG`, `ERROR`, `SESSION_ENDED`, `HANDSHAKE_OK`

All clients authenticate via a JSON first-message handshake (`{ version, token, source }`) before sending binary frames.

## Self-Hosting

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 16+
- Redis 7+

### Setup

```bash
# Clone the repository
git clone https://github.com/anyterm/anyterm.git
cd anyterm

# Start PostgreSQL and Redis (or use your own)
docker compose up -d

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, BETTER_AUTH_SECRET

# Build shared package
pnpm --filter @anyterm/utils build

# Run database migrations
pnpm db:generate
pnpm db:migrate

# Start the server
pnpm dev
```

The app runs at `http://localhost:3000` with WebSocket on the same port.

### Environment Variables

| Variable | Description | Default |
|----------|------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://anyterm:anyterm@localhost:5432/anyterm` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `BETTER_AUTH_SECRET` | Auth session signing secret | — |
| `BETTER_AUTH_URL` | Public URL of the app | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Public URL (client-side) | `http://localhost:3000` |
| `PORT` | Server port | `3000` |

### Production Deployment

#### Recommended Stack

| Service | Provider | Purpose |
|---------|----------|---------|
| **Web app** | [Fly.io](https://fly.io) | Next.js frontend + API routes |
| **WS server** | [Fly.io](https://fly.io) | WebSocket relay (persistent connections) |
| **Database** | [Neon](https://neon.tech) | Serverless PostgreSQL |
| **Redis** | [Upstash](https://upstash.com) | Serverless Redis (pub/sub relay) |

#### 1. Database (Neon)

Create a project at [console.neon.tech](https://console.neon.tech). Copy the **pooled** connection string (use the `-pooler` hostname).

#### 2. Redis (Upstash)

Create a database at [console.upstash.com](https://console.upstash.com). Copy the connection string (`rediss://...`). Start with Pay-as-you-go.

#### 3. Install Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

#### 4. Deploy WS Server

```bash
# Create the app (from monorepo root)
fly apps create anyterm-ws

# Set secrets
fly secrets set -a anyterm-ws \
  DATABASE_URL="postgresql://...@...neon.tech/..." \
  REDIS_URL="rediss://...@...upstash.io:6379" \
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  BETTER_AUTH_URL="https://anyterm-web.fly.dev"

# Deploy (from monorepo root — Dockerfile needs full context)
fly deploy --config apps/server/fly.toml
```

Your WS server is now at `https://anyterm-ws.fly.dev`.

#### 5. Deploy Web App

```bash
# Create the app
fly apps create anyterm-web

# Set secrets (same DATABASE_URL, REDIS_URL, BETTER_AUTH_SECRET as WS server)
fly secrets set -a anyterm-web \
  DATABASE_URL="postgresql://...@...neon.tech/..." \
  REDIS_URL="rediss://...@...upstash.io:6379" \
  BETTER_AUTH_SECRET="<same secret as step 4>" \
  BETTER_AUTH_URL="https://anyterm-web.fly.dev"

# Deploy (from monorepo root)
fly deploy --config apps/web/fly.toml
```

Your web app is now at `https://anyterm-web.fly.dev`.

> **Note:** `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_WS_URL` are set as build args in `apps/web/fly.toml`. Edit the `[build.args]` section if you use a custom domain.

#### 6. Run Migrations

```bash
DATABASE_URL="postgresql://...@...neon.tech/..." pnpm db:migrate
```

#### 7. Connect the CLI

```bash
anyterm login -s https://anyterm-web.fly.dev
anyterm run "echo hello"
```

#### Custom Domain

```bash
# Add your domain to both apps
fly certs create -a anyterm-web yourdomain.com
fly certs create -a anyterm-ws ws.yourdomain.com

# Update build args in apps/web/fly.toml:
#   NEXT_PUBLIC_APP_URL = "https://yourdomain.com"
#   NEXT_PUBLIC_WS_URL = "wss://ws.yourdomain.com"

# Update BETTER_AUTH_URL secret on both apps:
fly secrets set -a anyterm-web BETTER_AUTH_URL="https://yourdomain.com"
fly secrets set -a anyterm-ws BETTER_AUTH_URL="https://yourdomain.com"

# Redeploy web app (build args changed)
fly deploy --config apps/web/fly.toml
```

#### Scaling

Both apps use `auto_stop_machines` to save costs when idle. To keep them always warm or scale up:

```bash
# Keep at least 1 instance running (default in fly.toml)
fly scale count 1 -a anyterm-web
fly scale count 1 -a anyterm-ws

# Scale up for more traffic
fly scale count 2 -a anyterm-ws
fly scale vm shared-cpu-2x -a anyterm-ws
```

#### Docker (Self-Contained)

For a single-server deployment with Docker:

```bash
cp .env.example .env
# Edit .env with production values
docker compose -f docker-compose.prod.yml up -d
```

This runs everything (web, WS server, PostgreSQL, Redis) on one machine.

## CLI Commands

```
anyterm login [-s <server>]     Authenticate and save credentials
anyterm run [command]            Stream a terminal session
anyterm list                     List your sessions
anyterm logout                   Clear saved credentials
```

### Examples

```bash
# Stream Claude Code
anyterm run claude

# Stream with a custom command
anyterm run "npm run dev"

# Interactive shell
anyterm run "zsh"

# Connect to a different server
anyterm login -s https://anyterm.example.com
```

## Development

```bash
# Start databases
docker compose up -d

# Install dependencies
pnpm install

# Build shared package (required first)
pnpm --filter @anyterm/utils build

# Run migrations
cp .env.example .env
pnpm db:generate && pnpm db:migrate

# Start dev server (Next.js + WebSocket)
pnpm dev

# In another terminal — test the CLI
cd packages/cli
pnpm dev login
pnpm dev run "echo hello"

# Run tests
pnpm test
```

## Pricing

Self-hosted is free forever. Cloud plans available at [anyterm.dev](https://anyterm.dev).

## License

anyterm is source-available under the [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) license.

**You can:** use, modify, self-host, and distribute anyterm freely.

**You cannot:** use anyterm to compete with anyterm or its hosted service.

See [LICENSE](./LICENSE) for the full text.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/anyterm.git
cd anyterm

# Install and build
pnpm install
pnpm --filter @anyterm/utils build

# Run tests
pnpm test

# Submit a PR
```
