import { Command } from "commander";
import * as os from "node:os";
import WebSocket from "ws";
import { getConfig, getMachineId, getMachineName, setMachineName } from "../config.js";
import {
  generateSessionKey,
  encryptSessionKey,
  decryptChunk,
  openMessage,
  fromBase64,
  toBase64,
} from "@anyterm/utils/crypto";
import {
  createSubscribeFrame,
  createUnsubscribeFrame,
  createSpawnResponseFrame,
  createHttpResponseFrame,
  createSessionEndedFrame,
  createPongFrame,
  decodeFrame,
  FrameType,
} from "@anyterm/utils/protocol";
import { FRAME_VERSION, detectAgentType } from "@anyterm/utils/types";
import type {
  SpawnRequest,
  SpawnResponse,
  HttpTunnelRequest,
} from "@anyterm/utils/types";
import { gql } from "../graphql.js";
import { decryptPrivateKeyFromConfig } from "../shared/auth.js";
import { getSafeEnv, loadHeadlessTerminal } from "../shared/terminal.js";
import { proxyLocalHttp } from "../shared/http-proxy.js";
import {
  INITIAL_RECONNECT_DELAY,
  MAX_RECONNECT_DELAY,
  WS_CLOSE_TIMEOUT,
  MAX_COMMAND_LENGTH,
} from "../shared/constants.js";
import { type PtySessionState, createPtySessionState, createPtySessionManager } from "../shared/pty-session.js";

// Security limits
export const MAX_ACTIVE_SESSIONS = 20;

/** Parse forwarded ports from an untrusted spawn payload. */
export function parseSpawnForwardedPorts(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(Number)
    .filter((p: number) => Number.isInteger(p) && p >= 1 && p <= 65535);
}

/** Extract the base command name (basename of first word). */
export function extractCommandName(command: string): string {
  const cmdBase = command.split(" ")[0];
  return cmdBase.split("/").pop() || cmdBase;
}

/** Derive a session display name from an explicit name or command. */
export function deriveSessionName(spawnName: string, command: string): string {
  const cmdName = extractCommandName(command);
  return spawnName || cmdName.slice(0, 256);
}

/** Parse --allow into a list of substring patterns. Returns null if not set (allow all). */
export function parseAllowedCommands(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const patterns = raw.split(",").map(s => s.trim()).filter(Boolean);
  return patterns.length > 0 ? patterns : null;
}

/** Check if a command matches any allowed pattern (substring match). */
export function isCommandAllowed(command: string, allowedPatterns: string[] | null): boolean {
  if (!allowedPatterns) return true;
  return allowedPatterns.some(pattern => command.includes(pattern));
}

