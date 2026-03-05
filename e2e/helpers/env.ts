import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface E2EEnv {
  baseUrl: string;
  wsUrl: string;
  databaseUrl: string;
  redisUrl: string;
}

let cached: E2EEnv | null = null;

export function getEnv(): E2EEnv {
  if (cached) return cached;
  const envPath = resolve(import.meta.dirname, "../.e2e-env.json");
  cached = JSON.parse(readFileSync(envPath, "utf-8")) as E2EEnv;
  return cached;
}
