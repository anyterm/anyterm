import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { getEnv } from "../helpers/env.js";
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
  createPongFrame,
  FrameType,
} from "../helpers/crypto.js";

/**
 * Tests the browser-side WebSocket authentication and connectivity fixes:
 *
 * 1. GET /api/config — returns wsUrl for CLI discovery
 * 2. GET /api/ws-token — returns raw session token for browser WS auth
 * 3. Browser WS auth using token query param (from /api/ws-token)
 * 4. PING/PONG heartbeat keeping connection alive
 * 5. Full bidirectional CLI ↔ browser relay via token-authenticated WS
 */

describe("Browser WebSocket Auth & Connectivity", () => {
  let user: RegisteredUser;
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = getEnv().baseUrl;
    user = await registerUser();
  });

  // --- GET /api/config ---

  describe("GET /api/config", () => {
    it("returns wsUrl (public, no auth required)", async () => {
      const res = await fetch(`${baseUrl}/api/config`);

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.wsUrl).toBeTruthy();
      expect(typeof data.wsUrl).toBe("string");
      // Should be a ws:// or wss:// URL
      expect(data.wsUrl).toMatch(/^wss?:\/\//);
    });
  });

  // --- GET /api/ws-token ---

  describe("GET /api/ws-token", () => {
    it("returns session token when authenticated with cookie", async () => {
      const res = await fetch(`${baseUrl}/api/ws-token`, {
        headers: {
          Cookie: `better-auth.session_token=${user.cookieToken}`,
        },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.token).toBeTruthy();
      expect(typeof data.token).toBe("string");
    });

    it("returns 401 without authentication", async () => {
      const res = await fetch(`${baseUrl}/api/ws-token`);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 with invalid cookie", async () => {
      const res = await fetch(`${baseUrl}/api/ws-token`, {
        headers: {
          Cookie: "better-auth.session_token=invalid-token-xyz",
        },
      });

      expect(res.status).toBe(401);
    });

    it("returned token works for WS authentication", async () => {
      // Fetch token via cookie-authenticated endpoint (mimics browser fetch)
      const tokenRes = await fetch(`${baseUrl}/api/ws-token`, {
        headers: {
          Cookie: `better-auth.session_token=${user.cookieToken}`,
        },
      });
      const { token } = await tokenRes.json();

      // Use the token to connect WS (mimics browser WebSocket)
      const ws = new WsClient();
      await ws.connect(token, "browser");

      // Connection succeeded — clean up
      ws.close();
    });
  });

  // --- PING/PONG heartbeat ---

  describe("PING/PONG heartbeat", () => {
    let ws: WsClient;

    afterAll(() => {
      ws?.close();
    });

    it("server sends PING frame and client responds with PONG", async () => {
      ws = new WsClient();
      await ws.connect(user.token, "browser");

      // Wait for a PING from the server (sent every PING_INTERVAL_MS = 30s)
      // In tests, we wait up to 35s to accommodate timing
      const ping = await ws.waitForMessage(
        (f) => f.type === FrameType.PING,
        35_000,
      );
      expect(ping.type).toBe(FrameType.PING);

      // Respond with PONG (this is what the browser does)
      ws.send(createPongFrame());

      // Wait for the next PING — proves connection stayed alive after PONG
      const ping2 = await ws.waitForMessage(
        (f) => f.type === FrameType.PING && f !== ping,
        35_000,
      );
      expect(ping2.type).toBe(FrameType.PING);
    }, 75_000); // Long timeout for 2x PING_INTERVAL
  });

  // --- Full browser auth flow: ws-token → WS → relay ---

  describe("Browser-authenticated bidirectional relay", () => {
    let sessionId: string;
    let sessionKey: Uint8Array;
    let cliWs: WsClient;
    let browserWs: WsClient;

    beforeAll(async () => {
      // Create a session
      sessionKey = await generateSessionKey();
      const encryptedSessionKey = await encryptSessionKey(
        sessionKey,
        user.publicKey,
      );

      const api = new ApiClient(user.cookieToken);
      const result = await api.createSession({
        name: "browser-ws-auth-test",
        command: "echo hello",
        encryptedSessionKey: toBase64(encryptedSessionKey),
        cols: 80,
        rows: 24,
      });

      expect(result.status).toBe(200);
      sessionId = (result.body.data as Record<string, string>).id;

      // CLI connects with raw token
      cliWs = new WsClient();
      await cliWs.connect(user.token, "cli");
      cliWs.send(createSubscribeFrame(sessionId));

      // Browser fetches ws-token (simulating httpOnly cookie flow)
      const tokenRes = await fetch(`${baseUrl}/api/ws-token`, {
        headers: {
          Cookie: `better-auth.session_token=${user.cookieToken}`,
        },
      });
      const { token: browserToken } = await tokenRes.json();

      // Browser connects using the fetched token
      browserWs = new WsClient();
      await browserWs.connect(browserToken, "browser");
      browserWs.send(createSubscribeFrame(sessionId));

      // Let subscriptions settle
      await new Promise((r) => setTimeout(r, 300));
    });

    afterAll(() => {
      cliWs?.close();
      browserWs?.close();
    });

    it("CLI sends encrypted output, browser receives via token-auth WS", async () => {
      const plaintext = "browser-auth-test: terminal output from CLI";
      const encrypted = await encryptChunk(
        new TextEncoder().encode(plaintext),
        sessionKey,
      );
      cliWs.send(createEncryptedChunkFrame(sessionId, encrypted));

      const received = await browserWs.waitForMessage(
        (f) => f.type === FrameType.ENCRYPTED_CHUNK,
      );
      expect(received.sessionId).toBe(sessionId);

      const decrypted = await decryptChunk(received.payload, sessionKey);
      expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
    });

    it("browser sends encrypted input via token-auth WS, CLI receives", async () => {
      const plaintext = "browser-auth-test: user keystroke from browser";
      const encrypted = await encryptChunk(
        new TextEncoder().encode(plaintext),
        sessionKey,
      );
      browserWs.send(createEncryptedInputFrame(sessionId, encrypted));

      const received = await cliWs.waitForMessage(
        (f) => f.type === FrameType.ENCRYPTED_INPUT,
      );
      expect(received.sessionId).toBe(sessionId);

      const decrypted = await decryptChunk(received.payload, sessionKey);
      expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
    });
  });

  // --- Edge cases ---

  describe("WS auth edge cases", () => {
    it("WS connection with invalid token is rejected during handshake", async () => {
      const ws = new WsClient();
      await expect(
        ws.connect("invalid-token-xyz", "browser"),
      ).rejects.toThrow(/Handshake failed/);
      ws.close();
    });

    it("browser WS stays alive when responding to PINGs", async () => {
      // Fetch token via browser auth path
      const tokenRes = await fetch(`${baseUrl}/api/ws-token`, {
        headers: {
          Cookie: `better-auth.session_token=${user.cookieToken}`,
        },
      });
      const { token } = await tokenRes.json();

      const ws = new WsClient();
      await ws.connect(token, "browser");

      // Wait for a PING and respond with PONG
      const ping = await ws.waitForMessage(
        (f) => f.type === FrameType.PING,
        35_000,
      );
      expect(ping.type).toBe(FrameType.PING);
      ws.send(createPongFrame());

      // Connection should still be alive — send another message and get a second PING
      const ping2 = await ws.waitForMessage(
        (f) => f.type === FrameType.PING && f !== ping,
        35_000,
      );
      expect(ping2.type).toBe(FrameType.PING);

      ws.close();
    }, 75_000);
  });
});
