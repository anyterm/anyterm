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

describe("37 — Blocked Response Headers", () => {
  let user: RegisteredUser;
  let sessionId: string;
  let cliWs: WsClient;
  let wsUrl: string;

  beforeAll(async () => {
    user = await registerUser();
    const api = new ApiClient(user.cookieToken);
    const sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      user.publicKey,
    );
    const { body } = await api.createSession({
      name: "blocked-headers-test",
      command: "test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      forwardedPorts: "3000",
    });
    sessionId = body.data!.id as string;

    wsUrl = getEnv().wsUrl;
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    // Wait for subscription to be established
    await new Promise((r) => setTimeout(r, 200));
  });

  afterAll(async () => {
    await cliWs?.close();
  });

  let roundTripCounter = 0;

  async function tunnelWithHeaders(
    cliHeaders: Record<string, string>,
  ): Promise<Response> {
    const uniquePath = `/bh-${++roundTripCounter}`;
    const tunnelBaseUrl = wsUrl.replace("ws://", "http://");
    const tunnelUrl = `${tunnelBaseUrl}/tunnel/${sessionId}/3000${uniquePath}`;

    const framePromise = cliWs.waitForMessage(
      (f) => {
        if (f.type !== FrameType.HTTP_REQUEST) return false;
        const r = JSON.parse(new TextDecoder().decode(f.payload));
        return r.path.startsWith(uniquePath);
      },
      10_000,
    );

    const fetchPromise = fetch(tunnelUrl, {
      headers: { Authorization: `Bearer ${user.token}` },
    });

    const frame = await framePromise;
    const cliRequest: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(frame.payload),
    );

    const response: HttpTunnelResponse = {
      reqId: cliRequest.reqId,
      status: 200,
      headers: {
        "content-type": "text/plain",
        ...cliHeaders,
      },
      body: Buffer.from("ok").toString("base64"),
    };
    cliWs.send(
      createHttpResponseFrame(
        sessionId,
        new TextEncoder().encode(JSON.stringify(response)),
      ),
    );

    return fetchPromise;
  }

  it("strips set-cookie from CLI response", async () => {
    const res = await tunnelWithHeaders({ "set-cookie": "evil=1; Path=/" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("strips content-security-policy from CLI response", async () => {
    const res = await tunnelWithHeaders({
      "content-security-policy": "default-src 'none'",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("strips x-frame-options from CLI response", async () => {
    const res = await tunnelWithHeaders({ "x-frame-options": "DENY" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  it("strips strict-transport-security from CLI response", async () => {
    const res = await tunnelWithHeaders({
      "strict-transport-security": "max-age=99999",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("strips access-control-allow-origin from CLI response", async () => {
    const res = await tunnelWithHeaders({
      "access-control-allow-origin": "*",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("strips access-control-allow-credentials from CLI response", async () => {
    const res = await tunnelWithHeaders({
      "access-control-allow-credentials": "true",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("preserves safe custom headers from CLI response", async () => {
    const res = await tunnelWithHeaders({
      "x-custom-header": "safe-value",
      "x-powered-by": "test-server",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-custom-header")).toBe("safe-value");
    expect(res.headers.get("x-powered-by")).toBe("test-server");
  });
});
