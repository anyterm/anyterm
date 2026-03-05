import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { spawn, type ChildProcess, execSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync, cpSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(import.meta.dirname, ".e2e-env.json");
const WEB_PORT = 13456;
const WS_PORT = 13457;

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let webProcess: ChildProcess;
let wsProcess: ChildProcess;

function isFresh(outputFile: string, srcDir: string): boolean {
  if (!existsSync(outputFile)) return false;
  try {
    const result = execSync(
      `find "${srcDir}" \\( -name "*.ts" -o -name "*.tsx" \\) -newer "${outputFile}" -print -quit`,
      { encoding: "utf-8", stdio: "pipe" },
    );
    return result.trim().length === 0;
  } catch {
    return false;
  }
}

export async function setup() {
  console.log("\n[e2e] Starting test containers...");

  // Start PostgreSQL and Redis in parallel
  const [pg, redis] = await Promise.all([
    new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_USER: "anyterm",
        POSTGRES_PASSWORD: "anyterm",
        POSTGRES_DB: "anyterm_test",
      })
      .withExposedPorts(5432)
      .start(),
    new GenericContainer("redis:8-alpine")
      .withExposedPorts(6379)
      .start(),
  ]);

  pgContainer = pg;
  redisContainer = redis;

  const pgHost = pg.getHost();
  const pgPort = pg.getMappedPort(5432);
  const redisHost = redis.getHost();
  const redisPort = redis.getMappedPort(6379);

  const databaseUrl = `postgresql://anyterm:anyterm@${pgHost}:${pgPort}/anyterm_test`;
  const redisUrl = `redis://${redisHost}:${redisPort}`;

  console.log(`[e2e] PostgreSQL: ${pgHost}:${pgPort}`);
  console.log(`[e2e] Redis: ${redisHost}:${redisPort}`);

  // Run migrations via drizzle-kit push
  console.log("[e2e] Running database migrations...");
  const rootDir = resolve(import.meta.dirname, "..");
  const dbDir = resolve(rootDir, "packages/db");
  const webDir = resolve(rootDir, "apps/web");
  const serverDir = resolve(rootDir, "apps/server");
  execSync(`npx drizzle-kit push --force`, {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  console.log("[e2e] Migrations complete.");

  const sharedEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    NODE_ENV: "development",
    BETTER_AUTH_SECRET: "e2e-test-secret-key-do-not-use-in-production",
    BETTER_AUTH_URL: `http://localhost:${WEB_PORT}`,
    NEXT_PUBLIC_APP_URL: `http://localhost:${WEB_PORT}`,
    NEXT_PUBLIC_WS_URL: `ws://localhost:${WS_PORT}`,
    NEXT_PUBLIC_E2E: "1",
    DISABLE_RATE_LIMIT: "1",
  };

  // Pre-build servers (skipped if build output is fresh)
  const serverOutput = resolve(serverDir, "dist/index.js");
  if (isFresh(serverOutput, resolve(serverDir, "src"))) {
    console.log("[e2e] Server build is fresh, skipping.");
  } else {
    console.log("[e2e] Building WebSocket server...");
    execSync("pnpm --filter @anyterm/server build", {
      cwd: rootDir,
      stdio: "pipe",
    });
  }

  // NEXT_PUBLIC_* vars are inlined at build time. If they changed since the
  // last build (e.g. CI built with defaults, then e2e needs port 13456),
  // we must rebuild even when source files haven't changed.
  const webOutput = resolve(webDir, ".next/BUILD_ID");
  const envFingerprint = JSON.stringify({
    NEXT_PUBLIC_APP_URL: sharedEnv.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_WS_URL: sharedEnv.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_E2E: sharedEnv.NEXT_PUBLIC_E2E,
    WS_PORT: String(WS_PORT),
  });
  const envFile = resolve(webDir, ".next/.e2e-env");
  const envMatch = existsSync(envFile) && readFileSync(envFile, "utf-8") === envFingerprint;

  if (isFresh(webOutput, resolve(webDir, "src")) && envMatch) {
    console.log("[e2e] Web build is fresh, skipping.");
  } else {
    console.log("[e2e] Building web server...");
    execSync("pnpm --filter @anyterm/web build", {
      cwd: rootDir,
      env: { ...sharedEnv, NODE_ENV: "production", WS_PORT: String(WS_PORT) },
      stdio: "pipe",
    });
    writeFileSync(envFile, envFingerprint);
  }

  // Copy static assets into standalone output (required for standalone mode).
  // Mirrors the Dockerfile: standalone output doesn't include static files.
  const standaloneWebDir = resolve(webDir, ".next/standalone/apps/web");
  const staticSrc = resolve(webDir, ".next/static");
  const staticDest = resolve(standaloneWebDir, ".next/static");
  if (existsSync(staticSrc)) {
    cpSync(staticSrc, staticDest, { recursive: true });
  }
  const publicSrc = resolve(webDir, "public");
  const publicDest = resolve(standaloneWebDir, "public");
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, publicDest, { recursive: true });
  }

  // Start WebSocket server from pre-built output
  console.log("[e2e] Starting WebSocket server...");
  wsProcess = spawn("node", ["dist/index.js"], {
    cwd: serverDir,
    env: { ...sharedEnv, WS_PORT: String(WS_PORT), WS_STOPPED_GRACE_MS: "3000" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const wsReady = waitForOutput(wsProcess, "anyterm ws server ready on", "ws-server");

  // Start Next.js standalone server (next start does not work with output: "standalone")
  console.log("[e2e] Starting web server (standalone)...");
  webProcess = spawn("node", ["server.js"], {
    cwd: standaloneWebDir,
    env: { ...sharedEnv, PORT: String(WEB_PORT), HOSTNAME: "0.0.0.0" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const webReady = waitForOutput(webProcess, "Ready in", "web-server");

  // Wait for both servers
  await Promise.all([wsReady, webReady]);
  console.log("[e2e] Both servers ready.");

  // Write env file for test workers
  const env = {
    baseUrl: `http://localhost:${WEB_PORT}`,
    wsUrl: `ws://localhost:${WS_PORT}`,
    databaseUrl,
    redisUrl,
  };
  writeFileSync(ENV_FILE, JSON.stringify(env, null, 2));
  console.log("[e2e] Environment written. Ready to test.\n");
}

function waitForOutput(
  proc: ChildProcess,
  readyMarker: string,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`[e2e] ${label} failed to start within 120s`));
    }, 120_000);

    const onData = (data: Buffer) => {
      const line = data.toString();
      process.stdout.write(`[${label}] ${line}`);
      if (line.includes(readyMarker)) {
        clearTimeout(timeout);
        proc.stdout?.off("data", onData);
        resolve();
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[${label}:err] ${data.toString()}`);
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`[e2e] ${label} process error: ${err.message}`));
    });

    proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`[e2e] ${label} exited with code ${code}`));
      }
    });
  });
}

async function killProcess(proc: ChildProcess): Promise<void> {
  if (!proc || proc.killed) return;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    proc.on("exit", () => resolve());
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
      resolve();
    }, 5_000);
  });
}

export async function teardown() {
  console.log("\n[e2e] Tearing down...");

  // Kill both servers
  await Promise.all([
    killProcess(webProcess),
    killProcess(wsProcess),
  ]);

  // Stop containers
  await Promise.all([
    pgContainer?.stop().catch(() => {}),
    redisContainer?.stop().catch(() => {}),
  ]);

  // Clean up env file
  if (existsSync(ENV_FILE)) {
    unlinkSync(ENV_FILE);
  }

  console.log("[e2e] Teardown complete.\n");
}
