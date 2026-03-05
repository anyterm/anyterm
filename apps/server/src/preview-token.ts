import { createHmac, timingSafeEqual } from "node:crypto";

const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const HMAC_ALGORITHM = "sha256";

function getSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  return `preview-token:${secret}`;
}

export function createPreviewToken(userId: string): string {
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS;
  const payload = `${userId}:${expiresAt}`;
  const hmac = createHmac(HMAC_ALGORITHM, getSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}.${hmac}`).toString("base64url");
}

export function verifyPreviewToken(
  token: string,
): { id: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;

    const payload = decoded.slice(0, lastDot);
    const providedHmac = decoded.slice(lastDot + 1);

    const expectedHmac = createHmac(HMAC_ALGORITHM, getSecret())
      .update(payload)
      .digest("hex");

    if (providedHmac.length !== expectedHmac.length) return null;
    const a = Buffer.from(providedHmac, "utf8");
    const b = Buffer.from(expectedHmac, "utf8");
    if (!timingSafeEqual(a, b)) return null;

    const colonIdx = payload.indexOf(":");
    if (colonIdx === -1) return null;
    const userId = payload.slice(0, colonIdx);
    const expiresAt = parseInt(payload.slice(colonIdx + 1), 10);

    if (!userId || isNaN(expiresAt) || Date.now() > expiresAt) return null;

    return { id: userId };
  } catch {
    return null;
  }
}

export const PREVIEW_TOKEN_TTL_SECONDS = Math.floor(
  PREVIEW_TOKEN_TTL_MS / 1000,
);
