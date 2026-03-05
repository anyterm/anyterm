import { eq, and, lte, max } from "drizzle-orm";
import { terminalSessions, terminalChunks } from "@anyterm/db";
import { db } from "./db.js";

// Per-session sequence counters
const sessionSeqCounters = new Map<string, number>();

// Tracks in-flight initSessionSeq promises to prevent concurrent initialization
const pendingInits = new Map<string, Promise<void>>();

// Global chunk queue (across all sessions)
const pendingChunks: Array<{ sessionId: string; seq: number; data: string }> = [];

// Adaptive flush: trigger early when queue gets large instead of dropping data
const FLUSH_THRESHOLD = 5_000;
const MAX_PENDING_CHUNKS = 50_000;
let flushInProgress = false;

let flushTimer: NodeJS.Timeout | null = null;

/** Extract a Postgres error code from either `err.cause.code` or `err.code`. */
function getDbErrorCode(err: unknown): string | undefined {
  return (
    (err as { cause?: { code?: string } })?.cause?.code ??
    (err as { code?: string })?.code
  );
}

/**
 * Initialize the seq counter for a session by querying DB for max(seq).
 * Called when a CLI subscribes to a session.
 */
export async function initSessionSeq(sessionId: string): Promise<void> {
  // If already initialized, skip
  if (sessionSeqCounters.has(sessionId)) return;

  // If another call is already initializing this session, wait for it
  const existing = pendingInits.get(sessionId);
  if (existing) {
    await existing;
    return;
  }

  const init = (async () => {
    try {
      // Double-check after acquiring the "lock"
      if (sessionSeqCounters.has(sessionId)) return;

      const [result] = await db
        .select({ maxSeq: max(terminalChunks.seq) })
        .from(terminalChunks)
        .where(eq(terminalChunks.sessionId, sessionId));

      const currentMax = result?.maxSeq ?? 0;

      // Also check snapshotSeq — chunks before it are deleted
      const [session] = await db
        .select({ snapshotSeq: terminalSessions.snapshotSeq })
        .from(terminalSessions)
        .where(eq(terminalSessions.id, sessionId));

      const snapshotSeq = session?.snapshotSeq ?? 0;
      sessionSeqCounters.set(sessionId, Math.max(currentMax, snapshotSeq));
    } catch (err) {
      console.error("[Persistence] Failed to init seq for session", sessionId, err);
      if (!sessionSeqCounters.has(sessionId)) {
        sessionSeqCounters.set(sessionId, 0);
      }
    }
  })();

  pendingInits.set(sessionId, init);
  try {
    await init;
  } finally {
    pendingInits.delete(sessionId);
  }
}

/**
 * Queue a chunk for batch persistence.
 * Called synchronously from the WS frame handler.
 *
 * Under high load, triggers an early flush instead of waiting for the 2s timer.
 * At 1000 concurrent users (~3,200 chunks/2s): timer handles everything.
 * At 10,000 concurrent users (~32,000 chunks/2s): adaptive flush fires 6-7 times per cycle.
 */
export function queueChunk(sessionId: string, payload: Uint8Array): void {
  if (pendingChunks.length >= MAX_PENDING_CHUNKS) {
    console.error(
      `[Persistence] Safety cap reached (${MAX_PENDING_CHUNKS} chunks). DB may be unreachable. Dropping oldest 10%.`,
    );
    pendingChunks.splice(0, Math.ceil(MAX_PENDING_CHUNKS * 0.1));
  }

  const current = sessionSeqCounters.get(sessionId) ?? 0;
  const nextSeq = current + 1;
  sessionSeqCounters.set(sessionId, nextSeq);

  const data = Buffer.from(payload).toString("base64");
  pendingChunks.push({ sessionId, seq: nextSeq, data });

  // Adaptive: flush early under load instead of waiting for timer
  if (pendingChunks.length >= FLUSH_THRESHOLD && !flushInProgress) {
    flushInProgress = true;
    flushAllChunks().finally(() => {
      flushInProgress = false;
    });
  }
}

/**
 * Flush ALL pending chunks across all sessions in one bulk INSERT.
 */
