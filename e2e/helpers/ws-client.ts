import WebSocket from "ws";
import { getEnv } from "./env.js";
import { decodeFrame, createPongFrame, FrameType, FRAME_VERSION } from "./crypto.js";

interface DecodedFrame {
  type: FrameType;
  sessionId: string;
  payload: Uint8Array;
}

export class WsClient {
  private ws: WebSocket | null = null;
  public receivedFrames: DecodedFrame[] = [];
  private listeners: Array<(frame: DecodedFrame) => void> = [];

  /**
   * @param token - Raw session token (NOT the signed cookie value).
   * @param opts - Optional machineId/machineName for daemon connections.
   *              Optional version override for testing version mismatch.
   */
  async connect(
    token: string,
    source: "cli" | "browser" | "daemon",
    opts?: { machineId?: string; machineName?: string; version?: number },
  ): Promise<void> {
    const { wsUrl } = getEnv();
    const url = `${wsUrl}/ws`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket connection timeout"));
      }, 10_000);

      ws.on("open", () => {
        // Send JSON handshake as first message
        ws.send(JSON.stringify({
          version: opts?.version ?? FRAME_VERSION,
          token,
          source,
          ...(opts?.machineId ? { machineId: opts.machineId } : {}),
          ...(opts?.machineName ? { machineName: opts.machineName } : {}),
        }));
      });

      ws.on("message", (raw: Buffer) => {
        try {
          const frame = decodeFrame(new Uint8Array(raw));

          // During handshake: wait for HANDSHAKE_OK or ERROR
          if (!this.ws) {
            if (frame.type === FrameType.HANDSHAKE_OK) {
              clearTimeout(timeout);
              this.ws = ws;
              resolve();
              return;
            }
            if (frame.type === FrameType.ERROR) {
              clearTimeout(timeout);
              const msg = new TextDecoder().decode(frame.payload);
              reject(new Error(`Handshake failed: ${msg}`));
              return;
            }
          }

          // Auto-respond to PING with PONG to keep connection alive
          if (frame.type === FrameType.PING) {
            ws.send(createPongFrame());
          }
          this.receivedFrames.push(frame);
          for (const listener of this.listeners) {
            listener(frame);
          }
        } catch {
          // Ignore malformed frames
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  send(data: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(data);
  }

  waitForMessage(
    predicate: (frame: DecodedFrame) => boolean,
    timeout = 10_000,
  ): Promise<DecodedFrame> {
    // Check already-received frames
    const existing = this.receivedFrames.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.listeners.indexOf(listener);
        if (idx !== -1) this.listeners.splice(idx, 1);
        reject(new Error("waitForMessage timeout"));
      }, timeout);

      const listener = (frame: DecodedFrame) => {
        if (predicate(frame)) {
          clearTimeout(timer);
          const idx = this.listeners.indexOf(listener);
          if (idx !== -1) this.listeners.splice(idx, 1);
          resolve(frame);
        }
      };

      this.listeners.push(listener);
    });
  }

  waitForClose(timeout = 10_000): Promise<{ code: number; reason: string }> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error("waitForClose timeout"));
      }, timeout);

      this.ws.on("close", (code: number, reason: Buffer) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.listeners = [];
  }
}
