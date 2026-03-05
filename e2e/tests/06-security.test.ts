import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import {
  deriveKeysFromPassword,
  decryptPrivateKey,
  generateSessionKey,
  encryptSessionKey,
  encryptChunk,
  toBase64,
  fromBase64,
} from "../helpers/crypto.js";

describe("Security", () => {
  let userA: RegisteredUser;
  let userB: RegisteredUser;
  let apiA: ApiClient;
  let apiB: ApiClient;
  let sessionIdA: string;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([registerUser(), registerUser()]);
    apiA = new ApiClient(userA.cookieToken);
    apiB = new ApiClient(userB.cookieToken);

    // Create a session for user A
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      userA.publicKey,
    );
    const { body } = await apiA.createSession({
      name: "secure-session",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    sessionIdA = body.data!.id as string;

    // Store a chunk
    const encrypted = await encryptChunk(
      new TextEncoder().encode("secret data"),
      sessionKey,
    );
    await apiA.storeChunks(sessionIdA, [{ seq: 1, data: toBase64(encrypted) }]);
  });

  it("wrong password cannot decrypt privateKey", async () => {
    const { body } = await apiA.getKeys();
    const keySalt = fromBase64(body.data!.keySalt);
    const encryptedPk = fromBase64(body.data!.encryptedPrivateKey);

    const { masterKey: wrongKey } = await deriveKeysFromPassword(
      "CompletelyWrong!",
      keySalt,
    );

    expect(() => decryptPrivateKey(encryptedPk, wrongKey)).toThrow();
  });

  it("User B cannot GET another user's session", async () => {
    const { status, body } = await apiB.getSession(sessionIdA);
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("User B cannot PATCH another user's session", async () => {
    const { status, body } = await apiB.updateSession(sessionIdA, {
      status: "stopped",
    });
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("User B cannot access another user's chunks", async () => {
    const { status, body } = await apiB.getChunks(sessionIdA);
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("session lists are user-isolated", async () => {
    const { body: listA } = await apiA.listSessions();
    const { body: listB } = await apiB.listSessions();

    const aIds = listA.data!.map((s) => s.id);
    const bIds = listB.data!.map((s) => s.id);

    expect(aIds).toContain(sessionIdA);
    expect(bIds).not.toContain(sessionIdA);
  });

  it("invalid Bearer token returns error on GraphQL", async () => {
    const { status, body } = await ApiClient.rawFetch("/api/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token-xyz",
      },
      body: JSON.stringify({ query: "{ sessions { id } }" }),
    });
    // GraphQL Yoga returns 200 with errors array
    expect(status).toBe(200);
    const response = body as { errors?: Array<{ message: string }> };
    expect(response.errors).toBeDefined();
    expect(response.errors!.length).toBeGreaterThan(0);
  });

  it("rejects WebSocket connection with invalid token", async () => {
    const ws = new WsClient();
    await expect(
      ws.connect("invalid-token-xyz", "browser"),
    ).rejects.toThrow(/Handshake failed/);
    ws.close();
  });
});
