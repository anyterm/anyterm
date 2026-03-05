import { Command } from "commander";
import * as os from "node:os";
import WebSocket from "ws";
import { getConfig, getMachineId, getMachineName } from "../config.js";
import {
  generateSessionKey,
  encryptSessionKey,
  decryptChunk,
  fromBase64,
  toBase64,
} from "@anyterm/utils/crypto";
import {
  createSubscribeFrame,
  createHttpResponseFrame,
  createResizeFrame,
  createPongFrame,
  decodeFrame,
  FrameType,
} from "@anyterm/utils/protocol";
import { FRAME_VERSION, detectAgentType } from "@anyterm/utils/types";
import type { HttpTunnelRequest } from "@anyterm/utils/types";
import { gql } from "../graphql.js";
import { decryptPrivateKeyFromConfig } from "../shared/auth.js";
import { getSafeEnv, loadHeadlessTerminal } from "../shared/terminal.js";
import { proxyLocalHttp } from "../shared/http-proxy.js";
import {
  INITIAL_RECONNECT_DELAY,
  MAX_RECONNECT_DELAY,
  RESIZE_DB_DEBOUNCE,
  WS_CLOSE_TIMEOUT,
  MAX_COMMAND_LENGTH,
} from "../shared/constants.js";
import { createPtySessionState, createPtySessionManager } from "../shared/pty-session.js";

/** Resolve command, shell, and session name from CLI arguments. */
export function resolveRunArgs(
  commandArgs: string[],
  opts: { name?: string },
  platform: string = os.platform(),
  shell: string | undefined = process.env.SHELL,
) {
  const defaultShell =
    platform === "win32"
      ? "powershell.exe"
      : shell || "/bin/bash";
  const isInteractiveShell = commandArgs.length === 0;
  const command = commandArgs.join(" ") || defaultShell;
  const name = opts.name || (isInteractiveShell ? "shell" : command.split(" ")[0]);
  return { isInteractiveShell, command, name, defaultShell };
}

/** Parse --forward port list. Returns ports array or error string. */
export function parseForwardedPorts(raw: string | undefined): number[] | { error: string } {
  if (!raw) return [];
  const ports: number[] = [];
  for (const p of raw.split(",")) {
    const port = parseInt(p.trim(), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return { error: `Invalid port: ${p.trim()}` };
    }
    ports.push(port);
  }
  return ports;
}

