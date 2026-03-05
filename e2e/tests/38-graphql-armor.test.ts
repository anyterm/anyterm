import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { getEnv } from "../helpers/env.js";

describe("38 — GraphQL Armor Limits", () => {
  let user: RegisteredUser;
  let baseUrl: string;

  beforeAll(async () => {
    user = await registerUser();
    baseUrl = getEnv().baseUrl;
  });

  async function graphqlRaw(query: string) {
    const res = await fetch(`${baseUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `better-auth.session_token=${user.cookieToken}`,
      },
      body: JSON.stringify({ query }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("rejects queries exceeding cost limit (>5000)", async () => {
    // Use deeply nested introspection which has high fan-out cost.
    // __type fields expand recursively, producing cost > 5000.
    let query = "__typename";
    for (let i = 0; i < 12; i++) {
      query = `__type(name: "Query") { fields { name type { ${query} } } }`;
    }
    query = `{ ${query} }`;

    const { body } = await graphqlRaw(query);
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
    const errorMsg = JSON.stringify(body.errors).toLowerCase();
    expect(errorMsg).toMatch(/cost/);
  });

  it("rejects queries exceeding max aliases (>15)", async () => {
    const aliases = Array.from(
      { length: 16 },
      (_, i) => `a${i}: currentPlan`,
    ).join("\n");
    const query = `{ ${aliases} }`;

    const { body } = await graphqlRaw(query);
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
    const errorMsg = JSON.stringify(body.errors).toLowerCase();
    expect(errorMsg).toMatch(/alias/i);
  });

  it("allows a normal valid query", async () => {
    const query = `{ currentPlan }`;
    const { status, body } = await graphqlRaw(query);
    expect(status).toBe(200);
    if (body.errors) {
      const errorMsg = JSON.stringify(body.errors).toLowerCase();
      expect(errorMsg).not.toMatch(/depth|alias|token|cost/);
    }
    expect(body.data).toBeDefined();
  });
});
