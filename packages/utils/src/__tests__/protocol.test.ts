import { describe, it, expect } from "vitest";
import {
  encodeFrame,
  decodeFrame,
  FrameType,
  createSubscribeFrame,
  createUnsubscribeFrame,
  createEncryptedChunkFrame,
  createEncryptedInputFrame,
  createHttpRequestFrame,
  createHttpResponseFrame,
  createResizeFrame,
  parseResizePayload,
  createEventFrame,
  createPingFrame,
  createPongFrame,
} from "../protocol/index.js";
import { FRAME_VERSION } from "../types/constants.js";

describe("encodeFrame / decodeFrame", () => {
  it("round-trips a frame with payload", () => {
    const frame = {
      version: FRAME_VERSION,
      type: FrameType.ENCRYPTED_CHUNK,
      sessionId: "test-session-123",
      payload: new Uint8Array([1, 2, 3, 4, 5]),
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded.version).toBe(frame.version);
    expect(decoded.type).toBe(frame.type);
    expect(decoded.sessionId).toBe(frame.sessionId);
    expect(decoded.payload).toEqual(frame.payload);
  });

  it("round-trips a frame with empty payload", () => {
    const frame = {
      version: FRAME_VERSION,
      type: FrameType.SUBSCRIBE,
      sessionId: "abc",
      payload: new Uint8Array(0),
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded.sessionId).toBe("abc");
    expect(decoded.payload.length).toBe(0);
  });

  it("round-trips a frame with empty sessionId", () => {
    const frame = {
      version: FRAME_VERSION,
      type: FrameType.PING,
      sessionId: "",
      payload: new Uint8Array(0),
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded.sessionId).toBe("");
    expect(decoded.type).toBe(FrameType.PING);
  });

  it("rejects non-alphanumeric sessionId", () => {
    const frame = {
      version: FRAME_VERSION,
      type: FrameType.EVENT,
      sessionId: "session-日本語",
      payload: new TextEncoder().encode("event data"),
    };

    const encoded = encodeFrame(frame);
    expect(() => decodeFrame(encoded)).toThrow("Invalid sessionId");
  });

  it("rejects sessionId with Redis injection characters", () => {
    const frame = {
      version: FRAME_VERSION,
      type: FrameType.SUBSCRIBE,
      sessionId: "abc:output\nmalicious",
      payload: new Uint8Array(0),
    };

    const encoded = encodeFrame(frame);
    expect(() => decodeFrame(encoded)).toThrow("Invalid sessionId");
  });

  it("allows valid nanoid sessionId", () => {
    const frame = {
      version: FRAME_VERSION,
      type: FrameType.SUBSCRIBE,
      sessionId: "aBcD_1234-Zz",
      payload: new Uint8Array(0),
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded.sessionId).toBe("aBcD_1234-Zz");
  });

  it("round-trips large payload", () => {
    const payload = new Uint8Array(65536);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;

    const frame = {
      version: FRAME_VERSION,
      type: FrameType.ENCRYPTED_CHUNK,
      sessionId: "big-session",
      payload,
    };

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    expect(decoded.payload).toEqual(payload);
  });

  it("starts with magic bytes VC", () => {
    const encoded = encodeFrame({
      version: FRAME_VERSION,
      type: FrameType.PING,
      sessionId: "",
      payload: new Uint8Array(0),
    });

    expect(encoded[0]).toBe(0x56); // 'V'
    expect(encoded[1]).toBe(0x43); // 'C'
  });

  it("rejects invalid magic bytes", () => {
    const encoded = encodeFrame({
      version: FRAME_VERSION,
      type: FrameType.PING,
      sessionId: "",
      payload: new Uint8Array(0),
    });

    // Corrupt magic
    encoded[0] = 0x00;

    expect(() => decodeFrame(encoded)).toThrow("Invalid frame magic");
  });
});

describe("createSubscribeFrame", () => {
  it("creates valid subscribe frame", () => {
    const encoded = createSubscribeFrame("session-1");
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.SUBSCRIBE);
    expect(decoded.sessionId).toBe("session-1");
    expect(decoded.payload.length).toBe(0);
  });
});

describe("createUnsubscribeFrame", () => {
  it("creates valid unsubscribe frame", () => {
    const encoded = createUnsubscribeFrame("session-1");
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.UNSUBSCRIBE);
    expect(decoded.sessionId).toBe("session-1");
  });
});

describe("createEncryptedChunkFrame", () => {
  it("creates frame with encrypted payload", () => {
    const payload = new Uint8Array([10, 20, 30, 40]);
    const encoded = createEncryptedChunkFrame("s1", payload);
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.ENCRYPTED_CHUNK);
    expect(decoded.sessionId).toBe("s1");
    expect(decoded.payload).toEqual(payload);
  });
});

describe("createEncryptedInputFrame", () => {
  it("creates frame with encrypted input", () => {
    const payload = new Uint8Array([65, 66, 67]); // "ABC"
    const encoded = createEncryptedInputFrame("s2", payload);
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.ENCRYPTED_INPUT);
    expect(decoded.sessionId).toBe("s2");
    expect(decoded.payload).toEqual(payload);
  });
});

