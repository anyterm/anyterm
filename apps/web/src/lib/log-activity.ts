import { db } from "@/db";
import { activityLogs } from "@anyterm/db";
import type { GqlContext } from "@/graphql/builder";

/**
 * Write an activity log entry. Fire-and-forget — never throws.
 */
export function logActivity(
  ctx: GqlContext,
  action: string,
  target?: string | null,
  detail?: string | null,
) {
  if (!ctx.organization) return;

  db.insert(activityLogs)
    .values({
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
      userName: ctx.user.name,
      action,
      target: target ?? null,
      detail: detail ?? null,
    })
    .catch((err) => {
      console.error("Failed to write activity log:", err);
    });
}
