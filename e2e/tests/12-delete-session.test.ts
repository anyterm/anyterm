import { describe, it, expect, beforeAll } from "vitest";
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

describe("Delete Session", () => {
  let user: RegisteredUser;
  let otherUser: RegisteredUser;
  let api: ApiClient;
  let otherApi: ApiClient;

  beforeAll(async () => {
    [user, otherUser] = await Promise.all([registerUser(), registerUser()]);
    api = new ApiClient(user.cookieToken);
    otherApi = new ApiClient(otherUser.cookieToken);
  });

  async function createTestSession(
    client: ApiClient,
    publicKey: Uint8Array,
  ) {
    const sessionKey = await generateSessionKey();
    const encSk = await encryptSessionKey(sessionKey, publicKey);
    const result = await client.createSession({
      name: "delete-test",
      command: "echo test",
      encryptedSessionKey: toBase64(encSk),
    });
    return {
      id: (result.body.data as Record<string, string>).id,
      sessionKey,
    };
  }

  it("deletes a session and its chunks", async () => {
    const { id, sessionKey } = await createTestSession(api, user.publicKey);

    // Store some chunks
    const chunks = await Promise.all(
      [1, 2, 3].map(async (seq) => {
        const encrypted = await encryptChunk(
          new TextEncoder().encode(`line ${seq}`),
          sessionKey,
        );
        return { seq, data: toBase64(encrypted) };
      }),
    );
    await api.storeChunks(id, chunks);

    // Verify chunks exist
    const beforeChunks = await api.getChunks(id);
    expect(beforeChunks.body.data!.length).toBe(3);

    // Delete the session
    const { status } = await api.deleteSession(id);
    expect(status).toBe(200);

    // Session should no longer exist
    const { status: getStatus } = await api.getSession(id);
    expect(getStatus).toBe(404);

    // Chunks should be gone too (query returns empty array or error)
    const afterChunks = await api.getChunks(id);
    const chunkData = afterChunks.body.data ?? [];
    expect(chunkData.length).toBe(0);
  });

  it("returns error when deleting non-existent session", async () => {
    const { status } = await api.deleteSession("nonexistent-id");
    expect(status).toBe(404);
  });

  it("prevents deleting another user's session", async () => {
    const { id } = await createTestSession(api, user.publicKey);

    // Other user tries to delete
    const { status } = await otherApi.deleteSession(id);
    expect(status).toBe(404);

    // Session should still exist for the owner
    const { status: getStatus } = await api.getSession(id);
    expect(getStatus).toBe(200);
  });

  it("session disappears from list after deletion", async () => {
    const { id } = await createTestSession(api, user.publicKey);

    // Verify it appears in the list
    let list = await api.listSessions();
    expect(list.body.data!.some((s) => (s as Record<string, string>).id === id)).toBe(true);

    // Delete
    await api.deleteSession(id);

    // Verify it's gone from the list
    list = await api.listSessions();
    expect(list.body.data!.some((s) => (s as Record<string, string>).id === id)).toBe(false);
  });

  it("notifies CLI via SESSION_ENDED when live session is deleted", async () => {
    const { id, sessionKey } = await createTestSession(api, user.publicKey);

    // Connect CLI WsClient
    const cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 500));

    // Delete the session
    await api.deleteSession(id);

    // CLI should receive SESSION_ENDED frame
    const ended = await cliWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      5_000,
    );
    expect(ended).toBeTruthy();
    expect(ended!.sessionId).toBe(id);

    cliWs.close();
  });

  it("notifies browser viewer via SESSION_ENDED when session is deleted", async () => {
    const { id } = await createTestSession(api, user.publicKey);

    // Connect browser WsClient
    const browserWs = new WsClient();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 500));

    // Delete the session
    await api.deleteSession(id);

    // Browser should receive SESSION_ENDED frame
    const ended = await browserWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      5_000,
    );
    expect(ended).toBeTruthy();
    expect(ended!.sessionId).toBe(id);

    browserWs.close();
  });
});
