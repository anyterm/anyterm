import * as http from "node:http";
import type { HttpTunnelRequest, HttpTunnelResponse } from "@anyterm/utils/types";
import { HTTP_PROXY_TIMEOUT } from "./constants.js";

/** Proxy an HTTP request to localhost and return a serialized response.
 *  Tries localhost first (IPv6 ::1 on macOS), falls back to 127.0.0.1 (IPv4). */
export async function proxyLocalHttp(
  req: HttpTunnelRequest,
): Promise<HttpTunnelResponse> {
  try {
    return await tryProxy(req, "localhost");
  } catch {
    try {
      return await tryProxy(req, "127.0.0.1");
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === "timeout";
      return {
        reqId: req.reqId,
        status: isTimeout ? 504 : 502,
        headers: { "content-type": "text/plain" },
        body: Buffer.from(
          isTimeout
            ? "Gateway Timeout"
            : "Bad Gateway — connection refused on localhost:" + req.port,
        ).toString("base64"),
      };
    }
  }
}

function tryProxy(
  req: HttpTunnelRequest,
  hostname: string,
): Promise<HttpTunnelResponse> {
  return new Promise((resolve, reject) => {
    const body = req.body ? Buffer.from(req.body, "base64") : undefined;
    const pathAndQuery = req.path;
    const options: http.RequestOptions = {
      hostname,
      port: req.port,
      path: pathAndQuery,
      method: req.method,
      headers: req.headers,
      timeout: HTTP_PROXY_TIMEOUT,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on("end", () => {
        const bodyBuf = Buffer.concat(chunks);
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (typeof value === "string") headers[key] = value;
          else if (Array.isArray(value)) headers[key] = value.join(", ");
        }
        resolve({
          reqId: req.reqId,
          status: proxyRes.statusCode ?? 502,
          headers,
          body: bodyBuf.length > 0 ? bodyBuf.toString("base64") : undefined,
        });
      });
    });

    proxyReq.on("error", (err) => {
      reject(err);
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      reject(new Error("timeout"));
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}
