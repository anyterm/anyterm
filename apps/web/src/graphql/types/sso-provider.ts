import { builder } from "../builder";

export const SSOProvider = builder.objectRef<{
  id: string;
  providerId: string;
  domain: string;
  issuer: string;
  organizationId: string | null;
}>("SSOProvider");

builder.objectType(SSOProvider, {
  fields: (t) => ({
    id: t.exposeString("id"),
    providerId: t.exposeString("providerId"),
    domain: t.exposeString("domain"),
    issuer: t.exposeString("issuer"),
    organizationId: t.exposeString("organizationId", { nullable: true }),
  }),
});
