import { describe, it, expect } from "vitest";
import {
  REDIS_CHANNEL_HTTP_REQUEST,
  MAX_HTTP_TUNNEL_PAYLOAD,
} from "../types/constants.js";
import type { HttpTunnelRequest, HttpTunnelResponse } from "../types/index.js";
import {
  FrameType,
  createHttpRequestFrame,
  createHttpResponseFrame,
  decodeFrame,
} from "../protocol/index.js";

describe("HTTP Tunnel Constants", () => {
  it("REDIS_CHANNEL_HTTP_REQUEST formats correctly", () => {
    expect(REDIS_CHANNEL_HTTP_REQUEST("abc123")).toBe("session:abc123:http_request");
    expect(REDIS_CHANNEL_HTTP_REQUEST("session-with-dashes")).toBe(
      "session:session-with-dashes:http_request",
    );
  });

  it("MAX_HTTP_TUNNEL_PAYLOAD is 2MB", () => {
    expect(MAX_HTTP_TUNNEL_PAYLOAD).toBe(2 * 1024 * 1024);
    expect(MAX_HTTP_TUNNEL_PAYLOAD).toBe(2097152);
  });
});

describe("HttpTunnelRequest type shape", () => {
  it("constructs a valid GET request", () => {
    const req: HttpTunnelRequest = {
      reqId: "req-001",
      port: 3000,
      method: "GET",
      path: "/",
      headers: { accept: "text/html" },
    };

    expect(req.reqId).toBe("req-001");
    expect(req.port).toBe(3000);
    expect(req.method).toBe("GET");
    expect(req.body).toBeUndefined();
  });

  it("constructs a valid POST request with body", () => {
    const req: HttpTunnelRequest = {
      reqId: "req-002",
      port: 8080,
      method: "POST",
      path: "/api/data",
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"key":"value"}').toString("base64"),
    };

    expect(req.body).toBeTruthy();
    expect(Buffer.from(req.body!, "base64").toString()).toBe('{"key":"value"}');
  });

  it("serializes and deserializes via JSON round-trip", () => {
    const req: HttpTunnelRequest = {
      reqId: "req-003",
      port: 3000,
      method: "PUT",
      path: "/resource/1",
      headers: { authorization: "Bearer token123" },
      body: Buffer.from("updated content").toString("base64"),
    };

    const json = JSON.stringify(req);
    const parsed: HttpTunnelRequest = JSON.parse(json);

    expect(parsed.reqId).toBe(req.reqId);
    expect(parsed.port).toBe(req.port);
    expect(parsed.method).toBe(req.method);
    expect(parsed.path).toBe(req.path);
    expect(parsed.headers).toEqual(req.headers);
    expect(parsed.body).toBe(req.body);
  });
});

describe("HttpTunnelResponse type shape", () => {
  it("constructs a 200 response with body", () => {
    const res: HttpTunnelResponse = {
      reqId: "req-001",
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<h1>OK</h1>").toString("base64"),
    };

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body!, "base64").toString()).toBe("<h1>OK</h1>");
  });

  it("constructs a 204 response without body", () => {
    const res: HttpTunnelResponse = {
      reqId: "req-002",
      status: 204,
      headers: {},
    };

    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("constructs a 502 error response", () => {
    const res: HttpTunnelResponse = {
      reqId: "req-003",
      status: 502,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("Bad Gateway — connection refused").toString("base64"),
    };

    expect(res.status).toBe(502);
  });

  it("serializes and deserializes via JSON round-trip", () => {
    const res: HttpTunnelResponse = {
      reqId: "req-004",
      status: 301,
      headers: { location: "/new-path" },
    };

    const json = JSON.stringify(res);
    const parsed: HttpTunnelResponse = JSON.parse(json);

    expect(parsed).toEqual(res);
  });
});

