import { builder } from "../builder";
import { ActivityLog } from "../types/activity-log";
import { db } from "@/db";
import { activityLogs } from "@anyterm/db";
import { desc, eq, and, gte } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { getOrgPlan } from "@/lib/plan";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { requireOrg } from "../helpers";

builder.queryField("activityLogs", (t) =>
  t.field({
    type: [ActivityLog],
    args: {
      limit: t.arg.int({ defaultValue: 50 }),
    },
    resolve: async (_root, args, ctx) => {
      const org = requireOrg(ctx);

      // Plan-gate: only team tier
      const tier = await getOrgPlan(org.id);
      if (tier !== "team") {
        throw new GraphQLError("Audit logs require Team plan", {
          extensions: { code: "PLAN_REQUIRED" },
        });
      }

      const retentionDays = PLAN_LIMITS[tier].retentionDays;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      return db
        .select({
          id: activityLogs.id,
          organizationId: activityLogs.organizationId,
          userId: activityLogs.userId,
          userName: activityLogs.userName,
          action: activityLogs.action,
          target: activityLogs.target,
          detail: activityLogs.detail,
          createdAt: activityLogs.createdAt,
        })
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.organizationId, org.id),
            gte(activityLogs.createdAt, cutoff),
          ),
        )
        .orderBy(desc(activityLogs.createdAt))
        .limit(Math.min(args.limit ?? 50, 200));
    },
  }),
);