export const runCommand = new Command("run")
  .description("Run a command and stream to server (no command = interactive shell)")
  .argument("[command...]", "Command to run (defaults to your shell)")
  .option("-n, --name <name>", "Session name")
  .option("--forward <ports>", "Forward local ports (comma-separated, e.g. 3000,8080)")
  .action(async (commandArgs: string[], opts) => {
    const cfg = await getConfig();
    const { serverUrl, wsUrl, authToken, publicKey, encryptedPrivateKey, keySalt } = cfg;
    const { isInteractiveShell, command, name, defaultShell } = resolveRunArgs(commandArgs, opts);

    if (command.length > MAX_COMMAND_LENGTH) {
      console.error(`Command too long (${command.length} chars, max ${MAX_COMMAND_LENGTH})`);
      process.exit(1);
    }

    // Parse forwarded ports
    const parsedPorts = parseForwardedPorts(opts.forward as string | undefined);
    if ("error" in parsedPorts) {
      console.error(parsedPorts.error);
      process.exit(1);
    }
    const forwardedPortsList = parsedPorts;
    const forwardedPorts = forwardedPortsList.length > 0
      ? forwardedPortsList.join(",")
      : undefined;

    // Decrypt private key — use cached masterKey from keychain if available
    const privateKey = await decryptPrivateKeyFromConfig(cfg);

    // Dynamic import node-pty (native module)
    const pty = await import("node-pty");

    // Fetch org keys to determine which public key to seal the session key with
    let orgKeysData: { orgKeys: { orgPublicKey: string | null; isPersonalOrg: boolean } } | null = null;
    try {
      orgKeysData = await gql<{
        orgKeys: { orgPublicKey: string | null; isPersonalOrg: boolean };
      }>(serverUrl, authToken, `
        query { orgKeys { orgPublicKey isPersonalOrg } }
      `);
    } catch {
      // Fall back to user's publicKey
    }

    // Use org publicKey if available, otherwise fall back to user's publicKey
    const sealingKey = orgKeysData?.orgKeys?.orgPublicKey ?? publicKey;

    // Generate session key
    const sessionKey = await generateSessionKey();
    const pubKey = fromBase64(sealingKey);
    const encryptedSessionKey = await encryptSessionKey(sessionKey, pubKey);

    // Create session on server
    let createData: { createSession: { id: string } };
    try {
      createData = await gql<{
        createSession: { id: string };
      }>(serverUrl, authToken, `
        mutation ($input: CreateSessionInput!) {
          createSession(input: $input) { id }
        }
      `, {
        input: {
          name,
          command,
          encryptedSessionKey: toBase64(encryptedSessionKey),
          cols: process.stdout.columns || 80,
          rows: process.stdout.rows || 24,
          agentType: detectAgentType(command),
          machineId: getMachineId(),
          machineName: getMachineName(),
          ...(forwardedPorts ? { forwardedPorts } : {}),
        },
      });
    } catch (err) {
      console.error("Failed to create session:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const sessionId = createData.createSession.id;
    console.log(`Session: ${sessionId}`);
    console.log(`Web: ${serverUrl}/s/${sessionId}`);
    if (isInteractiveShell) {
      console.log(`Mode: interactive shell (${command})`);
    }
    if (forwardedPorts) {
      for (const port of forwardedPortsList) {
        console.log(`Tunnel: ${serverUrl}/tunnel/${sessionId}/${port}/`);
      }
    }
    console.log();

    // Spawn PTY with sanitized environment
    const shell = defaultShell;
    const args = isInteractiveShell ? [] : ["-c", command];

    const ptyProcess = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: process.cwd(),
      env: getSafeEnv(),
    });

    // Headless terminal for state serialization (snapshot on clear)
    let headless: import("@xterm/headless").Terminal | null = null;
    let serializer: import("@xterm/addon-serialize").SerializeAddon | null = null;
    const headlessClasses = await loadHeadlessTerminal();
    if (headlessClasses) {
      headless = new headlessClasses.Terminal({
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
      serializer = new headlessClasses.SerializeAddon();
      headless.loadAddon(serializer);
    }

    // Session state + manager
    let ws: WebSocket | null = null;
    let wsClosing = false;
    let handshakeCompleted = false;

    const session = createPtySessionState({
      id: sessionId,
      sessionKey,
      ptyProcess,
      headless,
      serializer,
      forwardedPorts: forwardedPortsList,
    });

    const ptyManager = createPtySessionManager(() => ws);

    // Connect WebSocket with reconnection
    const wsConnUrl = `${wsUrl}/ws`;
    let reconnectDelay = INITIAL_RECONNECT_DELAY;

    function connectWS() {
      const socket = new WebSocket(wsConnUrl);
      ws = socket;
      handshakeCompleted = false;

      socket.on("open", () => {
        reconnectDelay = INITIAL_RECONNECT_DELAY; // reset backoff on success
        // Send JSON handshake as first message
        socket.send(JSON.stringify({
          version: FRAME_VERSION,
          token: authToken,
          source: "cli",
        }));
      });

      socket.on("close", (code: number, reason: Buffer) => {
        if (wsClosing) return;
        // Fatal handshake errors — don't reconnect
        if (code === 4001) {
          console.error("\x1b[31mUnauthorized. Please run: anyterm login\x1b[0m");
          ptyProcess.kill();
          return;
        }
        if (code === 4010) {
          console.error(`\x1b[31m${reason.toString() || "Protocol version mismatch. Please update your CLI: npm update -g anyterm"}\x1b[0m`);
          ptyProcess.kill();
          return;
        }
        // Reconnect with exponential backoff
        setTimeout(() => {
          if (!wsClosing) connectWS();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      });

      socket.on("error", () => {
        // close event will fire after this — reconnection handled there
      });

      setupWsHandlers(socket);
    }

    connectWS();

    // Handle incoming frames from server
    function setupWsHandlers(socket: WebSocket) {
      socket.on("message", async (raw: Buffer) => {
        try {
          const frame = decodeFrame(new Uint8Array(raw));

          // Handle handshake response
          if (!handshakeCompleted) {
            if (frame.type === FrameType.HANDSHAKE_OK) {
              handshakeCompleted = true;
              socket.send(createSubscribeFrame(sessionId));
              ptyManager.resetPeriodicSnapshotTimer(session);
              return;
            }
            if (frame.type === FrameType.ERROR) {
              const msg = new TextDecoder().decode(frame.payload);
              try {
                const err = JSON.parse(msg);
                console.error(`\x1b[31m${err.message || msg}\x1b[0m`);
              } catch {
                console.error(`\x1b[31m${msg}\x1b[0m`);
              }
              return;
            }
            return; // Ignore other frames before handshake
          }

          if (frame.type === FrameType.PING) {
            socket.send(createPongFrame());
          } else if (frame.type === FrameType.ENCRYPTED_INPUT) {
            const plaintext = await decryptChunk(frame.payload, sessionKey);
            const text = new TextDecoder().decode(plaintext);
            ptyProcess.write(text);
          } else if (frame.type === FrameType.HTTP_REQUEST && forwardedPorts) {
            // HTTP tunnel: proxy to local server
            const json = new TextDecoder().decode(frame.payload);
            const req: HttpTunnelRequest = JSON.parse(json);

            // Validate port is in the forwarded list
            if (!forwardedPortsList.includes(req.port)) return;

            const response = await proxyLocalHttp(req);
            const responsePayload = new TextEncoder().encode(JSON.stringify(response));
            const responseFrame = createHttpResponseFrame(sessionId, responsePayload);
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(responseFrame);
            }
          } else if (frame.type === FrameType.SESSION_ENDED) {
            // Session was deleted from web — gracefully exit
            console.log("\n\x1b[33mSession ended remotely.\x1b[0m");
            ptyProcess.kill();
          }
          // RESIZE from browser is ignored — CLI terminal size is authoritative
        } catch (err) {
          console.error("[WS] Frame handling error:", err instanceof Error ? err.message : String(err));
          if (process.env.DEBUG) {
            console.debug(err);
          }
        }
      });
    }

    // Wire PTY output to batching pipeline (with local echo)
    ptyManager.setupPtyOutput(session, {
      onData: (data) => process.stdout.write(data),
    });

    // Handle PTY exit
    ptyProcess.onExit(async ({ exitCode }) => {
      wsClosing = true;

      await ptyManager.cleanupPtySession(session, { serverUrl, authToken });

      // Give WS close frame time to send before exiting
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        await new Promise<void>((resolve) => {
          ws!.once("close", resolve);
          setTimeout(resolve, WS_CLOSE_TIMEOUT); // fallback if close event doesn't fire
        });
      }
      process.exit(exitCode);
    });

    // Handle local terminal resize — CLI is the authority on terminal size
    let resizeDbTimer: NodeJS.Timeout | null = null;
    process.stdout.on("resize", () => {
      const cols = process.stdout.columns;
      const rows = process.stdout.rows;
      ptyProcess.resize(cols, rows);
      if (session.headless) session.headless.resize(cols, rows);

      // Notify browser via WS
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(createResizeFrame(sessionId, cols, rows));
      }

      // Debounced DB update (no need to hit DB on every resize drag)
      if (resizeDbTimer) clearTimeout(resizeDbTimer);
      resizeDbTimer = setTimeout(async () => {
        try {
          await gql(serverUrl, authToken, `
            mutation ($input: UpdateSessionInput!) {
              updateSession(input: $input) { id }
            }
          `, { input: { id: sessionId, cols, rows } });
        } catch {
          // Best-effort resize update
        }
      }, RESIZE_DB_DEBOUNCE);
    });

    // Forward local stdin to PTY
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on("data", (data: Buffer) => {
      ptyProcess.write(data.toString());
    });

    // Cleanup on SIGINT/SIGTERM/SIGHUP (SIGHUP = terminal window closed)
    const cleanup = () => {
      // Restore stdin before anything else so terminal isn't left in raw mode
      if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(false); } catch {}
      }
      if (session.periodicSnapshotTimer) clearTimeout(session.periodicSnapshotTimer);
      ptyProcess.kill();
      // Zero sensitive key material
      sessionKey.fill(0);
      privateKey.fill(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGHUP", cleanup);
  });
