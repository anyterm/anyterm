import { builder } from "../builder";
import { db } from "@/db";
import { users } from "@anyterm/db";
import { eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { auth } from "@/lib/auth";

builder.mutationField("updateUserKeys", (t) =>
  t.field({
    type: "Boolean",
    args: {
      encryptedPrivateKey: t.arg.string({ required: true }),
      keySalt: t.arg.string({ required: true }),
      currentPassword: t.arg.string({ required: true }),
    },
    resolve: async (_root, { encryptedPrivateKey, keySalt, currentPassword }, ctx) => {
      if (encryptedPrivateKey.length > 8192) {
        throw new GraphQLError("encryptedPrivateKey too large");
      }
      if (keySalt.length > 256) {
        throw new GraphQLError("keySalt too large");
      }

      // Verify current password before allowing key update
      const { user } = await auth.api.signInEmail({
        body: { email: ctx.user.email, password: currentPassword },
      }).catch(() => ({ user: null }));

      if (!user || user.id !== ctx.user.id) {
        throw new GraphQLError("Invalid password");
      }

      await db
        .update(users)
        .set({ encryptedPrivateKey, keySalt })
        .where(eq(users.id, ctx.user.id));

      return true;
    },
  }),
);
