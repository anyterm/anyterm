import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  encryptChunk,
  toBase64,
  createSubscribeFrame,
  createEncryptedChunkFrame,
  FrameType,
} from "../helpers/crypto.js";

/**
 * Tests for the disconnected → stopped session lifecycle.
 *
 * The WS server is started with WS_STOPPED_GRACE_MS=3000 (3s) in e2e.
 *
 * When CLI disconnects:
 * 1. Session status → "disconnected" immediately
 * 2. After grace period (3s in tests) → "stopped" with endedAt
 *
 * When CLI reconnects within the grace period:
 * 1. Grace timer is cancelled
 * 2. Session status → "running" with endedAt cleared
 */

describe("Disconnected Session Lifecycle", () => {
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
    const encSk = await encryptSessionKey(sessionKey, user.publicKey);
    const { body } = await api.createSession({
      name: "disconnect-test",
      command: "bash",
      encryptedSessionKey: toBase64(encSk),
    });
    return {
      id: body.data!.id as string,
      sessionKey,
    };
  }

  async function getSessionStatus(sessionId: string) {
    const { body } = await api.getSession(sessionId);
    return {
      status: (body.data as Record<string, unknown>)?.status as string,
      endedAt: (body.data as Record<string, unknown>)?.endedAt as string | null,
    };
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

  it("marks session as 'disconnected' when CLI disconnects", async () => {
    const { id } = await createTestSession();

    // CLI connects and subscribes
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Verify running
    let session = await getSessionStatus(id);
    expect(session.status).toBe("running");

    // CLI disconnects
    cliWs.close();
    const idx = wsClients.indexOf(cliWs);
    if (idx !== -1) wsClients.splice(idx, 1);

    // Wait for markSessionDisconnected to complete
    await new Promise((r) => setTimeout(r, 500));

    // Verify disconnected
    session = await getSessionStatus(id);
    expect(session.status).toBe("disconnected");
    expect(session.endedAt).toBeNull();
  });

  it("restores 'running' when CLI reconnects within grace period", async () => {
    const { id } = await createTestSession();

    // CLI connects
    const cliWs1 = createTrackedWs();
    await cliWs1.connect(user.token, "cli");
    cliWs1.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // CLI disconnects
    cliWs1.close();
    const idx = wsClients.indexOf(cliWs1);
    if (idx !== -1) wsClients.splice(idx, 1);
    await new Promise((r) => setTimeout(r, 500));

    // Verify disconnected
    let session = await getSessionStatus(id);
    expect(session.status).toBe("disconnected");

    // CLI reconnects within grace period (3s in tests)
    const cliWs2 = createTrackedWs();
    await cliWs2.connect(user.token, "cli");
    cliWs2.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 500));

    // Verify running again
    session = await getSessionStatus(id);
    expect(session.status).toBe("running");
    expect(session.endedAt).toBeNull();
  });

  it("escalates to 'stopped' after grace period expires", async () => {
    const { id } = await createTestSession();

    // CLI connects and disconnects
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    cliWs.close();
    const idx = wsClients.indexOf(cliWs);
    if (idx !== -1) wsClients.splice(idx, 1);

    // Wait for grace period to expire (3s in tests + buffer)
    await new Promise((r) => setTimeout(r, 4500));

    // Verify stopped with endedAt set
    const session = await getSessionStatus(id);
    expect(session.status).toBe("stopped");
    expect(session.endedAt).not.toBeNull();
  });

  it("cancels grace timer when session is deleted while disconnected", async () => {
    const { id } = await createTestSession();

    // CLI connects and disconnects
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    cliWs.close();
    const idx = wsClients.indexOf(cliWs);
    if (idx !== -1) wsClients.splice(idx, 1);
    await new Promise((r) => setTimeout(r, 500));

    // Delete the session while it's disconnected
    const { status } = await api.deleteSession(id);
    expect(status).toBe(200);

    // Wait past grace period — should not cause errors
    await new Promise((r) => setTimeout(r, 4000));

    // Session should be gone
    const { status: getStatus } = await api.getSession(id);
    expect(getStatus).toBe(404);
  });

  it("browser sees 'disconnected' status via CLI_DISCONNECTED + DB status", async () => {
    const { id } = await createTestSession();

    // CLI connects
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Browser subscribes — should get CLI_CONNECTED
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browserWs.receivedFrames.length = 0;

    // CLI disconnects
    cliWs.close();
    const idx = wsClients.indexOf(cliWs);
    if (idx !== -1) wsClients.splice(idx, 1);

    // Browser should receive CLI_DISCONNECTED
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_DISCONNECTED);

    // DB should reflect "disconnected"
    await new Promise((r) => setTimeout(r, 500));
    const session = await getSessionStatus(id);
    expect(session.status).toBe("disconnected");
  });

  it("flushes pending chunks on CLI disconnect", async () => {
    const { id, sessionKey } = await createTestSession();

    // CLI connects
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // CLI sends some chunks via WS (these get queued in the server's persistence layer)
    for (let i = 0; i < 5; i++) {
      const encrypted = await encryptChunk(
        new TextEncoder().encode(`chunk-${i}`),
        sessionKey,
      );
      cliWs.send(createEncryptedChunkFrame(id, encrypted));
    }

    // Small delay for chunks to be queued
    await new Promise((r) => setTimeout(r, 300));

    // CLI disconnects — should trigger flushSessionChunks
    cliWs.close();
    const idx = wsClients.indexOf(cliWs);
    if (idx !== -1) wsClients.splice(idx, 1);

    // Wait for flush to complete
    await new Promise((r) => setTimeout(r, 1000));

    // Chunks should be persisted in DB
    const { body } = await api.getChunks(id);
    expect(body.data!.length).toBe(5);
  });

  it("does not produce FK errors when session is deleted while chunks are queued", async () => {
    const { id, sessionKey } = await createTestSession();

    // CLI connects and sends chunks
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 300));

    // Send a burst of chunks
    for (let i = 0; i < 10; i++) {
      const encrypted = await encryptChunk(
        new TextEncoder().encode(`chunk-${i}`),
        sessionKey,
      );
      cliWs.send(createEncryptedChunkFrame(id, encrypted));
    }

    // Delete session immediately — chunks may still be in the pending queue
    await api.deleteSession(id);

    // CLI receives SESSION_ENDED
    await cliWs.waitForMessage((f) => f.type === FrameType.SESSION_ENDED, 5000);

    // Wait for the flush timer to fire (2s interval) — should not throw FK error
    await new Promise((r) => setTimeout(r, 3000));

    // If we got here without the server crashing, the FK handling works
    // Verify session is gone
    const { status } = await api.getSession(id);
    expect(status).toBe(404);
  });

  it("handles multiple disconnect/reconnect cycles correctly", async () => {
    const { id } = await createTestSession();

    for (let cycle = 0; cycle < 3; cycle++) {
      // Connect
      const cliWs = createTrackedWs();
      await cliWs.connect(user.token, "cli");
      cliWs.send(createSubscribeFrame(id));
      await new Promise((r) => setTimeout(r, 300));

      let session = await getSessionStatus(id);
      expect(session.status).toBe("running");

      // Disconnect
      cliWs.close();
      const idx = wsClients.indexOf(cliWs);
      if (idx !== -1) wsClients.splice(idx, 1);
      await new Promise((r) => setTimeout(r, 500));

      session = await getSessionStatus(id);
      expect(session.status).toBe("disconnected");
    }
  });
});
