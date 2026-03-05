import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { eq, and } from "drizzle-orm";
import { sessions, terminalSessions, members } from "@anyterm/db";
import { db } from "./db.js";
import { verifyPreviewToken } from "./preview-token.js";
import { PREVIEW_COOKIE_NAME } from "./preview-auth.js";

export async function authenticateWsToken(
  token: string,
): Promise<{ id: string } | null> {
  try {
    const [session] = await db
      .select({
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.token, token));

    if (!session || new Date(session.expiresAt) < new Date()) return null;

    return { id: session.userId };
  } catch {
    return null;
  }
}

/**
 * Authenticate an HTTP request by extracting a token from Authorization header,
 * cookie, or query string (legacy fallback). Used by HTTP API routes (not WebSocket).
 */
export async function authenticateWsConnection(
  c: Context,
): Promise<{ id: string } | null> {
  // 1. Bearer header (preferred for explicit API calls)
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token) return authenticateWsToken(token);
  }

  // 2. Cookie (browser requests — cookie value is "token.hmac", DB stores "token")
  const cookieValue = getCookie(c, "better-auth.session_token") ?? null;
  if (cookieValue) {
    const token = cookieValue.split(".")[0];
    if (token) return authenticateWsToken(token);
  }

  // 3. Preview cookie (cross-origin iframe — short-lived HMAC token, no DB hit)
  const previewCookie = getCookie(c, PREVIEW_COOKIE_NAME) ?? null;
  if (previewCookie) {
    const result = verifyPreviewToken(previewCookie);
    if (result) return result;
  }

  return null;
}

/**
 * Verify that a user has access to a terminal session via org membership.
 * Uses an in-memory cache to avoid hitting the DB on every frame.
 */
const ownershipCache = new Map<
  string,
  { organizationId: string | null; ownerId: string; expiresAt: number }
>();
const CACHE_TTL_MS = 30_000; // 30s
const CACHE_MAX_SIZE = 10_000;

export async function verifySessionOwnership(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  // Get the terminal session's organizationId (cached)
  let orgId: string | null = null;
  let ownerId: string | null = null;

  const cached = ownershipCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) {
    orgId = cached.organizationId;
    ownerId = cached.ownerId;
  } else {
    if (cached) ownershipCache.delete(sessionId);
    try {
      const [session] = await db
        .select({
          organizationId: terminalSessions.organizationId,
          userId: terminalSessions.userId,
        })
        .from(terminalSessions)
        .where(eq(terminalSessions.id, sessionId));

      if (!session) return false;

      orgId = session.organizationId;
      ownerId = session.userId;

      // Cache result (with size cap)
      if (ownershipCache.size >= CACHE_MAX_SIZE) {
        const firstKey = ownershipCache.keys().next().value;
        if (firstKey) ownershipCache.delete(firstKey);
      }
      ownershipCache.set(sessionId, {
        organizationId: orgId,
        ownerId,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    } catch {
      return false;
    }
  }

  // Fallback for sessions without org (legacy)
  if (!orgId) {
    return ownerId === userId;
  }

  // Check if user is a member of the org
  try {
    const [member] = await db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.organizationId, orgId),
          eq(members.userId, userId),
        ),
      )
      .limit(1);

    return !!member;
  } catch {
    return false;
  }
}
