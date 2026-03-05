import { describe, it, expect } from "vitest";
import {
  generateSessionKey,
  encryptSessionKey,
  decryptSessionKey,
  encryptChunk,
  decryptChunk,
} from "../crypto/session.js";
import { generateKeyPair } from "../crypto/keys.js";

describe("generateSessionKey", () => {
  it("returns a 32-byte key", async () => {
    const key = await generateSessionKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("generates unique keys", async () => {
    const k1 = await generateSessionKey();
    const k2 = await generateSessionKey();
    expect(k1).not.toEqual(k2);
  });
});

describe("encryptSessionKey / decryptSessionKey", () => {
  it("round-trips a session key via sealed box", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const sessionKey = await generateSessionKey();

    const encrypted = await encryptSessionKey(sessionKey, publicKey);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    // sealed box: ciphertext = 32 (pk) + 32 (key) + 16 (MAC) = 80 bytes
    expect(encrypted.length).toBe(48 + 32);

    const decrypted = await decryptSessionKey(encrypted, publicKey, privateKey);
    expect(decrypted).toEqual(sessionKey);
  });

  it("fails with wrong keypair", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const sessionKey = await generateSessionKey();

    const encrypted = await encryptSessionKey(sessionKey, kp1.publicKey);

    expect(() =>
      decryptSessionKey(encrypted, kp2.publicKey, kp2.privateKey),
    ).toThrow();
  });
});

describe("encryptChunk / decryptChunk", () => {
  it("round-trips terminal data", async () => {
    const sessionKey = await generateSessionKey();
    const plaintext = new TextEncoder().encode(
      "\x1b[32mhello\x1b[0m world\r\n",
    );

    const packed = await encryptChunk(plaintext, sessionKey);
    expect(packed).toBeInstanceOf(Uint8Array);
    // packed = nonce(24) + ciphertext(plaintext.length + 16 MAC)
    expect(packed.length).toBe(24 + plaintext.length + 16);

    const decrypted = await decryptChunk(packed, sessionKey);
    expect(decrypted).toEqual(plaintext);
  });

  it("fails with wrong session key", async () => {
    const sk1 = await generateSessionKey();
    const sk2 = await generateSessionKey();
    const plaintext = new TextEncoder().encode("secret");

    const packed = await encryptChunk(plaintext, sk1);

    expect(() => decryptChunk(packed, sk2)).toThrow();
  });

  it("handles empty data", async () => {
    const sessionKey = await generateSessionKey();
    const plaintext = new Uint8Array(0);

    const packed = await encryptChunk(plaintext, sessionKey);
    const decrypted = await decryptChunk(packed, sessionKey);
    expect(decrypted).toEqual(plaintext);
  });

  it("handles large chunks", async () => {
    const sessionKey = await generateSessionKey();
    const plaintext = new Uint8Array(64 * 1024); // 64KB
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = i % 256;

    const packed = await encryptChunk(plaintext, sessionKey);
    const decrypted = await decryptChunk(packed, sessionKey);
    expect(decrypted).toEqual(plaintext);
  });

  it("produces different ciphertext for same plaintext (random nonce)", async () => {
    const sessionKey = await generateSessionKey();
    const plaintext = new TextEncoder().encode("same data");

    const packed1 = await encryptChunk(plaintext, sessionKey);
    const packed2 = await encryptChunk(plaintext, sessionKey);

    // Nonces should differ, so packed bytes should differ
    expect(packed1).not.toEqual(packed2);

    // But both decrypt to the same plaintext
    const d1 = await decryptChunk(packed1, sessionKey);
    const d2 = await decryptChunk(packed2, sessionKey);
    expect(d1).toEqual(d2);
  });
});
