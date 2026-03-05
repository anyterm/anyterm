import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
} from "../helpers/crypto.js";

describe("Activity Logs", () => {
  let userA: RegisteredUser;
  let userB: RegisteredUser;
  let apiA: ApiClient;
  let apiB: ApiClient;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([registerUser(), registerUser()]);
    apiA = new ApiClient(userA.cookieToken);
    apiB = new ApiClient(userB.cookieToken);
  });

  async function createTestSession(api: ApiClient, publicKey: Uint8Array) {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(sessionKey, publicKey);
    return api.createSession({
      name: "audit-test",
      command: "echo audit",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
  }

  it("createSession generates an activity log entry", async () => {
    await createTestSession(apiA, userA.publicKey);

    // Small delay for fire-and-forget write
    await new Promise((r) => setTimeout(r, 500));

    const { status, body } = await apiA.getActivityLogs();

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const logs = body.data as Array<{ action: string; target: string | null }>;
    const createLog = logs.find((l) => l.action === "session.create");
    expect(createLog).toBeDefined();
    expect(createLog!.target).toBe("audit-test");
  });

  it("returns logs in reverse chronological order", async () => {
    // Create a second session to ensure ordering
    await createTestSession(apiA, userA.publicKey);
    await new Promise((r) => setTimeout(r, 500));

    const { body } = await apiA.getActivityLogs();
    const logs = body.data as Array<{ createdAt: string }>;

    expect(logs.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < logs.length; i++) {
      const prev = new Date(logs[i - 1].createdAt).getTime();
      const curr = new Date(logs[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("respects limit parameter", async () => {
    const { body } = await apiA.getActivityLogs(1);
    const logs = body.data as Array<Record<string, unknown>>;
    expect(logs.length).toBe(1);
  });

  it("logs are scoped to organization", async () => {
    // User B's logs should not contain User A's activity
    const { body } = await apiB.getActivityLogs();
    const logs = body.data as Array<{ target: string | null }>;
    const hasAuditTest = logs.some((l) => l.target === "audit-test");
    expect(hasAuditTest).toBe(false);
  });

  it("deleteSession generates an activity log", async () => {
    const { body: sessionBody } = await createTestSession(apiA, userA.publicKey);
    const sessionId = (sessionBody.data as Record<string, unknown>).id as string;

    await apiA.deleteSession(sessionId);
    await new Promise((r) => setTimeout(r, 500));

    const { body } = await apiA.getActivityLogs();
    const logs = body.data as Array<{ action: string; target: string | null }>;
    const deleteLog = logs.find(
      (l) => l.action === "session.delete" && l.target === sessionId,
    );
    expect(deleteLog).toBeDefined();
  });
});
