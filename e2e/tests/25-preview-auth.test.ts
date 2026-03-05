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
 * E2E tests for cookie-based preview auth.
 *
 * Verifies that:
 * 1. POST /preview-auth returns 401 without auth
 * 2. POST /preview-auth sets anyterm_preview_token cookie with valid Bearer
 * 3. Tunnel authenticates requests using the preview cookie (no ?token= in URL)
 * 4. Tunnel rejects invalid/garbage preview cookies
 * 5. CORS preflight responds correctly
 */

function getBaseUrl(): string {
  const { wsUrl } = getEnv();
  return wsUrl.replace("ws://", "http://");
}

function extractPreviewCookie(res: Response): string | undefined {
  const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
  const header = setCookieHeaders.find((c: string) =>
    c.startsWith("anyterm_preview_token="),
  );
  return header;
}

function extractCookieValue(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0];
}

describe("Preview Auth — Cookie-based", () => {
  let user: RegisteredUser;
  let api: ApiClient;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);
  });

  it("POST /preview-auth returns 401 without authentication", async () => {
    const res = await fetch(`${getBaseUrl()}/preview-auth`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("POST /preview-auth sets anyterm_preview_token cookie with valid Bearer", async () => {
    const res = await fetch(`${getBaseUrl()}/preview-auth`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.expiresIn).toBeGreaterThan(0);

    const cookie = extractPreviewCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/tunnel");
  });

  it("tunnel endpoint authenticates with preview cookie (no ?token=)", async () => {
    // Step 1: Get preview cookie
    const authRes = await fetch(`${getBaseUrl()}/preview-auth`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(authRes.status).toBe(200);

    const rawCookie = extractPreviewCookie(authRes);
    expect(rawCookie).toBeTruthy();
    const cookieValue = extractCookieValue(rawCookie!);

    // Step 2: Create a session with forwarded ports
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "preview-cookie-test",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "8080",
    });
    const sessionId = body.data!.id as string;

    // Step 3: Connect CLI and subscribe
    const cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Step 4: Hit tunnel with preview cookie — no token in URL
    const framePromise = cliWs.waitForMessage(
      (f) => f.type === FrameType.HTTP_REQUEST,
      10_000,
    );

    // Use the Cookie header with the preview token
    const fetchPromise = fetch(
      `${getBaseUrl()}/tunnel/${sessionId}/8080/`,
      { headers: { Cookie: cookieValue } },
    );

    // CLI should receive the HTTP_REQUEST frame
    const frame = await framePromise;
    expect(frame.type).toBe(FrameType.HTTP_REQUEST);

    const request: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    // Respond
    const response: HttpTunnelResponse = {
      reqId: request.reqId,
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<h1>Cookie auth works!</h1>").toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );

    const res = await fetchPromise;
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("<h1>Cookie auth works!</h1>");

    cliWs.close();
  });

  it("tunnel rejects invalid preview cookie", async () => {
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "preview-invalid-test",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "9090",
    });
    const sessionId = body.data!.id as string;

    // Hit tunnel with garbage cookie and no other auth
    const res = await fetch(
      `${getBaseUrl()}/tunnel/${sessionId}/9090/`,
      {
        headers: { Cookie: "anyterm_preview_token=garbage-invalid-token" },
      },
    );
    expect(res.status).toBe(401);
  });

  it("CORS preflight on /preview-auth returns correct headers", async () => {
    const { baseUrl } = getEnv();

    const res = await fetch(`${getBaseUrl()}/preview-auth`, {
      method: "OPTIONS",
      headers: {
        Origin: baseUrl,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
