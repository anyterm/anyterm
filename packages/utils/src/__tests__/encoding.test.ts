import { describe, it, expect } from "vitest";
import { toBase64, fromBase64 } from "../crypto/encoding.js";

describe("encoding", () => {
  it("round-trips binary data through base64", () => {
    const data = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const b64 = toBase64(data);
    const result = fromBase64(b64);
    expect(result).toEqual(data);
  });

  it("handles empty data", () => {
    const data = new Uint8Array(0);
    const b64 = toBase64(data);
    const result = fromBase64(b64);
    expect(result).toEqual(data);
  });

  it("handles large data", () => {
    const data = new Uint8Array(10000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const b64 = toBase64(data);
    const result = fromBase64(b64);
    expect(result).toEqual(data);
  });

  it("produces valid base64 string", () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = toBase64(data);
    expect(b64).toBe("SGVsbG8=");
  });
});
