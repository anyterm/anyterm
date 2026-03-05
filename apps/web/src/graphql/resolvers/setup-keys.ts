import { builder } from "../builder";
import { db } from "@/db";
import { users, organizations } from "@anyterm/db";
import { eq } from "drizzle-orm";
import { GraphQLError } from "graphql";

builder.mutationField("setupEncryptionKeys", (t) =>
  t.field({
    type: "Boolean",
    args: {
      publicKey: t.arg.string({ required: true }),
      encryptedPrivateKey: t.arg.string({ required: true }),
      keySalt: t.arg.string({ required: true }),
    },
    resolve: async (_root, { publicKey, encryptedPrivateKey, keySalt }, ctx) => {
      if (publicKey.length > 256) {
        throw new GraphQLError("publicKey too large");
      }
      if (encryptedPrivateKey.length > 8192) {
        throw new GraphQLError("encryptedPrivateKey too large");
      }
      if (keySalt.length > 256) {
        throw new GraphQLError("keySalt too large");
      }

      // Only allow setup if user has no existing keys (first-time setup for social login users)
      const [existing] = await db
        .select({ keySalt: users.keySalt })
        .from(users)
        .where(eq(users.id, ctx.user.id));

      if (existing?.keySalt) {
        throw new GraphQLError("Encryption keys already configured");
      }

      await db
        .update(users)
        .set({ publicKey, encryptedPrivateKey, keySalt })
        .where(eq(users.id, ctx.user.id));

      // Also set publicKey on personal org (slug === userId)
      await db
        .update(organizations)
        .set({ publicKey })
        .where(eq(organizations.slug, ctx.user.id));

      return true;
    },
  }),
);
