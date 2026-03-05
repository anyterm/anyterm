import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as http from "node:http";

// ── Infrastructure mocks (third-party/OS only) ──

const mockGetPassword = vi.fn();
const mockSetPassword = vi.fn();
const mockDeletePassword = vi.fn();

vi.mock("keytar", () => ({
  default: {
    getPassword: mockGetPassword,
    setPassword: mockSetPassword,
    deletePassword: mockDeletePassword,
  },
}));

const mockStore: Record<string, unknown> = {};
vi.mock("conf", () => ({
  default: class {
    store = mockStore;
    path = "/tmp/test-config.json";
    get(key: string) { return mockStore[key]; }
    set(key: string, value: unknown) { mockStore[key] = value; }
    has(key: string) { return key in mockStore; }
    delete(key: string) { delete mockStore[key]; }
  },
}));

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question: vi.fn(), close: vi.fn() }),
}));

// ── Real module imports (backed by mocked infrastructure) ──

const { setActiveServer, setServerConfig, getActiveServer, getServerConfig, config } =
  await import("../config.js");
const { setSecret, getSecret, _resetPlaintextConfirmation } =
  await import("../secure-store.js");
const { _resetMigrationState } = await import("../migrate.js");
const { logoutCommand } = await import("../commands/logout.js");

// ── Real HTTP server for sign-out endpoint ──

let server: http.Server;
let serverPort: number;
let lastRequest: { method: string; url: string; authorization: string } | null;
let signOutShouldFail = false;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      lastRequest = {
        method: req.method!,
        url: req.url!,
        authorization: req.headers.authorization || "",
      };
      if (signOutShouldFail) {
        res.destroy();
        return;
      }
      res.writeHead(200).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") serverPort = addr.port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function clearStore() {
  for (const key of Object.keys(mockStore)) delete mockStore[key];
}

function serverUrl() {
  return `http://127.0.0.1:${serverPort}`;
}

describe("anyterm logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore();
    _resetMigrationState();
    _resetPlaintextConfirmation();
    lastRequest = null;
    signOutShouldFail = false;
    delete process.env.ANYTERM_AUTH_TOKEN;
    delete process.env.ANYTERM_MASTER_KEY;

    // Stamp config version so migration is a no-op
    mockStore["configVersion"] = 2;
  });

  it("clears secrets, config, and calls sign-out API", async () => {
    const url = serverUrl();

    // Set up real config + secrets via real modules
    setActiveServer(url);
    setServerConfig(url, {
      wsUrl: `ws://127.0.0.1:${serverPort}`,
      userId: "user-1",
      publicKey: "pk",
      encryptedPrivateKey: "epk",
      keySalt: "salt",
    });
    mockSetPassword.mockResolvedValue(undefined);
    await setSecret("authToken", "tok-123", url);
    await setSecret("masterKey", "mk-456", url);

    // Keytar returns the token for the sign-out request
    mockGetPassword.mockImplementation((_svc: string, key: string) =>
      key === `authToken:${url}` ? "tok-123" : null,
    );

    await logoutCommand.parseAsync([], { from: "user" });

    // Real HTTP server received sign-out request
    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.method).toBe("POST");
    expect(lastRequest!.url).toBe("/api/auth/sign-out");
    expect(lastRequest!.authorization).toBe("Bearer tok-123");

    // Real keytar deletePassword was called for both secrets
    expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", `authToken:${url}`);
    expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", `masterKey:${url}`);

    // Real config state is cleaned
    expect(getServerConfig(url)).toBeUndefined();
    expect(getActiveServer()).toBeUndefined();
  });

  it("still clears local credentials when sign-out API is unreachable", async () => {
    const url = serverUrl();
    signOutShouldFail = true;

    setActiveServer(url);
    setServerConfig(url, {
      wsUrl: `ws://127.0.0.1:${serverPort}`,
      userId: "user-1",
      publicKey: "pk",
      encryptedPrivateKey: "epk",
      keySalt: "salt",
    });
    mockGetPassword.mockImplementation((_svc: string, key: string) =>
      key === `authToken:${url}` ? "tok-123" : null,
    );

    await logoutCommand.parseAsync([], { from: "user" });

    // Local cleanup still happened despite network failure
    expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", `authToken:${url}`);
    expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", `masterKey:${url}`);
    expect(getServerConfig(url)).toBeUndefined();
    expect(getActiveServer()).toBeUndefined();
  });

  it("skips sign-out when no auth token available", async () => {
    const url = serverUrl();

    setActiveServer(url);
    setServerConfig(url, {
      wsUrl: `ws://127.0.0.1:${serverPort}`,
      userId: "user-1",
      publicKey: "pk",
      encryptedPrivateKey: "epk",
      keySalt: "salt",
    });
    // No token in keytar or conf
    mockGetPassword.mockResolvedValue(null);

    await logoutCommand.parseAsync([], { from: "user" });

    // No sign-out request sent
    expect(lastRequest).toBeNull();

    // But local cleanup still happened
    expect(mockDeletePassword).toHaveBeenCalledTimes(2);
    expect(getServerConfig(url)).toBeUndefined();
  });

  it("does nothing destructive when no active server", async () => {
    // No active server set — config is empty (except version stamp)

    await logoutCommand.parseAsync([], { from: "user" });

    expect(lastRequest).toBeNull();
    expect(mockDeletePassword).not.toHaveBeenCalled();
  });

  it("runs migration on first call", async () => {
    // Set up legacy v1 flat config (pre-migration)
    clearStore();
    mockStore["serverUrl"] = serverUrl();
    mockStore["userId"] = "user-1";
    mockStore["publicKey"] = "pk";
    mockStore["encryptedPrivateKey"] = "epk";
    mockStore["keySalt"] = "salt";
    // No configVersion = v1
    mockGetPassword.mockResolvedValue(null);

    await logoutCommand.parseAsync([], { from: "user" });

    // Migration should have stamped version
    expect(mockStore["configVersion"]).toBe(2);
    // Legacy flat keys should be cleaned up by migration
    expect(mockStore["serverUrl"]).toBeUndefined();
  });
});
