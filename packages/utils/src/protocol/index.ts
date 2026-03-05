import { FRAME_MAGIC, FRAME_VERSION } from "../types/constants.js";

export enum FrameType {
  SUBSCRIBE = 0x01,
  UNSUBSCRIBE = 0x02,
  ENCRYPTED_CHUNK = 0x03,
  ENCRYPTED_INPUT = 0x04,
  EVENT = 0x05,
  RESIZE = 0x06,
  PING = 0x07,
  PONG = 0x08,
  ERROR = 0x09,
  SESSION_ENDED = 0x0a,
  HTTP_REQUEST = 0x0b,
  HTTP_RESPONSE = 0x0c,
  CLI_CONNECTED = 0x0d,
  CLI_DISCONNECTED = 0x0e,
  SNAPSHOT = 0x0f,
  SPAWN_REQUEST = 0x10,
  SPAWN_RESPONSE = 0x11,
  HANDSHAKE_OK = 0x12,
}

export interface Frame {
  version: number;
  type: FrameType;
  sessionId: string;
  payload: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Session IDs must be alphanumeric (nanoid charset: A-Za-z0-9_-)
// Empty sessionId is allowed for global frames (PING/PONG, SPAWN, HANDSHAKE_OK, ERROR)
const SESSION_ID_RE = /^[A-Za-z0-9_-]*$/;

export function encodeFrame(frame: Frame): Uint8Array {
  const sessionIdBytes = encoder.encode(frame.sessionId);
  const totalLen =
    2 + 1 + 1 + 4 + sessionIdBytes.length + 4 + frame.payload.length;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  let offset = 0;

  // Magic "VC"
  buf[offset++] = FRAME_MAGIC[0];
  buf[offset++] = FRAME_MAGIC[1];

  // Version
  buf[offset++] = FRAME_VERSION;

  // Type
  buf[offset++] = frame.type;

  // Session ID length + data
  view.setUint32(offset, sessionIdBytes.length, false);
  offset += 4;
  buf.set(sessionIdBytes, offset);
  offset += sessionIdBytes.length;

  // Payload length + data
  view.setUint32(offset, frame.payload.length, false);
  offset += 4;
  buf.set(frame.payload, offset);

  return buf;
}

export function decodeFrame(data: Uint8Array): Frame {
  // Minimum frame: magic(2) + version(1) + type(1) + sessionIdLen(4) + payloadLen(4) = 12
  if (data.byteLength < 12) {
    throw new Error("Frame too short");
  }

  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  );
  let offset = 0;

  // Validate magic
  if (data[offset] !== FRAME_MAGIC[0] || data[offset + 1] !== FRAME_MAGIC[1]) {
    throw new Error("Invalid frame magic");
  }
  offset += 2;

  const version = data[offset++];
  const type = data[offset++] as FrameType;

  // Session ID
  const sessionIdLen = view.getUint32(offset, false);
  if (sessionIdLen > 256) {
    throw new Error("sessionId too long");
  }
  offset += 4;
  if (offset + sessionIdLen + 4 > data.byteLength) {
    throw new Error("Frame truncated: sessionId extends beyond buffer");
  }
  const sessionId = decoder.decode(data.slice(offset, offset + sessionIdLen));
  if (sessionId.length > 0 && !SESSION_ID_RE.test(sessionId)) {
    throw new Error("Invalid sessionId: must be alphanumeric");
  }
  offset += sessionIdLen;

  // Payload
  const payloadLen = view.getUint32(offset, false);
  offset += 4;
  if (offset + payloadLen > data.byteLength) {
    throw new Error("Frame truncated: payload extends beyond buffer");
  }
  const payload = data.slice(offset, offset + payloadLen);

  return { version, type, sessionId, payload };
}

// Helper frame creators

const EMPTY_PAYLOAD = new Uint8Array(0);

export function createSubscribeFrame(sessionId: string): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.SUBSCRIBE,
    sessionId,
    payload: EMPTY_PAYLOAD,
  });
}

export function createUnsubscribeFrame(sessionId: string): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.UNSUBSCRIBE,
    sessionId,
    payload: EMPTY_PAYLOAD,
  });
}

export function createEncryptedChunkFrame(
  sessionId: string,
  payload: Uint8Array,
): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.ENCRYPTED_CHUNK,
    sessionId,
    payload,
  });
}

export function createEncryptedInputFrame(
  sessionId: string,
  payload: Uint8Array,
): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.ENCRYPTED_INPUT,
    sessionId,
    payload,
  });
}

const MAX_COLS = 1000;
const MAX_ROWS = 500;

export function createResizeFrame(
  sessionId: string,
  cols: number,
  rows: number,
): Uint8Array {
  const clampedCols = Math.max(1, Math.min(cols, MAX_COLS));
  const clampedRows = Math.max(1, Math.min(rows, MAX_ROWS));
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, clampedCols, false);
  view.setUint32(4, clampedRows, false);
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.RESIZE,
    sessionId,
    payload,
  });
}

export function parseResizePayload(payload: Uint8Array): {
  cols: number;
  rows: number;
} {
  if (payload.byteLength < 8) {
    throw new Error("RESIZE payload too short");
  }
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const cols = Math.max(1, Math.min(view.getUint32(0, false), MAX_COLS));
  const rows = Math.max(1, Math.min(view.getUint32(4, false), MAX_ROWS));
  return { cols, rows };
}

export function createEventFrame(
  sessionId: string,
  event: string,
): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.EVENT,
    sessionId,
    payload: encoder.encode(event),
  });
}

export function createPingFrame(): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.PING,
    sessionId: "",
    payload: EMPTY_PAYLOAD,
  });
}

export function createPongFrame(): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.PONG,
    sessionId: "",
    payload: EMPTY_PAYLOAD,
  });
}

export function createSessionEndedFrame(sessionId: string): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.SESSION_ENDED,
    sessionId,
    payload: EMPTY_PAYLOAD,
  });
}

export function createHttpRequestFrame(
  sessionId: string,
  payload: Uint8Array,
): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.HTTP_REQUEST,
    sessionId,
    payload,
  });
}

export function createHttpResponseFrame(
  sessionId: string,
  payload: Uint8Array,
): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.HTTP_RESPONSE,
    sessionId,
    payload,
  });
}

export function createCliConnectedFrame(sessionId: string): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.CLI_CONNECTED,
    sessionId,
    payload: EMPTY_PAYLOAD,
  });
}

export function createCliDisconnectedFrame(sessionId: string): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.CLI_DISCONNECTED,
    sessionId,
    payload: EMPTY_PAYLOAD,
  });
}

export function createSnapshotFrame(
  sessionId: string,
  payload: Uint8Array,
): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.SNAPSHOT,
    sessionId,
    payload,
  });
}

export function createSpawnRequestFrame(payload: Uint8Array): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.SPAWN_REQUEST,
    sessionId: "",
    payload,
  });
}

export function createSpawnResponseFrame(payload: Uint8Array): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.SPAWN_RESPONSE,
    sessionId: "",
    payload,
  });
}

export function createHandshakeOkFrame(): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.HANDSHAKE_OK,
    sessionId: "",
    payload: EMPTY_PAYLOAD,
  });
}

export function createErrorFrame(code: string, message: string): Uint8Array {
  return encodeFrame({
    version: FRAME_VERSION,
    type: FrameType.ERROR,
    sessionId: "",
    payload: encoder.encode(JSON.stringify({ code, message })),
  });
}

export interface WsHandshake {
  version: number;
  token: string;
  source: "cli" | "browser" | "daemon";
  machineId?: string;
  machineName?: string;
}
