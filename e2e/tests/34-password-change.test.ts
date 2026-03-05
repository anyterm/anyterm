import { describe, it, expect, beforeAll } from "vitest";
import { registerUser, loginUser, type RegisteredUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  deriveKeysFromPassword,
  encryptPrivateKey,
  decryptPrivateKey,
  generateSessionKey,
  encryptSessionKey,
  decryptSessionKey,
  toBase64,
  fromBase64,
} from "../helpers/crypto.js";

describe("34 — Password Change (updateUserKeys)", () => {
  let user: RegisteredUser;
  let api: ApiClient;
  let sessionId: string;
  let originalEncryptedSessionKey: string;

  beforeAll(async () => {
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    // Create a session to verify existing sessionKey remains decryptable
    const sessionKey = generateSessionKey();
    const esk = encryptSessionKey(sessionKey, user.publicKey);
    originalEncryptedSessionKey = toBase64(esk);

    const session = await api.createSession({
      name: "password-change-test",
      command: "echo test",
      encryptedSessionKey: originalEncryptedSessionKey,
    });
    expect(session.status).toBe(200);
    sessionId = (session.body.data as Record<string, string>).id;
  });

  it("updateUserKeys with valid currentPassword succeeds", async () => {
    const newPassword = "NewSecurePassword456!";
    const { masterKey: newMasterKey, salt: newSalt } =
      deriveKeysFromPassword(newPassword);

    // Re-encrypt the same private key with new master key
    const newEncryptedPrivateKey = encryptPrivateKey(
      user.privateKey,
      newMasterKey,
    );

    const res = await api.updateUserKeys({
      encryptedPrivateKey: toBase64(newEncryptedPrivateKey),
      keySalt: toBase64(newSalt),
      currentPassword: user.password,
    });
    expect(res.status).toBe(200);
  });

  it("old masterKey no longer decrypts new encryptedPrivateKey", async () => {
    const keys = await api.getKeys();
    expect(keys.status).toBe(200);
    const newEncPk = fromBase64(keys.body.data!.encryptedPrivateKey);

    // Old masterKey should fail
    expect(() => decryptPrivateKey(newEncPk, user.masterKey)).toThrow();
  });

  it("new password derives masterKey that decrypts it", async () => {
    const newPassword = "NewSecurePassword456!";
    const keys = await api.getKeys();
    const newSalt = fromBase64(keys.body.data!.keySalt);
    const { masterKey: newMasterKey } = deriveKeysFromPassword(
      newPassword,
      newSalt,
    );
    const newEncPk = fromBase64(keys.body.data!.encryptedPrivateKey);
    const pk = decryptPrivateKey(newEncPk, newMasterKey);
    expect(pk.length).toBe(32);
  });

  it("actual privateKey bytes unchanged (only wrapping changed)", async () => {
    const newPassword = "NewSecurePassword456!";
    const keys = await api.getKeys();
    const newSalt = fromBase64(keys.body.data!.keySalt);
    const { masterKey: newMasterKey } = deriveKeysFromPassword(
      newPassword,
      newSalt,
    );
    const newEncPk = fromBase64(keys.body.data!.encryptedPrivateKey);
    const pk = decryptPrivateKey(newEncPk, newMasterKey);
    expect(pk).toEqual(user.privateKey);
  });

  it("existing sessionKey still decryptable", async () => {
    // Private key is unchanged so existing sessionKeys still work
    const session = await api.getSession(sessionId);
    expect(session.status).toBe(200);
    const esk = fromBase64(
      (session.body.data as Record<string, string>).encryptedSessionKey,
    );
    const sk = decryptSessionKey(esk, user.publicKey, user.privateKey);
    expect(sk.length).toBe(32);
  });

  it("wrong currentPassword rejected", async () => {
    const res = await api.updateUserKeys({
      encryptedPrivateKey: toBase64(new Uint8Array(72)),
      keySalt: toBase64(new Uint8Array(16)),
      currentPassword: "WrongPassword999!",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid password");
  });

  it("oversized encryptedPrivateKey rejected", async () => {
    const res = await api.updateUserKeys({
      encryptedPrivateKey: "x".repeat(8193),
      keySalt: toBase64(new Uint8Array(16)),
      currentPassword: user.password,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("too large");
  });
});
