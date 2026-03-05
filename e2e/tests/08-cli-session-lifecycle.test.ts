import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { getEnv } from "../helpers/env.js";
import { WsClient } from "../helpers/ws-client.js";
import {
  deriveKeysFromPassword,
  decryptPrivateKey,
  generateSessionKey,
  encryptSessionKey,
  decryptSessionKey,
  encryptChunk,
  decryptChunk,
  toBase64,
  fromBase64,
  createSubscribeFrame,
  createEncryptedChunkFrame,
  createEncryptedInputFrame,
  FrameType,
} from "../helpers/crypto.js";

/**
 * Simulates the full `anyterm run` command flow using Bearer-auth GraphQL
 * and WebSocket with `source=cli`.
 *
 * Intentionally does NOT reuse ApiClient/loginUser since those use Cookie auth.
 * The CLI uses Bearer tokens exclusively.
 */

// --- Inline helpers mimicking CLI auth path ---

interface CliLoginResult {
  token: string;
  userId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

async function cliLogin(email: string, password: string): Promise<CliLoginResult> {
  const { baseUrl } = getEnv();

  // Step 1: POST sign-in with Origin (mirrors login.ts)
  const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!signInRes.ok) {
    throw new Error(`CLI login failed: ${signInRes.status}`);
  }

  const signInData = await signInRes.json();
  const token = signInData.session?.token ?? signInData.token;
  const userId = signInData.user?.id;

  if (!token || !userId) {
    throw new Error("CLI login: missing token or userId");
  }

  // Activate personal org on the new CLI session
  try {
    const orgsRes = await fetch(
      `${baseUrl}/api/auth/organization/list`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (orgsRes.ok) {
      const orgs = await orgsRes.json();
      const personalOrg = orgs?.find((o: any) => o.slug === userId);
      if (personalOrg) {
        await fetch(`${baseUrl}/api/auth/organization/set-active`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ organizationId: personalOrg.id }),
        });
      }
    }
  } catch {
    // Best effort
  }

  // Step 2: Fetch keys via Bearer-auth GraphQL (mirrors login.ts)
  const keysData = await cliGql<{
    userKeys: { publicKey: string; encryptedPrivateKey: string; keySalt: string };
  }>(token, `query { userKeys { publicKey encryptedPrivateKey keySalt } }`);

  // Step 3: Derive masterKey and decrypt privateKey
  const salt = fromBase64(keysData.userKeys.keySalt);
  const { masterKey } = await deriveKeysFromPassword(password, salt);
  const encPk = fromBase64(keysData.userKeys.encryptedPrivateKey);
  const privateKey = await decryptPrivateKey(encPk, masterKey);
  const publicKey = fromBase64(keysData.userKeys.publicKey);

  return { token, userId, publicKey, privateKey };
}

