import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { terminalSessions } from "@anyterm/db";
import {
  createHttpRequestFrame,
} from "@anyterm/utils/protocol";
import {
  REDIS_CHANNEL_HTTP_REQUEST,
  MAX_HTTP_TUNNEL_PAYLOAD,
} from "@anyterm/utils/types";
import type { HttpTunnelRequest, HttpTunnelResponse } from "@anyterm/utils/types";
import type { RedisClients } from "./redis.js";
import {
  authenticateWsConnection,
  verifySessionOwnership,
} from "./auth-ws.js";
import { db } from "./db.js";

// Shared pending request map — resolved by ws.ts when HTTP_RESPONSE arrives.
// Each entry tracks sessionId so we can verify the responding CLI belongs
// to the correct session, and clean up on disconnect.
export const pendingHttpRequests = new Map<
  string,
  {
    resolve: (res: HttpTunnelResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    sessionId: string;
    settled: boolean;
  }
>();

const HTTP_TIMEOUT_MS = 30_000;

// Response headers that a CLI must NOT be able to set — they could hijack
// browser security policy or inject cookies on the anyterm domain.
const BLOCKED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "transfer-encoding",
  "content-length",
  "set-cookie",
  "set-cookie2",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "strict-transport-security",
  "access-control-allow-origin",
  "access-control-allow-credentials",
]);

const encoder = new TextEncoder();

export function createHttpTunnelRoute(redis: RedisClients) {
  const app = new Hono();

  app.all("/tunnel/:sessionId/:port/*", async (c) => {
    // Authenticate
    const user = await authenticateWsConnection(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const sessionId = c.req.param("sessionId");
    const portStr = c.req.param("port");
    const port = parseInt(portStr, 10);

    if (!sessionId || !Number.isInteger(port) || port < 1 || port > 65535) {
      return c.json({ error: "Invalid session or port" }, 400);
    }

    // Verify ownership
    const isOwner = await verifySessionOwnership(sessionId, user.id);
    if (!isOwner) {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Verify requested port is in the session's forwardedPorts list
    try {
      const [session] = await db
        .select({ forwardedPorts: terminalSessions.forwardedPorts })
        .from(terminalSessions)
        .where(eq(terminalSessions.id, sessionId));

      if (!session?.forwardedPorts) {
        return c.json({ error: "No ports forwarded for this session" }, 400);
      }

      const allowedPorts = session.forwardedPorts
        .split(",")
        .map((p) => parseInt(p.trim(), 10));

      if (!allowedPorts.includes(port)) {
        return c.json({ error: "Port not forwarded for this session" }, 403);
      }
    } catch {
      return c.json({ error: "Failed to verify forwarded ports" }, 500);
    }

    // Build the path from the wildcard — everything after /tunnel/:sessionId/:port
    const fullPath = c.req.path;
    const prefix = `/tunnel/${sessionId}/${portStr}`;
    let tunnelPath = fullPath.slice(prefix.length) || "/";
    // Preserve query string but strip the auth token parameter if present
    const url = new URL(c.req.url);
    const params = new URLSearchParams(url.search);
    if (params.has("token")) {
      console.warn("[tunnel] DEPRECATED: ?token= query param detected — migrate to cookie-based preview auth");
      params.delete("token");
    }
    const qs = params.toString();
    if (qs) {
      tunnelPath += `?${qs}`;
    }

    // Read request body
    let bodyBase64: string | undefined;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const bodyBuf = await c.req.arrayBuffer();
      if (bodyBuf.byteLength > MAX_HTTP_TUNNEL_PAYLOAD) {
        return c.json({ error: "Request body too large" }, 413);
      }
      if (bodyBuf.byteLength > 0) {
        bodyBase64 = Buffer.from(bodyBuf).toString("base64");
      }
    }

    // Extract relevant request headers (skip hop-by-hop)
    const skipHeaders = new Set([
      "host", "connection", "upgrade", "keep-alive",
      "transfer-encoding", "te", "trailer", "proxy-authorization",
      "proxy-authenticate",
    ]);
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        headers[key] = value;
      }
    });

    const reqId = nanoid(16);
    const request: HttpTunnelRequest = {
      reqId,
      port,
      method: c.req.method,
      path: tunnelPath,
      headers,
      body: bodyBase64,
    };

    const payload = encoder.encode(JSON.stringify(request));
    if (payload.byteLength > MAX_HTTP_TUNNEL_PAYLOAD) {
      return c.json({ error: "Request too large" }, 413);
    }

    // Encode as HTTP_REQUEST frame and publish to Redis
    const frame = createHttpRequestFrame(sessionId, payload);
    await redis.publisher.publish(
      REDIS_CHANNEL_HTTP_REQUEST(sessionId),
      Buffer.from(frame),
    );

    // Wait for response from CLI via ws.ts resolving our Promise
    try {
      const response = await new Promise<HttpTunnelResponse>(
        (resolve, reject) => {
          const entry = {
            resolve: (res: HttpTunnelResponse) => {
              if (entry.settled) return;
              entry.settled = true;
              clearTimeout(entry.timer);
              resolve(res);
            },
            reject: (err: Error) => {
              if (entry.settled) return;
              entry.settled = true;
              reject(err);
            },
            timer: setTimeout(() => {
              pendingHttpRequests.delete(reqId);
              entry.reject(new Error("Gateway timeout"));
            }, HTTP_TIMEOUT_MS),
            sessionId,
            settled: false,
          };

          pendingHttpRequests.set(reqId, entry);
        },
      );

      // Build the HTTP response — block dangerous headers from CLI
      const resHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
        resHeaders.set(key, value);
      }

      // Validate body type before decoding
      const body =
        response.body && typeof response.body === "string"
          ? Buffer.from(response.body, "base64")
          : null;

      return new Response(body, {
        status: response.status,
        headers: resHeaders,
      });
    } catch {
      return c.json({ error: "Gateway Timeout — is the local server running?" }, 504);
    }
  });

  return app;
}
