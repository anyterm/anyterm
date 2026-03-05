export type PlanTier = "starter" | "pro" | "team";

export const PLAN_LIMITS: Record<
  PlanTier,
  {
    maxSessionsPerUser: number;
    maxSessionsPerOrg: number | "seats"; // "seats" = 10 × paid seats, capped at 100
    maxStorageGB: number;
    retentionDays: number;
  }
> = {
  starter: {
    maxSessionsPerUser: 1,
    maxSessionsPerOrg: 1,
    maxStorageGB: 1,
    retentionDays: 7,
  },
  pro: {
    maxSessionsPerUser: 3,
    maxSessionsPerOrg: 10,
    maxStorageGB: 50,
    retentionDays: 7,
  },
  team: {
    maxSessionsPerUser: 10,
    maxSessionsPerOrg: "seats", // min(10 × seats, 100)
    maxStorageGB: 200,
    retentionDays: 30,
  },
};

export const PLAN_FEATURES: Record<PlanTier, { sso: boolean; auditLogs: boolean }> = {
  starter: { sso: false, auditLogs: false },
  pro: { sso: false, auditLogs: false },
  team: { sso: true, auditLogs: true },
};

/** Resolve dynamic org cap for team tier. */
export function getOrgSessionCap(
  tier: PlanTier,
  seatCount: number,
): number {
  const limit = PLAN_LIMITS[tier].maxSessionsPerOrg;
  if (typeof limit === "number") return limit;
  // "seats" → min(10 × seats, 100)
  return Math.min(seatCount * 10, 100);
}
