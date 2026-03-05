import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

describe("WebSocket Relay", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let sessionKey: Uint8Array;
  let cliWs: WsClient;
  let browserWs: WsClient;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);

    sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "ws-test",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    sessionId = body.data!.id as string;
  });

  afterAll(() => {
    cliWs?.close();
    browserWs?.close();
  });

  it("CLI WebSocket client connects and subscribes", async () => {
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));

    // Small delay for subscription to propagate
    await new Promise((r) => setTimeout(r, 200));
  });

  it("browser WebSocket client connects and subscribes", async () => {
    browserWs = new WsClient();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));

    await new Promise((r) => setTimeout(r, 200));
  });

  it("CLI sends ENCRYPTED_CHUNK, browser receives and decrypts", async () => {
    const plaintext = "terminal output from CLI";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(plaintext),
      sessionKey,
    );
    const frame = createEncryptedChunkFrame(sessionId, encrypted);

    cliWs.send(frame);

    const received = await browserWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_CHUNK,
    );

    expect(received.sessionId).toBe(sessionId);
    const decrypted = await decryptChunk(received.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
  });

  it("browser sends ENCRYPTED_INPUT, CLI receives and decrypts", async () => {
    const plaintext = "user keyboard input";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(plaintext),
      sessionKey,
    );
    const frame = createEncryptedInputFrame(sessionId, encrypted);

    browserWs.send(frame);

    const received = await cliWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_INPUT,
    );

    expect(received.sessionId).toBe(sessionId);
    const decrypted = await decryptChunk(received.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
  });
});