describe("createResizeFrame / parseResizePayload", () => {
  it("round-trips resize dimensions", () => {
    const encoded = createResizeFrame("s1", 120, 40);
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.RESIZE);
    expect(decoded.sessionId).toBe("s1");

    const { cols, rows } = parseResizePayload(decoded.payload);
    expect(cols).toBe(120);
    expect(rows).toBe(40);
  });

  it("clamps oversized dimensions to max bounds", () => {
    const encoded = createResizeFrame("s1", 65535, 65535);
    const decoded = decodeFrame(encoded);
    const { cols, rows } = parseResizePayload(decoded.payload);
    expect(cols).toBe(1000);
    expect(rows).toBe(500);
  });

  it("clamps zero dimensions to minimum 1", () => {
    const encoded = createResizeFrame("s1", 0, 0);
    const decoded = decodeFrame(encoded);
    const { cols, rows } = parseResizePayload(decoded.payload);
    expect(cols).toBe(1);
    expect(rows).toBe(1);
  });

  it("rejects truncated RESIZE payload", () => {
    expect(() => parseResizePayload(new Uint8Array(4))).toThrow("RESIZE payload too short");
  });
});

describe("createEventFrame", () => {
  it("creates frame with event string", () => {
    const encoded = createEventFrame("s1", "session_ended");
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.EVENT);
    expect(decoded.sessionId).toBe("s1");
    expect(new TextDecoder().decode(decoded.payload)).toBe("session_ended");
  });
});

describe("createPingFrame / createPongFrame", () => {
  it("creates ping frame", () => {
    const encoded = createPingFrame();
    const decoded = decodeFrame(encoded);
    expect(decoded.type).toBe(FrameType.PING);
  });

  it("creates pong frame", () => {
    const encoded = createPongFrame();
    const decoded = decodeFrame(encoded);
    expect(decoded.type).toBe(FrameType.PONG);
  });
});

describe("createHttpRequestFrame", () => {
  it("creates frame with JSON payload", () => {
    const request = {
      reqId: "req-abc123",
      port: 3000,
      method: "GET",
      path: "/api/health",
      headers: { accept: "application/json" },
    };
    const payload = new TextEncoder().encode(JSON.stringify(request));
    const encoded = createHttpRequestFrame("session-1", payload);
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.HTTP_REQUEST);
    expect(decoded.sessionId).toBe("session-1");

    const parsed = JSON.parse(new TextDecoder().decode(decoded.payload));
    expect(parsed.reqId).toBe("req-abc123");
    expect(parsed.port).toBe(3000);
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/api/health");
  });

  it("round-trips POST request with body", () => {
    const body = Buffer.from("Hello World").toString("base64");
    const request = {
      reqId: "req-xyz",
      port: 8080,
      method: "POST",
      path: "/submit",
      headers: { "content-type": "text/plain" },
      body,
    };
    const payload = new TextEncoder().encode(JSON.stringify(request));
    const encoded = createHttpRequestFrame("s2", payload);
    const decoded = decodeFrame(encoded);

    const parsed = JSON.parse(new TextDecoder().decode(decoded.payload));
    expect(parsed.method).toBe("POST");
    expect(parsed.body).toBe(body);
    expect(Buffer.from(parsed.body, "base64").toString()).toBe("Hello World");
  });

  it("handles large payload up to 2MB", () => {
    const largeBody = Buffer.alloc(1024 * 1024).toString("base64"); // ~1.33MB base64
    const request = {
      reqId: "req-large",
      port: 3000,
      method: "POST",
      path: "/upload",
      headers: {},
      body: largeBody,
    };
    const payload = new TextEncoder().encode(JSON.stringify(request));
    const encoded = createHttpRequestFrame("s3", payload);
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.HTTP_REQUEST);
    const parsed = JSON.parse(new TextDecoder().decode(decoded.payload));
    expect(parsed.body).toBe(largeBody);
  });
});

describe("createHttpResponseFrame", () => {
  it("creates frame with JSON response payload", () => {
    const response = {
      reqId: "req-abc123",
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<h1>Hello</h1>").toString("base64"),
    };
    const payload = new TextEncoder().encode(JSON.stringify(response));
    const encoded = createHttpResponseFrame("session-1", payload);
    const decoded = decodeFrame(encoded);

    expect(decoded.type).toBe(FrameType.HTTP_RESPONSE);
    expect(decoded.sessionId).toBe("session-1");

    const parsed = JSON.parse(new TextDecoder().decode(decoded.payload));
    expect(parsed.reqId).toBe("req-abc123");
    expect(parsed.status).toBe(200);
    expect(Buffer.from(parsed.body, "base64").toString()).toBe("<h1>Hello</h1>");
  });

  it("round-trips error response", () => {
    const response = {
      reqId: "req-err",
      status: 502,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("Bad Gateway").toString("base64"),
    };
    const payload = new TextEncoder().encode(JSON.stringify(response));
    const encoded = createHttpResponseFrame("s1", payload);
    const decoded = decodeFrame(encoded);

    const parsed = JSON.parse(new TextDecoder().decode(decoded.payload));
    expect(parsed.status).toBe(502);
  });

  it("handles response without body", () => {
    const response = {
      reqId: "req-nobody",
      status: 204,
      headers: {},
    };
    const payload = new TextEncoder().encode(JSON.stringify(response));
    const encoded = createHttpResponseFrame("s1", payload);
    const decoded = decodeFrame(encoded);

    const parsed = JSON.parse(new TextDecoder().decode(decoded.payload));
    expect(parsed.status).toBe(204);
    expect(parsed.body).toBeUndefined();
  });
});
