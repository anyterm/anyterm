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
  fromBase64,
  createSubscribeFrame,
  createEncryptedChunkFrame,
  createSnapshotFrame,
  FrameType,
} from "../helpers/crypto.js";

describe("29 — Snapshot Storage & Chunk Pruning", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let cli: WsClient;
  let sessionId: string;
  let sessionKey: Uint8Array;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    sessionKey = generateSessionKey();
    const encryptedSessionKey = encryptSessionKey(sessionKey, user.publicKey);

    const res = await api.createSession({
      name: "snapshot-test",
      command: "echo snapshot",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    expect(res.status).toBe(200);
    sessionId = (res.body.data as Record<string, string>).id;

    cli = new WsClient();
    await cli.connect(user.token, "cli");
    cli.send(createSubscribeFrame(sessionId));

    // Wait for subscribe to propagate
    await new Promise((r) => setTimeout(r, 300));
  });

  afterAll(() => {
    cli.close();
  });

  it("stores chunks sent via WS", async () => {
    // Send 5 chunks
    for (let i = 1; i <= 5; i++) {
      const plain = new TextEncoder().encode(`chunk-${i}`);
      const encrypted = encryptChunk(plain, sessionKey);
      cli.send(createEncryptedChunkFrame(sessionId, encrypted));
    }

    // Wait for flush (CHUNK_FLUSH_INTERVAL_MS = 2000)
    await new Promise((r) => setTimeout(r, 3000));

    const chunks = await api.getChunks(sessionId);
    expect(chunks.status).toBe(200);
    const data = chunks.body.data as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThanOrEqual(5);
  });

  it("snapshot updates snapshotSeq and snapshotData", async () => {
    const snapshotPayload = new TextEncoder().encode("snapshot-state-v1");
    cli.send(createSnapshotFrame(sessionId, snapshotPayload));

    // Wait for persistence
    await new Promise((r) => setTimeout(r, 2000));

    const session = await api.getSession(sessionId);
    expect(session.status).toBe(200);
    const s = session.body.data as Record<string, unknown>;
    expect(s.snapshotSeq).toBeGreaterThanOrEqual(5);
    expect(s.snapshotData).toBeTruthy();
  });

  it("chunks with seq <= snapshotSeq are pruned", async () => {
    const session = await api.getSession(sessionId);
    const snapshotSeq = (session.body.data as Record<string, unknown>)
      .snapshotSeq as number;

    // Fetch chunks from seq 0 — should be empty since they were pruned
    const chunks = await api.getChunks(sessionId, { after: 0, limit: 1000 });
    const data = chunks.body.data as Array<Record<string, unknown>>;
    for (const chunk of data) {
      expect((chunk.seq as number)).toBeGreaterThan(snapshotSeq);
    }
  });

  it("chunks after snapshotSeq remain", async () => {
    const session = await api.getSession(sessionId);
    const snapshotSeq = (session.body.data as Record<string, unknown>)
      .snapshotSeq as number;

    // Send chunks after the snapshot
    for (let i = 0; i < 3; i++) {
      const plain = new TextEncoder().encode(`post-snap-${i}`);
      const encrypted = encryptChunk(plain, sessionKey);
      cli.send(createEncryptedChunkFrame(sessionId, encrypted));
    }

    await new Promise((r) => setTimeout(r, 3000));

    const chunks = await api.getChunks(sessionId, {
      after: snapshotSeq,
      limit: 1000,
    });
    const data = chunks.body.data as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  it("browser can read snapshot data", async () => {
    const session = await api.getSession(sessionId);
    const s = session.body.data as Record<string, unknown>;
    expect(s.snapshotData).toBeTruthy();

    // Verify it's valid base64
    const decoded = fromBase64(s.snapshotData as string);
    expect(decoded.length).toBeGreaterThan(0);
  });

  it("second snapshot prunes more chunks", async () => {
    // Send more chunks
    for (let i = 0; i < 5; i++) {
      const plain = new TextEncoder().encode(`batch2-${i}`);
      const encrypted = encryptChunk(plain, sessionKey);
      cli.send(createEncryptedChunkFrame(sessionId, encrypted));
    }
    await new Promise((r) => setTimeout(r, 3000));

    const beforeSession = await api.getSession(sessionId);
    const beforeSeq = (beforeSession.body.data as Record<string, unknown>)
      .snapshotSeq as number;

    // Send second snapshot
    const snapshotPayload2 = new TextEncoder().encode("snapshot-state-v2");
    cli.send(createSnapshotFrame(sessionId, snapshotPayload2));
    await new Promise((r) => setTimeout(r, 2000));

    const afterSession = await api.getSession(sessionId);
    const afterSeq = (afterSession.body.data as Record<string, unknown>)
      .snapshotSeq as number;
    expect(afterSeq).toBeGreaterThan(beforeSeq);

    // Old chunks pruned
    const chunks = await api.getChunks(sessionId, { after: 0, limit: 1000 });
    const data = chunks.body.data as Array<Record<string, unknown>>;
    for (const chunk of data) {
      expect((chunk.seq as number)).toBeGreaterThan(afterSeq);
    }
  });

  it("snapshot with no prior chunks works", async () => {
    // Create a fresh session
    const sk = generateSessionKey();
    const esk = encryptSessionKey(sk, user.publicKey);
    const res = await api.createSession({
      name: "snap-empty",
      command: "echo empty",
      encryptedSessionKey: toBase64(esk),
    });
    const sid = (res.body.data as Record<string, string>).id;

    const cli2 = new WsClient();
    await cli2.connect(user.token, "cli");
    cli2.send(createSubscribeFrame(sid));
    await new Promise((r) => setTimeout(r, 300));

    // Send snapshot immediately (no chunks sent)
    const payload = new TextEncoder().encode("initial-snapshot");
    cli2.send(createSnapshotFrame(sid, payload));
    await new Promise((r) => setTimeout(r, 2000));

    const session = await api.getSession(sid);
    const s = session.body.data as Record<string, unknown>;
    expect(s.snapshotSeq).toBe(0);
    expect(s.snapshotData).toBeTruthy();

    cli2.close();
  });
});
