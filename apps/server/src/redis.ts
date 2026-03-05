import Redis from "ioredis";

export interface RedisClients {
  publisher: Redis;
  subscriber: Redis;
}

export function createRedisClients(): RedisClients {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return {
    publisher: new Redis(url),
    subscriber: new Redis(url),
  };
}
