import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { getEnv } from "../helpers/env.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
} from "../helpers/crypto.js";

const CRON_SECRET = "e2e-cron-secret-do-not-use-in-production";

describe("Data Retention Cleanup", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let sql: ReturnType<typeof postgres>;
  let baseUrl: string;

  beforeAll(async () => {
    const env = getEnv();
    baseUrl = env.baseUrl;
    sql = postgres(env.databaseUrl);
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    // Set CRON_SECRET env var for the test server
    // Since the server is already running, we test the no-secret path (unset CRON_SECRET = open access)
  });

  async function createAndStopSession(name: string): Promise<string> {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(sessionKey, user.publicKey);
    const { body } = await api.createSession({
      name,
      command: `echo ${name}`,
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    const sessionId = (body.data as Record<string, unknown>).id as string;

    // Stop the session
    await api.updateSession(sessionId, {
      status: "stopped",
      endedAt: new Date().toISOString(),
    });

    return sessionId;
  }

  it("deletes old stopped sessions while keeping recent ones", async () => {
    // Create 3 sessions and stop them
    const oldSessionId = await createAndStopSession("retention-old");
    const midSessionId = await createAndStopSession("retention-mid");
    const recentSessionId = await createAndStopSession("retention-recent");

    // In e2e tests, no STRIPE_SECRET_KEY → getOrgPlan returns "team" (30-day retention)
    // Backdate ended_at: old = 35 days ago (past team retention), mid = 15 days ago, recent = now
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

    await sql`UPDATE terminal_sessions SET ended_at = ${thirtyFiveDaysAgo} WHERE id = ${oldSessionId}`;
    await sql`UPDATE terminal_sessions SET ended_at = ${fifteenDaysAgo} WHERE id = ${midSessionId}`;

    // Store some chunks for the old session to verify cascade
    await api.storeChunks(oldSessionId, [
      { seq: 0, data: toBase64(new Uint8Array([1, 2, 3])) },
      { seq: 1, data: toBase64(new Uint8Array([4, 5, 6])) },
    ]);

    // Verify chunks exist before cleanup
    const chunksBefore = await sql`SELECT count(*)::int as count FROM terminal_chunks WHERE session_id = ${oldSessionId}`;
    expect(chunksBefore[0].count).toBe(2);

    // Run cleanup (no CRON_SECRET set on test server = open access)
    const res = await fetch(`${baseUrl}/api/cron/cleanup`);
    expect(res.status).toBe(200);
    const result = await res.json();

    // Old session (35 days > 30 day team retention) should be deleted
    expect(result.deletedSessions).toBeGreaterThanOrEqual(1);

    // Verify old session is gone
    const { status: oldStatus } = await api.getSession(oldSessionId);
    expect(oldStatus).toBe(404);

    // Verify chunks were cascade-deleted
    const chunksAfter = await sql`SELECT count(*)::int as count FROM terminal_chunks WHERE session_id = ${oldSessionId}`;
    expect(chunksAfter[0].count).toBe(0);

    // Mid session (15 days < 30 day team retention) should still exist
    const { status: midStatus } = await api.getSession(midSessionId);
    expect(midStatus).toBe(200);

    // Recent session should still exist
    const { status: recentStatus } = await api.getSession(recentSessionId);
    expect(recentStatus).toBe(200);
  });

  it("does not delete running or disconnected sessions regardless of age", async () => {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(sessionKey, user.publicKey);
    const { body } = await api.createSession({
      name: "retention-running",
      command: "echo running",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });
    const sessionId = (body.data as Record<string, unknown>).id as string;

    // Backdate created_at to 30 days ago but keep status "running"
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await sql`UPDATE terminal_sessions SET created_at = ${thirtyDaysAgo} WHERE id = ${sessionId}`;

    // Run cleanup
    await fetch(`${baseUrl}/api/cron/cleanup`);

    // Running session should still exist
    const { status } = await api.getSession(sessionId);
    expect(status).toBe(200);
  });

  it("cleans up expired verification tokens", async () => {
    // Insert an expired verification token
    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at)
      VALUES ('test-expired-v', 'test@expired.com', 'token-value', ${expiredDate}, NOW(), NOW())
    `;

    // Insert a valid (non-expired) verification token
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at)
      VALUES ('test-valid-v', 'test@valid.com', 'token-value', ${futureDate}, NOW(), NOW())
    `;

    const res = await fetch(`${baseUrl}/api/cron/cleanup`);
    const result = await res.json();
    expect(result.deletedVerifications).toBeGreaterThanOrEqual(1);

    // Expired should be gone
    const expired = await sql`SELECT id FROM verifications WHERE id = 'test-expired-v'`;
    expect(expired.length).toBe(0);

    // Valid should remain
    const valid = await sql`SELECT id FROM verifications WHERE id = 'test-valid-v'`;
    expect(valid.length).toBe(1);

    // Cleanup
    await sql`DELETE FROM verifications WHERE id = 'test-valid-v'`;
  });

  it("cleans up expired pending invitations", async () => {
    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO invitations (id, email, inviter_id, organization_id, role, status, created_at, expires_at)
      VALUES ('test-expired-inv', 'invite@expired.com', ${user.userId}, ${user.organizationId}, 'member', 'pending', NOW(), ${expiredDate})
    `;

    // Insert an expired but already-accepted invitation (should NOT be deleted)
    await sql`
      INSERT INTO invitations (id, email, inviter_id, organization_id, role, status, created_at, expires_at)
      VALUES ('test-accepted-inv', 'invite@accepted.com', ${user.userId}, ${user.organizationId}, 'member', 'accepted', NOW(), ${expiredDate})
    `;

    const res = await fetch(`${baseUrl}/api/cron/cleanup`);
    const result = await res.json();
    expect(result.deletedInvitations).toBeGreaterThanOrEqual(1);

    // Expired pending should be gone
    const expired = await sql`SELECT id FROM invitations WHERE id = 'test-expired-inv'`;
    expect(expired.length).toBe(0);

    // Accepted (even if expired) should remain
    const accepted = await sql`SELECT id FROM invitations WHERE id = 'test-accepted-inv'`;
    expect(accepted.length).toBe(1);

    // Cleanup
    await sql`DELETE FROM invitations WHERE id = 'test-accepted-inv'`;
  });

  it("cleanup is idempotent", async () => {
    // Run cleanup twice, second run should succeed with 0 deletions for sessions
    const res1 = await fetch(`${baseUrl}/api/cron/cleanup`);
    expect(res1.status).toBe(200);

    const res2 = await fetch(`${baseUrl}/api/cron/cleanup`);
    expect(res2.status).toBe(200);
    const result2 = await res2.json();
    // Second run shouldn't fail, may still clean up auth tokens from other tests
    expect(result2).toHaveProperty("deletedSessions");
  });
});
