import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createRedisClients } from "./redis.js";
import { createWsRoute } from "./ws.js";
import { createHttpTunnelRoute } from "./http-tunnel.js";
import { createDaemonApiRoute } from "./daemon-api.js";
import { createPreviewAuthRoute } from "./preview-auth.js";
import { stopFlushTimer } from "./persistence.js";
import { rateLimitMiddleware } from "./rate-limit.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/health", (c) => c.json({ status: "ok" }));

// CORS for preview auth & tunnel: only allow the main app origin with credentials
const appOrigin = process.env.BETTER_AUTH_URL || "http://localhost:3000";
const previewCors = cors({
  origin: appOrigin,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
});
app.use("/preview-auth", previewCors);

// Rate limiting for HTTP endpoints (WS has its own per-frame rate limiting)
app.use("/preview-auth", rateLimitMiddleware({ scope: "preview", windowMs: 60_000, max: 30 }));
app.use("/tunnel/*", rateLimitMiddleware({ scope: "tunnel", windowMs: 60_000, max: 120 }));
app.use("/api/daemon/*", rateLimitMiddleware({ scope: "daemon", windowMs: 60_000, max: 30 }));

const previewAuthApp = createPreviewAuthRoute();
app.route("/", previewAuthApp);

const redis = createRedisClients();
const wsApp = createWsRoute(upgradeWebSocket, redis);
app.route("/", wsApp);

const tunnelApp = createHttpTunnelRoute(redis);
app.route("/", tunnelApp);

const daemonApp = createDaemonApiRoute(redis);
app.route("/", daemonApp);

const port = parseInt(process.env.PORT || process.env.WS_PORT || "3001", 10);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`> anyterm ws server ready on http://localhost:${info.port}`);
});
injectWebSocket(server);

// Graceful shutdown: flush pending chunks before exit
async function shutdown() {
  console.log("[Server] Shutting down, flushing pending chunks...");
  await stopFlushTimer();
  redis.publisher.disconnect();
  redis.subscriber.disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
