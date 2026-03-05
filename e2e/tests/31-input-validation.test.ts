import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
} from "../helpers/crypto.js";

describe("31 — GraphQL Input Boundaries", () => {
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
      name: "test",
      command: "echo hi",
      encryptedSessionKey: toBase64(encryptedSessionKey),
      ...overrides,
    };
  }

  // --- Session name ---

  it("session name 255 chars OK", async () => {
    const name = "a".repeat(255);
    const res = await api.createSession(makeSession({ name }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, string>).name).toBe(name);
  });

  it("session name 256 chars truncated to 255", async () => {
    const name = "b".repeat(256);
    const res = await api.createSession(makeSession({ name }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, string>).name.length).toBe(255);
  });

  // --- Command ---

  it("command 4096 chars OK", async () => {
    const command = "c".repeat(4096);
    const res = await api.createSession(makeSession({ command }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, string>).command.length).toBe(4096);
  });

  it("command 4097 chars truncated to 4096", async () => {
    const command = "d".repeat(4097);
    const res = await api.createSession(makeSession({ command }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, string>).command.length).toBe(4096);
  });

  // --- Encrypted session key ---

  it("encryptedSessionKey 4096 chars OK", async () => {
    const padded = "x".repeat(4096);
    const res = await api.createSession(
      makeSession({ encryptedSessionKey: padded }),
    );
    expect(res.status).toBe(200);
  });

  it("encryptedSessionKey 4097 chars rejected", async () => {
    const padded = "x".repeat(4097);
    const res = await api.createSession(
      makeSession({ encryptedSessionKey: padded }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("too large");
  });

  // --- Forwarded ports ---

  it("20 ports OK", async () => {
    const ports = Array.from({ length: 20 }, (_, i) => 3000 + i).join(",");
    const res = await api.createSession(
      makeSession({ forwardedPorts: ports }),
    );
    expect(res.status).toBe(200);
  });

  it("21 ports rejected", async () => {
    const ports = Array.from({ length: 21 }, (_, i) => 3000 + i).join(",");
    const res = await api.createSession(
      makeSession({ forwardedPorts: ports }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Too many");
  });

  // --- Cols/rows clamping ---

  it("cols 0 clamped to 1", async () => {
    const res = await api.createSession(makeSession({ cols: 0 }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, number>).cols).toBe(1);
  });

  it("cols 501 clamped to 500", async () => {
    const res = await api.createSession(makeSession({ cols: 501 }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, number>).cols).toBe(500);
  });

  it("rows 0 clamped to 1", async () => {
    const res = await api.createSession(makeSession({ rows: 0 }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, number>).rows).toBe(1);
  });

  it("rows 201 clamped to 200", async () => {
    const res = await api.createSession(makeSession({ rows: 201 }));
    expect(res.status).toBe(200);
    expect((res.body.data as Record<string, number>).rows).toBe(200);
  });

  // --- updateUserKeys: encryptedPrivateKey size ---

  it("updateUserKeys: encryptedPrivateKey 8192 OK", async () => {
    const padded = "y".repeat(8192);
    const res = await api.updateUserKeys({
      encryptedPrivateKey: padded,
      keySalt: toBase64(user.salt),
      currentPassword: user.password,
    });
    expect(res.status).toBe(200);
  });

  it("updateUserKeys: encryptedPrivateKey 8193 rejected", async () => {
    const padded = "y".repeat(8193);
    const res = await api.updateUserKeys({
      encryptedPrivateKey: padded,
      keySalt: toBase64(user.salt),
      currentPassword: user.password,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("too large");
  });

  // --- SSO: providerId format ---

  it("SSO: invalid providerId format rejected", async () => {
    const res = await api.registerSSOProvider({
      providerId: "INVALID_FORMAT!!",
      domain: "example.com",
      issuer: "https://idp.example.com",
      clientId: "test",
      clientSecret: "secret",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Pp]rovider/i);
  });

  it("SSO: domain >255 rejected", async () => {
    const res = await api.registerSSOProvider({
      providerId: "valid-id",
      domain: "x".repeat(256) + ".com",
      issuer: "https://idp.example.com",
      clientId: "test",
      clientSecret: "secret",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Dd]omain/i);
  });
});
