import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

/* ------------------------------------------------------------------ */
/*  Shared helper: fire tunnel request, CLI auto-responds              */
/* ------------------------------------------------------------------ */

let roundTripCounter = 0;

async function tunnelRoundTrip(opts: {
  wsUrl: string;
  sessionId: string;
  port: number;
  token: string;
  cliWs: WsClient;
  method?: string;
  path?: string;
  body?: string;
  headers?: Record<string, string>;
  cliStatus?: number;
  cliHeaders?: Record<string, string>;
  cliBody?: string; // base64
  skipCliResponse?: boolean;
}): Promise<{
  httpResponse: Response;
  cliRequest: HttpTunnelRequest;
}> {
  const uniquePath = opts.path ?? `/rtt-${++roundTripCounter}`;
  const tunnelBaseUrl = opts.wsUrl.replace("ws://", "http://");
  const tunnelUrl = `${tunnelBaseUrl}/tunnel/${opts.sessionId}/${opts.port}${uniquePath}`;

  const framePromise = opts.cliWs.waitForMessage(
    (f) => {
      if (f.type !== FrameType.HTTP_REQUEST) return false;
      const r = JSON.parse(new TextDecoder().decode(f.payload));
      return r.path.startsWith(uniquePath.split("?")[0]);
    },
    10_000,
  );

  const fetchPromise = fetch(tunnelUrl, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      ...(opts.headers ?? {}),
    },
    body: opts.body,
  });

  const frame = await framePromise;
  const cliRequest: HttpTunnelRequest = JSON.parse(
    new TextDecoder().decode(frame.payload),
  );

  if (!opts.skipCliResponse) {
    const response: HttpTunnelResponse = {
      reqId: cliRequest.reqId,
      status: opts.cliStatus ?? 200,
      headers: opts.cliHeaders ?? { "content-type": "text/plain" },
      body: opts.cliBody ?? Buffer.from("ok").toString("base64"),
    };
    opts.cliWs.send(
      createHttpResponseFrame(
        opts.sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );
  }

  const httpResponse = await fetchPromise;
  return { httpResponse, cliRequest };
}

/* ------------------------------------------------------------------ */
/*  1. Invalid port / session in tunnel URL                           */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — Invalid URL parameters", () => {
  let user: RegisteredUser;
  let sessionId: string;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "invalid-url-test",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "3000",
    });
    sessionId = body.data!.id as string;
  });

  it("returns 400 for port 0", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const res = await fetch(`${tunnelBaseUrl}/tunnel/${sessionId}/0/`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for port > 65535", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const res = await fetch(`${tunnelBaseUrl}/tunnel/${sessionId}/99999/`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric port", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const res = await fetch(`${tunnelBaseUrl}/tunnel/${sessionId}/abc/`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-existent session", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const res = await fetch(`${tunnelBaseUrl}/tunnel/nonexistent99/3000/`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */
/*  2. HTTP methods: PUT, DELETE, PATCH, HEAD                         */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — HTTP methods", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  const PORT = 6001;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "methods-test",
      command: "test",
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

  it("tunnels a PUT request with body", async () => {
    const { wsUrl } = getEnv();
    const putBody = JSON.stringify({ name: "updated" });
    const { httpResponse, cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      method: "PUT",
      path: "/resource/1",
      headers: { "content-type": "application/json" },
      body: putBody,
    });

    expect(cliRequest.method).toBe("PUT");
    expect(cliRequest.path).toBe("/resource/1");
    expect(cliRequest.body).toBeTruthy();
    expect(Buffer.from(cliRequest.body!, "base64").toString()).toBe(putBody);
    expect(httpResponse.status).toBe(200);
  });

  it("tunnels a DELETE request", async () => {
    const { wsUrl } = getEnv();
    const { httpResponse, cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      method: "DELETE",
      path: "/resource/42",
      cliStatus: 204,
      cliHeaders: {},
    });

    expect(cliRequest.method).toBe("DELETE");
    expect(cliRequest.path).toBe("/resource/42");
    expect(httpResponse.status).toBe(204);
  });

  it("tunnels a PATCH request with body", async () => {
    const { wsUrl } = getEnv();
    const patchBody = JSON.stringify({ field: "patched" });
    const { httpResponse, cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      method: "PATCH",
      path: "/patch-resource/99",
      headers: { "content-type": "application/json" },
      body: patchBody,
      cliStatus: 200,
      cliBody: Buffer.from('{"patched":true}').toString("base64"),
    });

    expect(cliRequest.method).toBe("PATCH");
    expect(Buffer.from(cliRequest.body!, "base64").toString()).toBe(patchBody);
    const json = await httpResponse.json();
    expect(json).toEqual({ patched: true });
  });

  it("tunnels a HEAD request (no body)", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      method: "HEAD",
      path: "/check",
      cliStatus: 200,
      cliHeaders: { "x-exists": "true" },
    });

    expect(cliRequest.method).toBe("HEAD");
    expect(cliRequest.path).toBe("/check");
    // HEAD typically has no body in request
    expect(cliRequest.body).toBeFalsy();
  });
});

