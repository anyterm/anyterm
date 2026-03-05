import { builder } from "../builder";
import { UserKeys } from "../types/user-keys";
import { db } from "@/db";
import { users } from "@anyterm/db";
import { eq } from "drizzle-orm";

builder.queryField("userKeys", (t) =>
  t.field({
    type: UserKeys,
    nullable: true,
    resolve: async (_root, _args, ctx) => {
      const [userData] = await db
        .select({
          publicKey: users.publicKey,
          encryptedPrivateKey: users.encryptedPrivateKey,
          keySalt: users.keySalt,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id));

      return userData ?? null;
    },
  }),
);
