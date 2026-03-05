import { argon2id } from "@noble/hashes/argon2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";

export function deriveKeysFromPassword(
  password: string,
  salt?: Uint8Array,
): { masterKey: Uint8Array; salt: Uint8Array } {
  const keySalt = salt ?? randomBytes(16);

  const masterKey = argon2id(new TextEncoder().encode(password), keySalt, {
    t: 3,
    m: 65536,
    p: 1,
    dkLen: 32,
  });

  return { masterKey, salt: keySalt };
}

export function generateKeyPair(): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

export function encryptPrivateKey(
  privateKey: Uint8Array,
  masterKey: Uint8Array,
): Uint8Array {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(masterKey, nonce);
  const ciphertext = cipher.encrypt(privateKey);
  // Pack: nonce (24 bytes) + ciphertext (32 + 16 MAC = 48)
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return packed;
}

export function decryptPrivateKey(
  packed: Uint8Array,
  masterKey: Uint8Array,
): Uint8Array {
  const nonce = packed.slice(0, 24);
  const ciphertext = packed.slice(24);
  const cipher = xchacha20poly1305(masterKey, nonce);
  return cipher.decrypt(ciphertext);
}
