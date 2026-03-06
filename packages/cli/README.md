# anyterm

Stream your terminal to any device. End-to-end encrypted. The server never sees your data.

Run any command locally, access it from your browser, phone, or tablet. Full interactive terminal with colors, unicode, and TUI support. Every byte encrypted before it leaves your machine.

```bash
npm i -g anyterm
anyterm login
anyterm run claude
# Open your browser → full interactive terminal, from anywhere
```

## Why anyterm

Your terminal stays on your machine. You get a live, encrypted window into it from any device.

- **Any command.** Claude Code, vim, htop, docker logs, ssh, your own scripts. Not locked to one tool.
- **True zero-knowledge encryption.** XChaCha20-Poly1305 with X25519 key exchange. The relay server stores only ciphertext. Even a full database breach reveals nothing.
- **Bidirectional.** Type in the browser, keystrokes go to the real shell. Not a read-only viewer.
- **Port forwarding.** Expose localhost ports through encrypted tunnels. See your dev server live in the browser, side-by-side with the terminal.
- **Daemon mode.** Run `anyterm daemon` on your machine, spawn terminals remotely from the web dashboard or your phone.
- **Session recording.** Every session saved encrypted. Replay anytime.
- **Self-hostable.** Source-available, run on your own infrastructure. Free forever.

## Install

```bash
npm i -g anyterm
```

Requires Node.js 20+.

## Quick start

```bash
# Authenticate (credentials stored in your OS keychain)
anyterm login

# Stream a terminal session
anyterm run

# Stream a specific command
anyterm run claude

# Stream with port forwarding
anyterm run "npm run dev" --forward 3000

# Run as a background daemon (spawn sessions from the web)
anyterm daemon
```

Open [anyterm.dev](https://anyterm.dev) in your browser to view and interact with your sessions.

## Commands

### `anyterm login`

Authenticate and store credentials securely.

```bash
anyterm login                              # Cloud (anyterm.dev)
anyterm login -s https://self-hosted.co    # Self-hosted server
```

Credentials are stored in your OS keychain (macOS Keychain, Windows Credential Vault, Linux libsecret). Falls back to local config with confirmation if keychain is unavailable.

For CI/headless environments, set `ANYTERM_AUTH_TOKEN` and `ANYTERM_MASTER_KEY` environment variables.

### `anyterm run [command]`

Capture a local terminal and stream it encrypted to the web.

```bash
anyterm run                          # Interactive shell
anyterm run claude                   # Stream Claude Code
anyterm run "npm run dev"            # Stream a dev server
anyterm run htop -n "Server Stats"   # Custom session name
anyterm run "npm run dev" --forward 3000,8080   # With port forwarding
```

| Flag | Description |
|------|-------------|
| `--forward <ports>` | Forward local ports (comma-separated) |
| `-n, --name <name>` | Session display name |

### `anyterm daemon`

Run a persistent background process. Spawn terminal sessions remotely from the web dashboard or mobile app without needing the CLI open.

```bash
anyterm daemon                                  # Start daemon
anyterm daemon -n "MacBook Pro"                 # Custom machine name
anyterm daemon --allow "claude,npm,node"        # Restrict allowed commands
```

| Flag | Description |
|------|-------------|
| `-n, --name <name>` | Machine display name (defaults to hostname) |
| `-d, --debug` | Enable debug logging |
| `--allow <patterns>` | Restrict spawnable commands (comma-separated substrings) |

### `anyterm list`

List your terminal sessions.

### `anyterm org`

Manage organizations.

```bash
anyterm org list      # List your organizations
anyterm org current   # Show active organization
anyterm org switch    # Switch active organization
```

### `anyterm logout`

Clear saved credentials.

## How encryption works

The server is a zero-knowledge relay. It routes encrypted bytes between your CLI and browser. It cannot decrypt anything.

```
Your machine                    Server                     Browser
    │                             │                           │
    ├─ capture PTY output         │                           │
    ├─ encrypt (XChaCha20)  ───►  ├─ relay ciphertext  ───►  ├─ decrypt
    │                             │  (cannot read)            ├─ render in xterm.js
    │                             │                           │
    ├─ decrypt  ◄───────────────  ├─ relay  ◄───────────────  ├─ encrypt keystrokes
    ├─ write to PTY stdin         │                           │
```

**Key hierarchy:**

1. Your password + Argon2id = master key (never leaves your device)
2. Master key encrypts your X25519 private key (server stores only ciphertext)
3. Each session gets a random session key, sealed with your public key
4. Every terminal chunk: XChaCha20-Poly1305(data, session key)

Database compromise = nothing. Not "we promise we don't look." Mathematically provable nothing.

## Port forwarding

Expose local ports through encrypted tunnels. See your running app in the browser, right next to the terminal.

```bash
anyterm run "npm run dev" --forward 3000
anyterm run "npm run dev" --forward 3000,8080,5173
```

The web dashboard shows a live iframe preview of your forwarded port. Navigate, interact, debug, all from your browser.

## Use cases

**Remote AI coding.** Run Claude Code, Cursor, Copilot, or any AI agent locally. Access the session from your phone while it works. anyterm auto-detects AI agents and tags them in your dashboard.

**DevOps on the go.** Check production logs, run diagnostics, manage containers from your phone. No VPN required.

**Encrypted session recording.** Every terminal session is saved encrypted. Replay for audits, compliance, or debugging. Even server admins can't read the recordings.

**Team collaboration.** Share encrypted terminal sessions with your team. Organization-level encryption keys, RBAC, SSO, audit logs.

**Teaching.** Stream a live terminal to students. They see exactly what you see, in real time, without screen sharing lag.

## Self-hosting

anyterm is fully self-hostable. Run the entire platform on your own infrastructure, free forever.

See the [full documentation](https://github.com/anyterm-io/anyterm) for setup instructions.

## Teams & organizations

anyterm supports multi-user organizations with:

- Role-based access control (owner, admin, member)
- Organization-level encryption keys
- SSO via OIDC
- Audit logging
- Stripe billing integration

Available on Team and Enterprise plans, or free when self-hosted.

## Pricing

| | Self-hosted | Pro | Team | Enterprise |
|---|---|---|---|---|
| Price | Free | $12/user/mo | $29/user/mo | Custom |
| Concurrent sessions | Unlimited | 3/user | 10/user | Custom |
| Retention | Unlimited | 7 days | 30 days | Up to 365 days |
| SSO & audit logs | - | - | Yes | Yes |

Self-hosted is always free. No feature gates, no SaaS cap, limited only by your infrastructure.

## Links

- Website: [anyterm.dev](https://anyterm.dev)
- GitHub: [github.com/anyterm-io/anyterm](https://github.com/anyterm-io/anyterm)
- Docs: [anyterm.dev/docs](https://anyterm.dev/docs)

## License

Source-available under [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/). Use, modify, and self-host freely. You can inspect every line of the encryption implementation.
