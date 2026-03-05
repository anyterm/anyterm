import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import {
  decodeFrame,
  encodeFrame,
  FrameType,
  createPongFrame,
  createPingFrame,
  createCliConnectedFrame,
  createCliDisconnectedFrame,
  createHandshakeOkFrame,
  createErrorFrame,
} from "@anyterm/utils/protocol";
import type { WsHandshake } from "@anyterm/utils/protocol";
import {
  REDIS_CHANNEL_OUTPUT,
  REDIS_CHANNEL_INPUT,
  REDIS_CHANNEL_EVENT,
  REDIS_CHANNEL_HTTP_REQUEST,
  REDIS_CHANNEL_DAEMON_MACHINE,
  PING_INTERVAL_MS,
  MAX_HTTP_TUNNEL_PAYLOAD,
  FRAME_VERSION,
  HANDSHAKE_TIMEOUT_MS,
} from "@anyterm/utils/types";
import type { HttpTunnelResponse, SpawnResponse } from "@anyterm/utils/types";
import { pendingHttpRequests } from "./http-tunnel.js";
import type { RedisClients } from "./redis.js";
import {
  authenticateWsToken,
  verifySessionOwnership,
} from "./auth-ws.js";
import {
  initSessionSeq,
  queueChunk,
  flushSessionChunks,
  storeSnapshot,
  cleanupSession,
  markSessionDisconnected,
  markSessionStopped,
  markSessionRunning,
  startFlushTimer,
} from "./persistence.js";

// --- Security limits ---
const MAX_CONNECTIONS_PER_USER = 10;
const MAX_SUBSCRIPTIONS_PER_CLIENT = 50;
const MAX_FRAME_PAYLOAD_BYTES = 256 * 1024; // 256 KB
const MAX_SESSION_ID_LENGTH = 256;
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MESSAGES = 100;

type WsSource = "browser" | "cli" | "daemon";

interface ClientState {
  userId: string;
  subscribedSessions: Set<string>;
  ws: WSContext;
  isAlive: boolean;
  source: WsSource;
  messageTimestamps: number[];
  machineId: string | null;
  machineName: string | null;
}

type WsState = {
  sessionSubscribers: Map<string, Set<WSContext>>;
  sessionCliClients: Map<string, Set<WSContext>>;
  clients: Map<WSContext, ClientState>;
  stoppedTimers: Map<string, NodeJS.Timeout>;
};

/** Convert any buffer-like to a plain ArrayBuffer for ws.send() */
function toArrayBuffer(data: Uint8Array | Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return ab;
}

