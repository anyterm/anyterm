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
 * Tests the "interactive shell" session flow — `anyterm run` with no command.
 *
 * When the user runs `anyterm run` without arguments, the CLI spawns $SHELL
 * and creates a session with name="shell" and command=$SHELL. This test
 * verifies that such sessions work correctly end-to-end.
 */

// --- Inline CLI helpers (same pattern as 08-cli-session-lifecycle) ---

interface CliLoginResult {
  token: string;
  userId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

async function cliLogin(email: string, password: string): Promise<CliLoginResult> {
  const { baseUrl } = getEnv();

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

  // Activate personal org
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

  const keysData = await cliGql<{
    userKeys: { publicKey: string; encryptedPrivateKey: string; keySalt: string };
  }>(token, `query { userKeys { publicKey encryptedPrivateKey keySalt } }`);

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

describe("Interactive Shell Session (anyterm run without command)", () => {
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

  it("creates a session with name='shell' and shell command (no explicit command)", async () => {
    sessionKey = await generateSessionKey();
    const encryptedSessionKey = await encryptSessionKey(sessionKey, cli.publicKey);

    // Simulate `anyterm run` with no command — CLI sets name="shell", command=$SHELL
    const shellPath = process.env.SHELL || "/bin/bash";
    const data = await cliGql<{
      createSession: {
        id: string;
        status: string;
        name: string;
        command: string;
        cols: number;
        rows: number;
      };
    }>(cli.token, `
      mutation ($input: CreateSessionInput!) {
        createSession(input: $input) {
          id status name command cols rows
        }
      }
    `, {
      input: {
        name: "shell",
        command: shellPath,
        encryptedSessionKey: toBase64(encryptedSessionKey),
        cols: 80,
        rows: 24,
      },
    });

    sessionId = data.createSession.id;
    expect(sessionId).toBeTruthy();
    expect(data.createSession.status).toBe("running");
    expect(data.createSession.name).toBe("shell");
    expect(data.createSession.command).toBe(shellPath);
  });

  it("session appears in list with correct metadata", async () => {
    const data = await cliGql<{
      sessions: Array<{ id: string; name: string; command: string; status: string }>;
    }>(cli.token, `
      query { sessions { id name command status } }
    `);

    const session = data.sessions.find((s) => s.id === sessionId);
    expect(session).toBeTruthy();
    expect(session!.name).toBe("shell");
    expect(session!.status).toBe("running");
  });

  it("CLI WebSocket connects and subscribes to shell session", async () => {
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 200));
  });

  it("browser WebSocket connects and subscribes to shell session", async () => {
    browserWs = new WsClient();
    await browserWs.connect(user.token, "browser");
    browserWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 200));
  });

  it("interactive shell output streams to browser", async () => {
    // Simulate shell prompt + command output
    const shellOutput = "user@host:~$ ls\nfile1.txt  file2.txt\nuser@host:~$ ";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(shellOutput),
      sessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(sessionId, encrypted));

    const received = await browserWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_CHUNK,
    );
    expect(received.sessionId).toBe(sessionId);

    const decrypted = await decryptChunk(received.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe(shellOutput);
  });

  it("browser input reaches CLI in shell session", async () => {
    // Simulate user typing a command in browser
    const userInput = "echo hello world\n";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(userInput),
      sessionKey,
    );
    browserWs.send(createEncryptedInputFrame(sessionId, encrypted));

    const received = await cliWs.waitForMessage(
      (f) => f.type === FrameType.ENCRYPTED_INPUT,
    );
    expect(received.sessionId).toBe(sessionId);

    const decrypted = await decryptChunk(received.payload, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe(userInput);
  });

  it("multiple commands can be run within the same shell session", async () => {
    // Simulate running several commands in the interactive shell
    const commands = [
      "$ echo first\nfirst\n",
      "$ echo second\nsecond\n",
      "$ python3 -c 'print(42)'\n42\n",
    ];

    for (const output of commands) {
      // Clear stale ENCRYPTED_CHUNK frames so waitForMessage waits for the new one
      browserWs.receivedFrames = browserWs.receivedFrames.filter(
        (f) => f.type !== FrameType.ENCRYPTED_CHUNK,
      );

      const encrypted = await encryptChunk(
        new TextEncoder().encode(output),
        sessionKey,
      );
      cliWs.send(createEncryptedChunkFrame(sessionId, encrypted));

      const received = await browserWs.waitForMessage(
        (f) => f.type === FrameType.ENCRYPTED_CHUNK,
      );
      const decrypted = await decryptChunk(received.payload, sessionKey);
      expect(new TextDecoder().decode(decrypted)).toBe(output);
    }
  });

  it("shell session can be stopped like any other session", async () => {
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

  it("stopped shell session retains name='shell' in listing", async () => {
    const data = await cliGql<{
      sessions: Array<{ id: string; name: string; status: string }>;
    }>(cli.token, `
      query { sessions { id name status } }
    `);

    const session = data.sessions.find((s) => s.id === sessionId);
    expect(session).toBeTruthy();
    expect(session!.name).toBe("shell");
    expect(session!.status).toBe("stopped");
  });

  it("chunks from shell session can be replayed after stop", async () => {
    // Fresh login to verify replay works
    const fresh = await cliLogin(user.email, user.password);

    const sessionData = await cliGql<{
      session: { id: string; encryptedSessionKey: string; name: string };
    }>(fresh.token, `
      query ($id: String!) {
        session(id: $id) { id encryptedSessionKey name }
      }
    `, { id: sessionId });

    expect(sessionData.session.name).toBe("shell");

    // Decrypt session key
    const decryptedSessionKey = await decryptSessionKey(
      fromBase64(sessionData.session.encryptedSessionKey),
      fresh.publicKey,
      fresh.privateKey,
    );

    // Fetch chunks — the WS relay persists chunks sent via ENCRYPTED_CHUNK
    const chunksData = await cliGql<{
      chunks: Array<{ seq: number; data: string }>;
    }>(fresh.token, `
      query ($sessionId: String!, $after: Int!, $limit: Int!) {
        chunks(sessionId: $sessionId, after: $after, limit: $limit) {
          seq data
        }
      }
    `, { sessionId, after: 0, limit: 1000 });

    // We sent 4 ENCRYPTED_CHUNK frames (1 shell output + 3 multi-command)
    expect(chunksData.chunks.length).toBeGreaterThanOrEqual(4);

    // Decrypt all chunks and verify content
    const decryptedLines = await Promise.all(
      chunksData.chunks.map(async (chunk) => {
        const decrypted = await decryptChunk(
          fromBase64(chunk.data),
          decryptedSessionKey,
        );
        return new TextDecoder().decode(decrypted);
      }),
    );

    // Verify key content is present
    expect(decryptedLines).toContain("user@host:~$ ls\nfile1.txt  file2.txt\nuser@host:~$ ");
    expect(decryptedLines).toContain("$ echo first\nfirst\n");
    expect(decryptedLines).toContain("$ echo second\nsecond\n");
  });
});
