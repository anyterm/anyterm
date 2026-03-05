import { builder } from "../builder";

export const OrgKeys = builder.objectRef<{
  orgPublicKey: string | null;
  encryptedOrgPrivateKey: string | null;
  isPersonalOrg: boolean;
}>("OrgKeys");

builder.objectType(OrgKeys, {
  fields: (t) => ({
    orgPublicKey: t.exposeString("orgPublicKey", { nullable: true }),
    encryptedOrgPrivateKey: t.exposeString("encryptedOrgPrivateKey", { nullable: true }),
    isPersonalOrg: t.exposeBoolean("isPersonalOrg"),
  }),
});

export const PendingKeyGrant = builder.objectRef<{
  memberId: string;
  userId: string;
  publicKey: string;
}>("PendingKeyGrant");

builder.objectType(PendingKeyGrant, {
  fields: (t) => ({
    memberId: t.exposeString("memberId"),
    userId: t.exposeString("userId"),
    publicKey: t.exposeString("publicKey"),
  }),
});
