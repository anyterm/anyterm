import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { getEnv } from "../helpers/env.js";
import {
  deriveKeysFromPassword,
  decryptPrivateKey,
  fromBase64,
} from "../helpers/crypto.js";

/**
 * Tests the exact HTTP calls the CLI `login` command makes.
 * Uses raw fetch (not ApiClient) to match the CLI's Bearer-token auth path.
 */
describe("CLI Login Flow", () => {
  let user: RegisteredUser;
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = getEnv().baseUrl;
    user = await registerUser();
  });

  // --- Sign-in with Origin header (CSRF) ---

  it("POST /api/auth/sign-in/email succeeds with Origin header", async () => {
    const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    // CLI extracts token from data.session.token ?? data.token
    const token = data.session?.token ?? data.token;
    expect(token).toBeTruthy();
    expect(data.user?.id).toBe(user.userId);
  });

  it("returns error for wrong password", async () => {
    const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email: user.email, password: "WrongPassword!" }),
    });

    // better-auth returns non-ok for bad credentials
    expect(res.ok).toBe(false);
  });

  it("returns error for non-existent email", async () => {
    const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({
        email: "nonexistent@test.local",
        password: "whatever",
      }),
    });

    expect(res.ok).toBe(false);
  });

  // --- Bearer-token GraphQL (CLI auth path) ---

  it("GraphQL userKeys query works with Bearer token", async () => {
    // Sign in CLI-style to get Bearer token
    const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    const signInData = await signInRes.json();
    const token = signInData.session?.token ?? signInData.token;

    // Use Bearer token (not Cookie) — this is what the CLI does
    const gqlRes = await fetch(`${baseUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query { userKeys { publicKey encryptedPrivateKey keySalt } }`,
      }),
    });

    expect(gqlRes.ok).toBe(true);
    const gqlData = await gqlRes.json();
    expect(gqlData.errors).toBeUndefined();
    expect(gqlData.data.userKeys).toBeTruthy();
    expect(gqlData.data.userKeys.publicKey).toBeTruthy();
    expect(gqlData.data.userKeys.encryptedPrivateKey).toBeTruthy();
    expect(gqlData.data.userKeys.keySalt).toBeTruthy();
  });

  it("invalid Bearer token is rejected on GraphQL", async () => {
    const gqlRes = await fetch(`${baseUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token-xyz",
      },
      body: JSON.stringify({ query: `{ userKeys { publicKey } }` }),
    });

    // GraphQL Yoga returns 200 with errors array
    const data = await gqlRes.json();
    expect(data.errors).toBeDefined();
    expect(data.errors.length).toBeGreaterThan(0);
  });

  // --- Full CLI login: sign-in → keys → decrypt ---

  it("correct password decrypts privateKey after CLI-style login", async () => {
    // Step 1: CLI sign-in
    const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    const signInData = await signInRes.json();
    const token = signInData.session?.token ?? signInData.token;

    // Step 2: Fetch keys via Bearer-auth GraphQL
    const gqlRes = await fetch(`${baseUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query { userKeys { publicKey encryptedPrivateKey keySalt } }`,
      }),
    });
    const gqlData = await gqlRes.json();
    const keys = gqlData.data.userKeys;

    // Step 3: Derive masterKey and decrypt privateKey (exactly what login.ts does)
    const salt = fromBase64(keys.keySalt);
    const { masterKey } = await deriveKeysFromPassword(user.password, salt);
    const encPk = fromBase64(keys.encryptedPrivateKey);
    const decryptedPk = await decryptPrivateKey(encPk, masterKey);

    expect(decryptedPk).toBeInstanceOf(Uint8Array);
    expect(decryptedPk.length).toBeGreaterThan(0);
  });

  it("wrong password fails to decrypt privateKey after CLI-style login", async () => {
    // Sign in with correct password to get token
    const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    const signInData = await signInRes.json();
    const token = signInData.session?.token ?? signInData.token;

    // Fetch keys
    const gqlRes = await fetch(`${baseUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query { userKeys { publicKey encryptedPrivateKey keySalt } }`,
      }),
    });
    const gqlData = await gqlRes.json();
    const keys = gqlData.data.userKeys;

    // Try to decrypt with wrong password
    const salt = fromBase64(keys.keySalt);
    const { masterKey: wrongKey } = await deriveKeysFromPassword(
      "WrongPassword999!",
      salt,
    );
    const encPk = fromBase64(keys.encryptedPrivateKey);

    expect(() => decryptPrivateKey(encPk, wrongKey)).toThrow();
  });
});
