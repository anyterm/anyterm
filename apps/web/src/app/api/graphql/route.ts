import { createYoga } from "graphql-yoga";
import { EnvelopArmor } from "@escape.tech/graphql-armor";
import { schema } from "@/graphql/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { GqlContext } from "@/graphql/builder";
import { GraphQLError } from "graphql";
import { db } from "@/db";
import { members } from "@anyterm/db";
import { and, eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

const armor = new EnvelopArmor({
  maxDepth: { n: 10 },
  costLimit: { maxCost: 5000 },
  maxAliases: { n: 15 },
  maxDirectives: { n: 50 },
  maxTokens: { n: 1000 },
  blockFieldSuggestion: { enabled: process.env.NODE_ENV === "production" },
});
const protection = armor.protect();

const yoga = createYoga<object, GqlContext>({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
  plugins: [...protection.plugins],
  maskedErrors: process.env.NODE_ENV === "production",
  context: async () => {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new GraphQLError("Unauthorized", {
        extensions: { code: "UNAUTHORIZED" },
      });
    }

    let organization: GqlContext["organization"] = null;

    const activeOrgId = (session.session as any).activeOrganizationId as string | null;
    if (activeOrgId) {
      const [member] = await db
        .select({ role: members.role })
        .from(members)
        .where(
          and(
            eq(members.organizationId, activeOrgId),
            eq(members.userId, session.user.id),
          ),
        )
        .limit(1);

      if (member) {
        organization = { id: activeOrgId, role: member.role };
      }
    }

    return { user: session.user, organization };
  },
});

const handler = yoga as unknown as (request: Request) => Promise<Response>;

export async function GET(req: Request) {
  const blocked = await rateLimit(req, "graphql", 120, 60_000, "user");
  if (blocked) return blocked;
  return handler(req);
}

export async function POST(req: Request) {
  const blocked = await rateLimit(req, "graphql", 120, 60_000, "user");
  if (blocked) return blocked;
  return handler(req);
}

export async function OPTIONS(req: Request) {
  return handler(req);
}