async function cliGql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const { baseUrl } = getEnv();
  const res = await fetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${json.errors[0].message}`);
  }

  return json.data as T;
}

// --- Tests ---

describe("CLI Session Lifecycle", () => {
  let user: RegisteredUser;
  let cli: CliLoginResult;
  let sessionId: string;
  let sessionKey: Uint8Array;
  let cliWs: WsClient;
  let browserWs: WsClient;

  beforeAll(async () => {
    user = await registerUser();
    cli = await cliLogin(user.email, user.password);
  });

  afterAll(() => {
    cliWs?.close();
    browserWs?.close();
  });

  it("creates a session with encrypted session key via Bearer-auth GraphQL", async () => {
    sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(sessionKey, cli.publicKey);

    const data = await cliGql<{
      createSession: {
        id: string;
        status: string;
        name: string;
        command: string;
        encryptedSessionKey: string;
      };
    }>(cli.token, `
      mutation ($input: CreateSessionInput!) {
        createSession(input: $input) {
          id status name command encryptedSessionKey cols rows
        }
      }
    `, {
      input: {
        name: "cli-lifecycle-test",
        command: "echo hello",
        encryptedSessionKey: toBase64(encryptedSessionKey),
        cols: 80,
        rows: 24,
      },
    });

    sessionId = data.createSession.id;
    expect(sessionId).toBeTruthy();
    expect(data.createSession.status).toBe("running");
    expect(data.createSession.name).toBe("cli-lifecycle-test");
  });

  it("CLI WebSocket connects with source=cli and subscribes", async () => {
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 200));
  });

  it("browser WebSocket connects and subscribes", async () => {
    browserWs = new WsClient();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 200));
  });

  it("CLI sends encrypted output, browser receives and decrypts", async () => {
    const plaintext = "cli-lifecycle: terminal output";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(plaintext),
      sessionKey,
    );
    const frame = createEncryptedChunkFrame(sessionId, encrypted);
    cliWs.send(frame);

    const received = await browserWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_CHUNK,
    );
    expect(received.sessionId).toBe(sessionId);

    const decrypted = await decryptChunk(received.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
  });

  it("browser sends encrypted input, CLI receives and decrypts", async () => {
    const plaintext = "cli-lifecycle: user input";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(plaintext),
      sessionKey,
    );
    const frame = createEncryptedInputFrame(sessionId, encrypted);
    browserWs.send(frame);

    const received = await cliWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_INPUT,
    );
    expect(received.sessionId).toBe(sessionId);

    const decrypted = await decryptChunk(received.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
  });

  it("stores encrypted chunks via Bearer-auth GraphQL", async () => {
    const lines = ["$ echo hello", "hello", "$ exit"];

    const chunks = await Promise.all(
      lines.map(async (line, i) => {
        const encrypted = await encryptChunk(
          new TextEncoder().encode(line),
          sessionKey,
        );
        // Start at seq 2 — seq 1 was already persisted by WS relay in previous test
        return { seq: i + 2, data: toBase64(encrypted) };
      }),
    );

    const data = await cliGql<{ storeChunks: boolean }>(cli.token, `
      mutation ($sessionId: String!, $chunks: [ChunkInput!]!) {
        storeChunks(sessionId: $sessionId, chunks: $chunks)
      }
    `, { sessionId, chunks });

    expect(data.storeChunks).toBe(true);
  });

  it("updates session to stopped via Bearer-auth GraphQL", async () => {
    const data = await cliGql<{
      updateSession: { id: string; status: string };
    }>(cli.token, `
      mutation ($input: UpdateSessionInput!) {
        updateSession(input: $input) { id status }
      }
    `, {
      input: {
        id: sessionId,
        status: "stopped",
        endedAt: new Date().toISOString(),
      },
    });

    expect(data.updateSession.status).toBe("stopped");
  });

  it("lists sessions and verifies the stopped session", async () => {
    const data = await cliGql<{
      sessions: Array<{ id: string; status: string; name: string }>;
    }>(cli.token, `
      query { sessions { id status name } }
    `);

    const session = data.sessions.find((s) => s.id === sessionId);
    expect(session).toBeTruthy();
    expect(session!.status).toBe("stopped");
    expect(session!.name).toBe("cli-lifecycle-test");
  });

  it("browser re-login decrypts sessionKey and replays chunks", async () => {
    // Fresh CLI-style login (simulating browser using same auth path)
    const fresh = await cliLogin(user.email, user.password);

    // Fetch session to get encryptedSessionKey
    const sessionData = await cliGql<{
      session: { id: string; encryptedSessionKey: string };
    }>(fresh.token, `
      query ($id: String!) {
        session(id: $id) { id encryptedSessionKey }
      }
    `, { id: sessionId });

    expect(sessionData.session).toBeTruthy();

    // Decrypt session key using fresh login's private key
    const decryptedSessionKey = await decryptSessionKey(
      fromBase64(sessionData.session.encryptedSessionKey),
      fresh.publicKey,
      fresh.privateKey,
    );

    // Fetch and decrypt chunks
    const chunksData = await cliGql<{
      chunks: Array<{ seq: number; data: string }>;
    }>(fresh.token, `
      query ($sessionId: String!, $after: Int!, $limit: Int!) {
        chunks(sessionId: $sessionId, after: $after, limit: $limit) {
          seq data
        }
      }
    `, { sessionId, after: 0, limit: 1000 });

    // 4 chunks: 1 persisted by WS server from relay test + 3 stored via HTTP
    expect(chunksData.chunks).toHaveLength(4);

    const decryptedLines = await Promise.all(
      chunksData.chunks.map(async (chunk) => {
        const decrypted = await decryptChunk(
          fromBase64(chunk.data),
          decryptedSessionKey,
        );
        return new TextDecoder().decode(decrypted);
      }),
    );

    // WS-persisted chunk ordering relative to HTTP chunks depends on flush timing
    expect(decryptedLines).toContain("cli-lifecycle: terminal output");
    expect(decryptedLines).toContain("$ echo hello");
    expect(decryptedLines).toContain("hello");
    expect(decryptedLines).toContain("$ exit");
  });
});
