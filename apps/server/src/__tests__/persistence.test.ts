import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock fns are available inside the vi.mock factory
const { mockInsert, mockUpdate } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../db.js", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    delete: vi.fn(),
    select: vi.fn(),
  },
}));

import {
  queueChunk,
  purgeSessionChunks,
  cleanupSession,
  flushAllChunks,
  flushSessionChunks,
  markSessionDisconnected,
  markSessionStopped,
  markSessionRunning,
  stopFlushTimer,
} from "../persistence.js";

// Helper: set up the mock chain for insert
function mockInsertSuccess() {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  mockInsert.mockReturnValue(chain);
  return chain;
}

// Helper: set up the mock chain for update
function mockUpdateSuccess() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  mockUpdate.mockReturnValue(chain);
  return chain;
}

// Helper: make insert throw an FK violation
function mockInsertFkViolation(sessionId: string) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockRejectedValue({
      code: "23503",
      detail: `Key (session_id)=(${sessionId}) is not present in table "terminal_sessions".`,
      cause: {
        code: "23503",
        detail: `Key (session_id)=(${sessionId}) is not present in table "terminal_sessions".`,
      },
    }),
  };
  mockInsert.mockReturnValue(chain);
  return chain;
}

describe("Persistence — In-memory chunk queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopFlushTimer();
  });

  it("queueChunk increments seq per session", async () => {
    cleanupSession("s1");
    cleanupSession("s2");

    const chain = mockInsertSuccess();

    queueChunk("s1", new TextEncoder().encode("a"));
    queueChunk("s1", new TextEncoder().encode("b"));
    queueChunk("s2", new TextEncoder().encode("c"));
    queueChunk("s1", new TextEncoder().encode("d"));

    await flushAllChunks();

    const values = chain.values.mock.calls[0][0];
    expect(values).toHaveLength(4);
    expect(values[0]).toMatchObject({ sessionId: "s1", seq: 1 });
    expect(values[1]).toMatchObject({ sessionId: "s1", seq: 2 });
    expect(values[2]).toMatchObject({ sessionId: "s2", seq: 1 });
    expect(values[3]).toMatchObject({ sessionId: "s1", seq: 3 });
  });

  it("purgeSessionChunks removes only chunks for the target session", async () => {
    cleanupSession("s1");
    cleanupSession("s2");

    queueChunk("s1", new TextEncoder().encode("keep"));
    queueChunk("s2", new TextEncoder().encode("remove"));
    queueChunk("s1", new TextEncoder().encode("keep2"));
    queueChunk("s2", new TextEncoder().encode("remove2"));

    purgeSessionChunks("s2");

    const chain = mockInsertSuccess();
    await flushAllChunks();

    const values = chain.values.mock.calls[0]?.[0] ?? [];
    expect(values).toHaveLength(2);
    expect(values.every((v: { sessionId: string }) => v.sessionId === "s1")).toBe(true);
  });

  it("purgeSessionChunks is a no-op when session has no queued chunks", () => {
    purgeSessionChunks("nonexistent");
  });

  it("flushAllChunks handles FK violation by discarding deleted session chunks", async () => {
    cleanupSession("s1");
    cleanupSession("s2");

    queueChunk("s1", new TextEncoder().encode("ok"));
    queueChunk("s2", new TextEncoder().encode("will-fail"));
    queueChunk("s1", new TextEncoder().encode("ok2"));

    // First flush: FK violation on s2
    mockInsertFkViolation("s2");
    await flushAllChunks();

    // Second flush: only s1's chunks should be re-queued
    const chain = mockInsertSuccess();
    await flushAllChunks();

    const values = chain.values.mock.calls[0]?.[0] ?? [];
    expect(values).toHaveLength(2);
    expect(values.every((v: { sessionId: string }) => v.sessionId === "s1")).toBe(true);
  });

  it("flushSessionChunks handles FK violation gracefully", async () => {
    cleanupSession("s1");

    queueChunk("s1", new TextEncoder().encode("data1"));
    queueChunk("s1", new TextEncoder().encode("data2"));

    // FK violation — session was deleted
    mockInsertFkViolation("s1");
    await flushSessionChunks("s1");

    // Queue should be empty — chunks were discarded, not re-queued
    const chain = mockInsertSuccess();
    await flushAllChunks();

    expect(chain.values).not.toHaveBeenCalled();
  });

  it("cleanupSession removes seq counter so next chunk starts at 1", async () => {
    cleanupSession("s1");

    queueChunk("s1", new TextEncoder().encode("a"));
    queueChunk("s1", new TextEncoder().encode("b"));

    purgeSessionChunks("s1");
    cleanupSession("s1");

    const chain = mockInsertSuccess();
    queueChunk("s1", new TextEncoder().encode("c"));
    await flushAllChunks();

    const values = chain.values.mock.calls[0][0];
    expect(values[0]).toMatchObject({ sessionId: "s1", seq: 1 });
  });
});

describe("Persistence — Adaptive flush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopFlushTimer();
  });

  it("triggers early flush when queue reaches threshold", async () => {
    // Clean up sessions
    for (let i = 0; i < 100; i++) cleanupSession(`s${i}`);

    const chain = mockInsertSuccess();
    const payload = new TextEncoder().encode("x".repeat(100));

    // Queue 5000 chunks (the FLUSH_THRESHOLD) across 100 sessions
    for (let i = 0; i < 5000; i++) {
      queueChunk(`s${i % 100}`, payload);
    }

    // The 5000th queueChunk should have triggered an async flush.
    // Wait for it to complete.
    await vi.waitFor(() => {
      expect(chain.values).toHaveBeenCalled();
    });

    const values = chain.values.mock.calls[0][0];
    expect(values.length).toBeGreaterThanOrEqual(5000);
  });

  it("does not trigger early flush below threshold", async () => {
    cleanupSession("s1");

    const chain = mockInsertSuccess();

    // Queue fewer than threshold
    for (let i = 0; i < 100; i++) {
      queueChunk("s1", new TextEncoder().encode("x"));
    }

    // No automatic flush should have fired
    expect(chain.values).not.toHaveBeenCalled();

    // Manual flush works
    await flushAllChunks();
    expect(chain.values).toHaveBeenCalled();
    expect(chain.values.mock.calls[0][0]).toHaveLength(100);
  });
});

describe("Persistence — Status updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("markSessionDisconnected updates status to disconnected", async () => {
    const chain = mockUpdateSuccess();
    await markSessionDisconnected("test-session");

    expect(mockUpdate).toHaveBeenCalled();
    expect(chain.set).toHaveBeenCalledWith({ status: "disconnected" });
    expect(chain.where).toHaveBeenCalled();
  });

  it("markSessionStopped updates status to stopped with endedAt", async () => {
    const chain = mockUpdateSuccess();
    await markSessionStopped("test-session");

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "stopped",
        endedAt: expect.any(Date),
      }),
    );
  });

  it("markSessionRunning updates status to running with null endedAt", async () => {
    const chain = mockUpdateSuccess();
    await markSessionRunning("test-session");

    expect(chain.set).toHaveBeenCalledWith({
      status: "running",
      endedAt: null,
    });
  });

  it("markSessionDisconnected propagates DB errors", async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("DB down")),
      }),
    });

    await expect(markSessionDisconnected("test-session")).rejects.toThrow("DB down");
  });

  it("markSessionStopped propagates DB errors", async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("DB down")),
      }),
    });

    await expect(markSessionStopped("test-session")).rejects.toThrow("DB down");
  });
});
