import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-preview-token";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.useRealTimers();
});

// Dynamic import so env is set before module loads
async function loadModule() {
  // Clear module cache to pick up fresh env
  vi.resetModules();
  return import("../preview-token.js");
}

describe("preview-token", () => {
  it("round-trips: create then verify returns the userId", async () => {
    const { createPreviewToken, verifyPreviewToken } = await loadModule();
    const token = createPreviewToken("user_abc123");
    const result = verifyPreviewToken(token);
    expect(result).toEqual({ id: "user_abc123" });
  });

  it("rejects an expired token", async () => {
    const { createPreviewToken, verifyPreviewToken } = await loadModule();
    const token = createPreviewToken("user_abc123");

    // Advance time past 5-minute TTL
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    const result = verifyPreviewToken(token);
    expect(result).toBeNull();
  });

  it("rejects a tampered HMAC", async () => {
    const { createPreviewToken, verifyPreviewToken } = await loadModule();
    const token = createPreviewToken("user_abc123");

    // Flip last character of the base64url token
    const lastChar = token[token.length - 1];
    const flipped = lastChar === "A" ? "B" : "A";
    const tampered = token.slice(0, -1) + flipped;

    expect(verifyPreviewToken(tampered)).toBeNull();
  });

  it("rejects a tampered payload (different userId)", async () => {
    const { createPreviewToken, verifyPreviewToken } = await loadModule();
    const token = createPreviewToken("user_abc123");

    // Decode, modify userId, re-encode (keeping original HMAC)
    const decoded = Buffer.from(token, "base64url").toString();
    const lastDot = decoded.lastIndexOf(".");
    const payload = decoded.slice(0, lastDot);
    const hmac = decoded.slice(lastDot + 1);
    const colonIdx = payload.indexOf(":");
    const newPayload = `evil_user${payload.slice(colonIdx)}`;
    const reencoded = Buffer.from(`${newPayload}.${hmac}`).toString("base64url");

    expect(verifyPreviewToken(reencoded)).toBeNull();
  });

  it("throws on createPreviewToken when BETTER_AUTH_SECRET is missing", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    const { createPreviewToken } = await loadModule();
    expect(() => createPreviewToken("user_abc123")).toThrow(
      "BETTER_AUTH_SECRET is required",
    );
  });

  it("returns null on verifyPreviewToken when BETTER_AUTH_SECRET is missing", async () => {
    // Create token with secret present
    const { createPreviewToken } = await loadModule();
    const token = createPreviewToken("user_abc123");

    // Now remove secret and re-import
    delete process.env.BETTER_AUTH_SECRET;
    const { verifyPreviewToken } = await loadModule();
    expect(verifyPreviewToken(token)).toBeNull();
  });

  it("rejects empty string", async () => {
    const { verifyPreviewToken } = await loadModule();
    expect(verifyPreviewToken("")).toBeNull();
  });

  it("rejects garbage input", async () => {
    const { verifyPreviewToken } = await loadModule();
    expect(verifyPreviewToken("not-a-real-token!!!")).toBeNull();
  });

  it("rejects token with no dot in decoded payload", async () => {
    const { verifyPreviewToken } = await loadModule();
    // Encode something without a dot
    const fake = Buffer.from("nodothere").toString("base64url");
    expect(verifyPreviewToken(fake)).toBeNull();
  });

  it("PREVIEW_TOKEN_TTL_SECONDS equals 300", async () => {
    const { PREVIEW_TOKEN_TTL_SECONDS } = await loadModule();
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(300);
  });

  it("userId containing colon is truncated at first colon (documents limitation)", async () => {
    const { createPreviewToken, verifyPreviewToken } = await loadModule();
    const token = createPreviewToken("user:with:colons");
    const result = verifyPreviewToken(token);
    // indexOf(":") finds the first colon, so userId becomes "user"
    // and expiresAt tries to parse "with:colons:timestamp" which is NaN → null
    expect(result).toBeNull();
  });
});
