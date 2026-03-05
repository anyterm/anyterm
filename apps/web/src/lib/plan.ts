import { db } from "@/db";
import { users, members, subscriptions } from "@anyterm/db";
import { eq, and, inArray } from "drizzle-orm";
import type { PlanTier } from "./plan-limits";
import { PLAN_LIMITS } from "./plan-limits";

export type { PlanTier };
export { PLAN_LIMITS } from "./plan-limits";

// In-memory cache with 5-minute TTL
const planCache = new Map<string, { tier: PlanTier; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

const ACTIVE_STATUSES = ["active", "trialing"] as const;

function isValidTier(plan: string): plan is PlanTier {
  return plan in PLAN_LIMITS;
}

/**
 * Resolve the plan tier for a user.
 * Queries the local subscription table (managed by better-auth Stripe plugin).
 * - No Stripe keys (self-hosted) → "team" (unlimited)
 * - Admin email → "team"
 * - Active subscription → mapped tier
 * - No subscription → "starter" (free)
 */
export async function getUserPlan(userId: string): Promise<PlanTier> {
  if (!process.env.STRIPE_SECRET_KEY) return "team";

  const cacheKey = `user:${userId}`;
  const cached = planCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  let tier: PlanTier = "starter";

  try {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return "starter";

    if (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL) {
      planCache.set(cacheKey, { tier: "team", expiresAt: Date.now() + CACHE_TTL });
      return "team";
    }

    // Query local subscription table (referenceId = userId for user subscriptions)
    const [sub] = await db
      .select({ plan: subscriptions.plan })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.referenceId, userId),
          inArray(subscriptions.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);

    if (sub?.plan && isValidTier(sub.plan)) {
      tier = sub.plan;
    }
  } catch (err) {
    console.error("Failed to fetch user plan:", err);
    const stale = planCache.get(cacheKey);
    if (stale) return stale.tier;
    return "starter";
  }

  planCache.set(cacheKey, { tier, expiresAt: Date.now() + CACHE_TTL });
  return tier;
}

/**
 * Resolve the plan tier for an organization.
 * Queries the local subscription table (managed by better-auth Stripe plugin).
 * - No Stripe keys (self-hosted) → "team" (unlimited)
 * - Owner is admin → "team"
 * - Active subscription → mapped tier
 * - No subscription → "starter" (free)
 */
export async function getOrgPlan(organizationId: string): Promise<PlanTier> {
  if (!process.env.STRIPE_SECRET_KEY) return "team";

  const cacheKey = `org:${organizationId}`;
  const cached = planCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  let tier: PlanTier = "starter";

  try {
    // Admin bypass: check org owner email
    const [ownerMember] = await db
      .select({ userId: members.userId })
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          eq(members.role, "owner"),
        ),
      )
      .limit(1);

    if (ownerMember) {
      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ownerMember.userId))
        .limit(1);

      if (user && process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL) {
        planCache.set(cacheKey, { tier: "team", expiresAt: Date.now() + CACHE_TTL });
        return "team";
      }
    }

    // Query local subscription table (referenceId = organizationId for org subscriptions)
    const [sub] = await db
      .select({ plan: subscriptions.plan })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.referenceId, organizationId),
          inArray(subscriptions.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);

    if (sub?.plan && isValidTier(sub.plan)) {
      tier = sub.plan;
    }
  } catch (err) {
    console.error("Failed to fetch org plan:", err);
    const stale = planCache.get(cacheKey);
    if (stale) return stale.tier;
    return "starter";
  }

  planCache.set(cacheKey, { tier, expiresAt: Date.now() + CACHE_TTL });
  return tier;
}