// Shared pending spawn request map — resolved by ws.ts when SPAWN_RESPONSE arrives
export const pendingSpawnRequests = new Map<
  string,
  {
    resolve: (res: SpawnResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    userId: string; // originator's userId — verified against daemon's userId
  }
>();

// Daemon WS clients per user — keyed by machineId
// Map<userId, Map<machineId, { ws, name }>>
export const userDaemonClients = new Map<string, Map<string, { ws: WSContext; name: string }>>();

export function createWsRoute(
  upgradeWebSocket: (factory: (c: any) => any) => any,
  redis: RedisClients,
) {
  const app = new Hono();
  const clients = new Map<WSContext, ClientState>();
  const pendingHandshakes = new Map<WSContext, { timer: ReturnType<typeof setTimeout> }>();
  const sessionSubscribers = new Map<string, Set<WSContext>>();
  const sessionCliClients = new Map<string, Set<WSContext>>();
  const userConnectionCount = new Map<string, number>();

  // Grace period before escalating "disconnected" → "stopped".
  // If the CLI reconnects within this window, status returns to "running".
  // Configurable via env for testing (default: 5 minutes).
  const STOPPED_GRACE_MS = parseInt(process.env.WS_STOPPED_GRACE_MS ?? "", 10) || 5 * 60_000;
  const stoppedTimers = new Map<string, NodeJS.Timeout>();

  // Redis subscriber message handler
  redis.subscriber.on("messageBuffer", (channel: Buffer, message: Buffer) => {
    const channelStr = channel.toString();

    // Handle per-machine daemon channel: forward spawn requests to specific daemon
    const daemonMatch = channelStr.match(/^user:(.+?):daemon:(.+)$/);
    if (daemonMatch) {
      const [, userId, machineId] = daemonMatch;
      const machineMap = userDaemonClients.get(userId);
      if (!machineMap) return;
      const entry = machineMap.get(machineId);
      if (!entry || entry.ws.readyState !== 1) return;
      entry.ws.send(toArrayBuffer(message));
      return;
    }

    const match = channelStr.match(/^session:(.+?):(output|input|event|http_request)$/);
    if (!match) return;

    const [, sessionId, direction] = match;

    // When a session is deleted, purge any in-memory chunks to prevent FK violations
    if (direction === "event") {
      try {
        const frame = decodeFrame(new Uint8Array(message));
        if (frame.type === FrameType.SESSION_ENDED) {
          // Flush remaining chunks to DB (handles FK violations gracefully
          // if session was deleted), then clean up persistence state
          flushSessionChunks(sessionId).catch((err) =>
            console.error("[WS] Flush on session ended failed:", err),
          );
          cleanupSession(sessionId);
          // Cancel any pending stopped timer — session is ending
          const pendingTimer = stoppedTimers.get(sessionId);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            stoppedTimers.delete(sessionId);
          }
        }
      } catch {
        // Not a valid frame — ignore
      }
    }

    const subs = sessionSubscribers.get(sessionId);
    if (!subs) return;

    const buf = toArrayBuffer(message);
    for (const ws of subs) {
      if (ws.readyState !== 1) continue;
      const client = clients.get(ws);
      if (!client) continue;

      // Route: output → browser, input → CLI/daemon, http_request → CLI/daemon, event → all
      if (direction === "output" && client.source === "browser") {
        ws.send(buf);
      } else if (direction === "input" && (client.source === "cli" || client.source === "daemon")) {
        ws.send(buf);
      } else if (direction === "http_request" && (client.source === "cli" || client.source === "daemon")) {
        ws.send(buf);
      } else if (direction === "event") {
        ws.send(buf);
      }
    }
  });

  // Application-level heartbeat using binary protocol PING/PONG
  setInterval(() => {
    const ping = toArrayBuffer(createPingFrame());
    for (const [ws, state] of clients) {
      if (!state.isAlive) {
        ws.close();
        continue;
      }
      state.isAlive = false;
      ws.send(ping);
    }
  }, PING_INTERVAL_MS);

  app.get(
    "/ws",
    upgradeWebSocket(() => {
      let state: ClientState | null = null;
      let wsRef: WSContext | null = null;

      return {
        onOpen(_event: Event, ws: WSContext) {
          wsRef = ws;
          // No auth here — wait for handshake message
          const timer = setTimeout(() => {
            pendingHandshakes.delete(ws);
            ws.close(4000, "Handshake timeout");
          }, HANDSHAKE_TIMEOUT_MS);
          pendingHandshakes.set(ws, { timer });
        },

        async onMessage(event: MessageEvent, _ws: WSContext) {
          // --- Handshake phase ---
          const pending = pendingHandshakes.get(_ws);
          if (pending) {
            clearTimeout(pending.timer);
            pendingHandshakes.delete(_ws);

            // Expect a JSON text message
            let text: string;
            if (typeof event.data === "string") {
              text = event.data;
            } else {
              // Binary first message = old client or invalid
              _ws.send(toArrayBuffer(createErrorFrame("INVALID_HANDSHAKE", "Expected JSON handshake as first message")));
              _ws.close(4000, "Invalid handshake");
              return;
            }

            let handshake: WsHandshake;
            try {
              handshake = JSON.parse(text);
            } catch {
              _ws.send(toArrayBuffer(createErrorFrame("INVALID_HANDSHAKE", "Malformed JSON")));
              _ws.close(4000, "Invalid handshake");
              return;
            }

            // Version check
            if (handshake.version !== FRAME_VERSION) {
              _ws.send(toArrayBuffer(createErrorFrame(
                "VERSION_MISMATCH",
                `Protocol version ${FRAME_VERSION} required. Your client uses version ${handshake.version}. Please update your client.`,
              )));
              _ws.close(4010, "Version mismatch");
              return;
            }

            // Auth check
            if (!handshake.token) {
              _ws.send(toArrayBuffer(createErrorFrame("AUTH_FAILED", "Missing token")));
              _ws.close(4001, "Unauthorized");
              return;
            }

            const user = await authenticateWsToken(handshake.token);
            if (!user) {
              _ws.send(toArrayBuffer(createErrorFrame("AUTH_FAILED", "Invalid or expired token")));
              _ws.close(4001, "Unauthorized");
              return;
            }

            // Source validation
            const source: WsSource = handshake.source === "cli" ? "cli"
              : handshake.source === "daemon" ? "daemon"
              : "browser";

            const machineId = handshake.machineId || null;
            const machineName = handshake.machineName || null;

            // Daemon checks
            if (source === "daemon" && !machineId) {
              _ws.send(toArrayBuffer(createErrorFrame("MISSING_MACHINE_ID", "Daemon connections require machineId")));
              _ws.close(4002, "Missing machineId");
              return;
            }

            if (source === "daemon" && machineId) {
              const machineMap = userDaemonClients.get(user.id);
              const existing = machineMap?.get(machineId);
              if (existing && existing.ws.readyState === 1) {
                _ws.send(toArrayBuffer(createErrorFrame("DUPLICATE_MACHINE", "Another daemon with this machine ID is already connected")));
                _ws.close(4003, "Machine ID already connected");
                return;
              }
            }

            // Connection limit
            const currentCount = userConnectionCount.get(user.id) || 0;
            if (currentCount >= MAX_CONNECTIONS_PER_USER) {
              console.warn(`[WS] Connection limit reached for user ${user.id} (${currentCount}/${MAX_CONNECTIONS_PER_USER})`);
              _ws.close(4029, "Too many connections");
              return;
            }

            // Handshake success — create client state
            state = {
              userId: user.id,
              subscribedSessions: new Set(),
              ws: _ws,
              isAlive: true,
              source,
              messageTimestamps: [],
              machineId,
              machineName,
            };
            clients.set(_ws, state);
            userConnectionCount.set(user.id, currentCount + 1);

            // Register daemon
            if (source === "daemon" && machineId) {
              let machineMap = userDaemonClients.get(user.id);
              if (!machineMap) {
                machineMap = new Map();
                userDaemonClients.set(user.id, machineMap);
              }

              machineMap.set(machineId, { ws: _ws, name: machineName || machineId });

              redis.subscriber
                .subscribe(REDIS_CHANNEL_DAEMON_MACHINE(user.id, machineId))
                .catch((err: Error) =>
                  console.error("[WS] Redis daemon subscribe error:", err.message),
                );

              console.log(`[WS] Daemon connected for user ${user.id}, machine ${machineName || machineId} (${machineId})`);
            }

            // Send HANDSHAKE_OK
            _ws.send(toArrayBuffer(createHandshakeOkFrame()));
            return;
          }

          // --- Normal frame phase ---
          if (!state) return;

          // Rate limiting
          const now = Date.now();
          state.messageTimestamps = state.messageTimestamps.filter(
            (t) => now - t < RATE_LIMIT_WINDOW_MS,
          );
          if (state.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
            console.warn(
              `[WS] Rate limit exceeded for user ${state.userId}`,
            );
            return;
          }
          state.messageTimestamps.push(now);

          // Convert message data to Uint8Array
          let raw: Uint8Array;
          if (event.data instanceof ArrayBuffer) {
            raw = new Uint8Array(event.data);
          } else if (event.data instanceof Uint8Array) {
            raw = event.data;
          } else if (Buffer.isBuffer(event.data)) {
            raw = new Uint8Array(event.data);
          } else {
            return; // Ignore text messages after handshake
          }

          // Payload size check — allow larger frames for HTTP tunnel traffic
          const maxSize = Math.max(MAX_FRAME_PAYLOAD_BYTES, MAX_HTTP_TUNNEL_PAYLOAD + 512);
          if (raw.length > maxSize) {
            console.warn(
              `[WS] Oversized frame from user ${state.userId}: ${raw.length} bytes`,
            );
            return;
          }

          try {
            const frame = decodeFrame(raw);

            if (
              frame.sessionId &&
              frame.sessionId.length > MAX_SESSION_ID_LENGTH
            ) {
              console.warn(
                `[WS] Oversized sessionId from user ${state.userId}`,
              );
              return;
            }

            await handleFrame(frame, state, redis, { sessionSubscribers, sessionCliClients, clients, stoppedTimers });
          } catch (error) {
            console.warn(
              `[WS] Malformed frame from user ${state.userId}:`,
              error instanceof Error ? error.message : "unknown",
            );
          }
        },

        onClose() {
          // Clean up pending handshake if connection closed before handshake
          if (wsRef) {
            const pending = pendingHandshakes.get(wsRef);
            if (pending) {
              clearTimeout(pending.timer);
              pendingHandshakes.delete(wsRef);
            }
          }

          if (!state) return;

          // Reject any pending HTTP tunnel requests that belong to this
          // CLI's subscribed sessions — avoids hanging for 30s until timeout.
          if (state.source === "cli" || state.source === "daemon") {
            for (const [reqId, pending] of pendingHttpRequests) {
              if (state.subscribedSessions.has(pending.sessionId)) {
                pendingHttpRequests.delete(reqId);
                pending.reject(new Error("CLI disconnected"));
              }
            }
          }

          // Cleanup daemon registration (per-machine)
          if (state.source === "daemon" && state.machineId) {
            const machineMap = userDaemonClients.get(state.userId);
            if (machineMap) {
              const entry = machineMap.get(state.machineId);
              if (entry && entry.ws === state.ws) {
                machineMap.delete(state.machineId);
                redis.subscriber
                  .unsubscribe(REDIS_CHANNEL_DAEMON_MACHINE(state.userId, state.machineId))
                  .catch((err: Error) =>
                    console.error("[WS] Redis daemon unsubscribe error:", err.message),
                  );
              }
              if (machineMap.size === 0) {
                userDaemonClients.delete(state.userId);
              }
            }
            console.log(`[WS] Daemon disconnected for user ${state.userId}, machine ${state.machineName || state.machineId}`);
          }

          for (const sessionId of state.subscribedSessions) {
            if (state.source === "cli" || state.source === "daemon") {
              flushSessionChunks(sessionId).catch((err) =>
                console.error("[WS] Flush on disconnect failed:", err),
              );
              cleanupSession(sessionId);

              const cliSet = sessionCliClients.get(sessionId);
              if (cliSet) {
                cliSet.delete(state.ws);
                if (cliSet.size === 0) {
                  sessionCliClients.delete(sessionId);

                  // Notify browsers that CLI is gone
                  const subs = sessionSubscribers.get(sessionId);
                  if (subs) {
                    const disconnectedBuf = toArrayBuffer(createCliDisconnectedFrame(sessionId));
                    for (const ws of subs) {
                      if (ws.readyState !== 1) continue;
                      const client = clients.get(ws);
                      if (client?.source === "browser") {
                        ws.send(disconnectedBuf);
                      }
                    }
                  }

                  markSessionDisconnected(sessionId).catch((err) =>
                    console.error("[WS] Failed to mark session disconnected:", err),
                  );

                  const timer = setTimeout(() => {
                    stoppedTimers.delete(sessionId);
                    markSessionStopped(sessionId).catch((err) =>
                      console.error("[WS] Failed to mark session stopped:", err),
                    );
                  }, STOPPED_GRACE_MS);
                  stoppedTimers.set(sessionId, timer);
                }
              }
            }

            const subs = sessionSubscribers.get(sessionId);
            if (subs) {
              subs.delete(state.ws);
              if (subs.size === 0) {
                sessionSubscribers.delete(sessionId);
                redis.subscriber
                  .unsubscribe(
                    REDIS_CHANNEL_OUTPUT(sessionId),
                    REDIS_CHANNEL_INPUT(sessionId),
                    REDIS_CHANNEL_EVENT(sessionId),
                    REDIS_CHANNEL_HTTP_REQUEST(sessionId),
                  )
                  .catch((err: Error) =>
                    console.error(
                      "[WS] Redis unsubscribe error:",
                      err.message,
                    ),
                  );
              }
            }
          }

          const count = userConnectionCount.get(state.userId) || 1;
          if (count <= 1) {
            userConnectionCount.delete(state.userId);
          } else {
            userConnectionCount.set(state.userId, count - 1);
          }

          clients.delete(state.ws);
          state = null;
        },
      };
    }),
  );

  startFlushTimer();
  console.log("WebSocket relay configured on /ws");
  return app;
}

