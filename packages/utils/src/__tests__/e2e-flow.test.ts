import { describe, it, expect } from "vitest";
import {
  deriveKeysFromPassword,
  generateKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  generateSessionKey,
  encryptSessionKey,
  decryptSessionKey,
  encryptChunk,
  decryptChunk,
  toBase64,
  fromBase64,
} from "../crypto/index.js";

describe("full E2E encryption flow", () => {
  it("simulates complete registration → session → encrypt → decrypt", async () => {
    // === REGISTRATION (client-side) ===
    const password = "user-strong-password-123";

    // Derive masterKey from password
    const { masterKey, salt } = await deriveKeysFromPassword(password);

    // Generate asymmetric keypair
    const { publicKey, privateKey } = await generateKeyPair();

    // Encrypt privateKey with masterKey for server storage
    const encryptedPrivateKey = await encryptPrivateKey(privateKey, masterKey);

    // Simulate storing on server (as base64)
    const serverStored = {
      publicKey: toBase64(publicKey),
      encryptedPrivateKey: toBase64(encryptedPrivateKey),
      keySalt: toBase64(salt),
    };

    // === CLI: CREATE SESSION ===
    const sessionKey = await generateSessionKey();

    // Seal session key with user's public key
    const pubKeyBytes = fromBase64(serverStored.publicKey);
    const encryptedSessionKey = await encryptSessionKey(
      sessionKey,
      pubKeyBytes,
    );
    const encryptedSessionKeyB64 = toBase64(encryptedSessionKey);

    // === CLI: STREAM TERMINAL OUTPUT ===
    const terminalOutputs = [
      "\x1b[32m$ \x1b[0mclaude\r\n",
      "╭──────────────────────────╮\r\n",
      "│ Welcome to Claude Code!  │\r\n",
      "╰──────────────────────────╯\r\n",
      "\x1b[36mReading files...\x1b[0m\r\n",
    ];

    const encryptedChunks: string[] = [];
    for (const output of terminalOutputs) {
      const plaintext = new TextEncoder().encode(output);
      const packed = await encryptChunk(plaintext, sessionKey);
      encryptedChunks.push(toBase64(packed));
    }

    // === BROWSER: LOGIN AND DECRYPT ===
    // Re-derive masterKey from password
    const saltBytes = fromBase64(serverStored.keySalt);
    const { masterKey: browserMasterKey } = await deriveKeysFromPassword(
      password,
      saltBytes,
    );

    // Decrypt privateKey
    const encPkBytes = fromBase64(serverStored.encryptedPrivateKey);
    const browserPrivateKey = await decryptPrivateKey(
      encPkBytes,
      browserMasterKey,
    );
    expect(browserPrivateKey).toEqual(privateKey);

    // Decrypt session key
    const encSkBytes = fromBase64(encryptedSessionKeyB64);
    const browserPubKey = fromBase64(serverStored.publicKey);
    const browserSessionKey = await decryptSessionKey(
      encSkBytes,
      browserPubKey,
      browserPrivateKey,
    );
    expect(browserSessionKey).toEqual(sessionKey);

    // Decrypt all chunks
    const decryptedOutputs: string[] = [];
    for (const chunkB64 of encryptedChunks) {
      const packed = fromBase64(chunkB64);
      const plaintext = await decryptChunk(packed, browserSessionKey);
      decryptedOutputs.push(new TextDecoder().decode(plaintext));
    }

    expect(decryptedOutputs).toEqual(terminalOutputs);
  });

  it("simulates bidirectional: browser input → CLI decrypt", async () => {
    const sessionKey = await generateSessionKey();

    // Browser encrypts user keystrokes
    const keystrokes = "ls -la\r";
    const plaintext = new TextEncoder().encode(keystrokes);
    const packed = await encryptChunk(plaintext, sessionKey);

    // CLI decrypts
    const decrypted = await decryptChunk(packed, sessionKey);
    const text = new TextDecoder().decode(decrypted);
    expect(text).toBe(keystrokes);
  });

  it("wrong password fails at privateKey decryption step", async () => {
    const { masterKey, salt } = await deriveKeysFromPassword("correct-pw");
    const { privateKey } = await generateKeyPair();
    const encrypted = await encryptPrivateKey(privateKey, masterKey);

    // Attacker tries with wrong password
    const { masterKey: wrongKey } = await deriveKeysFromPassword(
      "wrong-pw",
      salt,
    );

    expect(() => decryptPrivateKey(encrypted, wrongKey)).toThrow();
  });

  it("server cannot decrypt chunks (no session key)", async () => {
    const sessionKey = await generateSessionKey();
    const fakeKey = await generateSessionKey(); // server doesn't have real key

    const plaintext = new TextEncoder().encode("secret terminal data");
    const packed = await encryptChunk(plaintext, sessionKey);

    expect(() => decryptChunk(packed, fakeKey)).toThrow();
  });
});