export async function flushAllChunks(): Promise<void> {
  if (pendingChunks.length === 0) return;

  const batch = pendingChunks.splice(0);
  try {
    await db.insert(terminalChunks).values(batch).onConflictDoNothing();
  } catch (err: unknown) {
    // FK violation — session was deleted while chunks were queued
    if (getDbErrorCode(err) === "23503") {
      const detail =
        (err as { cause?: { detail?: string } })?.cause?.detail ??
        (err as { detail?: string })?.detail ??
        "";
      const match = detail.match(/\(session_id\)=\((.+?)\)/);
      if (match) {
        const deletedId = match[1];
        console.warn(
          `[Persistence] Session ${deletedId} deleted — discarding its chunks`,
        );
        cleanupSession(deletedId);
        const remaining = batch.filter((c) => c.sessionId !== deletedId);
        if (remaining.length > 0) {
          pendingChunks.push(...remaining);
        }
      }
      return;
    }

    console.error("[Persistence] Bulk chunk flush failed:", err);
    // Re-queue failed batch so next flush retries
    pendingChunks.push(...batch);
  }
}

/**
 * Flush only chunks for a specific session (used before snapshot).
 */
export async function flushSessionChunks(sessionId: string): Promise<void> {
  const sessionBatch: Array<{ sessionId: string; seq: number; data: string }> =
    [];
  const remaining: Array<{ sessionId: string; seq: number; data: string }> = [];

  for (const chunk of pendingChunks) {
    if (chunk.sessionId === sessionId) {
      sessionBatch.push(chunk);
    } else {
      remaining.push(chunk);
    }
  }

  if (sessionBatch.length === 0) return;

  // Replace global queue with non-matching chunks
  pendingChunks.length = 0;
  pendingChunks.push(...remaining);

  try {
    await db.insert(terminalChunks).values(sessionBatch).onConflictDoNothing();
  } catch (err: unknown) {
    if (getDbErrorCode(err) === "23503") {
      // Session was deleted — discard chunks
      console.warn(
        `[Persistence] Session ${sessionId} deleted — discarding its chunks`,
      );
      return;
    }
    console.error("[Persistence] Session chunk flush failed:", err);
    pendingChunks.push(...sessionBatch);
  }
}

/**
 * Store a snapshot and prune old chunks.
 * Flushes pending chunks for this session first to ensure consistency.
 */
export async function storeSnapshot(
  sessionId: string,
  payload: Uint8Array,
): Promise<void> {
  // Flush pending chunks for this session first
  await flushSessionChunks(sessionId);

  const afterSeq = sessionSeqCounters.get(sessionId) ?? 0;
  const data = Buffer.from(payload).toString("base64");

  try {
    await db.transaction(async (tx) => {
      // Update session with snapshot
      await tx
        .update(terminalSessions)
        .set({ snapshotSeq: afterSeq, snapshotData: data })
        .where(eq(terminalSessions.id, sessionId));

      // Delete old chunks covered by the snapshot
      await tx
        .delete(terminalChunks)
        .where(
          and(
            eq(terminalChunks.sessionId, sessionId),
            lte(terminalChunks.seq, afterSeq),
          ),
        );
    });
  } catch (err) {
    console.error("[Persistence] Snapshot storage failed:", err);
  }
}

/**
 * Purge pending chunks for a session from the in-memory queue (no DB write).
 * Called when a session is deleted to prevent FK violations on next flush.
 */
export function purgeSessionChunks(sessionId: string): void {
  let i = pendingChunks.length;
  while (i--) {
    if (pendingChunks[i].sessionId === sessionId) {
      pendingChunks.splice(i, 1);
    }
  }
}

/**
 * Mark a session as disconnected in the DB.
 * Called immediately when the last CLI client drops.
 */
export async function markSessionDisconnected(sessionId: string): Promise<void> {
  await db
    .update(terminalSessions)
    .set({ status: "disconnected" })
    .where(eq(terminalSessions.id, sessionId));
}

/**
 * Mark a session as stopped in the DB.
 * Called after the grace period when no CLI reconnects.
 */
export async function markSessionStopped(sessionId: string): Promise<void> {
  await db
    .update(terminalSessions)
    .set({ status: "stopped", endedAt: new Date() })
    .where(eq(terminalSessions.id, sessionId));
}

/**
 * Mark a session as running in the DB.
 * Called when CLI reconnects after a temporary disconnect.
 */
export async function markSessionRunning(sessionId: string): Promise<void> {
  await db
    .update(terminalSessions)
    .set({ status: "running", endedAt: null })
    .where(eq(terminalSessions.id, sessionId));
}

/**
 * Remove session from seq tracking.
 */
export function cleanupSession(sessionId: string): void {
  sessionSeqCounters.delete(sessionId);
}

/**
 * Start the global 2s flush timer.
 */
export function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushAllChunks().catch((err) =>
      console.error("[Persistence] Flush timer error:", err),
    );
  }, 2000);
}

/**
 * Stop the global flush timer and flush remaining chunks.
 */
export async function stopFlushTimer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush to persist any remaining in-memory chunks
  await flushAllChunks();
}
