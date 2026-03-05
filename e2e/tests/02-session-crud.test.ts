import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
} from "../helpers/crypto.js";

describe("Session CRUD", () => {
  let userA: RegisteredUser;
  let userB: RegisteredUser;
  let apiA: ApiClient;
  let apiB: ApiClient;
  let sessionId: string;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([registerUser(), registerUser()]);
    apiA = new ApiClient(userA.cookieToken);
    apiB = new ApiClient(userB.cookieToken);
  });

  async function createTestSession(api: ApiClient, publicKey: Uint8Array) {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(sessionKey, publicKey);
    return api.createSession({
      name: "test-session",
      command: "echo hello",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      cols: 120,
      rows: 40,
    });
  }

  it("creates a terminal session", async () => {
    const { status, body } = await createTestSession(apiA, userA.publicKey);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.id).toBeTruthy();
    expect(body.data!.name).toBe("test-session");
    expect(body.data!.command).toBe("echo hello");
    expect(body.data!.status).toBe("running");
    expect(body.data!.cols).toBe(120);
    expect(body.data!.rows).toBe(40);

    sessionId = body.data!.id as string;
  });

  it("lists sessions for the user", async () => {
    const { status, body } = await apiA.listSessions();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.length).toBeGreaterThanOrEqual(1);
    expect(body.data!.some((s) => s.id === sessionId)).toBe(true);
  });

  it("gets a session by id", async () => {
    const { status, body } = await apiA.getSession(sessionId);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.id).toBe(sessionId);
    expect(body.data!.name).toBe("test-session");
  });

  it("updates session status", async () => {
    const { status, body } = await apiA.updateSession(sessionId, {
      status: "stopped",
      endedAt: new Date().toISOString(),
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.status).toBe("stopped");
  });

  it("returns 404 for non-existent session", async () => {
    const { status, body } = await apiA.getSession("nonexistent-id");

    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("prevents User B from accessing User A's session", async () => {
    const { status, body } = await apiB.getSession(sessionId);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });
});
