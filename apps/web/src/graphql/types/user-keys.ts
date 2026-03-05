import { builder } from "../builder";

export const UserKeys = builder.objectRef<{
  publicKey: string | null;
  encryptedPrivateKey: string | null;
  keySalt: string | null;
}>("UserKeys");

builder.objectType(UserKeys, {
  fields: (t) => ({
    publicKey: t.exposeString("publicKey", { nullable: true }),
    encryptedPrivateKey: t.exposeString("encryptedPrivateKey", { nullable: true }),
    keySalt: t.exposeString("keySalt", { nullable: true }),
  }),
});
