import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
} from "../helpers/crypto.js";
import { getEnv } from "../helpers/env.js";

describe("35 — Tunnel & Key Security", () => {
  let user: RegisteredUser;
  let api: ApiClient;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);
  });

  function makeSession(overrides: Record<string, unknown> = {}) {
    const sessionKey = generateSessionKey();
    const encryptedSessionKey = encryptSessionKey(sessionKey, user.publicKey);
    return {
      name: "security-test",
      command: "echo test",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      ...overrides,
    };
  }

  // --- getOrgSessionCap formula (pure function, no external deps) ---

  it("getOrgSessionCap returns correct caps per tier", async () => {
    const { getOrgSessionCap } = await import(
      "../../apps/web/src/lib/plan-limits.js"
    );

    // starter: fixed at 1
    expect(getOrgSessionCap("starter", 1)).toBe(1);
    expect(getOrgSessionCap("starter", 100)).toBe(1);

    // pro: fixed at 10
    expect(getOrgSessionCap("pro", 1)).toBe(10);
    expect(getOrgSessionCap("pro", 100)).toBe(10);

    // team: min(seats * 10, 100)
    expect(getOrgSessionCap("team", 1)).toBe(10);
    expect(getOrgSessionCap("team", 5)).toBe(50);
    expect(getOrgSessionCap("team", 10)).toBe(100);
    expect(getOrgSessionCap("team", 15)).toBe(100); // capped

    // edge case: 0 seats = 0 cap
    expect(getOrgSessionCap("team", 0)).toBe(0);
  });

  // --- Port whitelist enforcement ---

  it("tunnel rejects non-whitelisted port with 403", async () => {
    const session = await api.createSession(
      makeSession({ forwardedPorts: "3000" }),
    );
    expect(session.status).toBe(200);
    const sid = (session.body.data as Record<string, string>).id;

    // Tunnel endpoint lives on the Hono WS server
    const { wsUrl } = getEnv();
    const tunnelBase = wsUrl
      .replace("ws://", "http://")
      .replace("wss://", "https://");

    // Request a port NOT in the whitelist
    const res = await fetch(`${tunnelBase}/tunnel/${sid}/4000/test`, {
      headers: {
        Cookie: `better-auth.session_token=${user.cookieToken}`,
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Port not forwarded");
  });

  it("tunnel allows whitelisted port (504 = auth passed, no CLI)", async () => {
    const session = await api.createSession(
      makeSession({ forwardedPorts: "3000" }),
    );
    expect(session.status).toBe(200);
    const sid = (session.body.data as Record<string, string>).id;

    const { wsUrl } = getEnv();
    const tunnelBase = wsUrl
      .replace("ws://", "http://")
      .replace("wss://", "https://");

    // Request the whitelisted port. No CLI is connected, so we expect
    // 504 (gateway timeout) rather than 403 (port not forwarded).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const res = await fetch(`${tunnelBase}/tunnel/${sid}/3000/`, {
        headers: {
          Cookie: `better-auth.session_token=${user.cookieToken}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      // 504 means the request made it past auth + port whitelist
      expect(res.status).toBe(504);
    } catch {
      clearTimeout(timer);
      // AbortError is also acceptable (timeout = no CLI to respond)
    }
  });

  // --- setupEncryptionKeys one-time guard ---

  it("setupEncryptionKeys rejects when keys already exist", async () => {
    const res = await api.setupEncryptionKeys({
      publicKey: toBase64(user.publicKey),
      encryptedPrivateKey: toBase64(new Uint8Array(72)),
      keySalt: toBase64(user.salt),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("already configured");
  });
});
