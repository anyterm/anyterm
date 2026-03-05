import { Hono } from "hono";
import { nanoid } from "nanoid";
import { createSpawnRequestFrame } from "@anyterm/utils/protocol";
import { REDIS_CHANNEL_DAEMON_MACHINE } from "@anyterm/utils/types";
import type { SpawnResponse, DaemonStatusResponse, MachineInfo } from "@anyterm/utils/types";
import type { RedisClients } from "./redis.js";
import { authenticateWsConnection } from "./auth-ws.js";
import { pendingSpawnRequests, userDaemonClients } from "./ws.js";

const SPAWN_TIMEOUT_MS = 15_000;

// --- Security limits ---
const MAX_ENCRYPTED_PAYLOAD_SIZE = 16_384; // 16 KB — generous for sealed box of {command,name,cols,rows}
const MAX_CONCURRENT_SPAWNS_PER_USER = 5;

const encoder = new TextEncoder();

// Track in-flight spawn requests per user to prevent flooding
const userPendingSpawnCount = new Map<string, number>();

export function createDaemonApiRoute(redis: RedisClients) {
  const app = new Hono();

  // Check if daemon is online for the authenticated user
  app.get("/api/daemon/status", async (c) => {
    const user = await authenticateWsConnection(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const machineMap = userDaemonClients.get(user.id);
    const machines: MachineInfo[] = [];
    if (machineMap) {
      for (const [machineId, entry] of machineMap) {
        if (entry.ws.readyState === 1) {
          machines.push({ machineId, name: entry.name });
        }
      }
    }
    const response: DaemonStatusResponse = { online: machines.length > 0, machines };
    return c.json(response);
  });

  // Spawn a new terminal session via the daemon
  // The server is zero-knowledge: it relays an encrypted payload to the daemon.
  // Only the daemon (with user's privateKey) can decrypt the spawn parameters.
  app.post("/api/daemon/spawn", async (c) => {
    const user = await authenticateWsConnection(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Parse body safely
    let body: { encryptedPayload?: unknown; targetMachineId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate encrypted payload
    if (typeof body.encryptedPayload !== "string" || body.encryptedPayload.length === 0) {
      return c.json({ error: "Missing encryptedPayload" }, 400);
    }
    if (body.encryptedPayload.length > MAX_ENCRYPTED_PAYLOAD_SIZE) {
      return c.json({ error: "Payload too large" }, 400);
    }

    // Check concurrent spawn limit
    const currentPending = userPendingSpawnCount.get(user.id) || 0;
    if (currentPending >= MAX_CONCURRENT_SPAWNS_PER_USER) {
      return c.json({ error: "Too many concurrent spawn requests" }, 429);
    }

    // Check if daemon is online and resolve target machine
    const machineMap = userDaemonClients.get(user.id);
    const onlineMachines: Array<{ machineId: string; entry: { ws: import("hono/ws").WSContext; name: string } }> = [];
    if (machineMap) {
      for (const [machineId, entry] of machineMap) {
        if (entry.ws.readyState === 1) {
          onlineMachines.push({ machineId, entry });
        }
      }
    }

    if (onlineMachines.length === 0) {
      return c.json({ error: "No daemon connected" }, 503);
    }

    let targetMachineId: string;
    if (typeof body.targetMachineId === "string" && body.targetMachineId.length > 0) {
      // Explicit target — verify it's online
      const target = onlineMachines.find((m) => m.machineId === body.targetMachineId);
      if (!target) {
        return c.json({ error: "Target machine is not online" }, 503);
      }
      targetMachineId = body.targetMachineId;
    } else if (onlineMachines.length === 1) {
      // Auto-target when only 1 machine
      targetMachineId = onlineMachines[0].machineId;
    } else {
      // Multiple machines and no target specified
      return c.json({ error: "Multiple machines online — targetMachineId required" }, 400);
    }

    // Server generates requestId for matching responses; encrypted payload is opaque
    const requestId = nanoid(16);
    const frameData = JSON.stringify({
      requestId,
      encryptedPayload: body.encryptedPayload,
    });
    const frame = createSpawnRequestFrame(encoder.encode(frameData));

    // Track concurrent spawn count
    userPendingSpawnCount.set(user.id, currentPending + 1);

    // Publish to per-machine daemon Redis channel
    await redis.publisher.publish(
      REDIS_CHANNEL_DAEMON_MACHINE(user.id, targetMachineId),
      Buffer.from(frame),
    );

    // Wait for response from daemon via ws.ts resolving our promise
    try {
      const response = await new Promise<SpawnResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingSpawnRequests.delete(requestId);
          reject(new Error("Spawn timeout"));
        }, SPAWN_TIMEOUT_MS);

        pendingSpawnRequests.set(requestId, {
          resolve,
          reject,
          timer,
          userId: user.id,
        });
      });

      if (response.error) {
        return c.json({ error: response.error }, 500);
      }

      return c.json({ sessionId: response.sessionId });
    } catch {
      return c.json(
        { error: "Spawn timeout — daemon did not respond" },
        504,
      );
    } finally {
      // Decrement concurrent spawn count
      const count = userPendingSpawnCount.get(user.id) || 1;
      if (count <= 1) {
        userPendingSpawnCount.delete(user.id);
      } else {
        userPendingSpawnCount.set(user.id, count - 1);
      }
    }
  });

  return app;
}
