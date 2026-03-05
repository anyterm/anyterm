import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateKeyPair,
  encryptPrivateKey,
  deriveKeysFromPassword,
  toBase64,
} from "@anyterm/utils/crypto";
import { decryptPrivateKeyFromConfig } from "../shared/auth.js";

/**
 * Tests decryptPrivateKeyFromConfig — the function that decrypts the user's
 * private key using a cached masterKey.
 *
 * The password-prompt fallback path (readPassword) is TTY-dependent and
 * covered by e2e tests (07-cli-login-flow). Only the masterKey paths
 * are unit tested here.
 */

// Generate a real keypair for testing
const PASSWORD = "test-password-123";
const SALT = crypto.getRandomValues(new Uint8Array(16));
const { masterKey } = deriveKeysFromPassword(PASSWORD, SALT);
const { privateKey: originalPrivateKey } = generateKeyPair();
const encryptedPrivateKey = encryptPrivateKey(originalPrivateKey, masterKey);

describe("decryptPrivateKeyFromConfig", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decrypts with valid cached masterKey", async () => {
    const cfg = {
      masterKey: toBase64(masterKey),
      encryptedPrivateKey: toBase64(encryptedPrivateKey),
      keySalt: toBase64(SALT),
    };

    const result = await decryptPrivateKeyFromConfig(cfg);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32); // X25519 private key = 32 bytes
    expect(Buffer.from(result)).toEqual(Buffer.from(originalPrivateKey));
  });

  it("exits when cached masterKey is wrong", async () => {
    const wrongKey = new Uint8Array(32); // all zeros
    const cfg = {
      masterKey: toBase64(wrongKey),
      encryptedPrivateKey: toBase64(encryptedPrivateKey),
      keySalt: toBase64(SALT),
    };

    await expect(decryptPrivateKeyFromConfig(cfg)).rejects.toThrow("process.exit");
  });

  it("exits when encryptedPrivateKey is corrupted", async () => {
    const corrupted = new Uint8Array(64);
    crypto.getRandomValues(corrupted);
    const cfg = {
      masterKey: toBase64(masterKey),
      encryptedPrivateKey: toBase64(corrupted),
      keySalt: toBase64(SALT),
    };

    await expect(decryptPrivateKeyFromConfig(cfg)).rejects.toThrow("process.exit");
  });

  it("returns correct key bytes that match original", async () => {
    const cfg = {
      masterKey: toBase64(masterKey),
      encryptedPrivateKey: toBase64(encryptedPrivateKey),
      keySalt: toBase64(SALT),
    };

    const result = await decryptPrivateKeyFromConfig(cfg);

    // Verify byte-for-byte equality
    for (let i = 0; i < originalPrivateKey.length; i++) {
      expect(result[i]).toBe(originalPrivateKey[i]);
    }
  });
});
