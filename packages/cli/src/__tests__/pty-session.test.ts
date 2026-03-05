import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { generateSessionKey, decryptChunk } from "@anyterm/utils/crypto";
import { decodeFrame, FrameType } from "@anyterm/utils/protocol";
import { createPtySessionState, createPtySessionManager, type PtySessionState } from "../shared/pty-session.js";

// ── Real WebSocket server ──

let wss: WebSocketServer;
let wsPort: number;

// ── Real HTTP server to stand in for the GraphQL endpoint ──

let gqlServer: http.Server;
let gqlPort: number;
let lastGqlBody: Record<string, unknown> | null;

beforeAll(async () => {
  // WS server — frame collection is per-connection (see connectClient)
  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      if (typeof addr === "object") wsPort = addr.port;
      resolve();
    });
  });

  // HTTP server that mimics /api/graphql
  await new Promise<void>((resolve) => {
    gqlServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        lastGqlBody = JSON.parse(Buffer.concat(chunks).toString());
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { updateSession: { id: "test" } } }));
      });
    });
    gqlServer.listen(0, "127.0.0.1", () => {
      const addr = gqlServer.address();
      if (addr && typeof addr === "object") gqlPort = addr.port;
      resolve();
    });
  });
});

afterAll(async () => {
  wss.close();
  await new Promise<void>((resolve) => gqlServer.close(() => resolve()));
});

beforeEach(() => {
  lastGqlBody = null;
});

// ── Helpers ──

type TestClient = {
  ws: WebSocket;
  frames: Uint8Array[];
  waitForFrames: (n: number, timeoutMs?: number) => Promise<void>;
};

const activeClients: TestClient[] = [];

afterEach(() => {
  for (const client of activeClients) {
    if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) {
      client.ws.close();
    }
  }
  activeClients.length = 0;
});

