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

/**
 * Security tests: verify auth tokens are never leaked in URL query parameters.
 *
 * These tests ensure:
 * - Tunnel and daemon API endpoints accept Bearer header and cookie auth
 * - Tokens are NOT forwarded in the HTTP_REQUEST path to CLI
 * - Unauthenticated requests are properly rejected
 */

describe("Token Security — Auth methods", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let sessionId: string;
  let cliWs: WsClient;
  const PORT = 5555;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );

    const { body } = await api.createSession({
      name: "security-test",
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

  // Counter to generate unique paths per tunnelRoundTrip call, preventing
  // waitForMessage from matching stale frames from previous invocations.
  let roundTripCounter = 0;

  /** Fire a tunnel request and have CLI respond, returning both the HTTP response and CLI-side request. */
  async function tunnelRoundTrip(fetchOptions: RequestInit = {}): Promise<{
    httpResponse: Response;
    cliRequest: HttpTunnelRequest;
  }> {
    const uniquePath = `/test-path-${++roundTripCounter}`;
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT}${uniquePath}`;

    const framePromise = cliWs.waitForMessage(
      (f) => {
        if (f.type !== FrameType.HTTP_REQUEST) return false;
        const r = JSON.parse(new TextDecoder().decode(f.payload));
        return r.path === uniquePath;
      },
      10_000,
    );

    const fetchPromise = fetch(tunnelUrl, fetchOptions);

    const frame = await framePromise;
    const cliRequest: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    const response: HttpTunnelResponse = {
      reqId: cliRequest.reqId,
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("ok").toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );

    const httpResponse = await fetchPromise;
    return { httpResponse, cliRequest };
  }

  it("tunnel authenticates via Bearer header", async () => {
    const { httpResponse } = await tunnelRoundTrip({
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(httpResponse.status).toBe(200);
  });

  it("tunnel authenticates via cookie", async () => {
    const { httpResponse } = await tunnelRoundTrip({
      headers: { Cookie: `better-auth.session_token=${user.cookieToken}` },
    });
    expect(httpResponse.status).toBe(200);
  });

  it("tunnel rejects unauthenticated request", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const res = await fetch(
      `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT}/`,
    );
    expect(res.status).toBe(401);
  });

  it("token is NOT leaked in forwarded HTTP_REQUEST path", async () => {
    const { cliRequest } = await tunnelRoundTrip({
      headers: { Authorization: `Bearer ${user.token}` },
    });
    // The path forwarded to CLI must never contain the auth token
    expect(cliRequest.path).not.toContain("token");
    expect(cliRequest.path).not.toContain(user.token);
    expect(cliRequest.path).toMatch(/^\/test-path-\d+$/);
  });

  it("token query param is stripped from forwarded path even if sent", async () => {
    const { wsUrl } = getEnv();
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    // Intentionally pass token as query param + extra params
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/${PORT}/legacy?token=${encodeURIComponent(user.token)}&foo=bar`;

    const framePromise = cliWs.waitForMessage(
      (f) => {
        if (f.type !== FrameType.HTTP_REQUEST) return false;
        const r = JSON.parse(new TextDecoder().decode(f.payload));
        return r.path.includes("/legacy");
      },
      10_000,
    );

    // Authenticate via Bearer header; query param token should still be stripped from forwarded path
    const fetchPromise = fetch(tunnelUrl, {
      headers: { Authorization: `Bearer ${user.token}` },
    });

    const frame = await framePromise;
    const cliRequest: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    // Token must be stripped, but other params preserved
    expect(cliRequest.path).not.toContain("token");
    expect(cliRequest.path).not.toContain(user.token);
    expect(cliRequest.path).toContain("foo=bar");

    // Respond so fetch resolves
    const response: HttpTunnelResponse = {
      reqId: cliRequest.reqId,
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("ok").toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );

    const httpResponse = await fetchPromise;
    expect(httpResponse.status).toBe(200);
  });
});

describe("Token Security — Daemon API auth methods", () => {
  let user: RegisteredUser;

  beforeAll(async () => {
    user = await registerUser();
  });

  it("daemon status accepts Bearer auth", async () => {
    const { wsUrl } = getEnv();
    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/status`,
      { headers: { Authorization: `Bearer ${user.token}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("online");
  });

  it("daemon status rejects unauthenticated request", async () => {
    const { wsUrl } = getEnv();
    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/status`,
    );
    expect(res.status).toBe(401);
  });

  it("daemon spawn accepts Bearer auth (503 = no daemon, but auth passed)", async () => {
    const { wsUrl } = getEnv();
    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ encryptedPayload: "test" }),
      },
    );
    // 503 = "No daemon connected" means auth passed successfully
    expect(res.status).toBe(503);
  });

  it("daemon spawn rejects unauthenticated request", async () => {
    const { wsUrl } = getEnv();
    const res = await fetch(
      `${wsUrl.replace("ws", "http")}/api/daemon/spawn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptedPayload: "test" }),
      },
    );
    expect(res.status).toBe(401);
  });
});
