import { GraphQLError } from "graphql";

type OrgContext = { organization: { id: string; role: string } | null };

export function requireOrg(ctx: OrgContext) {
  if (!ctx.organization) {
    throw new GraphQLError("No active organization", {
      extensions: { code: "NO_ORGANIZATION" },
    });
  }
  return ctx.organization;
}

export function requireOrgAdmin(ctx: OrgContext) {
  const org = requireOrg(ctx);
  if (org.role !== "owner" && org.role !== "admin") {
    throw new GraphQLError("Only org owners and admins can perform this action", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return org;
}
