import WebSocket from "ws";
import { encryptChunk } from "@anyterm/utils/crypto";
import { createEncryptedChunkFrame, createSnapshotFrame } from "@anyterm/utils/protocol";
import { MAX_CHUNK_SIZE, PTY_BATCH_INTERVAL_MS } from "@anyterm/utils/types";
import { gql } from "../graphql.js";
import { containsClear, SNAPSHOT_CHUNK_THRESHOLD, SNAPSHOT_INTERVAL_MS } from "./terminal.js";
import { SNAPSHOT_DEBOUNCE } from "./constants.js";

export type PtySessionState = {
  id: string;
  sessionKey: Uint8Array;
  ptyProcess: import("node-pty").IPty;
  headless: import("@xterm/headless").Terminal | null;
  serializer: import("@xterm/addon-serialize").SerializeAddon | null;
  chunksSinceSnapshot: number;
  snapshotInFlight: boolean;
  periodicSnapshotTimer: NodeJS.Timeout | null;
  snapshotTimer: NodeJS.Timeout | null;
  forwardedPorts: number[];
  ptyBuffer: string;
  ptyBatchTimer: NodeJS.Timeout | null;
  hasClearInBatch: boolean;
};

/** Create a fresh PtySessionState with default mutable fields. */
export function createPtySessionState(
  init: Pick<PtySessionState, "id" | "sessionKey" | "ptyProcess" | "headless" | "serializer" | "forwardedPorts">,
): PtySessionState {
  return {
    ...init,
    chunksSinceSnapshot: 0,
    snapshotInFlight: false,
    periodicSnapshotTimer: null,
    snapshotTimer: null,
    ptyBuffer: "",
    ptyBatchTimer: null,
    hasClearInBatch: false,
  };
}

/**
 * Factory that returns PTY session lifecycle functions bound to a WebSocket getter.
 * The getter is called on each operation so reconnections are handled transparently.
 */
export function createPtySessionManager(getWs: () => WebSocket | null) {

  async function createAndSendSnapshot(session: PtySessionState): Promise<boolean> {
    if (!session.headless || !session.serializer) return false;
    if (session.snapshotInFlight) return false;
    const ws = getWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    session.snapshotInFlight = true;

    try {
      const serialized = session.serializer.serialize();
      const encoded = new TextEncoder().encode(serialized);
      const packed = await encryptChunk(encoded, session.sessionKey);
      ws.send(createSnapshotFrame(session.id, packed));
      session.chunksSinceSnapshot = 0;
      return true;
    } catch {
      return false;
    } finally {
      session.snapshotInFlight = false;
    }
  }

  function resetPeriodicSnapshotTimer(session: PtySessionState): void {
    if (session.periodicSnapshotTimer) clearTimeout(session.periodicSnapshotTimer);
    if (!session.headless || !session.serializer) return;

    session.periodicSnapshotTimer = setTimeout(async () => {
      if (session.chunksSinceSnapshot > 0) {
        await createAndSendSnapshot(session);
      }
      resetPeriodicSnapshotTimer(session);
    }, SNAPSHOT_INTERVAL_MS);
  }

  async function flushPtyBuffer(session: PtySessionState): Promise<void> {
    if (!session.ptyBuffer) return;
    const batch = session.ptyBuffer;
    const hadClear = session.hasClearInBatch;
    session.ptyBuffer = "";
    session.hasClearInBatch = false;
    session.ptyBatchTimer = null;

    if (session.headless) session.headless.write(batch);

    const encoded = new TextEncoder().encode(batch);
    const packed = await encryptChunk(encoded, session.sessionKey);
    const frame = createEncryptedChunkFrame(session.id, packed);

    const ws = getWs();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(frame);
    }

    session.chunksSinceSnapshot++;

    if (session.headless && session.serializer && hadClear) {
      if (session.snapshotTimer) clearTimeout(session.snapshotTimer);
      session.snapshotTimer = setTimeout(async () => {
        session.snapshotTimer = null;
        await createAndSendSnapshot(session);
        resetPeriodicSnapshotTimer(session);
      }, SNAPSHOT_DEBOUNCE);
    }

    if (session.headless && session.serializer && session.chunksSinceSnapshot >= SNAPSHOT_CHUNK_THRESHOLD && !session.snapshotTimer) {
      await createAndSendSnapshot(session);
      resetPeriodicSnapshotTimer(session);
    }
  }

  /** Wire ptyProcess.onData to the batching pipeline. Optional onData callback for local echo. */
  function setupPtyOutput(
    session: PtySessionState,
    opts?: { onData?: (data: string) => void },
  ): void {
    session.ptyProcess.onData((data: string) => {
      if (opts?.onData) opts.onData(data);

      session.ptyBuffer += data;
      if (containsClear(data)) session.hasClearInBatch = true;

      if (Buffer.byteLength(session.ptyBuffer) >= MAX_CHUNK_SIZE) {
        if (session.ptyBatchTimer) { clearTimeout(session.ptyBatchTimer); session.ptyBatchTimer = null; }
        flushPtyBuffer(session);
        return;
      }

      if (!session.ptyBatchTimer) {
        session.ptyBatchTimer = setTimeout(() => flushPtyBuffer(session), PTY_BATCH_INTERVAL_MS);
      }
    });
  }

  /** Flush buffer, cancel timers, send final snapshot, update session status. Does NOT kill PTY. */
  async function cleanupPtySession(
    session: PtySessionState,
    opts: { serverUrl: string; authToken: string },
  ): Promise<void> {
    if (session.ptyBatchTimer) clearTimeout(session.ptyBatchTimer);
    await flushPtyBuffer(session);

    if (session.snapshotTimer) clearTimeout(session.snapshotTimer);
    if (session.periodicSnapshotTimer) clearTimeout(session.periodicSnapshotTimer);

    await createAndSendSnapshot(session);

    try {
      await gql(opts.serverUrl, opts.authToken, `
        mutation ($input: UpdateSessionInput!) {
          updateSession(input: $input) { id }
        }
      `, {
        input: {
          id: session.id,
          status: "stopped",
          endedAt: new Date().toISOString(),
        },
      });
    } catch {
      // Best effort
    }
  }

  return {
    createAndSendSnapshot,
    resetPeriodicSnapshotTimer,
    flushPtyBuffer,
    setupPtyOutput,
    cleanupPtySession,
  };
}
