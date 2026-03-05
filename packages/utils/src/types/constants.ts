export const WS_PATH = "/ws";

export const REDIS_CHANNEL_OUTPUT = (sessionId: string) =>
  `session:${sessionId}:output`;
export const REDIS_CHANNEL_INPUT = (sessionId: string) =>
  `session:${sessionId}:input`;
export const REDIS_CHANNEL_EVENT = (sessionId: string) =>
  `session:${sessionId}:event`;
export const REDIS_CHANNEL_HTTP_REQUEST = (sessionId: string) =>
  `session:${sessionId}:http_request`;

export const REDIS_CHANNEL_DAEMON_MACHINE = (userId: string, machineId: string) =>
  `user:${userId}:daemon:${machineId}`;

export const MAX_HTTP_TUNNEL_PAYLOAD = 2 * 1024 * 1024; // 2MB

export const FRAME_MAGIC = new Uint8Array([0x56, 0x43]); // "VC"
export const FRAME_VERSION = 1;
export const MAX_CHUNK_SIZE = 64 * 1024; // 64KB
export const PING_INTERVAL_MS = 30_000;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const CHUNK_BATCH_SIZE = 50;
export const CHUNK_FLUSH_INTERVAL_MS = 2_000;
export const HANDSHAKE_TIMEOUT_MS = 5_000;
export const PTY_BATCH_INTERVAL_MS = 100; // Buffer PTY output before encrypting+sending
