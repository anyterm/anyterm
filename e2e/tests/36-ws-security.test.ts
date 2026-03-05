import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  encodeFrame,
  FrameType,
  FRAME_VERSION,
} from "../helpers/crypto.js";
import { getEnv } from "../helpers/env.js";

describe("36 — WebSocket Security Limits", () => {
  let user: RegisteredUser;
  let api: ApiClient;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);
  });

  function makeSession(name: string) {
    const sessionKey = generateSessionKey();
    const encryptedSessionKey = encryptSessionKey(sessionKey, user.publicKey);
    return {
      session: {
        name,
        command: "echo test",
        encryptedSessionKey: toBase64(encryptedSessionKey),
      },
      sessionKey,
    };
  }

  // --- Rate limiting: server drops frames beyond 100/second ---

  it("rate limiting drops frames beyond 100/s", async () => {
    const { session, sessionKey } = makeSession("rate-limit-test");
    const res = await api.createSession(session);
    expect(res.status).toBe(200);
    const sessionId = (res.body.data as Record<string, string>).id;

    const cli = new WsClient();
    await cli.connect(user.token, "cli");
    cli.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Send 150 chunks as fast as possible (limit is 100/s)
    const totalSent = 150;
    for (let i = 1; i <= totalSent; i++) {
      const plain = new TextEncoder().encode(`rate-chunk-${i}`);
      const encrypted = encryptChunk(plain, sessionKey);
      cli.send(createEncryptedChunkFrame(sessionId, encrypted));
    }

    // Wait for persistence flush (2s interval + buffer)
    await new Promise((r) => setTimeout(r, 4000));

    const chunks = await api.getChunks(sessionId);
    expect(chunks.status).toBe(200);
    const stored = (chunks.body.data as Array<Record<string, unknown>>).length;

    // Rate limit is 100/s. Some frames should have been dropped.
    // Allow small margin since rate window is sliding.
    expect(stored).toBeLessThan(totalSent);
    expect(stored).toBeGreaterThanOrEqual(90); // at least ~100 should pass

    cli.close();
  });

  // --- Oversized frame silently dropped ---

  it("oversized frame (>2MB) is silently dropped", async () => {
    const { session, sessionKey } = makeSession("oversize-test");
    const res = await api.createSession(session);
    expect(res.status).toBe(200);
    const sessionId = (res.body.data as Record<string, string>).id;

    const cli = new WsClient();
    await cli.connect(user.token, "cli");
    cli.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Send a small valid chunk first to verify connectivity
    const smallPlain = new TextEncoder().encode("small-chunk");
    const smallEncrypted = encryptChunk(smallPlain, sessionKey);
    cli.send(createEncryptedChunkFrame(sessionId, smallEncrypted));

    // Construct an oversized raw frame (> 2MB + 512)
    // Frame: "VC"(2B) + version(1B) + type(1B) + sessionIdLen(4B) + sessionId + payloadLen(4B) + payload
    const oversizePayloadLen = 2 * 1024 * 1024 + 1024; // ~2MB + 1KB
    const sidBytes = new TextEncoder().encode(sessionId);
    const headerLen = 2 + 1 + 1 + 4 + sidBytes.length + 4;
    const frame = new Uint8Array(headerLen + oversizePayloadLen);
    const view = new DataView(frame.buffer);

    // Magic "VC"
    frame[0] = 0x56; // V
    frame[1] = 0x43; // C
    // Version
    frame[2] = FRAME_VERSION;
    // Type = ENCRYPTED_CHUNK (0x03)
    frame[3] = 0x03;
    // Session ID length
    view.setUint32(4, sidBytes.length, false);
    // Session ID
    frame.set(sidBytes, 8);
    // Payload length
    view.setUint32(8 + sidBytes.length, oversizePayloadLen, false);
    // Payload (zeros = garbage, doesn't matter)

    cli.send(frame);

    // Wait for flush
    await new Promise((r) => setTimeout(r, 3000));

    const chunks = await api.getChunks(sessionId);
    expect(chunks.status).toBe(200);
    const stored = chunks.body.data as Array<Record<string, unknown>>;

    // Only the small valid chunk should be stored, not the oversized one
    expect(stored.length).toBe(1);

    cli.close();
  });

  // --- Concurrent session creation race ---

  it("concurrent session creation respects limit", async () => {
    // Create a fresh user for isolation (team tier = 10 sessions/user)
    const raceUser = await registerUser();
    const raceApi = new ApiClient(raceUser.cookieToken);

    // Fill up to limit - 2 (leave room for the race)
    for (let i = 0; i < 8; i++) {
      const sk = generateSessionKey();
      const esk = encryptSessionKey(sk, raceUser.publicKey);
      const r = await raceApi.createSession({
        name: `prefill-${i}`,
        command: "echo prefill",
        encryptedSessionKey: toBase64(esk),
      });
      expect(r.status).toBe(200);
    }

    // Now at 8/10. Fire 5 parallel creation requests.
    // Only 2 should succeed (slots 9, 10). The other 3 should fail.
    const promises = Array.from({ length: 5 }, (_, i) => {
      const sk = generateSessionKey();
      const esk = encryptSessionKey(sk, raceUser.publicKey);
      return raceApi.createSession({
        name: `race-${i}`,
        command: "echo race",
        encryptedSessionKey: toBase64(esk),
      });
    });

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.status === 200).length;
    const failures = results.filter((r) => r.status === 400).length;

    // Advisory lock ensures exactly 2 succeed, 3 fail
    expect(successes).toBe(2);
    expect(failures).toBe(3);
  });

  // --- Daemon spawn concurrent limit ---

  it("daemon spawn limit returns 429 at 5 in-flight", async () => {
    // Fresh user for isolation
    const daemonUser = await registerUser();

    // Connect a daemon WsClient so the server knows we have a daemon
    const daemon = new WsClient();
    const machineId = `test-${Date.now().toString(36)}`;
    await daemon.connect(daemonUser.token, "daemon", {
      machineId,
      machineName: "test-machine",
    });

    const { wsUrl } = getEnv();
    const httpBase = wsUrl
      .replace("ws://", "http://")
      .replace("wss://", "https://");

    const spawnUrl = `${httpBase}/api/daemon/spawn`;
    const headers = {
      "Content-Type": "application/json",
      Cookie: `better-auth.session_token=${daemonUser.cookieToken}`,
    };
    const body = JSON.stringify({
      encryptedPayload: toBase64(new Uint8Array(64)),
      targetMachineId: machineId,
    });

    // Fire 7 spawn requests simultaneously.
    // The first 5 will be accepted (blocking, waiting for daemon response).
    // Request 6+ should get 429.
    // Use short timeout for non-429 requests since daemon won't respond.
    async function spawnRequest(): Promise<{
      status: number;
      body: Record<string, unknown> | null;
    }> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      try {
        const res = await fetch(spawnUrl, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const json = await res.json();
        return { status: res.status, body: json };
      } catch {
        clearTimeout(timer);
        return { status: 0, body: null }; // aborted (pending spawn)
      }
    }

    const results = await Promise.allSettled(
      Array.from({ length: 7 }, () => spawnRequest()),
    );

    const statuses = results
      .filter(
        (r): r is PromiseFulfilledResult<{ status: number; body: Record<string, unknown> | null }> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value.status);

    // At least one should be 429 (too many concurrent spawns)
    const has429 = statuses.some((s) => s === 429);
    expect(has429).toBe(true);

    // The 429 responses should contain the right error message
    const spawns429 = results
      .filter(
        (r): r is PromiseFulfilledResult<{ status: number; body: Record<string, unknown> | null }> =>
          r.status === "fulfilled" && r.value.status === 429,
      );
    for (const s of spawns429) {
      expect((s.value.body as Record<string, string>)?.error).toContain(
        "Too many concurrent spawn",
      );
    }

    daemon.close();
  });
});
