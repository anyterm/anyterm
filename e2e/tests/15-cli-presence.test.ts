import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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
  createEncryptedChunkFrame,
  createEncryptedInputFrame,
  FrameType,
} from "../helpers/crypto.js";

/**
 * Tests for CLI presence tracking via CLI_CONNECTED / CLI_DISCONNECTED frames.
 *
 * The server tracks which sessions have a CLI WebSocket client connected.
 * When a browser subscribes, it immediately receives presence status.
 * When CLI connects or disconnects, all browser subscribers are notified.
 */

describe("CLI Presence", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let sessionId: string;
  let sessionKey: Uint8Array;

  // Keep track of all WS clients for cleanup
  const wsClients: WsClient[] = [];

  function createTrackedWs(): WsClient {
    const ws = new WsClient();
    wsClients.push(ws);
    return ws;
  }

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "presence-test",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    sessionId = body.data!.id as string;
  });

  afterEach(() => {
    // Close all WS clients between tests for clean state
    for (const ws of wsClients) {
      ws.close();
    }
    wsClients.length = 0;
  });

  it("browser receives CLI_DISCONNECTED when subscribing without CLI connected", async () => {
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));

    const frame = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED,
    );

    expect(frame.sessionId).toBe(sessionId);
  });

  it("browser receives CLI_CONNECTED when subscribing after CLI is already connected", async () => {
    // CLI connects first
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Browser subscribes after CLI
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));

    const frame = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED,
    );

    expect(frame.sessionId).toBe(sessionId);
  });

  it("browser receives CLI_CONNECTED when CLI subscribes after browser", async () => {
    // Browser connects first
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));

    // Wait for initial CLI_DISCONNECTED
    await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED,
    );

    // Clear received frames so we can wait for the next one
    browserWs.receivedFrames.length = 0;

    // CLI subscribes
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));

    const frame = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED,
    );

    expect(frame.sessionId).toBe(sessionId);
  });

  it("browser receives CLI_DISCONNECTED when CLI closes connection", async () => {
    // Both connect
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));

    // Wait for CLI_CONNECTED
    await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED,
    );
    browserWs.receivedFrames.length = 0;

    // CLI disconnects
    cliWs.close();
    // Remove from tracked so afterEach doesn't double-close
    const idx = wsClients.indexOf(cliWs);
    if (idx !== -1) wsClients.splice(idx, 1);

    const frame = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_DISCONNECTED,
    );

    expect(frame.sessionId).toBe(sessionId);
  });

  it("multiple browsers all receive CLI presence notifications", async () => {
    // Two browsers subscribe
    const browser1 = createTrackedWs();
    const browser2 = createTrackedWs();
    await browser1.connect(user.token, "browser");
    await browser2.connect(user.token, "browser");
    browser1.send(createSubscribeFrame(sessionId));
    browser2.send(createSubscribeFrame(sessionId));

    // Both receive initial CLI_DISCONNECTED
    await browser1.waitForMessage((f) => f.type === FrameType.CLI_DISCONNECTED);
    await browser2.waitForMessage((f) => f.type === FrameType.CLI_DISCONNECTED);
    browser1.receivedFrames.length = 0;
    browser2.receivedFrames.length = 0;

    // CLI connects
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));

    // Both browsers receive CLI_CONNECTED
    await browser1.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    await browser2.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);

    browser1.receivedFrames.length = 0;
    browser2.receivedFrames.length = 0;

    // CLI disconnects
    cliWs.close();
    const idx = wsClients.indexOf(cliWs);
    if (idx !== -1) wsClients.splice(idx, 1);

    // Both browsers receive CLI_DISCONNECTED
    await browser1.waitForMessage((f) => f.type === FrameType.CLI_DISCONNECTED);
    await browser2.waitForMessage((f) => f.type === FrameType.CLI_DISCONNECTED);
  });

  it("CLI reconnect sends CLI_CONNECTED again", async () => {
    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_DISCONNECTED);
    browserWs.receivedFrames.length = 0;

    // CLI connects
    const cliWs1 = createTrackedWs();
    await cliWs1.connect(user.token, "cli");
    cliWs1.send(createSubscribeFrame(sessionId));
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browserWs.receivedFrames.length = 0;

    // CLI disconnects
    cliWs1.close();
    const idx = wsClients.indexOf(cliWs1);
    if (idx !== -1) wsClients.splice(idx, 1);
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_DISCONNECTED);
    browserWs.receivedFrames.length = 0;

    // CLI reconnects
    const cliWs2 = createTrackedWs();
    await cliWs2.connect(user.token, "cli");
    cliWs2.send(createSubscribeFrame(sessionId));

    const frame = await browserWs.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED,
    );
    expect(frame.sessionId).toBe(sessionId);
  });

  it("data relay still works after CLI presence tracking", async () => {
    // Verify that the presence tracking doesn't break normal relay

    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    const browserWs = createTrackedWs();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));
    await browserWs.waitForMessage((f) => f.type === FrameType.CLI_CONNECTED);
    browserWs.receivedFrames.length = 0;

    // CLI sends output, browser receives
    const outputText = "presence-test: output";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(outputText),
      sessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(sessionId, encrypted));

    const chunkFrame = await browserWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_CHUNK,
    );
    const decrypted = await decryptChunk(chunkFrame.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe(outputText);

    // Browser sends input, CLI receives
    const inputText = "presence-test: input";
    const encInput = await encryptChunk(
      new TextEncoder().encode(inputText),
      sessionKey,
    );
    browserWs.send(createEncryptedInputFrame(sessionId, encInput));

    const inputFrame = await cliWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_INPUT,
    );
    const decInput = await decryptChunk(inputFrame.payload, sessionKey);
    expect(new TextDecoder().decode(decInput)).toBe(inputText);
  });

  it("CLI presence is per-session (different sessions are independent)", async () => {
    // Create a second session
    const sessionKey2 = await generateSessionKey();
    const encSk2 = await encryptSessionKey(sessionKey2, user.publicKey);
    const { body: body2 } = await api.createSession({
      name: "presence-test-2",
      command: "bash",
      encryptedSessionKey: toBase64(encSk2),
    });
    const sessionId2 = body2.data!.id as string;

    // CLI subscribes to session 1 only
    const cliWs = createTrackedWs();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Browser 1 subscribes to session 1 — should get CLI_CONNECTED
    const browser1 = createTrackedWs();
    await browser1.connect(user.token, "browser");
    browser1.send(createSubscribeFrame(sessionId));
    const frame1 = await browser1.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED || f.type === FrameType.CLI_DISCONNECTED,
    );
    expect(frame1.type).toBe(FrameType.CLI_CONNECTED);

    // Browser 2 subscribes to session 2 — should get CLI_DISCONNECTED
    const browser2 = createTrackedWs();
    await browser2.connect(user.token, "browser");
    browser2.send(createSubscribeFrame(sessionId2));
    const frame2 = await browser2.waitForMessage(
      (f) => f.type === FrameType.CLI_CONNECTED || f.type === FrameType.CLI_DISCONNECTED,
    );
    expect(frame2.type).toBe(FrameType.CLI_DISCONNECTED);
  });
});
