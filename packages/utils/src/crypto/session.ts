import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { blake2b } from "@noble/hashes/blake2.js";

export function generateSessionKey(): Uint8Array {
  return randomBytes(32);
}

export function encryptSessionKey(
  sessionKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  // Custom sealed box using X25519 + blake2b + XChaCha20-Poly1305
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(
    ephemeralPrivateKey,
    recipientPublicKey,
  );

  const encryptionKey = blake2b(sharedSecret, { dkLen: 32 });

  // Nonce derived from ephemeralPublicKey || recipientPublicKey
  const nonceInput = new Uint8Array(
    ephemeralPublicKey.length + recipientPublicKey.length,
  );
  nonceInput.set(ephemeralPublicKey, 0);
  nonceInput.set(recipientPublicKey, ephemeralPublicKey.length);
  const nonce = blake2b(nonceInput, { dkLen: 24 });

  const cipher = xchacha20poly1305(encryptionKey, nonce);
  const ciphertext = cipher.encrypt(sessionKey);

  // Pack: ephemeralPublicKey (32) + ciphertext (32 + 16 MAC = 48) = 80 bytes
  const packed = new Uint8Array(
    ephemeralPublicKey.length + ciphertext.length,
  );
  packed.set(ephemeralPublicKey, 0);
  packed.set(ciphertext, ephemeralPublicKey.length);
  return packed;
}

export function decryptSessionKey(
  packed: Uint8Array,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array {
  const ephemeralPublicKey = packed.slice(0, 32);
  const ciphertext = packed.slice(32);

  const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);
  const encryptionKey = blake2b(sharedSecret, { dkLen: 32 });

  // Nonce derived from ephemeralPublicKey || recipientPublicKey
  const nonceInput = new Uint8Array(
    ephemeralPublicKey.length + publicKey.length,
  );
  nonceInput.set(ephemeralPublicKey, 0);
  nonceInput.set(publicKey, ephemeralPublicKey.length);
  const nonce = blake2b(nonceInput, { dkLen: 24 });

  const cipher = xchacha20poly1305(encryptionKey, nonce);
  return cipher.decrypt(ciphertext);
}

export function encryptChunk(
  plaintext: Uint8Array,
  sessionKey: Uint8Array,
): Uint8Array {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(sessionKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  // Pack: nonce (24 bytes) + ciphertext
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return packed;
}

export function decryptChunk(
  packed: Uint8Array,
  sessionKey: Uint8Array,
): Uint8Array {
  const nonce = packed.slice(0, 24);
  const ciphertext = packed.slice(24);
  const cipher = xchacha20poly1305(sessionKey, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Seal arbitrary-length message for a recipient (X25519 sealed box).
 * Uses ephemeral keypair + ECDH → XChaCha20-Poly1305.
 * Only the holder of the recipientPrivateKey can decrypt.
 *
 * Output: ephemeralPublicKey(32) + nonce(24) + ciphertext(N + 16 MAC)
 */
export function sealMessage(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(
    ephemeralPrivateKey,
    recipientPublicKey,
  );
  const encryptionKey = blake2b(sharedSecret, { dkLen: 32 });
  const nonce = randomBytes(24);

  const cipher = xchacha20poly1305(encryptionKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  // Pack: ephemeralPublicKey(32) + nonce(24) + ciphertext
  const packed = new Uint8Array(32 + 24 + ciphertext.length);
  packed.set(ephemeralPublicKey, 0);
  packed.set(nonce, 32);
  packed.set(ciphertext, 56);
  return packed;
}

/**
 * Open a sealed message using recipient's keypair.
 */
export function openMessage(
  packed: Uint8Array,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array {
  const ephemeralPublicKey = packed.slice(0, 32);
  const nonce = packed.slice(32, 56);
  const ciphertext = packed.slice(56);

  const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);
  const encryptionKey = blake2b(sharedSecret, { dkLen: 32 });

  const cipher = xchacha20poly1305(encryptionKey, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Seal an org's private key for a specific member using their public key.
 */
export function sealOrgPrivateKey(
  orgPrivateKey: Uint8Array,
  memberPublicKey: Uint8Array,
): Uint8Array {
  return sealMessage(orgPrivateKey, memberPublicKey);
}

/**
 * Unseal an org's private key using the member's keypair.
 */
export function unsealOrgPrivateKey(
  sealed: Uint8Array,
  memberPublicKey: Uint8Array,
  memberPrivateKey: Uint8Array,
): Uint8Array {
  return openMessage(sealed, memberPublicKey, memberPrivateKey);
}
