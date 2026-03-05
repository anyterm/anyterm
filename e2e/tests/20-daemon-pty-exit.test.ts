import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import { getEnv } from "../helpers/env.js";
import {
  encryptChunk,
  decryptSessionKey,
  sealMessage,
  toBase64,
  fromBase64,
  createSubscribeFrame,
  createEncryptedInputFrame,
  FrameType,
} from "../helpers/crypto.js";

const encoder = new TextEncoder();

/**
 * Integration test: runs the REAL daemon binary with a real PTY.
 *
 * Verifies that when a spawned command exits (PTY closes), the daemon
 * sends SESSION_ENDED to the server, which relays it to the browser.
 *
 * This test:
 * 1. Registers a user and writes daemon config to a temp HOME
 * 2. Starts the actual `anyterm daemon` subprocess
 * 3. Spawns short-lived commands via the daemon API
 * 4. Verifies browser receives SESSION_ENDED + CLI_DISCONNECTED
 * 5. Verifies chunks are persisted and session status is "stopped"
 */

describe("Daemon PTY Exit (real daemon)", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let daemonProc: ChildProcess | null = null;
  let tmpHome: string;
  const wsClients: WsClient[] = [];

  function createTrackedWs(): WsClient {
    const ws = new WsClient();
    wsClients.push(ws);
    return ws;
  }

  function encryptSpawnPayload(
    data: { command?: string; name?: string },
    publicKey: Uint8Array,
  ): string {
    const plaintext = encoder.encode(JSON.stringify(data));
    const sealed = sealMessage(plaintext, publicKey);
    return toBase64(sealed);
  }

  /** Decrypt the daemon-generated session key for a session */
  async function getSessionKey(sessionId: string): Promise<Uint8Array> {
    const { body } = await api.getSession(sessionId);
    const encSk = fromBase64(body.data!.encryptedSessionKey as string);
    return decryptSessionKey(encSk, user.publicKey, user.privateKey);
  }

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    const { baseUrl, wsUrl } = getEnv();

    // Create temp HOME for daemon config
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "anyterm-daemon-test-"));

    // Conf stores config at platform-specific path under $HOME
    const configDir =
      process.platform === "darwin"
        ? path.join(tmpHome, "Library", "Preferences", "anyterm-nodejs")
        : path.join(tmpHome, ".config", "anyterm-nodejs");

    fs.mkdirSync(configDir, { recursive: true });

    // Fetch the encrypted private key from the server
    const { body: keysBody } = await api.getKeys();

    // Write daemon config (v2 per-server format).
    // getSecret() falls back to reading from per-server Conf block
    // when keytar is unavailable (common in CI / test envs).
    const configData = {
      configVersion: 2,
      activeServer: baseUrl,
      machineName: "e2e-test-daemon",
      servers: {
        [baseUrl]: {
          wsUrl: wsUrl,
          userId: user.userId,
          publicKey: toBase64(user.publicKey),
          encryptedPrivateKey: keysBody.data!.encryptedPrivateKey,
          keySalt: keysBody.data!.keySalt,
          // Secrets (keytar fallback reads from per-server config)
          authToken: user.token,
          masterKey: toBase64(user.masterKey),
        },
      },
    };

    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify(configData, null, 2),
    );

    // Start the real daemon subprocess
    const cliEntry = path.resolve("../packages/cli/src/index.ts");
    daemonProc = spawn(
      "npx",
      ["tsx", cliEntry, "daemon", "--name", "e2e-test-daemon"],
      {
        env: {
          ...process.env,
          HOME: tmpHome,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Wait for daemon to connect to server
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Daemon failed to start within 20s")),
        20_000,
      );

      let output = "";
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("Connected to server")) {
          clearTimeout(timeout);
          resolve();
        }
      };

      daemonProc!.stdout?.on("data", onData);
      daemonProc!.stderr?.on("data", onData);

      daemonProc!.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      daemonProc!.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Daemon exited with code ${code}: ${output}`));
        }
      });
    });

    // Let the daemon register with the WS server
    await new Promise((r) => setTimeout(r, 500));
  }, 30_000);

  afterEach(() => {
    for (const ws of wsClients) {
      ws.close();
    }
    wsClients.length = 0;
  });

  afterAll(async () => {
    if (daemonProc && !daemonProc.killed) {
      daemonProc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          daemonProc?.kill("SIGKILL");
          resolve();
        }, 3000);
        daemonProc!.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("browser receives SESSION_ENDED when spawned command exits", async () => {
    const { wsUrl } = getEnv();

    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");

    // Spawn a command that exits immediately
    const encryptedPayload = encryptSpawnPayload(
      { command: "echo hello", name: "quick-exit" },
      user.publicKey,
    );

    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ encryptedPayload }),
      },
    );
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();
    expect(sessionId).toBeTruthy();

    // Browser subscribes
    browserWs.send(createSubscribeFrame(sessionId));
    await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED && f.sessionId === sessionId,
      5_000,
    );

    // "echo hello" exits quickly → daemon sends SESSION_ENDED
    const ended = await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED && f.sessionId === sessionId,
      10_000,
    );
    expect(ended.sessionId).toBe(sessionId);

    // Also receives CLI_DISCONNECTED (from UNSUBSCRIBE handler)
    const disconnected = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED && f.sessionId === sessionId,
      5_000,
    );
    expect(disconnected.sessionId).toBe(sessionId);
  }, 20_000);

  it("session status is 'stopped' in DB after PTY exits", async () => {
    const { wsUrl } = getEnv();

    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");

    const encryptedPayload = encryptSpawnPayload(
      { command: "true", name: "status-check" },
      user.publicKey,
    );

    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ encryptedPayload }),
      },
    );
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    browserWs.send(createSubscribeFrame(sessionId));

    // Wait for session to end
    await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED && f.sessionId === sessionId,
      10_000,
    );

    // Give the daemon time to update DB
    await new Promise((r) => setTimeout(r, 1000));

    // Verify DB status
    const { body } = await api.getSession(sessionId);
    expect(body.data!.status).toBe("stopped");
    expect(body.data!.endedAt).not.toBeNull();
  }, 20_000);

  it("encrypted output chunks are persisted before session ends", async () => {
    const { wsUrl } = getEnv();

    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");

    // Command that produces output then exits
    const encryptedPayload = encryptSpawnPayload(
      { command: 'printf "hello from daemon\\n"', name: "chunks-test" },
      user.publicKey,
    );

    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ encryptedPayload }),
      },
    );
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    browserWs.send(createSubscribeFrame(sessionId));

    // Wait for session to end
    await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED && f.sessionId === sessionId,
      10_000,
    );

    // Wait for chunk flush
    await new Promise((r) => setTimeout(r, 3000));

    // Verify chunks in DB
    const { body } = await api.getChunks(sessionId);
    expect(body.data!.length).toBeGreaterThan(0);
  }, 20_000);

  it("interactive shell exit via typed 'exit' sends SESSION_ENDED", async () => {
    const { wsUrl } = getEnv();

    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");

    // Spawn with empty command → interactive shell
    const encryptedPayload = encryptSpawnPayload(
      { command: "", name: "interactive-exit" },
      user.publicKey,
    );

    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ encryptedPayload }),
      },
    );
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    browserWs.send(createSubscribeFrame(sessionId));
    await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED && f.sessionId === sessionId,
      5_000,
    );

    // Decrypt session key so we can send encrypted input
    const sessionKey = await getSessionKey(sessionId);

    // Send "exit\n" to the shell
    const exitInput = await encryptChunk(encoder.encode("exit\n"), sessionKey);
    browserWs.send(createEncryptedInputFrame(sessionId, exitInput));

    // Shell exits → daemon sends SESSION_ENDED
    const ended = await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED && f.sessionId === sessionId,
      10_000,
    );
    expect(ended.sessionId).toBe(sessionId);

    // Verify DB status
    await new Promise((r) => setTimeout(r, 1000));
    const { body } = await api.getSession(sessionId);
    expect(body.data!.status).toBe("stopped");
  }, 20_000);
});