/* ------------------------------------------------------------------ */
/*  3. Response without body (204) and response header preservation   */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — Response handling", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  const PORT = 6002;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "response-test",
      command: "test",
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

  it("handles 204 No Content response (no body)", async () => {
    const { wsUrl } = getEnv();
    const { httpResponse } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      cliStatus: 204,
      cliHeaders: {},
    });

    expect(httpResponse.status).toBe(204);
    const text = await httpResponse.text();
    expect(text).toBe("");
  });

  it("preserves custom response headers from CLI", async () => {
    const { wsUrl } = getEnv();
    const { httpResponse } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      cliStatus: 200,
      cliHeaders: {
        "content-type": "application/json",
        "x-request-id": "abc-123",
        "x-ratelimit-remaining": "99",
        "cache-control": "no-cache",
      },
      cliBody: Buffer.from("{}").toString("base64"),
    });

    expect(httpResponse.status).toBe(200);
    expect(httpResponse.headers.get("x-request-id")).toBe("abc-123");
    expect(httpResponse.headers.get("x-ratelimit-remaining")).toBe("99");
    expect(httpResponse.headers.get("cache-control")).toBe("no-cache");
  });

  it("strips hop-by-hop headers (content-encoding, transfer-encoding) from response", async () => {
    const { wsUrl } = getEnv();
    const { httpResponse } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      cliStatus: 200,
      cliHeaders: {
        "content-type": "text/plain",
        "content-encoding": "gzip",
        "transfer-encoding": "chunked",
        "content-length": "12345",
        "x-custom": "keep-me",
      },
      cliBody: Buffer.from("hello").toString("base64"),
    });

    expect(httpResponse.status).toBe(200);
    // These hop-by-hop headers should be stripped
    expect(httpResponse.headers.get("content-encoding")).toBeNull();
    expect(httpResponse.headers.get("transfer-encoding")).toBeNull();
    // content-length is also stripped (Response sets correct one)
    // Custom headers should be preserved
    expect(httpResponse.headers.get("x-custom")).toBe("keep-me");
  });

  it("handles redirect response (301) with manual redirect mode", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const uniquePath = `/redirect-test-${++roundTripCounter}`;
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT}${uniquePath}`;

    const framePromise = cliWs.waitForMessage(
      (f) => {
        if (f.type !== FrameType.HTTP_REQUEST) return false;
        const r = JSON.parse(new TextDecoder().decode(f.payload));
        return r.path === uniquePath;
      },
      10_000,
    );

    // Use redirect: "manual" to prevent fetch from following the redirect
    const fetchPromise = fetch(tunnelUrl, {
      headers: { Authorization: `Bearer ${user.token}` },
      redirect: "manual",
    });

    const frame = await framePromise;
    const cliRequest: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    const response: HttpTunnelResponse = {
      reqId: cliRequest.reqId,
      status: 301,
      headers: { location: "/new-location" },
      body: Buffer.from("Moved").toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );

    const httpResponse = await fetchPromise;
    expect(httpResponse.status).toBe(301);
    expect(httpResponse.headers.get("location")).toBe("/new-location");
  });

  it("handles 500 error response", async () => {
    const { wsUrl } = getEnv();
    const { httpResponse } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      cliStatus: 500,
      cliHeaders: { "content-type": "text/plain" },
      cliBody: Buffer.from("Internal Server Error").toString("base64"),
    });

    expect(httpResponse.status).toBe(500);
    const text = await httpResponse.text();
    expect(text).toBe("Internal Server Error");
  });
});

/* ------------------------------------------------------------------ */
/*  4. Browser WS source restriction — cannot send HTTP_RESPONSE      */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — Source restrictions", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  let browserWs: WsClient;
  const PORT = 6003;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "source-restrict-test",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: String(PORT),
    });
    sessionId = body.data!.id as string;

    // Connect CLI
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));

    // Connect browser
    browserWs = new WsClient();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));

    await new Promise((r) => setTimeout(r, 300));
  });

  afterAll(() => {
    cliWs?.close();
    browserWs?.close();
  });

  it("browser WS sending HTTP_RESPONSE does not resolve pending request", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT}/browser-spoof`;

    // Listen for the HTTP_REQUEST on CLI
    const framePromise = cliWs.waitForMessage(
      (f) => {
        if (f.type !== FrameType.HTTP_REQUEST) return false;
        const r = JSON.parse(new TextDecoder().decode(f.payload));
        return r.path === "/browser-spoof";
      },
      10_000,
    );

    // Fire tunnel request with a short abort timeout
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 8_000);

    const fetchPromise = fetch(tunnelUrl, {
      headers: { Authorization: `Bearer ${user.token}` },
      signal: controller.signal,
    }).catch(() => null);

    // Wait for CLI to receive the request
    const frame = await framePromise;
    const cliRequest: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    // Browser tries to send HTTP_RESPONSE — should be rejected by server
    const spoofResponse: HttpTunnelResponse = {
      reqId: cliRequest.reqId,
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("spoofed!").toString("base64"),
    };
    browserWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(spoofResponse)),
      ),
    );

    // Give server time to process the spoofed frame
    await new Promise((r) => setTimeout(r, 500));

    // Now have CLI respond properly
    const realResponse: HttpTunnelResponse = {
      reqId: cliRequest.reqId,
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("real-response").toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(realResponse)),
      ),
    );

    const res = await fetchPromise;
    clearTimeout(abortTimer);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const text = await res!.text();
    // Should get the real CLI response, not the spoofed browser one
    expect(text).toBe("real-response");
  });
});

