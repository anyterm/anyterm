import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { WsClient } from "../helpers/ws-client.js";
import { FRAME_VERSION } from "../helpers/crypto.js";

describe("32 — WebSocket Connection Limits", () => {
  let user: RegisteredUser;
  const clients: WsClient[] = [];

  beforeAll(async () => {
    user = await registerUser();
  });

  afterAll(() => {
    for (const c of clients) {
      c.close();
    }
  });

  it("10 WS clients for same user all succeed", async () => {
    for (let i = 0; i < 10; i++) {
      const c = new WsClient();
      await c.connect(user.token, "browser");
      clients.push(c);
    }
    expect(clients.length).toBe(10);
  });

  it("11th connection rejected", async () => {
    const c = new WsClient();
    try {
      await c.connect(user.token, "browser");
      // If connect somehow succeeds, check for close
      const close = await c.waitForClose(5000);
      expect(close.code).toBe(4029);
    } catch (err) {
      // Handshake should fail with error or timeout
      expect((err as Error).message).toMatch(
        /Handshake failed|timeout|close/i,
      );
    } finally {
      c.close();
    }
  });

  it("version mismatch returns ERROR frame", async () => {
    const c = new WsClient();
    try {
      await c.connect(user.token, "browser", {
        version: FRAME_VERSION + 1,
      });
      // Should not reach here
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("Handshake failed");
      // The error payload should mention version
      expect((err as Error).message).toMatch(/VERSION_MISMATCH|version/i);
    } finally {
      c.close();
    }
  });

  it("duplicate daemon machineId rejected (close 4003)", async () => {
    const daemonUser = await registerUser();
    const machineId = "test1234";

    const d1 = new WsClient();
    await d1.connect(daemonUser.token, "daemon", {
      machineId,
      machineName: "machine-a",
    });

    const d2 = new WsClient();
    try {
      await d2.connect(daemonUser.token, "daemon", {
        machineId,
        machineName: "machine-b",
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("Handshake failed");
      expect((err as Error).message).toMatch(/DUPLICATE_MACHINE|duplicate/i);
    } finally {
      d1.close();
      d2.close();
    }
  });

  it("malformed handshake (invalid JSON) closes connection", async () => {
    const { getEnv } = await import("../helpers/env.js");
    const { default: WebSocket } = await import("ws");
    const { wsUrl } = getEnv();

    const ws = new WebSocket(`${wsUrl}/ws`);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Send garbage instead of JSON handshake
    ws.send("not-json{{{");

    const closePromise = new Promise<{ code: number }>((resolve) => {
      ws.on("close", (code: number) => resolve({ code }));
    });

    const result = await Promise.race([
      closePromise,
      new Promise<{ code: number }>((resolve) =>
        setTimeout(() => resolve({ code: -1 }), 6000),
      ),
    ]);

    // Should close — either immediately on parse error or after handshake timeout (5s)
    expect(result.code).not.toBe(-1);
    ws.close();
  });
});
