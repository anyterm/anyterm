export function toBase64(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function fromBase64(b64: string): Uint8Array {
  if (typeof b64 !== "string") {
    throw new Error("Invalid base64: non-string input");
  }
  if (b64.length === 0) {
    return new Uint8Array(0);
  }
  if (!BASE64_RE.test(b64)) {
    throw new Error("Invalid base64: contains illegal characters");
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