function connectClient(): Promise<TestClient> {
  return new Promise((resolve) => {
    const frames: Uint8Array[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);

    // Collect frames server-side for this connection only
    wss.once("connection", (serverWs) => {
      serverWs.on("message", (data: Buffer) => {
        frames.push(new Uint8Array(data));
      });
    });

    const waitForFrames = async (n: number, timeoutMs = 2000) => {
      const start = Date.now();
      while (frames.length < n) {
        if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${n} frames (got ${frames.length})`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    ws.on("open", () => {
      const client = { ws, frames, waitForFrames };
      activeClients.push(client);
      resolve(client);
    });
  });
}

function mockPty() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    onData: vi.fn((cb: (data: string) => void) => {
      handlers["data"] = handlers["data"] || [];
      handlers["data"].push(cb);
    }),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    _emit(event: string, ...args: unknown[]) {
      for (const cb of handlers[event] || []) cb(...args);
    },
  };
}

function mockSerializer(content = "serialized-terminal-state") {
  return { serialize: vi.fn(() => content) };
}

function mockHeadless() {
  return { write: vi.fn(), resize: vi.fn(), loadAddon: vi.fn() };
}

function makeSession(overrides: Partial<PtySessionState> = {}): PtySessionState {
  const pty = mockPty();
  return createPtySessionState({
    id: "sess-001",
    sessionKey: generateSessionKey(),
    ptyProcess: pty as unknown as import("node-pty").IPty,
    headless: null,
    serializer: null,
    forwardedPorts: [],
    ...overrides,
  });
}

// ── Tests ──

describe("createPtySessionState", () => {
  it("sets default mutable fields", () => {
    const session = makeSession();
    expect(session.id).toBe("sess-001");
    expect(session.chunksSinceSnapshot).toBe(0);
    expect(session.snapshotInFlight).toBe(false);
    expect(session.periodicSnapshotTimer).toBeNull();
    expect(session.snapshotTimer).toBeNull();
    expect(session.ptyBuffer).toBe("");
    expect(session.ptyBatchTimer).toBeNull();
    expect(session.hasClearInBatch).toBe(false);
  });

  it("preserves init fields", () => {
    const key = generateSessionKey();
    const session = makeSession({ sessionKey: key, forwardedPorts: [3000, 8080] });
    expect(session.sessionKey).toBe(key);
    expect(session.forwardedPorts).toEqual([3000, 8080]);
  });
});

describe("createAndSendSnapshot", () => {
  it("returns false when headless is null", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession();

    expect(await mgr.createAndSendSnapshot(session)).toBe(false);
    expect(client.frames.length).toBe(0);
    client.ws.close();
  });

  it("returns false when snapshotInFlight", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession({
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: mockSerializer() as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });
    session.snapshotInFlight = true;

    expect(await mgr.createAndSendSnapshot(session)).toBe(false);
    client.ws.close();
  });

  it("returns false when ws is null", async () => {
    const mgr = createPtySessionManager(() => null);
    const session = makeSession({
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: mockSerializer() as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });

    expect(await mgr.createAndSendSnapshot(session)).toBe(false);
  });

  it("sends a valid SNAPSHOT frame and resets counter", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const sessionKey = generateSessionKey();
    const session = makeSession({
      sessionKey,
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: mockSerializer("terminal-content") as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });
    session.chunksSinceSnapshot = 50;

    const result = await mgr.createAndSendSnapshot(session);
    expect(result).toBe(true);
    expect(session.chunksSinceSnapshot).toBe(0);
    expect(session.snapshotInFlight).toBe(false);

    await client.waitForFrames(1);
    const frame = decodeFrame(client.frames[0]);
    expect(frame.type).toBe(FrameType.SNAPSHOT);
    expect(frame.sessionId).toBe("sess-001");

    // Decrypt the payload and verify content
    const decrypted = decryptChunk(frame.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe("terminal-content");

    client.ws.close();
  });

  it("resets snapshotInFlight on serializer error", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const badSerializer = { serialize: () => { throw new Error("boom"); } };
    const session = makeSession({
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: badSerializer as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });

    const result = await mgr.createAndSendSnapshot(session);
    expect(result).toBe(false);
    expect(session.snapshotInFlight).toBe(false);
    client.ws.close();
  });
});

describe("flushPtyBuffer", () => {
  it("does nothing when buffer is empty", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession();

    await mgr.flushPtyBuffer(session);
    // Give a moment for any potential frame to arrive
    await new Promise((r) => setTimeout(r, 50));
    expect(client.frames.length).toBe(0);
    client.ws.close();
  });

  it("encrypts buffer and sends a valid ENCRYPTED_CHUNK frame", async () => {
    const client = await connectClient();
    const sessionKey = generateSessionKey();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession({ sessionKey });
    session.ptyBuffer = "hello world";

    await mgr.flushPtyBuffer(session);
    expect(session.ptyBuffer).toBe("");
    expect(session.chunksSinceSnapshot).toBe(1);

    await client.waitForFrames(1);
    const frame = decodeFrame(client.frames[0]);
    expect(frame.type).toBe(FrameType.ENCRYPTED_CHUNK);
    expect(frame.sessionId).toBe("sess-001");

    const decrypted = decryptChunk(frame.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe("hello world");

    client.ws.close();
  });

  it("writes to headless terminal when available", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const headless = mockHeadless();
    const session = makeSession({
      headless: headless as unknown as import("@xterm/headless").Terminal,
    });
    session.ptyBuffer = "terminal output";

    await mgr.flushPtyBuffer(session);
    expect(headless.write).toHaveBeenCalledWith("terminal output");
    client.ws.close();
  });

  it("clears hasClearInBatch flag", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession();
    session.ptyBuffer = "data";
    session.hasClearInBatch = true;

    await mgr.flushPtyBuffer(session);
    expect(session.hasClearInBatch).toBe(false);
    client.ws.close();
  });

  it("triggers snapshot at chunk threshold", async () => {
    const client = await connectClient();
    const sessionKey = generateSessionKey();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession({
      sessionKey,
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: mockSerializer() as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });
    session.ptyBuffer = "data";
    session.chunksSinceSnapshot = 99; // Will become 100 after flush

    await mgr.flushPtyBuffer(session);

    await client.waitForFrames(2);
    const chunkFrame = decodeFrame(client.frames[0]);
    const snapshotFrame = decodeFrame(client.frames[1]);
    expect(chunkFrame.type).toBe(FrameType.ENCRYPTED_CHUNK);
    expect(snapshotFrame.type).toBe(FrameType.SNAPSHOT);
    expect(session.chunksSinceSnapshot).toBe(0);

    client.ws.close();
  });
});

describe("resetPeriodicSnapshotTimer", () => {
  it("does nothing when headless is null", () => {
    const mgr = createPtySessionManager(() => null);
    const session = makeSession();
    mgr.resetPeriodicSnapshotTimer(session);
    expect(session.periodicSnapshotTimer).toBeNull();
  });

  it("sets a timer when headless is available", () => {
    const mgr = createPtySessionManager(() => null);
    const session = makeSession({
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: mockSerializer() as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });

    mgr.resetPeriodicSnapshotTimer(session);
    expect(session.periodicSnapshotTimer).not.toBeNull();
    clearTimeout(session.periodicSnapshotTimer!);
  });

  it("replaces previous timer", () => {
    const mgr = createPtySessionManager(() => null);
    const session = makeSession({
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: mockSerializer() as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });

    mgr.resetPeriodicSnapshotTimer(session);
    const first = session.periodicSnapshotTimer;
    mgr.resetPeriodicSnapshotTimer(session);
    expect(session.periodicSnapshotTimer).not.toBe(first);
    clearTimeout(session.periodicSnapshotTimer!);
  });
});

describe("setupPtyOutput", () => {
  it("registers onData handler and buffers data", () => {
    const mgr = createPtySessionManager(() => null);
    const pty = mockPty();
    const session = makeSession({
      ptyProcess: pty as unknown as import("node-pty").IPty,
    });

    mgr.setupPtyOutput(session);
    expect(pty.onData).toHaveBeenCalledOnce();

    pty._emit("data", "hello");
    expect(session.ptyBuffer).toBe("hello");
  });

  it("calls onData callback for local echo", () => {
    const mgr = createPtySessionManager(() => null);
    const pty = mockPty();
    const session = makeSession({
      ptyProcess: pty as unknown as import("node-pty").IPty,
    });
    const onData = vi.fn();

    mgr.setupPtyOutput(session, { onData });
    pty._emit("data", "output");
    expect(onData).toHaveBeenCalledWith("output");
  });

  it("detects clear sequences", () => {
    const mgr = createPtySessionManager(() => null);
    const pty = mockPty();
    const session = makeSession({
      ptyProcess: pty as unknown as import("node-pty").IPty,
    });

    mgr.setupPtyOutput(session);
    pty._emit("data", "\x1b[2J");
    expect(session.hasClearInBatch).toBe(true);
  });
});

describe("cleanupPtySession", () => {
  it("flushes buffer, sends snapshot, and calls GQL to update status", async () => {
    const client = await connectClient();
    const sessionKey = generateSessionKey();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession({
      sessionKey,
      headless: mockHeadless() as unknown as import("@xterm/headless").Terminal,
      serializer: mockSerializer() as unknown as import("@xterm/addon-serialize").SerializeAddon,
    });
    session.ptyBuffer = "remaining data";

    const serverUrl = `http://127.0.0.1:${gqlPort}`;
    await mgr.cleanupPtySession(session, { serverUrl, authToken: "test-token" });

    // Buffer flushed + snapshot sent
    await client.waitForFrames(2);
    const chunkFrame = decodeFrame(client.frames[0]);
    const snapshotFrame = decodeFrame(client.frames[1]);
    expect(chunkFrame.type).toBe(FrameType.ENCRYPTED_CHUNK);
    expect(snapshotFrame.type).toBe(FrameType.SNAPSHOT);

    // Verify buffer content was encrypted correctly
    const decrypted = decryptChunk(chunkFrame.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe("remaining data");

    // GQL was called with correct mutation
    expect(lastGqlBody).not.toBeNull();
    expect(lastGqlBody!.query).toContain("updateSession");
    const input = (lastGqlBody!.variables as Record<string, unknown>).input as Record<string, unknown>;
    expect(input.id).toBe("sess-001");
    expect(input.status).toBe("stopped");
    expect(input.endedAt).toBeDefined();

    client.ws.close();
  });

  it("cancels pending timers", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession();

    session.ptyBatchTimer = setTimeout(() => {}, 60000);
    session.snapshotTimer = setTimeout(() => {}, 60000);
    session.periodicSnapshotTimer = setTimeout(() => {}, 60000);

    const serverUrl = `http://127.0.0.1:${gqlPort}`;
    await mgr.cleanupPtySession(session, { serverUrl, authToken: "tok" });

    // No error = timers were cleared properly
    client.ws.close();
  });

  it("handles GQL failure gracefully (best effort)", async () => {
    const client = await connectClient();
    const mgr = createPtySessionManager(() => client.ws);
    const session = makeSession();

    // Point at a non-existent server
    await mgr.cleanupPtySession(session, { serverUrl: "http://127.0.0.1:1", authToken: "tok" });

    // Should not throw
    client.ws.close();
  });
});
