import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("node-machine-id", () => ({
  default: {
    machineIdSync: () => "abcdef1234567890abcdef1234567890",
  },
}));

// ── Real module imports (backed by mocked infrastructure) ──

const { setActiveServer, setServerConfig, getConfig, getMachineId } =
  await import("../config.js");
const { _resetMigrationState } = await import("../migrate.js");
const { _resetPlaintextConfirmation } = await import("../secure-store.js");

function clearStore() {
  for (const key of Object.keys(mockStore)) delete mockStore[key];
}

function setupLoggedIn(serverUrl: string) {
  mockStore["configVersion"] = 2;
  setActiveServer(serverUrl);
  setServerConfig(serverUrl, {
    wsUrl: `ws://127.0.0.1:3001`,
    userId: "user-1",
    publicKey: "pk-base64",
    encryptedPrivateKey: "epk-base64",
    keySalt: "salt-base64",
  });
  mockGetPassword.mockImplementation((_svc: string, key: string) => {
    if (key === `authToken:${serverUrl}`) return "tok-123";
    if (key === `masterKey:${serverUrl}`) return "mk-456";
    return null;
  });
}

describe("getConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStore();
    _resetMigrationState();
    _resetPlaintextConfirmation();
    delete process.env.ANYTERM_AUTH_TOKEN;
    delete process.env.ANYTERM_MASTER_KEY;
    mockStore["configVersion"] = 2;
  });

  it("returns full config when logged in", async () => {
    const url = "http://127.0.0.1:3000";
    setupLoggedIn(url);

    const cfg = await getConfig();

    expect(cfg.serverUrl).toBe(url);
    expect(cfg.authToken).toBe("tok-123");
    expect(cfg.userId).toBe("user-1");
    expect(cfg.publicKey).toBe("pk-base64");
    expect(cfg.encryptedPrivateKey).toBe("epk-base64");
    expect(cfg.keySalt).toBe("salt-base64");
    expect(cfg.masterKey).toBe("mk-456");
  });

  it("derives wsUrl from serverUrl when not set", async () => {
    const url = "http://127.0.0.1:3000";
    mockStore["configVersion"] = 2;
    setActiveServer(url);
    setServerConfig(url, {
      wsUrl: "",
      userId: "user-1",
      publicKey: "pk",
      encryptedPrivateKey: "epk",
      keySalt: "salt",
    });
    mockGetPassword.mockImplementation((_svc: string, key: string) =>
      key === `authToken:${url}` ? "tok" : null,
    );

    const cfg = await getConfig();

    expect(cfg.wsUrl).toBe("ws://127.0.0.1:3000");
  });

  it("uses explicit wsUrl when set", async () => {
    const url = "http://127.0.0.1:3000";
    setupLoggedIn(url);

    const cfg = await getConfig();

    expect(cfg.wsUrl).toBe("ws://127.0.0.1:3001");
  });

  it("masterKey can be null", async () => {
    const url = "http://127.0.0.1:3000";
    mockStore["configVersion"] = 2;
    setActiveServer(url);
    setServerConfig(url, {
      wsUrl: "ws://127.0.0.1:3001",
      userId: "user-1",
      publicKey: "pk",
      encryptedPrivateKey: "epk",
      keySalt: "salt",
    });
    mockGetPassword.mockImplementation((_svc: string, key: string) =>
      key === `authToken:${url}` ? "tok" : null,
    );

    const cfg = await getConfig();

    expect(cfg.masterKey).toBeNull();
  });

  it("exits when no active server", async () => {
    clearStore();
    mockStore["configVersion"] = 2;
    // No activeServer set

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(getConfig()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it("exits when server config has no userId", async () => {
    const url = "http://127.0.0.1:3000";
    setActiveServer(url);
    // Set server config with empty userId (simulating corrupted config)
    mockStore["servers"] = { [url]: { wsUrl: "", publicKey: "", encryptedPrivateKey: "", keySalt: "" } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(getConfig()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it("exits when no auth token available", async () => {
    const url = "http://127.0.0.1:3000";
    setActiveServer(url);
    setServerConfig(url, {
      wsUrl: "ws://127.0.0.1:3001",
      userId: "user-1",
      publicKey: "pk",
      encryptedPrivateKey: "epk",
      keySalt: "salt",
    });
    // No token in keytar or env
    mockGetPassword.mockResolvedValue(null);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(getConfig()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

describe("getMachineId", () => {
  it("returns first 8 characters of machine ID", () => {
    const id = getMachineId();
    expect(id).toBe("abcdef12");
    expect(id).toHaveLength(8);
  });
});
