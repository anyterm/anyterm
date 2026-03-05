import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import type { HttpTunnelRequest } from "@anyterm/utils/types";
import { proxyLocalHttp } from "../shared/http-proxy.js";

let server: http.Server;
let serverPort: number;

function makeReq(overrides: Partial<HttpTunnelRequest> = {}): HttpTunnelRequest {
  return {
    reqId: `test-${Date.now()}`,
    port: serverPort,
    method: "GET",
    path: "/",
    headers: {},
    ...overrides,
  };
}

describe("proxyLocalHttp", () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      // Route-based response handling
      if (req.url === "/200") {
        res.writeHead(200, { "content-type": "text/plain", "x-custom": "hello" });
        res.end("ok");
      } else if (req.url === "/204") {
        res.writeHead(204);
        res.end();
      } else if (req.url === "/echo-body") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(body);
        });
      } else if (req.url === "/binary") {
        const buf = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(buf);
      } else if (req.url === "/headers") {
        res.writeHead(200, {
          "x-request-method": req.method ?? "",
          "x-request-url": req.url ?? "",
        });
        res.end("headers");
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("proxies a GET request and returns status, headers, body", async () => {
    const res = await proxyLocalHttp(makeReq({ path: "/200" }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/plain");
    expect(res.headers["x-custom"]).toBe("hello");
    expect(res.body).toBe(Buffer.from("ok").toString("base64"));
  });

  it("proxies a POST with base64-encoded body", async () => {
    const bodyContent = "hello from test";
    const res = await proxyLocalHttp(
      makeReq({
        method: "POST",
        path: "/echo-body",
        headers: { "content-type": "text/plain" },
        body: Buffer.from(bodyContent).toString("base64"),
      }),
    );
    expect(res.status).toBe(200);
    const decoded = Buffer.from(res.body!, "base64").toString();
    expect(decoded).toBe(bodyContent);
  });

  it("handles 204 No Content (empty body)", async () => {
    const res = await proxyLocalHttp(makeReq({ path: "/204" }));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("returns 502 on connection refused (no server on port)", async () => {
    const res = await proxyLocalHttp(
      makeReq({ port: 19999, path: "/" }),
    );
    expect(res.status).toBe(502);
    const body = Buffer.from(res.body!, "base64").toString();
    expect(body).toContain("Bad Gateway");
  });

  it("correctly base64-encodes binary response body", async () => {
    const res = await proxyLocalHttp(makeReq({ path: "/binary" }));
    expect(res.status).toBe(200);
    const buf = Buffer.from(res.body!, "base64");
    expect(buf).toEqual(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
  });

  it("preserves custom response headers", async () => {
    const res = await proxyLocalHttp(
      makeReq({ method: "PUT", path: "/headers" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers["x-request-method"]).toBe("PUT");
    expect(res.headers["x-request-url"]).toBe("/headers");
  });

  it("preserves reqId in response", async () => {
    const reqId = "custom-req-id-42";
    const res = await proxyLocalHttp(makeReq({ reqId, path: "/200" }));
    expect(res.reqId).toBe(reqId);
  });
});