/* ------------------------------------------------------------------ */
/*  5. Multiple ports on same session                                 */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — Multiple ports on same session", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  const PORT_A = 6010;
  const PORT_B = 6011;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "multi-port-test",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: `${PORT_A},${PORT_B}`,
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

  it("routes request to correct port A", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest, httpResponse } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT_A,
      token: user.token,
      cliWs,
      cliBody: Buffer.from("from port A").toString("base64"),
    });

    expect(cliRequest.port).toBe(PORT_A);
    expect(httpResponse.status).toBe(200);
    const text = await httpResponse.text();
    expect(text).toBe("from port A");
  });

  it("routes request to correct port B", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest, httpResponse } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT_B,
      token: user.token,
      cliWs,
      cliBody: Buffer.from("from port B").toString("base64"),
    });

    expect(cliRequest.port).toBe(PORT_B);
    expect(httpResponse.status).toBe(200);
    const text = await httpResponse.text();
    expect(text).toBe("from port B");
  });

  it("handles interleaved requests to different ports", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");

    // Use unique paths to avoid matching stale frames from earlier tests
    const pathA = `/ilv-a-${Date.now()}`;
    const pathB = `/ilv-b-${Date.now()}`;
    const validPaths = new Set([pathA, pathB]);
    const respondedReqIds: string[] = [];

    const fetchA = fetch(
      `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT_A}${pathA}`,
      { headers: { Authorization: `Bearer ${user.token}` } },
    );
    const fetchB = fetch(
      `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT_B}${pathB}`,
      { headers: { Authorization: `Bearer ${user.token}` } },
    );

    // Process both requests from CLI
    for (let i = 0; i < 2; i++) {
      const frame = await cliWs.waitForMessage(
        (f) => {
          if (f.type !== FrameType.HTTP_REQUEST) return false;
          const r = JSON.parse(new TextDecoder().decode(f.payload));
          return validPaths.has(r.path) && !respondedReqIds.includes(r.reqId);
        },
        10_000,
      );

      const req: HttpTunnelRequest = JSON.parse(
        new TextDecoder().decode(frame.payload),
      );
      respondedReqIds.push(req.reqId);

      const response: HttpTunnelResponse = {
        reqId: req.reqId,
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from(`port:${req.port}`).toString("base64"),
      };
      cliWs.send(
        createHttpResponseFrame(
          sessionId,
          new TextEncoder().encode(JSON.stringify(response)),
        ),
      );
    }

    const [resA, resB] = await Promise.all([fetchA, fetchB]);
    const textA = await resA.text();
    const textB = await resB.text();

    expect(textA).toBe(`port:${PORT_A}`);
    expect(textB).toBe(`port:${PORT_B}`);
  });
});