export const daemonCommand = new Command("daemon")
  .description("Run background daemon for web-initiated terminals")
  .option("-d, --debug", "Enable debug logging")
  .option("-n, --name <name>", "Display name for this machine (defaults to hostname)")
  .option("--allow <patterns>", "Restrict spawnable commands (comma-separated patterns, e.g. claude,npm,node)")
  .action(async (opts) => {
    const debug = opts.debug || !!process.env.DEBUG;
    const log = (...args: unknown[]) => console.log("[daemon]", ...args);
    const dbg = debug ? (...args: unknown[]) => console.debug("[daemon]", ...args) : () => {};

    // Command allowlist
    const allowedCommands = parseAllowedCommands(opts.allow as string | undefined);
    if (allowedCommands) {
      log(`Command allowlist: ${allowedCommands.join(", ")}`);
    }

    // Machine identity
    const machineId = getMachineId();
    if (opts.name) {
      setMachineName(opts.name);
    }
    const machineName = opts.name || getMachineName();
    log(`Machine: ${machineName} (${machineId})`);

    const cfg = await getConfig();
    const { serverUrl, wsUrl, authToken, publicKey, encryptedPrivateKey, keySalt } = cfg;

    // Decrypt private key
    const privateKey = await decryptPrivateKeyFromConfig(cfg);

    const pubKey = fromBase64(publicKey);

    // Dynamic imports for headless terminal
    const headlessClasses = await loadHeadlessTerminal();
    if (!headlessClasses) {
      log("Headless terminal unavailable — snapshots disabled");
    }

    // Dynamic import node-pty
    const pty = await import("node-pty");

    const activeSessions = new Map<string, PtySessionState>();
    let ws: WebSocket | null = null;
    let shuttingDown = false;

    const ptyManager = createPtySessionManager(() => ws);

    // WebSocket connection with reconnection
    const wsConnUrl = `${wsUrl}/ws`;
    let reconnectDelay = INITIAL_RECONNECT_DELAY;
    let handshakeCompleted = false;

    function connectWS() {
      const socket = new WebSocket(wsConnUrl);
      ws = socket;
      handshakeCompleted = false;

      socket.on("open", () => {
        reconnectDelay = INITIAL_RECONNECT_DELAY;
        // Send JSON handshake as first message
        socket.send(JSON.stringify({
          version: FRAME_VERSION,
          token: authToken,
          source: "daemon",
          machineId,
          machineName,
        }));
      });

      socket.on("close", (code: number, reason: Buffer) => {
        if (shuttingDown) return;

        // Fatal close codes — do not reconnect
        if (code === 4001) {
          console.error("[daemon] Unauthorized. Run: anyterm login");
          process.exit(1);
        }
        if (code === 4002) {
          console.error("[daemon] Server rejected connection: missing machine ID.");
          process.exit(1);
        }
        if (code === 4003) {
          console.error(
            "[daemon] Another daemon with the same machine ID is already connected." +
            "\n         Stop the other daemon first, or run on a different machine.",
          );
          process.exit(1);
        }
        if (code === 4010) {
          console.error("[daemon] Protocol version mismatch. Please update your CLI: npm update -g anyterm");
          process.exit(1);
        }

        log(`Disconnected (code ${code}), reconnecting in ${reconnectDelay}ms...`);
        setTimeout(() => {
          if (!shuttingDown) connectWS();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      });

      socket.on("error", () => {
        // close event will fire after this
      });

      setupWsHandlers(socket);
    }

    async function spawnSession(request: SpawnRequest, socket: WebSocket) {
      const { requestId, command, name, forwardedPorts: fwdPorts } = request;
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      dbg(`Spawn request: ${command} (${cols}x${rows})`);

      // Enforce local session limit
      if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
        log(`Rejected spawn: active session limit reached (${MAX_ACTIVE_SESSIONS})`);
        const response: SpawnResponse = { requestId, error: `Daemon session limit reached (max ${MAX_ACTIVE_SESSIONS})` };
        const responsePayload = new TextEncoder().encode(JSON.stringify(response));
        socket.send(createSpawnResponseFrame(responsePayload));
        return;
      }

      try {
        // Generate session key and encrypt it
        const sessionKey = await generateSessionKey();
        const encryptedSessionKey = await encryptSessionKey(sessionKey, pubKey);

        // Create session on server
        const createData = await gql<{ createSession: { id: string } }>(
          serverUrl,
          authToken,
          `
            mutation ($input: CreateSessionInput!) {
              createSession(input: $input) { id }
            }
          `,
          {
            input: {
              name,
              command,
              encryptedSessionKey: toBase64(encryptedSessionKey),
              cols,
              rows,
              agentType: detectAgentType(command),
              machineId,
              machineName,
              ...(fwdPorts && fwdPorts.length > 0 ? { forwardedPorts: fwdPorts.join(",") } : {}),
            },
          },
        );

        const sessionId = createData.createSession.id;
        log(`Spawned session ${sessionId}: ${command}`);

        // Subscribe to the session
        socket.send(createSubscribeFrame(sessionId));

        // Set up headless terminal
        let headless: import("@xterm/headless").Terminal | null = null;
        let serializer: import("@xterm/addon-serialize").SerializeAddon | null = null;
        if (headlessClasses) {
          headless = new headlessClasses.Terminal({ cols, rows });
          serializer = new headlessClasses.SerializeAddon();
          headless.loadAddon(serializer);
        }

        // Spawn PTY
        const shell =
          os.platform() === "win32"
            ? "powershell.exe"
            : process.env.SHELL || "/bin/bash";
        const args = command !== shell ? ["-c", command] : [];

        const ptyProcess = pty.spawn(shell, args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd: process.env.HOME || process.cwd(),
          env: getSafeEnv(),
        });

        const session = createPtySessionState({
          id: sessionId,
          sessionKey,
          ptyProcess,
          headless,
          serializer,
          forwardedPorts: fwdPorts ?? [],
        });

        activeSessions.set(sessionId, session);
        ptyManager.resetPeriodicSnapshotTimer(session);

        // Wire PTY output to batching pipeline
        ptyManager.setupPtyOutput(session);

        // Handle PTY exit
        ptyProcess.onExit(async ({ exitCode }) => {
          log(`Session ${sessionId} ended (exit ${exitCode})`);

          await ptyManager.cleanupPtySession(session, { serverUrl, authToken });

          // Notify browsers that session ended, then unsubscribe
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(createSessionEndedFrame(sessionId));
            ws.send(createUnsubscribeFrame(sessionId));
          }
          activeSessions.delete(sessionId);
        });

        // Send success response
        const response: SpawnResponse = { requestId, sessionId };
        const responsePayload = new TextEncoder().encode(JSON.stringify(response));
        socket.send(createSpawnResponseFrame(responsePayload));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        log(`Spawn failed: ${errorMsg}`);
        const response: SpawnResponse = { requestId, error: errorMsg };
        const responsePayload = new TextEncoder().encode(JSON.stringify(response));
        socket.send(createSpawnResponseFrame(responsePayload));
      }
    }

    function setupWsHandlers(socket: WebSocket) {
      socket.on("message", async (raw: Buffer) => {
        try {
          const frame = decodeFrame(new Uint8Array(raw));

          // Handle handshake response
          if (!handshakeCompleted) {
            if (frame.type === FrameType.HANDSHAKE_OK) {
              handshakeCompleted = true;
              log("Connected to server");
              // Re-subscribe all active sessions on reconnect
              for (const [sessionId] of activeSessions) {
                socket.send(createSubscribeFrame(sessionId));
              }
              return;
            }
            if (frame.type === FrameType.ERROR) {
              const msg = new TextDecoder().decode(frame.payload);
              try {
                const err = JSON.parse(msg);
                console.error(`[daemon] ${err.message || msg}`);
              } catch {
                console.error(`[daemon] ${msg}`);
              }
              return;
            }
            return; // Ignore other frames before handshake
          }

          switch (frame.type) {
            case FrameType.PING: {
              socket.send(createPongFrame());
              break;
            }

            case FrameType.SPAWN_REQUEST: {
              const json = new TextDecoder().decode(frame.payload);
              const outer: { requestId: string; encryptedPayload: string } = JSON.parse(json);

              // Decrypt the sealed spawn request with our private key
              const sealed = fromBase64(outer.encryptedPayload);
              const decrypted = openMessage(sealed, pubKey, privateKey);
              const inner = JSON.parse(new TextDecoder().decode(decrypted));

              // Validate decrypted fields locally (server can't validate encrypted data)
              const defaultShell = os.platform() === "win32"
                ? "powershell.exe"
                : process.env.SHELL || "/bin/bash";
              const rawCommand = typeof inner.command === "string" ? inner.command.trim() : "";
              const command = rawCommand || defaultShell;
              const spawnName = typeof inner.name === "string" ? inner.name.trim() : "";

              if (command.length > MAX_COMMAND_LENGTH) {
                const response: SpawnResponse = { requestId: outer.requestId, error: "Invalid command" };
                socket.send(createSpawnResponseFrame(new TextEncoder().encode(JSON.stringify(response))));
                break;
              }

              // Check against command allowlist
              if (!isCommandAllowed(command, allowedCommands)) {
                log(`Rejected spawn: "${command}" not in allowlist`);
                const response: SpawnResponse = { requestId: outer.requestId, error: "Command not in allowlist" };
                socket.send(createSpawnResponseFrame(new TextEncoder().encode(JSON.stringify(response))));
                break;
              }

              const forwardedPorts = parseSpawnForwardedPorts(inner.forwardedPorts);

              const request: SpawnRequest = {
                requestId: outer.requestId,
                command,
                name: deriveSessionName(spawnName, command),
                forwardedPorts,
              };
              await spawnSession(request, socket);
              break;
            }

            case FrameType.ENCRYPTED_INPUT: {
              const session = activeSessions.get(frame.sessionId);
              if (!session) break;
              const plaintext = await decryptChunk(frame.payload, session.sessionKey);
              const text = new TextDecoder().decode(plaintext);
              session.ptyProcess.write(text);
              break;
            }

            case FrameType.HTTP_REQUEST: {
              const session = activeSessions.get(frame.sessionId);
              if (!session) break;

              const json = new TextDecoder().decode(frame.payload);
              const req: HttpTunnelRequest = JSON.parse(json);

              // Validate port is in the forwarded list
              if (!session.forwardedPorts.includes(req.port)) break;

              const response = await proxyLocalHttp(req);
              const responsePayload = new TextEncoder().encode(JSON.stringify(response));
              const responseFrame = createHttpResponseFrame(frame.sessionId, responsePayload);
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(responseFrame);
              }
              break;
            }

            case FrameType.SESSION_ENDED: {
              // Session was deleted from web — kill PTY
              const session = activeSessions.get(frame.sessionId);
              if (session) {
                log(`Session ${frame.sessionId} ended remotely`);
                session.ptyProcess.kill();
              }
              break;
            }
          }
        } catch (err) {
          console.error("[daemon] Frame handling error:", err instanceof Error ? err.message : String(err));
          if (debug) {
            console.debug(err);
          }
        }
      });
    }

    // Start connection
    connectWS();
    log("Daemon started, waiting for spawn requests...");
    log(`Ctrl+C to stop`);

    // Graceful shutdown
    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      log("Shutting down...");

      // Clean up all sessions (flush, snapshot, update status) then kill PTY
      const shutdownPromises: Promise<void>[] = [];
      for (const [, session] of activeSessions) {
        shutdownPromises.push(
          (async () => {
            await ptyManager.cleanupPtySession(session, { serverUrl, authToken });
            session.ptyProcess.kill();
          })(),
        );
      }

      await Promise.allSettled(shutdownPromises);

      // Zero sensitive key material
      privateKey.fill(0);
      for (const [, session] of activeSessions) {
        session.sessionKey.fill(0);
      }

      // Close WS
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        await new Promise<void>((resolve) => {
          ws!.once("close", resolve);
          setTimeout(resolve, WS_CLOSE_TIMEOUT);
        });
      }

      process.exit(0);
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGHUP", shutdown);
  });
