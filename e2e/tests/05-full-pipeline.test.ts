import { describe, it, expect } from "vitest";
import { registerUser, loginUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  decryptSessionKey,
  encryptChunk,
  decryptChunk,
  deriveKeysFromPassword,
  decryptPrivateKey,
  toBase64,
  fromBase64,
} from "../helpers/crypto.js";

describe("Full Pipeline", () => {
  it("register → encrypt → store → re-login → decrypt end-to-end", async () => {
    // 1. Register a user (generates keys, encrypts privateKey)
    const user = await registerUser();
    const api = new ApiClient(user.cookieToken);

    // 2. Generate session key and seal it with the user's public key
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    // 3. Create a terminal session
    const { body: sessionBody } = await api.createSession({
      name: "pipeline-test",
      command: "bash -c 'echo hello world'",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    const sessionId = sessionBody.data!.id as string;

    // 4. Encrypt terminal output chunks and store via API
    const originalLines = [
      "$ echo hello world",
      "hello world",
      "$ exit",
    ];

    const chunks = await Promise.all(
      originalLines.map(async (line, i) => {
        const encrypted = await encryptChunk(
          new TextEncoder().encode(line),
          sessionKey,
        );
        return { seq: i + 1, data: toBase64(encrypted) };
      }),
    );

    await api.storeChunks(sessionId, chunks);

    // 5. Mark session as stopped
    await api.updateSession(sessionId, {
      status: "stopped",
      endedAt: new Date().toISOString(),
    });

    // 6. Re-login as a fresh browser session (simulating new device)
    const freshLogin = await loginUser(user.email, user.password);
    const freshApi = new ApiClient(freshLogin.cookieToken);

    // 7. Fetch user keys and derive master key from password
    const { body: keysBody } = await freshApi.getKeys();
    const keySalt = fromBase64(keysBody.data!.keySalt);
    const { masterKey } = await deriveKeysFromPassword(
      user.password,
      keySalt,
    );

    // 8. Decrypt private key
    const encryptedPk = fromBase64(keysBody.data!.encryptedPrivateKey);
    const privateKey = await decryptPrivateKey(encryptedPk, masterKey);

    // 9. Fetch session and decrypt session key
    const { body: sessionData } = await freshApi.getSession(sessionId);
    const decryptedSessionKey = await decryptSessionKey(
      fromBase64(sessionData.data!.encryptedSessionKey as string),
      fromBase64(keysBody.data!.publicKey),
      privateKey,
    );

    // 10. Fetch chunks and decrypt them
    const { body: chunksBody } = await freshApi.getChunks(sessionId);
    expect(chunksBody.data!.length).toBe(3);

    const decryptedLines: string[] = [];
    for (const chunk of chunksBody.data!) {
      const decrypted = await decryptChunk(
        fromBase64(chunk.data as string),
        decryptedSessionKey,
      );
      decryptedLines.push(new TextDecoder().decode(decrypted));
    }

    // 11. Verify the full round-trip
    expect(decryptedLines).toEqual(originalLines);
  });
});
