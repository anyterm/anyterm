import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import Redis from "ioredis";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { getEnv } from "../helpers/env.js";

describe("Rate Limiting", () => {
  let user: RegisteredUser;
  let baseUrl: string;
  let redis: Redis;

  beforeAll(async () => {
    const env = getEnv();
    baseUrl = env.baseUrl;
    redis = new Redis(env.redisUrl);
    // Re-enable rate limiting for this test (disabled globally for parallel tests)
    await redis.set("force_rate_limit", "1");
    user = await registerUser();
  });

  afterAll(async () => {
    await redis.del("force_rate_limit");
  });

  afterEach(async () => {
    // Clear all rate limit keys between tests
    const keys = await redis.keys("rl:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  it("/api/config returns 429 after exceeding 60 requests per minute", async () => {
    // Send 60 requests (the limit)
    const promises = Array.from({ length: 60 }, () =>
      fetch(`${baseUrl}/api/config`),
    );
    const responses = await Promise.all(promises);

    // All should succeed
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // 61st should be rate limited
    const blocked = await fetch(`${baseUrl}/api/config`);
    expect(blocked.status).toBe(429);

    const body = await blocked.json();
    expect(body.error).toBe("Too many requests");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
  });

  it("/api/graphql returns 429 after exceeding 120 requests per minute", async () => {
    const cookie = `better-auth.session_token=${user.cookieToken}`;
    const query = JSON.stringify({ query: "{ sessions { id } }" });

    // Send 120 requests (the limit)
    const promises = Array.from({ length: 120 }, () =>
      fetch(`${baseUrl}/api/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: query,
      }),
    );
    const responses = await Promise.all(promises);

    // All should succeed (200, not 429)
    const succeeded = responses.filter((r) => r.status === 200);
    expect(succeeded.length).toBe(120);

    // 121st should be rate limited
    const blocked = await fetch(`${baseUrl}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: query,
    });
    expect(blocked.status).toBe(429);
  });

  it("/api/auth rate limits by IP at 60 requests per minute", async () => {
    // Send 60 login attempts (they'll fail auth but should pass rate limit)
    const promises = Array.from({ length: 60 }, () =>
      fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "nonexistent@test.local",
          password: "wrong",
        }),
      }),
    );
    const responses = await Promise.all(promises);

    // All should get through rate limiting (auth may return 401/400/200 depending on better-auth)
    const rateLimited = responses.filter((r) => r.status === 429);
    expect(rateLimited.length).toBe(0);

    // 61st should be rate limited
    const blocked = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonexistent@test.local",
        password: "wrong",
      }),
    });
    expect(blocked.status).toBe(429);
  });

  it("/api/ws-token rate limits at 30 requests per minute", async () => {
    const cookie = `better-auth.session_token=${user.cookieToken}`;

    const promises = Array.from({ length: 30 }, () =>
      fetch(`${baseUrl}/api/ws-token`, {
        headers: { Cookie: cookie },
      }),
    );
    const responses = await Promise.all(promises);

    const succeeded = responses.filter((r) => r.status === 200);
    expect(succeeded.length).toBe(30);

    // 31st should be rate limited
    const blocked = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Cookie: cookie },
    });
    expect(blocked.status).toBe(429);
  });

  it("rate limiting is per-user, not global", async () => {
    const user2 = await registerUser();
    const cookie1 = `better-auth.session_token=${user.cookieToken}`;
    const cookie2 = `better-auth.session_token=${user2.cookieToken}`;

    // Exhaust user1's ws-token limit
    const promises1 = Array.from({ length: 30 }, () =>
      fetch(`${baseUrl}/api/ws-token`, {
        headers: { Cookie: cookie1 },
      }),
    );
    await Promise.all(promises1);

    // User1 should be blocked
    const blocked = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Cookie: cookie1 },
    });
    expect(blocked.status).toBe(429);

    // User2 should still be allowed
    const allowed = await fetch(`${baseUrl}/api/ws-token`, {
      headers: { Cookie: cookie2 },
    });
    expect(allowed.status).toBe(200);
  });

  it("429 response includes correct headers", async () => {
    // Exhaust config limit
    const promises = Array.from({ length: 60 }, () =>
      fetch(`${baseUrl}/api/config`),
    );
    await Promise.all(promises);

    const blocked = await fetch(`${baseUrl}/api/config`);
    expect(blocked.status).toBe(429);

    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const retryAfter = parseInt(blocked.headers.get("retry-after")!);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    expect(blocked.headers.get("x-ratelimit-limit")).toBe("60");
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
  });
});
