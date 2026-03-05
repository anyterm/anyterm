import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
} from "../helpers/crypto.js";

describe("30 — Session Concurrency Enforcement", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);
  });

  afterAll(async () => {
    // Clean up: stop all sessions
    for (const id of sessionIds) {
      await api.updateSession(id, { status: "stopped" }).catch(() => {});
    }
  });

  function createSessionData(name: string) {
    const sessionKey = generateSessionKey();
    const encryptedSessionKey = encryptSessionKey(sessionKey, user.publicKey);
    return {
      name,
      command: "echo test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    };
  }

  it("currentPlan returns team (no Stripe in test env)", async () => {
    const res = await api.getCurrentPlan();
    expect(res.status).toBe(200);
    expect(res.body.data).toBe("team");
  });

  it("creates 10 sessions (team per-user limit)", async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await api.createSession(createSessionData(`session-${i}`));
      expect(res.status).toBe(200);
      sessionIds.push((res.body.data as Record<string, string>).id);
    }
    expect(sessionIds.length).toBe(10);
  });

  it("11th session fails with concurrent limit error", async () => {
    const res = await api.createSession(createSessionData("session-11"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("concurrent session limit");
  });

  it("stopping one session allows new creation", async () => {
    // Stop the first session
    const stoppedId = sessionIds.shift()!;
    const stopRes = await api.updateSession(stoppedId, { status: "stopped" });
    expect(stopRes.status).toBe(200);

    // Now create a new one
    const res = await api.createSession(createSessionData("session-new"));
    expect(res.status).toBe(200);
    sessionIds.push((res.body.data as Record<string, string>).id);
  });
});