async function handleFrame(
  frame: ReturnType<typeof decodeFrame>,
  state: ClientState,
  redis: RedisClients,
  { sessionSubscribers, sessionCliClients, clients, stoppedTimers }: WsState,
) {
  switch (frame.type) {
    case FrameType.SUBSCRIBE: {
      if (state.subscribedSessions.size >= MAX_SUBSCRIPTIONS_PER_CLIENT) {
        console.warn(
          `[WS] Subscription limit reached for user ${state.userId}`,
        );
        return;
      }

      const isOwner = await verifySessionOwnership(
        frame.sessionId,
        state.userId,
      );
      if (!isOwner) {
        console.warn(
          `[WS] User ${state.userId} tried to subscribe to unowned session ${frame.sessionId}`,
        );
        return;
      }

      state.subscribedSessions.add(frame.sessionId);
      let subs = sessionSubscribers.get(frame.sessionId);
      if (!subs) {
        subs = new Set();
        sessionSubscribers.set(frame.sessionId, subs);
        redis.subscriber
          .subscribe(
            REDIS_CHANNEL_OUTPUT(frame.sessionId),
            REDIS_CHANNEL_INPUT(frame.sessionId),
            REDIS_CHANNEL_EVENT(frame.sessionId),
            REDIS_CHANNEL_HTTP_REQUEST(frame.sessionId),
          )
          .catch((err: Error) =>
            console.error("[WS] Redis subscribe error:", err.message),
          );
      }
      subs.add(state.ws);

      if (state.source === "cli" || state.source === "daemon") {
        // Cancel pending "mark stopped" timer — CLI/daemon reconnected
        const pendingTimer = stoppedTimers.get(frame.sessionId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          stoppedTimers.delete(frame.sessionId);
          // Restore running status in case it was already marked stopped
          markSessionRunning(frame.sessionId).catch((err) =>
            console.error("[WS] Failed to restore session running:", err),
          );
        }

        // Initialize seq counter for chunk persistence
        await initSessionSeq(frame.sessionId);

        // Track CLI presence for this session
        let cliSet = sessionCliClients.get(frame.sessionId);
        if (!cliSet) {
          cliSet = new Set();
          sessionCliClients.set(frame.sessionId, cliSet);
        }
        cliSet.add(state.ws);

        // Notify browsers that CLI/daemon is connected
        const connFrame = toArrayBuffer(createCliConnectedFrame(frame.sessionId));
        for (const ws of subs) {
          if (ws.readyState !== 1) continue;
          const client = clients.get(ws);
          if (client?.source === "browser") {
            ws.send(connFrame);
          }
        }
      } else if (state.source === "browser") {
        // Tell the new browser subscriber whether a CLI is currently connected
        const hasCliConnected = (sessionCliClients.get(frame.sessionId)?.size ?? 0) > 0;
        const presenceFrame = hasCliConnected
          ? createCliConnectedFrame(frame.sessionId)
          : createCliDisconnectedFrame(frame.sessionId);
        if (state.ws.readyState === 1) {
          state.ws.send(toArrayBuffer(presenceFrame));
        }
      }

      break;
    }

    case FrameType.UNSUBSCRIBE: {
      state.subscribedSessions.delete(frame.sessionId);

      // When CLI/daemon unsubscribes (PTY exited), notify browsers and clean up
      if (state.source === "cli" || state.source === "daemon") {
        flushSessionChunks(frame.sessionId).catch((err) =>
          console.error("[WS] Flush on unsubscribe failed:", err),
        );
        cleanupSession(frame.sessionId);

        const cliSet = sessionCliClients.get(frame.sessionId);
        if (cliSet) {
          cliSet.delete(state.ws);
          if (cliSet.size === 0) {
            sessionCliClients.delete(frame.sessionId);

            // Cancel any pending stopped timer — PTY already exited
            const pendingTimer = stoppedTimers.get(frame.sessionId);
            if (pendingTimer) {
              clearTimeout(pendingTimer);
              stoppedTimers.delete(frame.sessionId);
            }

            // Notify browsers that CLI is gone
            const subs = sessionSubscribers.get(frame.sessionId);
            if (subs) {
              const disconnectedBuf = toArrayBuffer(createCliDisconnectedFrame(frame.sessionId));
              for (const ws of subs) {
                if (ws.readyState !== 1) continue;
                const client = clients.get(ws);
                if (client?.source === "browser") {
                  ws.send(disconnectedBuf);
                }
              }
            }
          }
        }
      }

      const subs = sessionSubscribers.get(frame.sessionId);
      if (subs) {
        subs.delete(state.ws);
        if (subs.size === 0) {
          sessionSubscribers.delete(frame.sessionId);
          redis.subscriber
            .unsubscribe(
              REDIS_CHANNEL_OUTPUT(frame.sessionId),
              REDIS_CHANNEL_INPUT(frame.sessionId),
              REDIS_CHANNEL_EVENT(frame.sessionId),
              REDIS_CHANNEL_HTTP_REQUEST(frame.sessionId),
            )
            .catch((err: Error) =>
              console.error("[WS] Redis unsubscribe error:", err.message),
            );
        }
      }
      break;
    }

    case FrameType.ENCRYPTED_CHUNK: {
      if (state.source !== "cli" && state.source !== "daemon") {
        console.warn(`[WS] Browser tried to send ENCRYPTED_CHUNK — rejected`);
        return;
      }
      if (!state.subscribedSessions.has(frame.sessionId)) {
        console.warn(
          `[WS] User ${state.userId} tried to send chunk to unsubscribed session ${frame.sessionId}`,
        );
        return;
      }
      const rawChunk = encodeFrame(frame);
      redis.publisher
        .publish(
          REDIS_CHANNEL_OUTPUT(frame.sessionId),
          Buffer.from(rawChunk),
        )
        .catch((err: Error) =>
          console.error("[WS] Redis publish error:", err.message),
        );
      // Queue for DB persistence (CLI/daemon)
      queueChunk(frame.sessionId, frame.payload);
      break;
    }

    case FrameType.ENCRYPTED_INPUT: {
      if (state.source !== "browser") {
        console.warn(`[WS] CLI tried to send ENCRYPTED_INPUT — rejected`);
        return;
      }
      if (!state.subscribedSessions.has(frame.sessionId)) {
        console.warn(
          `[WS] User ${state.userId} tried to send input to unsubscribed session ${frame.sessionId}`,
        );
        return;
      }
      const rawInput = encodeFrame(frame);
      redis.publisher
        .publish(
          REDIS_CHANNEL_INPUT(frame.sessionId),
          Buffer.from(rawInput),
        )
        .catch((err: Error) =>
          console.error("[WS] Redis publish error:", err.message),
        );
      break;
    }

    case FrameType.RESIZE: {
      if (state.source !== "cli" && state.source !== "daemon") {
        console.warn(`[WS] Browser tried to send RESIZE — rejected`);
        return;
      }
      if (!state.subscribedSessions.has(frame.sessionId)) {
        console.warn(
          `[WS] User ${state.userId} tried to resize unsubscribed session ${frame.sessionId}`,
        );
        return;
      }
      const rawResize = encodeFrame(frame);
      redis.publisher
        .publish(
          REDIS_CHANNEL_EVENT(frame.sessionId),
          Buffer.from(rawResize),
        )
        .catch((err: Error) =>
          console.error("[WS] Redis publish error:", err.message),
        );
      break;
    }

    case FrameType.PING: {
      state.ws.send(toArrayBuffer(createPongFrame()));
      break;
    }

    case FrameType.PONG: {
      state.isAlive = true;
      break;
    }

    case FrameType.HTTP_RESPONSE: {
      if (state.source !== "cli" && state.source !== "daemon") {
        console.warn(`[WS] Browser tried to send HTTP_RESPONSE — rejected`);
        return;
      }
      // CLI sends HTTP_RESPONSE — resolve the pending HTTP request in-process
      try {
        const decoder = new TextDecoder();
        const json = decoder.decode(frame.payload);
        const response: HttpTunnelResponse = JSON.parse(json);
        const pending = pendingHttpRequests.get(response.reqId);
        if (pending) {
          // Verify the responding CLI is subscribed to the session that
          // originated this request — prevents cross-session spoofing.
          if (!state.subscribedSessions.has(pending.sessionId)) {
            console.warn(
              `[WS] CLI sent HTTP_RESPONSE for session ${pending.sessionId} it is not subscribed to — rejected`,
            );
            return;
          }
          pendingHttpRequests.delete(response.reqId);
          pending.resolve(response);
        }
      } catch (err) {
        console.warn("[WS] Malformed HTTP_RESPONSE:", err instanceof Error ? err.message : "unknown");
      }
      break;
    }

    case FrameType.SNAPSHOT: {
      if (state.source !== "cli" && state.source !== "daemon") return;
      if (!state.subscribedSessions.has(frame.sessionId)) return;
      await storeSnapshot(frame.sessionId, frame.payload);
      break;
    }

    case FrameType.SESSION_ENDED: {
      // CLI/daemon reports PTY exited — relay to browsers via Redis event channel
      if (state.source !== "cli" && state.source !== "daemon") {
        console.warn(`[WS] Browser tried to send SESSION_ENDED — rejected`);
        return;
      }
      if (!state.subscribedSessions.has(frame.sessionId)) return;

      // Flush pending chunks before notifying (so replay data is complete)
      await flushSessionChunks(frame.sessionId);

      const rawEnded = encodeFrame(frame);
      redis.publisher
        .publish(
          REDIS_CHANNEL_EVENT(frame.sessionId),
          Buffer.from(rawEnded),
        )
        .catch((err: Error) =>
          console.error("[WS] Redis publish error:", err.message),
        );
      break;
    }

    case FrameType.SPAWN_RESPONSE: {
      if (state.source !== "daemon") {
        console.warn(`[WS] Non-daemon tried to send SPAWN_RESPONSE — rejected`);
        return;
      }
      try {
        const decoder = new TextDecoder();
        const json = decoder.decode(frame.payload);
        const response: SpawnResponse = JSON.parse(json);
        const pending = pendingSpawnRequests.get(response.requestId);
        if (pending) {
          // Verify the daemon responding belongs to the same user who initiated the spawn
          if (pending.userId !== state.userId) {
            console.warn(
              `[WS] SPAWN_RESPONSE userId mismatch: expected ${pending.userId}, got ${state.userId}`,
            );
            return;
          }
          clearTimeout(pending.timer);
          pendingSpawnRequests.delete(response.requestId);
          pending.resolve(response);
        }
      } catch (err) {
        console.warn("[WS] Malformed SPAWN_RESPONSE:", err instanceof Error ? err.message : "unknown");
      }
      break;
    }
  }
}
