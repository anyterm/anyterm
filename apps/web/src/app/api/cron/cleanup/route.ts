import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  terminalSessions,
  activityLogs,
  verifications,
  sessions,
  invitations,
} from "@anyterm/db";
import { and, eq, lt, inArray, isNull, isNotNull } from "drizzle-orm";
import { getOrgPlan } from "@/lib/plan";
import { PLAN_LIMITS } from "@/lib/plan-limits";

const TERMINAL_STATUSES = ["stopped", "error"] as const;
const DEFAULT_RETENTION_DAYS = 7; // strictest tier, used for orphaned data

export async function GET(req: Request) {
  // Auth: require CRON_SECRET if configured
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = {
    deletedSessions: 0,
    deletedActivityLogs: 0,
    deletedVerifications: 0,
    deletedAuthSessions: 0,
    deletedInvitations: 0,
  };

  // 1. Terminal sessions (per-org retention)
  // Get distinct orgs that have stale sessions
  const orgsWithSessions = await db
    .selectDistinct({ organizationId: terminalSessions.organizationId })
    .from(terminalSessions)
    .where(
      and(
        inArray(terminalSessions.status, [...TERMINAL_STATUSES]),
        isNotNull(terminalSessions.endedAt),
      ),
    );

  // Group orgs by retention to batch queries
  for (const row of orgsWithSessions) {
    const orgId = row.organizationId;
    let retentionDays = DEFAULT_RETENTION_DAYS;

    if (orgId) {
      try {
        const tier = await getOrgPlan(orgId);
        retentionDays = PLAN_LIMITS[tier].retentionDays;
      } catch {
        // If plan lookup fails, use strictest retention
      }
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const condition = orgId
      ? and(
          eq(terminalSessions.organizationId, orgId),
          inArray(terminalSessions.status, [...TERMINAL_STATUSES]),
          lt(terminalSessions.endedAt, cutoff),
        )
      : and(
          isNull(terminalSessions.organizationId),
          inArray(terminalSessions.status, [...TERMINAL_STATUSES]),
          lt(terminalSessions.endedAt, cutoff),
        );

    // FK cascade handles terminal_chunks automatically
    const deleted = await db
      .delete(terminalSessions)
      .where(condition!)
      .returning({ id: terminalSessions.id });
    results.deletedSessions += deleted.length;
  }

  // 2. Activity logs (per-org retention)
  const orgsWithLogs = await db
    .selectDistinct({ organizationId: activityLogs.organizationId })
    .from(activityLogs);

  for (const row of orgsWithLogs) {
    let retentionDays = DEFAULT_RETENTION_DAYS;

    try {
      const tier = await getOrgPlan(row.organizationId);
      retentionDays = PLAN_LIMITS[tier].retentionDays;
    } catch {
      // Use strictest retention on failure
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const deleted = await db
      .delete(activityLogs)
      .where(
        and(
          eq(activityLogs.organizationId, row.organizationId),
          lt(activityLogs.createdAt, cutoff),
        ),
      )
      .returning({ id: activityLogs.id });
    results.deletedActivityLogs += deleted.length;
  }

  // 3. Expired auth data (global)
  const now = new Date();

  const deletedVerifications = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, now))
    .returning({ id: verifications.id });
  results.deletedVerifications = deletedVerifications.length;

  const deletedAuthSessions = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  results.deletedAuthSessions = deletedAuthSessions.length;

  const deletedInvitations = await db
    .delete(invitations)
    .where(
      and(
        lt(invitations.expiresAt, now),
        eq(invitations.status, "pending"),
      ),
    )
    .returning({ id: invitations.id });
  results.deletedInvitations = deletedInvitations.length;

  console.log("[cleanup]", results);

  return NextResponse.json(results);
}
