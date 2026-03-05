import { builder } from "../builder";
import { OrgKeys } from "../types/org-keys";
import { PendingKeyGrant } from "../types/org-keys";
import { db } from "@/db";
import { organizations, members, users } from "@anyterm/db";
import { eq, and } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { logActivity } from "@/lib/log-activity";
import { requireOrg, requireOrgAdmin } from "../helpers";

// --- Queries ---

builder.queryField("orgKeys", (t) =>
  t.field({
    type: OrgKeys,
    resolve: async (_root, _args, ctx) => {
      const org = requireOrg(ctx);

      const [orgRow] = await db
        .select({
          publicKey: organizations.publicKey,
          slug: organizations.slug,
        })
        .from(organizations)
        .where(eq(organizations.id, org.id));

      if (!orgRow) throw new GraphQLError("Organization not found");

      const isPersonalOrg = orgRow.slug === ctx.user.id;

      // For personal orgs, no encryptedOrgPrivateKey — client uses user's own keypair
      if (isPersonalOrg) {
        return {
          orgPublicKey: orgRow.publicKey,
          encryptedOrgPrivateKey: null,
          isPersonalOrg: true,
        };
      }

      // Non-personal org: fetch member's encryptedOrgPrivateKey
      const [memberRow] = await db
        .select({
          encryptedOrgPrivateKey: members.encryptedOrgPrivateKey,
          keyGrantPending: members.keyGrantPending,
        })
        .from(members)
        .where(
          and(
            eq(members.organizationId, org.id),
            eq(members.userId, ctx.user.id),
          ),
        );

      // Auto-detect: if member has no key and isn't pending, mark as pending
      if (memberRow && !memberRow.encryptedOrgPrivateKey && !memberRow.keyGrantPending && orgRow.publicKey) {
        await db
          .update(members)
          .set({ keyGrantPending: true })
          .where(
            and(
              eq(members.organizationId, org.id),
              eq(members.userId, ctx.user.id),
            ),
          );
      }

      return {
        orgPublicKey: orgRow.publicKey,
        encryptedOrgPrivateKey: memberRow?.encryptedOrgPrivateKey ?? null,
        isPersonalOrg: false,
      };
    },
  }),
);

builder.queryField("pendingKeyGrants", (t) =>
  t.field({
    type: [PendingKeyGrant],
    resolve: async (_root, _args, ctx) => {
      const org = requireOrg(ctx);

      const rows = await db
        .select({
          memberId: members.id,
          userId: members.userId,
          publicKey: users.publicKey,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(
          and(
            eq(members.organizationId, org.id),
            eq(members.keyGrantPending, true),
          ),
        );

      // Only return members that have a publicKey set
      return rows.filter((r) => r.publicKey != null) as {
        memberId: string;
        userId: string;
        publicKey: string;
      }[];
    },
  }),
);

// --- Mutations ---

builder.mutationField("grantOrgKey", (t) =>
  t.field({
    type: "Boolean",
    args: {
      memberId: t.arg.string({ required: true }),
      encryptedOrgPrivateKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, { memberId, encryptedOrgPrivateKey }, ctx) => {
      const org = requireOrgAdmin(ctx);

      if (encryptedOrgPrivateKey.length > 8192) {
        throw new GraphQLError("encryptedOrgPrivateKey too large");
      }

      // Verify the target member belongs to this org and is pending
      const [member] = await db
        .select({ id: members.id, keyGrantPending: members.keyGrantPending })
        .from(members)
        .where(
          and(
            eq(members.id, memberId),
            eq(members.organizationId, org.id),
          ),
        );

      if (!member) throw new GraphQLError("Member not found");
      if (!member.keyGrantPending) throw new GraphQLError("Member key grant not pending");

      await db
        .update(members)
        .set({ encryptedOrgPrivateKey, keyGrantPending: false })
        .where(eq(members.id, memberId));

      logActivity(ctx, "org.keys.grant", memberId);

      return true;
    },
  }),
);

builder.mutationField("setOrgKeys", (t) =>
  t.field({
    type: "Boolean",
    args: {
      publicKey: t.arg.string({ required: true }),
      encryptedOrgPrivateKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, { publicKey, encryptedOrgPrivateKey }, ctx) => {
      const org = requireOrgAdmin(ctx);

      if (publicKey.length > 256) {
        throw new GraphQLError("publicKey too large");
      }
      if (encryptedOrgPrivateKey.length > 8192) {
        throw new GraphQLError("encryptedOrgPrivateKey too large");
      }

      // Only allow setting keys if org doesn't have a publicKey yet
      const [orgRow] = await db
        .select({ publicKey: organizations.publicKey, slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, org.id));

      if (!orgRow) throw new GraphQLError("Organization not found");
      if (orgRow.slug === ctx.user.id) throw new GraphQLError("Cannot set keys on personal org");
      if (orgRow.publicKey) throw new GraphQLError("Org keys already configured");

      // Set org publicKey
      await db
        .update(organizations)
        .set({ publicKey })
        .where(eq(organizations.id, org.id));

      // Store creator's encryptedOrgPrivateKey
      await db
        .update(members)
        .set({ encryptedOrgPrivateKey, keyGrantPending: false })
        .where(
          and(
            eq(members.organizationId, org.id),
            eq(members.userId, ctx.user.id),
          ),
        );

      logActivity(ctx, "org.keys.setup", org.id);

      return true;
    },
  }),
);
