import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  encryptChunk,
  decryptChunk,
  toBase64,
  fromBase64,
} from "../helpers/crypto.js";

describe("Chunk Storage", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let sessionId: string;
  let sessionKey: Uint8Array;
  const plainTexts = [
    "Hello, world!",
    "Line 2 of terminal output",
    "ANSI: \x1b[32mgreen\x1b[0m",
    "Unicode: 日本語テスト",
    "Final line of output",
  ];

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    // Create session
    sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "chunk-test",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    sessionId = body.data!.id as string;
  });

  it("stores a batch of encrypted chunks", async () => {
    const chunks = await Promise.all(
      plainTexts.map(async (text, i) => {
        const encrypted = await encryptChunk(
          new TextEncoder().encode(text),
          sessionKey,
        );
        return { seq: i + 1, data: toBase64(encrypted) };
      }),
    );

    const { status, body } = await api.storeChunks(sessionId, chunks);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("retrieves all chunks in order", async () => {
    const { status, body } = await api.getChunks(sessionId);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.length).toBe(5);

    // Verify ordering
    const seqs = body.data!.map((c) => c.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it("paginates chunks via after param", async () => {
    const { status, body } = await api.getChunks(sessionId, { after: 3 });

    expect(status).toBe(200);
    expect(body.data!.length).toBe(2);
    expect(body.data![0].seq).toBe(4);
    expect(body.data![1].seq).toBe(5);
  });

  it("decrypts all retrieved chunks to match original plaintext", async () => {
    const { body } = await api.getChunks(sessionId);

    for (let i = 0; i < body.data!.length; i++) {
      const chunk = body.data![i];
      const decrypted = await decryptChunk(
        fromBase64(chunk.data as string),
        sessionKey,
      );
      const text = new TextDecoder().decode(decrypted);
      expect(text).toBe(plainTexts[i]);
    }
  });
});
