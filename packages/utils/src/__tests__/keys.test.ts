import { describe, it, expect } from "vitest";
import {
  deriveKeysFromPassword,
  generateKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
} from "../crypto/keys.js";

describe("deriveKeysFromPassword", () => {
  it("returns masterKey and salt", async () => {
    const { masterKey, salt } = await deriveKeysFromPassword("test-password");
    expect(masterKey).toBeInstanceOf(Uint8Array);
    expect(masterKey.length).toBe(32);
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(16); // crypto_pwhash_SALTBYTES
  });

  it("produces same masterKey with same password and salt", async () => {
    const { masterKey: mk1, salt } =
      await deriveKeysFromPassword("my-password");
    const { masterKey: mk2 } = await deriveKeysFromPassword(
      "my-password",
      salt,
    );
    expect(mk1).toEqual(mk2);
  });

  it("produces different masterKey with different password", { timeout: 15_000 }, async () => {
    const { salt } = await deriveKeysFromPassword("password-a");
    const { masterKey: mk1 } = await deriveKeysFromPassword(
      "password-a",
      salt,
    );
    const { masterKey: mk2 } = await deriveKeysFromPassword(
      "password-b",
      salt,
    );
    expect(mk1).not.toEqual(mk2);
  });

  it("produces different salt each time without explicit salt", async () => {
    const { salt: s1 } = await deriveKeysFromPassword("pw");
    const { salt: s2 } = await deriveKeysFromPassword("pw");
    expect(s1).not.toEqual(s2);
  });
});

describe("generateKeyPair", () => {
  it("returns publicKey and privateKey", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(32);
    expect(privateKey.length).toBe(32);
  });

  it("generates different keypairs each time", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    expect(kp1.publicKey).not.toEqual(kp2.publicKey);
    expect(kp1.privateKey).not.toEqual(kp2.privateKey);
  });
});

describe("encryptPrivateKey / decryptPrivateKey", () => {
  it("round-trips a private key", async () => {
    const { privateKey } = await generateKeyPair();
    const { masterKey } = await deriveKeysFromPassword("test-pw");

    const encrypted = await encryptPrivateKey(privateKey, masterKey);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    // encrypted = nonce(24) + ciphertext(32 + MAC16) = 72 bytes
    expect(encrypted.length).toBe(24 + 32 + 16);

    const decrypted = await decryptPrivateKey(encrypted, masterKey);
    expect(decrypted).toEqual(privateKey);
  });

  it("fails to decrypt with wrong masterKey", async () => {
    const { privateKey } = await generateKeyPair();
    const { masterKey: mk1 } = await deriveKeysFromPassword("correct");
    const { masterKey: mk2 } = await deriveKeysFromPassword("wrong");

    const encrypted = await encryptPrivateKey(privateKey, mk1);

    expect(() => decryptPrivateKey(encrypted, mk2)).toThrow();
  });
});
