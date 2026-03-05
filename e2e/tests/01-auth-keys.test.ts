import { describe, it, expect } from "vitest";
import { registerUser, loginUser } from "../helpers/auth.js";
import { ApiClient } from "../helpers/api-client.js";
import {
  deriveKeysFromPassword,
  decryptPrivateKey,
  fromBase64,
  toBase64,
} from "../helpers/crypto.js";

describe("Auth & Keys", () => {
  it("registers a user and stores encryption keys", async () => {
    const user = await registerUser();
    const api = new ApiClient(user.cookieToken);

    const { status, body } = await api.getKeys();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.publicKey).toBe(toBase64(user.publicKey));
    expect(body.data!.encryptedPrivateKey).toBeTruthy();
    expect(body.data!.keySalt).toBeTruthy();
  });

  it("logs in and returns a valid token and userId", async () => {
    const user = await registerUser();
    const loggedIn = await loginUser(user.email, user.password);

    expect(loggedIn.token).toBeTruthy();
    expect(loggedIn.userId).toBe(user.userId);
  });

  it("derives masterKey from password + salt and decrypts privateKey", async () => {
    const user = await registerUser();
    const api = new ApiClient(user.cookieToken);

    const { body } = await api.getKeys();
    const keySalt = fromBase64(body.data!.keySalt);
    const encryptedPk = fromBase64(body.data!.encryptedPrivateKey);

    // Re-derive master key from password + stored salt
    const { masterKey } = await deriveKeysFromPassword(user.password, keySalt);
    const decryptedPk = await decryptPrivateKey(encryptedPk, masterKey);

    expect(toBase64(decryptedPk)).toBe(toBase64(user.privateKey));
  });

  it("throws when decrypting privateKey with wrong password", async () => {
    const user = await registerUser();
    const api = new ApiClient(user.cookieToken);

    const { body } = await api.getKeys();
    const keySalt = fromBase64(body.data!.keySalt);
    const encryptedPk = fromBase64(body.data!.encryptedPrivateKey);

    // Derive with wrong password
    const { masterKey: wrongKey } = await deriveKeysFromPassword(
      "WrongPassword999!",
      keySalt,
    );

    expect(() => decryptPrivateKey(encryptedPk, wrongKey)).toThrow();
  });
});
