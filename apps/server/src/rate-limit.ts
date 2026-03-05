import type { MiddlewareHandler, Context } from "hono";
import { getCookie } from "hono/cookie";
import Redis from "ioredis";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redis;
}

/**
 * Atomic sliding window rate limiter using Redis sorted sets.
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

function extractKey(c: Context): string {
  // Bearer token (CLI, daemon, proxied requests)
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    return `token:${auth.slice(7, 23)}`;
  }
  // Session cookie (browser requests)
  const cookie = getCookie(c, "better-auth.session_token");
  if (cookie) {
    const token = cookie.split(".")[0];
    if (token) return `token:${token.slice(0, 16)}`;
  }
  // Fallback to IP
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return `ip:${forwarded.split(",")[0].trim()}`;
  return `ip:unknown`;
}

export function rateLimitMiddleware(opts: {
  scope: string;
  windowMs: number;
  max: number;
}): MiddlewareHandler {
  return async (c, next) => {
    try {
      const r = getRedis();
      const now = Date.now();
      const key = `rl:${opts.scope}:${extractKey(c)}`;

      const result = (await r.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        String(now),
        String(opts.windowMs),
        String(opts.max),
      )) as [number, number, number];

      const [allowed, remaining, retryAfter] = result;

      if (!allowed) {
        c.header("Retry-After", String(Math.max(1, retryAfter)));
        c.header("X-RateLimit-Limit", String(opts.max));
        c.header("X-RateLimit-Remaining", "0");
        return c.json({ error: "Too many requests" }, 429);
      }

      c.header("X-RateLimit-Limit", String(opts.max));
      c.header("X-RateLimit-Remaining", String(remaining));
    } catch (err) {
      // Fail open: if Redis is unavailable, allow the request
      console.error("[rate-limit] Redis error, allowing request:", err);
    }

    await next();
  };
}
