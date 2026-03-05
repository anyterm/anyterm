import { nanoid } from "nanoid";
import { builder } from "../builder";
import { SSOProvider } from "../types/sso-provider";
import { db } from "@/db";
import { ssoProviders } from "@anyterm/db";
import { eq, and } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { getOrgPlan } from "@/lib/plan";
import { logActivity } from "@/lib/log-activity";
import { requireOrgAdmin } from "../helpers";

// --- Queries ---

builder.queryField("ssoProviders", (t) =>
  t.field({
    type: [SSOProvider],
    resolve: async (_root, _args, ctx) => {
      const org = requireOrgAdmin(ctx);

      const tier = await getOrgPlan(org.id);
      if (tier !== "team") {
        throw new GraphQLError("SSO requires Team plan", {
          extensions: { code: "PLAN_REQUIRED" },
        });
      }

      return db
        .select({
          id: ssoProviders.id,
          providerId: ssoProviders.providerId,
          domain: ssoProviders.domain,
          issuer: ssoProviders.issuer,
          organizationId: ssoProviders.organizationId,
        })
        .from(ssoProviders)
        .where(eq(ssoProviders.organizationId, org.id));
    },
  }),
);

// --- Mutations ---

builder.mutationField("registerSSOProvider", (t) =>
  t.field({
    type: "Boolean",
    args: {
      providerId: t.arg.string({ required: true }),
      domain: t.arg.string({ required: true }),
      issuer: t.arg.string({ required: true }),
      clientId: t.arg.string({ required: true }),
      clientSecret: t.arg.string({ required: true }),
      discoveryEndpoint: t.arg.string(),
    },
    resolve: async (_root, args, ctx) => {
      const org = requireOrgAdmin(ctx);

      const tier = await getOrgPlan(org.id);
      if (tier !== "team") {
        throw new GraphQLError("SSO requires Team plan", {
          extensions: { code: "PLAN_REQUIRED" },
        });
      }

      // Validate inputs
      if (args.providerId.length > 64 || !/^[a-z0-9-]+$/.test(args.providerId)) {
        throw new GraphQLError("Provider ID must be lowercase alphanumeric with hyphens, max 64 chars");
      }
      if (args.domain.length > 255) {
        throw new GraphQLError("Domain too long");
      }

      const oidcConfig = JSON.stringify({
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        discoveryEndpoint: args.discoveryEndpoint ?? undefined,
        scopes: ["openid", "email", "profile"],
      });

      await db.insert(ssoProviders).values({
        id: nanoid(12),
        providerId: args.providerId,
        issuer: args.issuer,
        domain: args.domain,
        organizationId: org.id,
        userId: ctx.user.id,
        oidcConfig,
      });

      logActivity(ctx, "sso.provider.create", args.providerId, args.domain);

      return true;
    },
  }),
);

builder.mutationField("deleteSSOProvider", (t) =>
  t.field({
    type: "Boolean",
    args: {
      providerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, { providerId }, ctx) => {
      const org = requireOrgAdmin(ctx);

      const tier = await getOrgPlan(org.id);
      if (tier !== "team") {
        throw new GraphQLError("SSO requires Team plan", {
          extensions: { code: "PLAN_REQUIRED" },
        });
      }

      // Verify the provider belongs to this org
      const [provider] = await db
        .select({ id: ssoProviders.id })
        .from(ssoProviders)
        .where(
          and(
            eq(ssoProviders.providerId, providerId),
            eq(ssoProviders.organizationId, org.id),
          ),
        );

      if (!provider) {
        throw new GraphQLError("SSO provider not found");
      }

      await db
        .delete(ssoProviders)
        .where(eq(ssoProviders.id, provider.id));

      logActivity(ctx, "sso.provider.delete", providerId);

      return true;
    },
  }),
);
