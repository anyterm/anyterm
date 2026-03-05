import { describe, it, expect } from "vitest";
import {
  sealMessage,
  openMessage,
  sealOrgPrivateKey,
  unsealOrgPrivateKey,
  generateKeyPair,
} from "../crypto/index.js";

describe("sealMessage / openMessage", () => {
  it("round-trips plaintext", () => {
    const { publicKey, privateKey } = generateKeyPair();
    const plaintext = new TextEncoder().encode("hello world");
    const sealed = sealMessage(plaintext, publicKey);
    const opened = openMessage(sealed, publicKey, privateKey);
    expect(opened).toEqual(plaintext);
  });

  it("produces random ciphertext (different each time)", () => {
    const { publicKey } = generateKeyPair();
    const plaintext = new TextEncoder().encode("test");
    const a = sealMessage(plaintext, publicKey);
    const b = sealMessage(plaintext, publicKey);
    expect(a).not.toEqual(b);
  });

  it("fails with wrong private key", () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const plaintext = new TextEncoder().encode("secret");
    const sealed = sealMessage(plaintext, alice.publicKey);
    expect(() =>
      openMessage(sealed, bob.publicKey, bob.privateKey),
    ).toThrow();
  });

  it("handles empty plaintext", () => {
    const { publicKey, privateKey } = generateKeyPair();
    const plaintext = new Uint8Array(0);
    const sealed = sealMessage(plaintext, publicKey);
    const opened = openMessage(sealed, publicKey, privateKey);
    expect(opened).toEqual(plaintext);
  });

  it("handles large plaintext (64KB)", () => {
    const { publicKey, privateKey } = generateKeyPair();
    const plaintext = new Uint8Array(65536);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = i & 0xff;
    const sealed = sealMessage(plaintext, publicKey);
    const opened = openMessage(sealed, publicKey, privateKey);
    expect(opened).toEqual(plaintext);
  });
});

describe("sealOrgPrivateKey / unsealOrgPrivateKey", () => {
  it("round-trips a 32-byte key", () => {
    const orgKeypair = generateKeyPair();
    const member = generateKeyPair();
    const sealed = sealOrgPrivateKey(orgKeypair.privateKey, member.publicKey);
    const opened = unsealOrgPrivateKey(sealed, member.publicKey, member.privateKey);
    expect(opened).toEqual(orgKeypair.privateKey);
  });

  it("fails with wrong member key", () => {
    const orgKeypair = generateKeyPair();
    const member = generateKeyPair();
    const wrongMember = generateKeyPair();
    const sealed = sealOrgPrivateKey(orgKeypair.privateKey, member.publicKey);
    expect(() =>
      unsealOrgPrivateKey(sealed, wrongMember.publicKey, wrongMember.privateKey),
    ).toThrow();
  });
});
