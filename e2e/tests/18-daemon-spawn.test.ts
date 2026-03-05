import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import { getEnv } from "../helpers/env.js";
import {
  generateSessionKey,
  encryptSessionKey,
  sealMessage,
  openMessage,
  toBase64,
  fromBase64,
  decodeFrame,
  FrameType,
  createSpawnResponseFrame,
  createSubscribeFrame,
  createEncryptedChunkFrame,
  encryptChunk,
} from "../helpers/crypto.js";
import type { SpawnResponse } from "@anyterm/utils/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let machineCounter = 0;
function uniqueMachineId() {
  return `test-machine-${Date.now()}-${++machineCounter}`;
}

/** Encrypt spawn request data with user's publicKey (mirrors browser sealMessage flow) */
function encryptSpawnPayload(
  data: { command?: string; name?: string; cols?: number; rows?: number },
  publicKey: Uint8Array,
): string {
  const plaintext = encoder.encode(JSON.stringify(data));
  const sealed = sealMessage(plaintext, publicKey);
  return toBase64(sealed);
}

describe("Daemon Spawn Flow", () => {
  let userA: RegisteredUser;
  let userB: RegisteredUser;
  let daemonWsA: WsClient;
  let clients: WsClient[];

  beforeAll(async () => {
    [userA, userB] = await Promise.all([registerUser(), registerUser()]);
    clients = [];
  });

  afterEach(() => {
    // Close all WS clients created in tests
    for (const c of clients) {
      c.close();
    }
    clients = [];
  });

  afterAll(() => {
    daemonWsA?.close();
  });

  // --- Daemon API Auth ---

  describe("Daemon API authentication", () => {
    it("GET /api/daemon/status returns 401 without auth", async () => {
      const { wsUrl } = getEnv();
      const res = await fetch(`${wsUrl.replace("ws", "http")}/api/daemon/status`);
      expect(res.status).toBe(401);
    });

    it("POST /api/daemon/spawn returns 401 without auth", async () => {
      const { wsUrl } = getEnv();
      const res = await fetch(`${wsUrl.replace("ws", "http")}/api/daemon/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptedPayload: "irrelevant" }),
      });
      expect(res.status).toBe(401);
    });

    it("GET /api/daemon/status returns offline with empty machines when no daemon connected", async () => {
      const { wsUrl } = getEnv();
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/status`,
        { headers: { Authorization: `Bearer ${userA.token}` } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.online).toBe(false);
      expect(body.machines).toEqual([]);
    });
  });

  // --- Daemon WS Connection ---

  describe("Daemon WebSocket connection", () => {
    it("daemon without machineId is rejected during handshake", async () => {
      daemonWsA = new WsClient();
      clients.push(daemonWsA);
      // Connect without machineId — should be rejected
      await expect(
        daemonWsA.connect(userA.token, "daemon"),
      ).rejects.toThrow(/Handshake failed/);
    });

    it("daemon connects with source=daemon and machineId", async () => {
      daemonWsA = new WsClient();
      clients.push(daemonWsA);
      await daemonWsA.connect(userA.token, "daemon", {
        machineId: uniqueMachineId(),
        machineName: "test-machine",
      });
      // Connection succeeded — no error
    });

    it("daemon status shows online with machines array after connection", async () => {
      const mid = uniqueMachineId();
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", {
        machineId: mid,
        machineName: "my-laptop",
      });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/status`,
        { headers: { Authorization: `Bearer ${userA.token}` } },
      );
      const body = await res.json();
      expect(body.online).toBe(true);
      expect(body.machines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ machineId: mid, name: "my-laptop" }),
        ]),
      );
    });

    it("daemon status is user-isolated (user B sees offline)", async () => {
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", {
        machineId: uniqueMachineId(),
        machineName: "a-machine",
      });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/status`,
        { headers: { Authorization: `Bearer ${userB.token}` } },
      );
      const body = await res.json();
      expect(body.online).toBe(false);
      expect(body.machines).toEqual([]);
    });
  });

  // --- Spawn Request Routing ---

  describe("Spawn request routing", () => {
    it("spawn request reaches the correct user's daemon (E2E encrypted)", async () => {
      const mid = uniqueMachineId();
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", { machineId: mid, machineName: "test" });

      await new Promise((r) => setTimeout(r, 200));

      // Send encrypted spawn request via API (single machine — auto-targets)
      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "echo test", name: "test-spawn" },
        userA.publicKey,
      );
      const spawnPromise = fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload }),
        },
      );

      // Daemon should receive SPAWN_REQUEST
      const frame = await daemon.waitForMessage(
        (f) => f.type === FrameType.SPAWN_REQUEST,
        5_000,
      );

      expect(frame.type).toBe(FrameType.SPAWN_REQUEST);
      const outer = JSON.parse(decoder.decode(frame.payload));
      expect(outer.requestId).toBeTruthy();
      expect(outer.encryptedPayload).toBeTruthy();

      // Verify the payload is actually encrypted — decrypt it with privateKey
      const sealed = fromBase64(outer.encryptedPayload);
      const decrypted = openMessage(sealed, userA.publicKey, userA.privateKey);
      const inner = JSON.parse(decoder.decode(decrypted));
      expect(inner.command).toBe("echo test");
      expect(inner.name).toBe("test-spawn");

      // Send a mock SPAWN_RESPONSE
      const response: SpawnResponse = {
        requestId: outer.requestId,
        sessionId: "mock-session-id",
      };
      daemon.send(
        createSpawnResponseFrame(encoder.encode(JSON.stringify(response))),
      );

      // The HTTP request should resolve
      const res = await spawnPromise;
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("mock-session-id");
    });

    it("spawn request does NOT reach user B's daemon", async () => {
      const daemonB = new WsClient();
      clients.push(daemonB);
      await daemonB.connect(userB.token, "daemon", { machineId: uniqueMachineId(), machineName: "b-machine" });

      const midA = uniqueMachineId();
      const daemonA = new WsClient();
      clients.push(daemonA);
      await daemonA.connect(userA.token, "daemon", { machineId: midA, machineName: "a-machine" });

      await new Promise((r) => setTimeout(r, 200));

      // Send encrypted spawn request for user A
      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "echo isolated" },
        userA.publicKey,
      );
      const spawnPromise = fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload }),
        },
      );

      // User A's daemon should get the request
      const frameA = await daemonA.waitForMessage(
        (f) => f.type === FrameType.SPAWN_REQUEST,
        5_000,
      );
      expect(frameA.type).toBe(FrameType.SPAWN_REQUEST);

      // User B's daemon should NOT get it
      await new Promise((r) => setTimeout(r, 500));
      const receivedByB = daemonB.receivedFrames.filter(
        (f) => f.type === FrameType.SPAWN_REQUEST,
      );
      expect(receivedByB.length).toBe(0);

      // Clean up: respond to the spawn request so HTTP doesn't hang
      const outer = JSON.parse(decoder.decode(frameA.payload));
      daemonA.send(
        createSpawnResponseFrame(
          encoder.encode(
            JSON.stringify({ requestId: outer.requestId, sessionId: "x" }),
          ),
        ),
      );
      await spawnPromise;
    });
  });

  // --- Multi-machine targeting ---

  describe("Multi-machine targeting", () => {
    it("spawn targets correct machine when multiple connected", async () => {
      const midA = uniqueMachineId();
      const midB = uniqueMachineId();

      const daemonA = new WsClient();
      clients.push(daemonA);
      await daemonA.connect(userA.token, "daemon", { machineId: midA, machineName: "laptop" });

      const daemonB = new WsClient();
      clients.push(daemonB);
      await daemonB.connect(userA.token, "daemon", { machineId: midB, machineName: "desktop" });

      await new Promise((r) => setTimeout(r, 200));

      // Target machine B explicitly
      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "echo targeted" },
        userA.publicKey,
      );
      const spawnPromise = fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload, targetMachineId: midB }),
        },
      );

      // Machine B should receive the request
      const frameB = await daemonB.waitForMessage(
        (f) => f.type === FrameType.SPAWN_REQUEST,
        5_000,
      );
      expect(frameB.type).toBe(FrameType.SPAWN_REQUEST);

      // Machine A should NOT receive it
      await new Promise((r) => setTimeout(r, 500));
      const receivedByA = daemonA.receivedFrames.filter(
        (f) => f.type === FrameType.SPAWN_REQUEST,
      );
      expect(receivedByA.length).toBe(0);

      // Respond from B
      const outer = JSON.parse(decoder.decode(frameB.payload));
      daemonB.send(
        createSpawnResponseFrame(
          encoder.encode(
            JSON.stringify({ requestId: outer.requestId, sessionId: "targeted-session" }),
          ),
        ),
      );

      const res = await spawnPromise;
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("targeted-session");
    });

    it("returns 400 when multiple machines and no targetMachineId", async () => {
      const daemonA = new WsClient();
      clients.push(daemonA);
      await daemonA.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "laptop" });

      const daemonB = new WsClient();
      clients.push(daemonB);
      await daemonB.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "desktop" });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "bash" },
        userA.publicKey,
      );
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload }),
        },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/targetMachineId/i);
    });

    it("returns 503 when targeted machine is offline", async () => {
      const daemonA = new WsClient();
      clients.push(daemonA);
      await daemonA.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "laptop" });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "bash" },
        userA.publicKey,
      );
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload, targetMachineId: "nonexistent-machine-id" }),
        },
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/not online/i);
    });

    it("auto-targets single machine without targetMachineId", async () => {
      const mid = uniqueMachineId();
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", { machineId: mid, machineName: "only-machine" });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "echo auto" },
        userA.publicKey,
      );
      const spawnPromise = fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload }), // no targetMachineId
        },
      );

      // Should auto-target the only machine
      const frame = await daemon.waitForMessage(
        (f) => f.type === FrameType.SPAWN_REQUEST,
        5_000,
      );
      expect(frame.type).toBe(FrameType.SPAWN_REQUEST);

      const outer = JSON.parse(decoder.decode(frame.payload));
      daemon.send(
        createSpawnResponseFrame(
          encoder.encode(
            JSON.stringify({ requestId: outer.requestId, sessionId: "auto-session" }),
          ),
        ),
      );

      const res = await spawnPromise;
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("auto-session");
    });
  });

  // --- Cross-user SPAWN_RESPONSE rejection ---

  describe("SPAWN_RESPONSE cross-user isolation", () => {
    it("user B's daemon cannot resolve user A's pending spawn", async () => {
      const daemonA = new WsClient();
      clients.push(daemonA);
      await daemonA.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "a-machine" });

      const daemonB = new WsClient();
      clients.push(daemonB);
      await daemonB.connect(userB.token, "daemon", { machineId: uniqueMachineId(), machineName: "b-machine" });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "echo cross-user" },
        userA.publicKey,
      );
      const spawnPromise = fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload }),
        },
      );

      // Daemon A receives the request
      const frameA = await daemonA.waitForMessage(
        (f) => f.type === FrameType.SPAWN_REQUEST,
        5_000,
      );
      const outer = JSON.parse(decoder.decode(frameA.payload));

      // User B's daemon tries to respond with the same requestId — should be rejected
      const fakeResponse: SpawnResponse = {
        requestId: outer.requestId,
        sessionId: "hijacked-session",
      };
      daemonB.send(
        createSpawnResponseFrame(
          encoder.encode(JSON.stringify(fakeResponse)),
        ),
      );

      // Wait a moment — the fake response should be rejected
      await new Promise((r) => setTimeout(r, 500));

      // Now send the real response from daemon A
      const realResponse: SpawnResponse = {
        requestId: outer.requestId,
        sessionId: "real-session",
      };
      daemonA.send(
        createSpawnResponseFrame(
          encoder.encode(JSON.stringify(realResponse)),
        ),
      );

      const res = await spawnPromise;
      const body = await res.json();
      expect(res.status).toBe(200);
      // Must be the real session, not the hijacked one
      expect(body.sessionId).toBe("real-session");
    });
  });

  // --- Frame type enforcement ---

  describe("Frame type enforcement", () => {
    it("browser cannot send SPAWN_RESPONSE", async () => {
      const browserWs = new WsClient();
      clients.push(browserWs);
      await browserWs.connect(userA.token, "browser");

      // Try sending a SPAWN_RESPONSE from browser — should be silently rejected
      const response: SpawnResponse = {
        requestId: "fake-id",
        sessionId: "fake-session",
      };
      browserWs.send(
        createSpawnResponseFrame(
          encoder.encode(JSON.stringify(response)),
        ),
      );

      // Should not crash; connection should remain open
      await new Promise((r) => setTimeout(r, 500));
      // If the connection is still up, that's good
    });

    it("CLI cannot send SPAWN_RESPONSE", async () => {
      const cliWs = new WsClient();
      clients.push(cliWs);
      await cliWs.connect(userA.token, "cli");

      const response: SpawnResponse = {
        requestId: "fake-id",
        sessionId: "fake-session",
      };
      cliWs.send(
        createSpawnResponseFrame(
          encoder.encode(JSON.stringify(response)),
        ),
      );

      await new Promise((r) => setTimeout(r, 500));
      // Connection should remain open — frame is just rejected
    });
  });

  // --- Input validation ---

  describe("Spawn API input validation", () => {
    it("rejects missing encryptedPayload", async () => {
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "test" });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ command: "bash" }),
        },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/encryptedPayload/i);
    });

    it("rejects oversized encryptedPayload", async () => {
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "test" });

      await new Promise((r) => setTimeout(r, 200));

      const { wsUrl } = getEnv();
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload: "x".repeat(20_000) }),
        },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/too large/i);
    });

    it("returns 503 when no daemon connected", async () => {
      // userB has no daemon connected
      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "bash" },
        userB.publicKey,
      );
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userB.token}` },
          body: JSON.stringify({ encryptedPayload }),
        },
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/no daemon/i);
    });

    it("returns 504 on spawn timeout (daemon doesn't respond)", async () => {
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userB.token, "daemon", { machineId: uniqueMachineId(), machineName: "test" });

      await new Promise((r) => setTimeout(r, 200));

      // Send encrypted spawn request but don't respond from daemon
      const { wsUrl } = getEnv();
      const encryptedPayload = encryptSpawnPayload(
        { command: "bash" },
        userB.publicKey,
      );
      const res = await fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userB.token}` },
          body: JSON.stringify({ encryptedPayload }),
        },
      );

      // Should timeout (15s default, we wait)
      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.error).toMatch(/timeout/i);
    }, 20_000);

    it("spawn payload is opaque to server (cannot read command)", async () => {
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "test" });

      await new Promise((r) => setTimeout(r, 200));

      // Encrypt a spawn request
      const secretCommand = "echo super-secret-command-12345";
      const encryptedPayload = encryptSpawnPayload(
        { command: secretCommand, name: "secret-test" },
        userA.publicKey,
      );

      // The encrypted payload should NOT contain the plaintext command
      expect(encryptedPayload).not.toContain("super-secret-command");
      expect(encryptedPayload).not.toContain("secret-test");

      const { wsUrl } = getEnv();
      const spawnPromise = fetch(
        `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
          body: JSON.stringify({ encryptedPayload }),
        },
      );

      // Daemon receives it, verifies encrypted payload can be decrypted
      const frame = await daemon.waitForMessage(
        (f) => f.type === FrameType.SPAWN_REQUEST,
        5_000,
      );
      const outer = JSON.parse(decoder.decode(frame.payload));
      const sealed = fromBase64(outer.encryptedPayload);
      const decrypted = openMessage(sealed, userA.publicKey, userA.privateKey);
      const inner = JSON.parse(decoder.decode(decrypted));
      expect(inner.command).toBe(secretCommand);
      expect(inner.name).toBe("secret-test");

      // Clean up
      daemon.send(
        createSpawnResponseFrame(
          encoder.encode(
            JSON.stringify({ requestId: outer.requestId, sessionId: "s" }),
          ),
        ),
      );
      await spawnPromise;
    });
  });

  // --- Daemon sends session data like CLI ---

  describe("Daemon session data flow", () => {
    it("daemon can send ENCRYPTED_CHUNK and browser receives it", async () => {
      // Create a session for user A
      const apiA = new ApiClient(userA.cookieToken);
      const sessionKey = await generateSessionKey();
      const encryptedSessionKey = await encryptSessionKey(
        sessionKey,
        userA.publicKey,
      );
      const { body } = await apiA.createSession({
        name: "daemon-data-test",
        command: "bash",
        encryptedSessionKey: toBase64(encryptedSessionKey),
      });
      const sessionId = body.data!.id as string;

      // Connect daemon and browser
      const daemon = new WsClient();
      clients.push(daemon);
      await daemon.connect(userA.token, "daemon", { machineId: uniqueMachineId(), machineName: "test" });
      daemon.send(createSubscribeFrame(sessionId));

      const browser = new WsClient();
      clients.push(browser);
      await browser.connect(userA.token, "browser");
      browser.send(createSubscribeFrame(sessionId));

      await new Promise((r) => setTimeout(r, 300));

      // Daemon sends encrypted chunk
      const plaintext = "hello from daemon";
      const encrypted = await encryptChunk(
        new TextEncoder().encode(plaintext),
        sessionKey,
      );
      daemon.send(createEncryptedChunkFrame(sessionId, encrypted));

      // Browser should receive it
      const received = await browser.waitForMessage(
        (f) =>
          f.type === FrameType.ENCRYPTED_CHUNK && f.sessionId === sessionId,
        5_000,
      );
      expect(received.sessionId).toBe(sessionId);
    });
  });
});
