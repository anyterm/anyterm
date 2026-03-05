import { builder } from "../builder";
import { getOrgPlan } from "@/lib/plan";

builder.queryField("currentPlan", (t) =>
  t.field({
    type: "String",
    nullable: true,
    resolve: async (_root, _args, ctx) => {
      if (!ctx.organization) return "starter";
      return getOrgPlan(ctx.organization.id);
    },
  }),
);