/* ------------------------------------------------------------------ */
/*  6. Path edge cases (special chars, encoding)                      */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — Path edge cases", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  const PORT = 6020;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "path-edge-test",
      command: "test",
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

  it("handles deep nested path", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      path: "/api/v2/users/123/posts/456/comments",
    });

    expect(cliRequest.path).toBe("/api/v2/users/123/posts/456/comments");
  });

  it("handles path with encoded characters", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      path: "/search?q=hello%20world&tag=c%2B%2B",
    });

    // The query string should be preserved
    expect(cliRequest.path).toContain("q=hello");
    expect(cliRequest.path).toContain("world");
  });

  it("handles path with multiple query parameters", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      path: "/filter?status=active&sort=name&order=asc&limit=10",
    });

    expect(cliRequest.path).toContain("status=active");
    expect(cliRequest.path).toContain("sort=name");
    expect(cliRequest.path).toContain("order=asc");
    expect(cliRequest.path).toContain("limit=10");
  });

  it("handles root path without trailing slash", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");

    // Request exactly /tunnel/:sessionId/:port (no trailing slash, no wildcard match)
    // The Hono route is /tunnel/:sessionId/:port/* so a trailing slash or path is needed
    // Let's test with just "/" which is the minimal path
    const framePromise = cliWs.waitForMessage(
      (f) => {
        if (f.type !== FrameType.HTTP_REQUEST) return false;
        const r = JSON.parse(new TextDecoder().decode(f.payload));
        return r.path === "/";
      },
      10_000,
    );

    const fetchPromise = fetch(
      `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT}/`,
      { headers: { Authorization: `Bearer ${user.token}` } },
    );

    const frame = await framePromise;
    const req: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );
    expect(req.path).toBe("/");

    // Respond
    const response: HttpTunnelResponse = {
      reqId: req.reqId,
      status: 200,
      headers: {},
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );
    await fetchPromise;
  });
});

/* ------------------------------------------------------------------ */
/*  7. forwardedPorts edge cases in session creation                   */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — forwardedPorts edge cases", () => {
  let user: RegisteredUser;
  let api: ApiClient;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);
  });

  async function createWithPorts(forwardedPorts: string) {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    return api.createSession({
      name: "edge-case",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts,
    });
  }

  it("trims whitespace in port list", async () => {
    const { body } = await createWithPorts("  3000 , 8080 ");
    expect(body.success).toBe(true);
    // Ports should be normalized (trimmed)
    expect(body.data!.forwardedPorts).toBe("3000,8080");
  });

  it("accepts port 1 (minimum valid)", async () => {
    const { body } = await createWithPorts("1");
    expect(body.success).toBe(true);
    expect(body.data!.forwardedPorts).toBe("1");
  });

  it("accepts port 65535 (maximum valid)", async () => {
    const { body } = await createWithPorts("65535");
    expect(body.success).toBe(true);
    expect(body.data!.forwardedPorts).toBe("65535");
  });

  it("rejects port 65536 (exceeds max)", async () => {
    const { body } = await createWithPorts("65536");
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid forwardedPorts");
  });

  it("rejects negative port", async () => {
    const { body } = await createWithPorts("-1");
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid forwardedPorts");
  });

  it("rejects decimal port", async () => {
    const { body } = await createWithPorts("3000.5");
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid forwardedPorts");
  });

  it("rejects mixed valid and invalid ports", async () => {
    const { body } = await createWithPorts("3000,abc,8080");
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid forwardedPorts");
  });

  it("accepts many ports", async () => {
    const ports = "3000,3001,3002,3003,3004,8080,8081,8082,9090,9091";
    const { body } = await createWithPorts(ports);
    expect(body.success).toBe(true);
    expect(body.data!.forwardedPorts).toBe(ports);
  });
});

/* ------------------------------------------------------------------ */
/*  8. Request header forwarding                                      */
/* ------------------------------------------------------------------ */

describe("HTTP Tunnel — Request header forwarding", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  const PORT = 6030;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "header-fwd-test",
      command: "test",
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

  it("forwards custom request headers to CLI", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      headers: {
        "x-custom-header": "my-value",
        "accept-language": "en-US",
      },
    });

    expect(cliRequest.headers["x-custom-header"]).toBe("my-value");
    expect(cliRequest.headers["accept-language"]).toBe("en-US");
  });

  it("strips hop-by-hop headers from request", async () => {
    const { wsUrl } = getEnv();
    const { cliRequest } = await tunnelRoundTrip({
      wsUrl,
      sessionId,
      port: PORT,
      token: user.token,
      cliWs,
      headers: {
        "x-keep": "yes",
      },
    });

    // connection, host, transfer-encoding should be stripped
    expect(cliRequest.headers["host"]).toBeUndefined();
    expect(cliRequest.headers["connection"]).toBeUndefined();
    expect(cliRequest.headers["transfer-encoding"]).toBeUndefined();
    // Custom headers should be forwarded
    expect(cliRequest.headers["x-keep"]).toBe("yes");
  });
});
