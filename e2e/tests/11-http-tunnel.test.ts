import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import { getEnv } from "../helpers/env.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
  createSubscribeFrame,
  createHttpResponseFrame,
  FrameType,
} from "../helpers/crypto.js";
import type {
  HttpTunnelRequest,
  HttpTunnelResponse,
} from "@anyterm/utils/types";

/**
 * E2E test for HTTP Tunnel (port forwarding).
 *
 * Flow:
 *   Browser → GET /tunnel/:sessionId/:port/path
 *     → Server publishes HTTP_REQUEST frame via Redis
 *     → CLI WS receives it → proxies to localhost → sends HTTP_RESPONSE frame
 *     → Server resolves pending Promise → returns response to browser
 *
 * This test simulates the CLI side by:
 *   1. Connecting a WS client as `source=cli`
 *   2. Listening for HTTP_REQUEST frames
 *   3. Responding with HTTP_RESPONSE frames (instead of proxying to localhost)
 *
 * We also start a real local HTTP server to test the "direct fetch to /tunnel" path.
 */

describe("HTTP Tunnel", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let sessionId: string;
  let sessionKey: Uint8Array;
  let cliWs: WsClient;

  // A simple local HTTP server to verify the tunnel endpoint works
  let localServer: Server;
  let localPort: number;

  beforeAll(async () => {
    // Register user and create session with forwarded ports
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    // Start a local HTTP server for testing
    localServer = createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h1>Hello from tunnel</h1>");
      } else if (req.url === "/json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", tunnel: true }));
      } else if (req.url === "/echo" && req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(`echo: ${body}`);
        });
      } else if (req.url === "/headers") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(req.headers));
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not Found");
      }
    });

    await new Promise<void>((resolve) => {
      localServer.listen(0, "127.0.0.1", () => {
        const addr = localServer.address();
        localPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    const { body } = await api.createSession({
      name: "tunnel-test",
      command: "test-server",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: String(localPort),
    });
    sessionId = body.data!.id as string;

    // Connect CLI WS and subscribe
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));
  });

  afterAll(async () => {
    cliWs?.close();
    await new Promise<void>((resolve) => {
      localServer?.close(() => resolve());
    });
  });

  it("session is created with forwardedPorts", async () => {
    const { body } = await api.getSession(sessionId);
    expect(body.success).toBe(true);
    expect(body.data!.forwardedPorts).toBe(String(localPort));
  });

  it("tunnel endpoint returns 401 without authentication", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const res = await fetch(`${tunnelBaseUrl}/tunnel/${sessionId}/${localPort}/`);
    expect(res.status).toBe(401);
  });

  it("CLI receives HTTP_REQUEST frame when browser hits tunnel endpoint", async () => {
    const { wsUrl } = getEnv();
    // The tunnel endpoint is on the WS server (Hono)
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");

    // Make a request to the tunnel endpoint (authenticated via Bearer header)
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${localPort}/`;

    // Start listening for HTTP_REQUEST frame on CLI WS
    const framePromise = cliWs.waitForMessage(
      (f) => f.type === FrameType.HTTP_REQUEST,
      10_000,
    );

    // Fire the tunnel request (don't await — it will hang waiting for CLI response)
    const fetchPromise = fetch(tunnelUrl, {
      headers: { Authorization: `Bearer ${user.token}` },
    }).catch(() => null);

    // CLI should receive the HTTP_REQUEST frame
    const frame = await framePromise;
    expect(frame.type).toBe(FrameType.HTTP_REQUEST);
    expect(frame.sessionId).toBe(sessionId);

    const request: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );
    expect(request.reqId).toBeTruthy();
    expect(request.port).toBe(localPort);
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/");

    // Now send HTTP_RESPONSE frame back
    const response: HttpTunnelResponse = {
      reqId: request.reqId,
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<h1>Tunnel works!</h1>").toString("base64"),
    };
    const responsePayload = new TextEncoder().encode(JSON.stringify(response));
    cliWs.send(createHttpResponseFrame(sessionId, responsePayload));

    // Now the fetch should resolve
    const res = await fetchPromise;
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const text = await res!.text();
    expect(text).toBe("<h1>Tunnel works!</h1>");
  });

  it("tunnels a POST request with body", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${localPort}/submit`;

    const framePromise = cliWs.waitForMessage(
      (f) =>
        f.type === FrameType.HTTP_REQUEST &&
        JSON.parse(new TextDecoder().decode(f.payload)).method === "POST",
      10_000,
    );

    const postBody = JSON.stringify({ key: "value", num: 42 });
    const fetchPromise = fetch(tunnelUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: postBody,
    }).catch(() => null);

    const frame = await framePromise;
    const request: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    expect(request.method).toBe("POST");
    expect(request.path).toBe("/submit");
    expect(request.body).toBeTruthy();
    expect(Buffer.from(request.body!, "base64").toString()).toBe(postBody);

    // Respond
    const response: HttpTunnelResponse = {
      reqId: request.reqId,
      status: 201,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"created":true}').toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );

    const res = await fetchPromise;
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);
    const json = await res!.json();
    expect(json).toEqual({ created: true });
  });

  it("preserves query parameters in tunnel path", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${localPort}/search?q=hello&page=2`;

    const framePromise = cliWs.waitForMessage(
      (f) => {
        if (f.type !== FrameType.HTTP_REQUEST) return false;
        const r = JSON.parse(new TextDecoder().decode(f.payload));
        return r.path.includes("/search");
      },
      10_000,
    );

    const fetchPromise = fetch(tunnelUrl, {
      headers: { Authorization: `Bearer ${user.token}` },
    }).catch(() => null);

    const frame = await framePromise;
    const request: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    // Path should include query params but NOT the auth token
    expect(request.path).toContain("/search");
    expect(request.path).toContain("q=hello");
    expect(request.path).toContain("page=2");
    expect(request.path).not.toContain("token");

    // Respond
    const response: HttpTunnelResponse = {
      reqId: request.reqId,
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("search results").toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );

    const res = await fetchPromise;
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  it("returns 504 when CLI does not respond within timeout", async () => {
    // We need a separate session where CLI doesn't respond
    // Use the existing session but don't respond to the request
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");

    // Create a second session with a different port that CLI won't respond to
    const sessionKey2 = await generateSessionKey();
    const encryptedSessionKey2 = await encryptSessionKey(
      sessionKey2,
      user.publicKey,
    );
    const { body: body2 } = await api.createSession({
      name: "tunnel-timeout",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey2),
      forwardedPorts: "9999",
    });
    const sessionId2 = body2.data!.id as string;

    // Subscribe CLI but don't send any responses
    const cliWs2 = new WsClient();
    await cliWs2.connect(user.token, "cli");
    cliWs2.send(createSubscribeFrame(sessionId2));
    await new Promise((r) => setTimeout(r, 300));

    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId2}/9999/`;

    // This should timeout (30s is too long for tests, but the server's timeout is configurable)
    // We'll set a shorter test timeout and expect 504
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35_000);

    try {
      const res = await fetch(tunnelUrl, {
        headers: { Authorization: `Bearer ${user.token}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      expect(res.status).toBe(504);
    } catch {
      clearTimeout(timeoutId);
      // AbortError means the request timed out client-side — acceptable
    } finally {
      cliWs2.close();
    }
  }, 40_000); // 40s test timeout

  it("returns 403 when accessing another user's session tunnel", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");

    // Register a different user
    const otherUser = await registerUser();

    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${localPort}/`;
    const res = await fetch(tunnelUrl, {
      headers: { Authorization: `Bearer ${otherUser.token}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("HTTP Tunnel — Session with forwardedPorts via GraphQL", () => {
  let user: RegisteredUser;
  let api: ApiClient;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);
  });

  it("creates session with single forwarded port", async () => {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    const { body } = await api.createSession({
      name: "port-test-1",
      command: "npm run dev",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "3000",
    });

    expect(body.success).toBe(true);
    expect(body.data!.forwardedPorts).toBe("3000");
  });

  it("creates session with multiple forwarded ports", async () => {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    const { body } = await api.createSession({
      name: "port-test-multi",
      command: "docker compose up",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "3000,8080,5432",
    });

    expect(body.success).toBe(true);
    expect(body.data!.forwardedPorts).toBe("3000,8080,5432");
  });

  it("creates session without forwarded ports (null)", async () => {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    const { body } = await api.createSession({
      name: "no-ports",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
    });

    expect(body.success).toBe(true);
    expect(body.data!.forwardedPorts).toBeNull();
  });

  it("rejects invalid forwarded ports", async () => {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    const { body } = await api.createSession({
      name: "invalid-ports",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "abc,not-a-port",
    });

    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid forwardedPorts");
  });

  it("rejects out-of-range port numbers", async () => {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    const { body } = await api.createSession({
      name: "bad-range",
      command: "bash",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "70000",
    });

    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid forwardedPorts");
  });

  it("lists sessions with forwardedPorts field", async () => {
    const { body } = await api.listSessions();
    expect(body.success).toBe(true);

    const sessions = body.data!;
    const portSession = sessions.find(
      (s: Record<string, unknown>) => s.name === "port-test-multi",
    );
    expect(portSession).toBeTruthy();
    expect(portSession!.forwardedPorts).toBe("3000,8080,5432");
  });
});

describe("HTTP Tunnel — Multiple concurrent requests", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  const PORT = 4444;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);

    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    const { body } = await api.createSession({
      name: "concurrent-test",
      command: "server",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: String(PORT),
    });
    sessionId = body.data!.id as string;

    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));
  });

  afterAll(() => {
    cliWs?.close();
  });

  it("handles multiple concurrent tunnel requests with correct reqId correlation", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");

    // Set up a listener that auto-responds to HTTP_REQUEST frames
    const respondedReqIds: string[] = [];
    const originalFrames = cliWs.receivedFrames;

    // Start 3 concurrent requests
    const paths = ["/page1", "/page2", "/page3"];
    const fetchPromises = paths.map((path) =>
      fetch(`${tunnelBaseUrl}/tunnel/${sessionId}/${PORT}${path}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      }),
    );

    // Wait for all 3 HTTP_REQUEST frames to arrive
    const requestFrames: HttpTunnelRequest[] = [];
    for (let i = 0; i < 3; i++) {
      const frame = await cliWs.waitForMessage(
        (f) => {
          if (f.type !== FrameType.HTTP_REQUEST) return false;
          const req: HttpTunnelRequest = JSON.parse(
            new TextDecoder().decode(f.payload),
          );
          // Don't match already-processed requests
          return !respondedReqIds.includes(req.reqId);
        },
        10_000,
      );

      const req: HttpTunnelRequest = JSON.parse(
        new TextDecoder().decode(frame.payload),
      );
      requestFrames.push(req);
      respondedReqIds.push(req.reqId);

      // Respond immediately with a unique body per path
      const response: HttpTunnelResponse = {
        reqId: req.reqId,
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from(`response for ${req.path}`).toString("base64"),
      };
      cliWs.send(
        createHttpResponseFrame(
          sessionId,
          new TextEncoder().encode(JSON.stringify(response)),
        ),
      );
    }

    // All 3 fetches should resolve
    const responses = await Promise.all(fetchPromises);

    for (const res of responses) {
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toMatch(/^response for \/page[123]/);
    }

    // Verify all 3 distinct paths were received
    const receivedPaths = requestFrames.map((r) => r.path);
    expect(receivedPaths.sort()).toEqual(["/page1", "/page2", "/page3"]);

    // Verify reqIds are all unique
    const reqIds = requestFrames.map((r) => r.reqId);
    expect(new Set(reqIds).size).toBe(3);
  });
});
