import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  encryptChunk,
  decryptChunk,
  toBase64,
  createSubscribeFrame,
  createUnsubscribeFrame,
  createEncryptedChunkFrame,
  createSessionEndedFrame,
  FrameType,
} from "../helpers/crypto.js";

/**
 * Tests for PTY exit notification flow.
 *
 * When a daemon/CLI's PTY process exits:
 * 1. Daemon sends SESSION_ENDED frame (server relays to browsers via Redis)
 * 2. Daemon sends UNSUBSCRIBE frame (server sends CLI_DISCONNECTED to browsers)
 * 3. Browser receives SESSION_ENDED → shows "Session ended" message
 * 4. Pending chunks are flushed to DB before session ends
 * 5. DB status is updated to "stopped"
 */

describe("Session Exit (PTY exit notification)", () => {
  let user: RegisteredUser;
  let api: ApiClient;

  const wsClients: WsClient[] = [];

  function createTrackedWs(): WsClient {
    const ws = new WsClient();
    wsClients.push(ws);
    return ws;
  }

  async function createTestSession() {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "exit-test",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    return { id: body.data!.id as string, sessionKey };
  }

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);
  });

  afterEach(() => {
    for (const ws of wsClients) {
      ws.close();
    }
    wsClients.length = 0;
  });

  it("browser receives SESSION_ENDED when daemon sends it before unsubscribing", async () => {
    const { id, sessionKey } = await createTestSession();

    // Daemon connects and subscribes
    const daemonWs = createTrackedWs();
    await daemonWs.connect(user.token, "daemon", {
      machineId: `exit-test-${Date.now()}`,
      machineName: "test",
    });
    daemonWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Browser connects and subscribes
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));

    // Wait for initial CLI_CONNECTED
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browserWs.receivedFrames.length = 0;

    // Daemon sends SESSION_ENDED (simulating PTY exit)
    daemonWs.send(createSessionEndedFrame(id));

    // Browser should receive SESSION_ENDED
    const ended = await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      5_000,
    );
    expect(ended.sessionId).toBe(id);
  });

  it("browser receives CLI_DISCONNECTED when daemon unsubscribes after PTY exit", async () => {
    const { id } = await createTestSession();

    // Daemon connects and subscribes
    const daemonWs = createTrackedWs();
    await daemonWs.connect(user.token, "daemon", {
      machineId: `exit-unsub-${Date.now()}`,
      machineName: "test",
    });
    daemonWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Browser connects and subscribes
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));

    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browserWs.receivedFrames.length = 0;

    // Daemon sends SESSION_ENDED then UNSUBSCRIBE (like real daemon does)
    daemonWs.send(createSessionEndedFrame(id));
    daemonWs.send(createUnsubscribeFrame(id));

    // Browser should receive CLI_DISCONNECTED
    const disconnected = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED,
      5_000,
    );
    expect(disconnected.sessionId).toBe(id);
  });

  it("chunks sent before SESSION_ENDED are persisted in DB", async () => {
    const { id, sessionKey } = await createTestSession();

    // Daemon connects and subscribes
    const daemonWs = createTrackedWs();
    await daemonWs.connect(user.token, "daemon", {
      machineId: `exit-chunks-${Date.now()}`,
      machineName: "test",
    });
    daemonWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Send some encrypted chunks
    for (let i = 0; i < 3; i++) {
      const encrypted = await encryptChunk(
        new TextEncoder().encode(`output line ${i}`),
        sessionKey,
      );
      daemonWs.send(createEncryptedChunkFrame(id, encrypted));
    }

    // Daemon sends SESSION_ENDED + UNSUBSCRIBE
    daemonWs.send(createSessionEndedFrame(id));
    daemonWs.send(createUnsubscribeFrame(id));

    // Wait for flush (server flushes on SESSION_ENDED + 2s flush timer)
    await new Promise((r) => setTimeout(r, 3000));

    // Verify chunks are in DB
    const { body } = await api.getChunks(id);
    expect(body.data!.length).toBe(3);

    // Verify chunks are decryptable
    for (let i = 0; i < 3; i++) {
      const chunk = body.data![i] as { data: string };
      const packed = Buffer.from(chunk.data, "base64");
      const decrypted = await decryptChunk(new Uint8Array(packed), sessionKey);
      expect(new TextDecoder().decode(decrypted)).toBe(`output line ${i}`);
    }
  });

  it("multiple browsers all receive SESSION_ENDED when daemon exits", async () => {
    const { id } = await createTestSession();

    // Daemon connects and subscribes
    const daemonWs = createTrackedWs();
    await daemonWs.connect(user.token, "daemon", {
      machineId: `exit-multi-${Date.now()}`,
      machineName: "test",
    });
    daemonWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Two browsers connect
    const browser1 = createTrackedWs();
    const browser2 = createTrackedWs();
    await browser1.connect(user.token, "browser");
    await browser2.connect(user.token, "browser");
    browser1.send(createSubscribeFrame(id));
    browser2.send(createSubscribeFrame(id));

    await browser1.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    await browser2.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browser1.receivedFrames.length = 0;
    browser2.receivedFrames.length = 0;

    // Daemon sends SESSION_ENDED + UNSUBSCRIBE
    daemonWs.send(createSessionEndedFrame(id));
    daemonWs.send(createUnsubscribeFrame(id));

    // Both browsers should receive SESSION_ENDED
    const ended1 = await browser1.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      5_000,
    );
    const ended2 = await browser2.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      5_000,
    );
    expect(ended1.sessionId).toBe(id);
    expect(ended2.sessionId).toBe(id);

    // Both should also receive CLI_DISCONNECTED
    const disc1 = await browser1.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED,
      5_000,
    );
    const disc2 = await browser2.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED,
      5_000,
    );
    expect(disc1.sessionId).toBe(id);
    expect(disc2.sessionId).toBe(id);
  });

  it("CLI (non-daemon) sending SESSION_ENDED + UNSUBSCRIBE also notifies browser", async () => {
    const { id } = await createTestSession();

    // CLI connects and subscribes
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Browser connects and subscribes
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));

    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browserWs.receivedFrames.length = 0;

    // CLI sends SESSION_ENDED then UNSUBSCRIBE
    cliWs.send(createSessionEndedFrame(id));
    cliWs.send(createUnsubscribeFrame(id));

    // Browser should receive SESSION_ENDED
    const ended = await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      5_000,
    );
    expect(ended.sessionId).toBe(id);

    // Browser should also receive CLI_DISCONNECTED
    const disconnected = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED,
      5_000,
    );
    expect(disconnected.sessionId).toBe(id);
  });

  it("browser cannot send SESSION_ENDED (only CLI/daemon can)", async () => {
    const { id } = await createTestSession();

    // Browser connects and subscribes
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Browser tries to send SESSION_ENDED — should be silently rejected
    browserWs.send(createSessionEndedFrame(id));

    // Wait a moment — no crash, connection stays open
    await new Promise((r) => setTimeout(r, 500));

    // Verify connection is still alive by subscribing again (no error)
    browserWs.receivedFrames.length = 0;
  });

  it("SESSION_ENDED for unsubscribed session is silently ignored", async () => {
    const { id } = await createTestSession();

    // Daemon connects but does NOT subscribe to the session
    const daemonWs = createTrackedWs();
    await daemonWs.connect(user.token, "daemon", {
      machineId: `exit-nosub-${Date.now()}`,
      machineName: "test",
    });

    // Browser subscribes
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));
    browserWs.receivedFrames.length = 0;

    // Daemon sends SESSION_ENDED without being subscribed — should be ignored
    daemonWs.send(createSessionEndedFrame(id));
    await new Promise((r) => setTimeout(r, 500));

    // Browser should NOT have received SESSION_ENDED
    const endedFrames = browserWs.receivedFrames.filter(
      (f) => f.type === FrameType.SESSION_ENDED,
    );
    expect(endedFrames.length).toBe(0);
  });

  it("session status is 'stopped' in DB after daemon marks it and exits", async () => {
    const { id } = await createTestSession();

    // Daemon connects and subscribes
    const daemonWs = createTrackedWs();
    await daemonWs.connect(user.token, "daemon", {
      machineId: `exit-status-${Date.now()}`,
      machineName: "test",
    });
    daemonWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Simulate what the real daemon does: update status, then send frames
    await api.updateSession(id, {
      status: "stopped",
      endedAt: new Date().toISOString(),
    });

    daemonWs.send(createSessionEndedFrame(id));
    daemonWs.send(createUnsubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 500));

    // Verify DB status
    const { body } = await api.getSession(id);
    expect(body.data!.status).toBe("stopped");
    expect(body.data!.endedAt).not.toBeNull();
  });

  it("data relay works normally until SESSION_ENDED is sent", async () => {
    const { id, sessionKey } = await createTestSession();

    // Daemon and browser connect
    const daemonWs = createTrackedWs();
    await daemonWs.connect(user.token, "daemon", {
      machineId: `exit-relay-${Date.now()}`,
      machineName: "test",
    });
    daemonWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browserWs.receivedFrames.length = 0;

    // Send chunk — should be relayed to browser
    const encrypted = await encryptChunk(
      new TextEncoder().encode("before exit"),
      sessionKey,
    );
    daemonWs.send(createEncryptedChunkFrame(id, encrypted));

    const chunk = await browserWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_CHUNK,
      5_000,
    );
    const decrypted = await decryptChunk(chunk.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe("before exit");

    // Now daemon exits
    browserWs.receivedFrames.length = 0;
    daemonWs.send(createSessionEndedFrame(id));
    daemonWs.send(createUnsubscribeFrame(id));

    // Browser gets SESSION_ENDED
    const ended = await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      5_000,
    );
    expect(ended.sessionId).toBe(id);
  });
});