describe("HTTP tunnel JSON payload encoding", () => {
  it("request payload fits within MAX_HTTP_TUNNEL_PAYLOAD for typical requests", () => {
    const req: HttpTunnelRequest = {
      reqId: "req-typical",
      port: 3000,
      method: "GET",
      path: "/api/users?page=1&limit=50",
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US,en;q=0.9",
        cookie: "session=abc123",
      },
    };

    const encoded = new TextEncoder().encode(JSON.stringify(req));
    expect(encoded.byteLength).toBeLessThan(MAX_HTTP_TUNNEL_PAYLOAD);
  });

  it("reqId is preserved across request-response correlation", () => {
    const reqId = "corr-12345-abcde";

    const req: HttpTunnelRequest = {
      reqId,
      port: 3000,
      method: "GET",
      path: "/",
      headers: {},
    };

    const res: HttpTunnelResponse = {
      reqId,
      status: 200,
      headers: {},
      body: Buffer.from("ok").toString("base64"),
    };

    expect(req.reqId).toBe(res.reqId);
  });
});

describe("HTTP tunnel frame encode/decode", () => {
  it("createHttpRequestFrame encodes and decodes correctly", () => {
    const sessionId = "sess-abc123";
    const request: HttpTunnelRequest = {
      reqId: "req-frame-001",
      port: 3000,
      method: "GET",
      path: "/api/test",
      headers: { accept: "application/json" },
    };
    const payload = new TextEncoder().encode(JSON.stringify(request));
    const frame = createHttpRequestFrame(sessionId, payload);

    const decoded = decodeFrame(frame);
    expect(decoded.type).toBe(FrameType.HTTP_REQUEST);
    expect(decoded.sessionId).toBe(sessionId);

    const parsedReq: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(decoded.payload),
    );
    expect(parsedReq.reqId).toBe("req-frame-001");
    expect(parsedReq.port).toBe(3000);
    expect(parsedReq.method).toBe("GET");
    expect(parsedReq.path).toBe("/api/test");
    expect(parsedReq.headers).toEqual({ accept: "application/json" });
    expect(parsedReq.body).toBeUndefined();
  });

  it("createHttpResponseFrame encodes and decodes correctly", () => {
    const sessionId = "sess-xyz789";
    const response: HttpTunnelResponse = {
      reqId: "req-frame-002",
      status: 201,
      headers: { "content-type": "application/json", "x-custom": "value" },
      body: Buffer.from('{"id":42}').toString("base64"),
    };
    const payload = new TextEncoder().encode(JSON.stringify(response));
    const frame = createHttpResponseFrame(sessionId, payload);

    const decoded = decodeFrame(frame);
    expect(decoded.type).toBe(FrameType.HTTP_RESPONSE);
    expect(decoded.sessionId).toBe(sessionId);

    const parsedRes: HttpTunnelResponse = JSON.parse(
      new TextDecoder().decode(decoded.payload),
    );
    expect(parsedRes.reqId).toBe("req-frame-002");
    expect(parsedRes.status).toBe(201);
    expect(parsedRes.headers["x-custom"]).toBe("value");
    expect(Buffer.from(parsedRes.body!, "base64").toString()).toBe('{"id":42}');
  });

  it("frame type values are correct", () => {
    expect(FrameType.HTTP_REQUEST).toBe(0x0b);
    expect(FrameType.HTTP_RESPONSE).toBe(0x0c);
  });

  it("round-trips a request with body through frame encoding", () => {
    const sessionId = "sess-body";
    const request: HttpTunnelRequest = {
      reqId: "req-body-001",
      port: 8080,
      method: "POST",
      path: "/submit",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("binary\x00data\xff").toString("base64"),
    };

    const payload = new TextEncoder().encode(JSON.stringify(request));
    const frame = createHttpRequestFrame(sessionId, payload);
    const decoded = decodeFrame(frame);
    const parsed: HttpTunnelRequest = JSON.parse(
      new TextDecoder().decode(decoded.payload),
    );

    expect(Buffer.from(parsed.body!, "base64")).toEqual(
      Buffer.from("binary\x00data\xff"),
    );
  });

  it("round-trips a response without body through frame encoding", () => {
    const sessionId = "sess-nobody";
    const response: HttpTunnelResponse = {
      reqId: "req-nobody",
      status: 204,
      headers: {},
    };

    const payload = new TextEncoder().encode(JSON.stringify(response));
    const frame = createHttpResponseFrame(sessionId, payload);
    const decoded = decodeFrame(frame);
    const parsed: HttpTunnelResponse = JSON.parse(
      new TextDecoder().decode(decoded.payload),
    );

    expect(parsed.status).toBe(204);
    expect(parsed.body).toBeUndefined();
  });
});
