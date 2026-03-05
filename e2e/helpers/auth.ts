import postgres from "postgres";
import { getEnv } from "./env.js";
import {
  deriveKeysFromPassword,
  generateKeyPair,
  encryptPrivateKey,
  toBase64,
} from "./crypto.js";

export interface RegisteredUser {
  email: string;
  password: string;
  userId: string;
  /** Raw session token (for WS auth direct DB lookup) */
  token: string;
  /** Full signed cookie value (for HTTP API Cookie header) */
  cookieToken: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  masterKey: Uint8Array;
  salt: Uint8Array;
  organizationId: string;
}

export interface LoggedInUser {
  token: string;
  cookieToken: string;
  userId: string;
}

let userCounter = 0;

/**
 * Extract session token from Set-Cookie headers.
 * Cookie format: `better-auth.session_token=<token>.<hmac>` (URL-encoded)
 * DB stores just `<token>`, better-auth's getSession expects full `<token>.<hmac>`.
 */
function extractTokens(
  res: Response,
  data: Record<string, unknown>,
): { raw: string; cookie: string } {
  // Try Set-Cookie header first
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const match = c.match(/better-auth\.session_token=([^;]+)/);
    if (match) {
      const cookie = decodeURIComponent(match[1]);
      // Raw token is the part before the first dot (if signed)
      const raw =
        typeof data.token === "string" ? data.token : cookie.split(".")[0];
      return { raw, cookie };
    }
  }

  // Fallback: raw set-cookie header
  const rawCookie = res.headers.get("set-cookie") ?? "";
  const match = rawCookie.match(/better-auth\.session_token=([^;]+)/);
  if (match) {
    const cookie = decodeURIComponent(match[1]);
    const raw =
      typeof data.token === "string" ? data.token : cookie.split(".")[0];
    return { raw, cookie };
  }

  // Fallback: JSON body only
  if (typeof data.token === "string") {
    return { raw: data.token, cookie: data.token };
  }

  throw new Error("Could not extract session token from response");
}

function extractUserId(data: Record<string, unknown>): string {
  if (data.user && typeof data.user === "object" && "id" in data.user!) {
    return (data.user as Record<string, string>).id;
  }
  throw new Error("Could not extract userId from response");
}

export async function registerUser(
  passwordOverride?: string,
): Promise<RegisteredUser> {
  const { baseUrl } = getEnv();
  const email = `e2e-user-${Date.now()}-${process.pid}-${++userCounter}@test.local`;
  const password = passwordOverride ?? "TestPassword123!";

  // Derive master key
  const { masterKey, salt } = await deriveKeysFromPassword(password);

  // Generate X25519 keypair
  const { publicKey, privateKey } = await generateKeyPair();

  // Encrypt private key with master key
  const encryptedPrivateKey = await encryptPrivateKey(privateKey, masterKey);

  // Register via better-auth
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      name: email.split("@")[0],
      publicKey: toBase64(publicKey),
      encryptedPrivateKey: toBase64(encryptedPrivateKey),
      keySalt: toBase64(salt),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Registration failed (${res.status}): ${text}`);
  }

  const signUpData = await res.json();
  const userId = extractUserId(signUpData);

  // Auto-verify email in DB (requireEmailVerification is enabled)
  const { databaseUrl } = getEnv();
  const sql = postgres(databaseUrl);
  await sql`UPDATE users SET email_verified = true WHERE email = ${email}`;
  await sql.end();

  // Sign in to get a session token (sign-up no longer returns one with email verification)
  const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!signInRes.ok) {
    const text = await signInRes.text();
    throw new Error(`Post-registration sign-in failed (${signInRes.status}): ${text}`);
  }

  const signInData = await signInRes.json();
  const { raw, cookie } = extractTokens(signInRes, signInData);

  // Find and activate personal org (auto-created on signup with slug === userId)
  let organizationId = "";
  const cookieHeader = `better-auth.session_token=${cookie}`;
  try {
    const orgsRes = await fetch(
      `${baseUrl}/api/auth/organization/list`,
      {
        headers: {
          Authorization: `Bearer ${raw}`,
          Cookie: cookieHeader,
        },
      },
    );
    if (orgsRes.ok) {
      const orgs = await orgsRes.json();
      const personalOrg = orgs?.find((o: any) => o.slug === userId);
      if (personalOrg) {
        organizationId = personalOrg.id;
        await fetch(`${baseUrl}/api/auth/organization/set-active`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${raw}`,
            Cookie: cookieHeader,
          },
          body: JSON.stringify({ organizationId: personalOrg.id }),
        });
      }
    }
  } catch {
    // Non-critical — org activation can be done later
  }

  return {
    email,
    password,
    userId,
    token: raw,
    cookieToken: cookie,
    publicKey,
    privateKey,
    masterKey,
    salt,
    organizationId,
  };
}

export async function loginUser(
  email: string,
  password: string,
): Promise<LoggedInUser> {
  const { baseUrl } = getEnv();

  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const { raw, cookie } = extractTokens(res, data);
  const userId = extractUserId(data);

  // Activate personal org on the new session
  const cookieHeader = `better-auth.session_token=${cookie}`;
  try {
    const orgsRes = await fetch(
      `${baseUrl}/api/auth/organization/list`,
      {
        headers: {
          Authorization: `Bearer ${raw}`,
          Cookie: cookieHeader,
        },
      },
    );
    if (orgsRes.ok) {
      const orgs = await orgsRes.json();
      const personalOrg = orgs?.find((o: any) => o.slug === userId);
      if (personalOrg) {
        await fetch(`${baseUrl}/api/auth/organization/set-active`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${raw}`,
            Cookie: cookieHeader,
          },
          body: JSON.stringify({ organizationId: personalOrg.id }),
        });
      }
    }
  } catch {
    // Non-critical
  }

  return { token: raw, cookieToken: cookie, userId };
}
