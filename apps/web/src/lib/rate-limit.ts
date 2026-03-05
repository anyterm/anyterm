import { NextResponse } from "next/server";
import { getRedisPublisher } from "./redis";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
};

/**
 * Atomic sliding window rate limiter using Redis sorted sets.
 * The Lua script ensures no race conditions between concurrent requests.
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = 0
  if #oldest >= 2 then
    retryAfter = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  end
  return {0, 0, retryAfter}
end

redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
redis.call('PEXPIRE', key, window)
return {1, limit - count - 1, 0}
`;

export async function checkRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<RateLimitResult> {
  try {
    const redis = getRedisPublisher();
    const now = Date.now();

    const result = (await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(windowMs),
      String(maxRequests),
    )) as [number, number, number];

    const [allowed, remaining, retryAfter] = result;

    return {
      allowed: allowed === 1,
      remaining,
      retryAfter: Math.max(1, retryAfter),
    };
  } catch (err) {
    // Fail open: if Redis is unavailable, allow the request
    console.error("[rate-limit] Redis error, allowing request:", err);
    return { allowed: true, remaining: -1, retryAfter: 0 };
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function getTokenKey(req: Request): string {
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const match = cookie.match(/better-auth\.session_token=([^;]+)/);
    if (match) {
      // Cookie value is "token.hmac" - use first 16 chars of token as key
      const token = match[1].split(".")[0];
      if (token) return `token:${token.slice(0, 16)}`;
    }
  }
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return `token:${auth.slice(7, 23)}`;
  }
  // Fallback to IP if no auth
  return `ip:${getClientIp(req)}`;
}

/**
 * Check rate limit for a Next.js API route. Returns a 429 response if blocked,
 * or null if the request is allowed.
 */
export async function rateLimit(
  req: Request,
  scope: string,
  max: number,
  windowMs: number,
  mode: "ip" | "user",
): Promise<NextResponse | null> {
  // In e2e tests, rate limiting is disabled by default but can be force-enabled
  // via Redis (used by the rate-limiting test to verify limits still work).
  if (process.env.DISABLE_RATE_LIMIT === "1") {
    try {
      const redis = getRedisPublisher();
      const force = await redis.get("force_rate_limit");
      if (force !== "1") return null;
    } catch {
      return null;
    }
  }
  const identifier = mode === "ip" ? `ip:${getClientIp(req)}` : getTokenKey(req);
  const key = `rl:${scope}:${identifier}`;

  const result = await checkRateLimit(key, windowMs, max);

  if (!result.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfter),
          "X-RateLimit-Limit": String(max),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  return null;
}
