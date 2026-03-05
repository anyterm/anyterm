import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock keytar
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

// Mock conf — use a simple in-memory object
const mockStore: Record<string, unknown> = {};
vi.mock("conf", () => {
  return {
    default: class {
      store = mockStore;
      path = "/tmp/test-config.json";
      get(key: string) { return mockStore[key]; }
      set(key: string, value: unknown) { mockStore[key] = value; }
      has(key: string) { return key in mockStore; }
      delete(key: string) { delete mockStore[key]; }
    },
  };
});

// Mock readline for plaintext confirmation prompt (used by secure-store setSecret)
const mockQuestion = vi.fn();
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: vi.fn(),
  }),
}));

const { migrateConfigIfNeeded, _resetMigrationState } = await import("../migrate.js");
const { _resetPlaintextConfirmation } = await import("../secure-store.js");

function clearMockStore() {
  for (const key of Object.keys(mockStore)) delete mockStore[key];
}

const SERVER = "https://anyterm.dev";

describe("migrateConfigIfNeeded", () => {
  const origIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockStore();
    _resetMigrationState();
    _resetPlaintextConfirmation();
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("migrates flat config to per-server namespace", async () => {
    // Set up v1 flat config
    mockStore["serverUrl"] = SERVER;
    mockStore["wsUrl"] = "wss://anyterm.dev";
    mockStore["userId"] = "user-123";
    mockStore["publicKey"] = "pk-base64";
    mockStore["encryptedPrivateKey"] = "epk-base64";
    mockStore["keySalt"] = "salt-base64";
    mockStore["machineName"] = "my-laptop";

    // Keytar has flat secrets
    mockGetPassword.mockImplementation((_svc: string, key: string) => {
      if (key === "authToken") return "tok-abc";
      if (key === "masterKey") return "mk-base64";
      return null;
    });
    mockSetPassword.mockResolvedValue(undefined);
    mockDeletePassword.mockResolvedValue(true);

    await migrateConfigIfNeeded();

    // Per-server config block should exist
    const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
    expect(servers[SERVER]).toBeDefined();
    expect(servers[SERVER]["wsUrl"]).toBe("wss://anyterm.dev");
    expect(servers[SERVER]["userId"]).toBe("user-123");
    expect(servers[SERVER]["publicKey"]).toBe("pk-base64");
    expect(servers[SERVER]["encryptedPrivateKey"]).toBe("epk-base64");
    expect(servers[SERVER]["keySalt"]).toBe("salt-base64");

    // Active server should be set
    expect(mockStore["activeServer"]).toBe(SERVER);

    // Config version should be 2
    expect(mockStore["configVersion"]).toBe(2);

    // Legacy flat keys should be removed
    expect(mockStore["serverUrl"]).toBeUndefined();
    expect(mockStore["wsUrl"]).toBeUndefined();
    expect(mockStore["userId"]).toBeUndefined();
    expect(mockStore["publicKey"]).toBeUndefined();
    expect(mockStore["encryptedPrivateKey"]).toBeUndefined();
    expect(mockStore["keySalt"]).toBeUndefined();
  });

  it("migrates keychain secrets to host-scoped keys", async () => {
    mockStore["serverUrl"] = SERVER;
    mockStore["userId"] = "user-123";

    mockGetPassword.mockImplementation((_svc: string, key: string) => {
      if (key === "authToken") return "tok-abc";
      if (key === "masterKey") return "mk-base64";
      return null;
    });
    mockSetPassword.mockResolvedValue(undefined);
    mockDeletePassword.mockResolvedValue(true);

    await migrateConfigIfNeeded();

    // Should have written host-scoped keys
    expect(mockSetPassword).toHaveBeenCalledWith(
      "anyterm",
      `authToken:${SERVER}`,
      "tok-abc",
    );
    expect(mockSetPassword).toHaveBeenCalledWith(
      "anyterm",
      `masterKey:${SERVER}`,
      "mk-base64",
    );

    // Should have deleted old flat keys
    expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", "authToken");
    expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", "masterKey");
  });

  it("preserves machineName at root level", async () => {
    mockStore["serverUrl"] = SERVER;
    mockStore["userId"] = "user-123";
    mockStore["machineName"] = "my-laptop";

    mockGetPassword.mockResolvedValue(null);

    await migrateConfigIfNeeded();

    expect(mockStore["machineName"]).toBe("my-laptop");
  });

  it("skips if already at configVersion 2", async () => {
    mockStore["configVersion"] = 2;
    mockStore["activeServer"] = SERVER;
    mockStore["servers"] = { [SERVER]: { userId: "user-123" } };

    await migrateConfigIfNeeded();

    // Should not have touched keytar at all
    expect(mockGetPassword).not.toHaveBeenCalled();
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("handles fresh install with no legacy config", async () => {
    // Empty store
    await migrateConfigIfNeeded();

    expect(mockStore["configVersion"]).toBe(2);
    expect(mockGetPassword).not.toHaveBeenCalled();
    expect(mockStore["servers"]).toBeUndefined();
    expect(mockStore["activeServer"]).toBeUndefined();
  });

  it("runs only once per process", async () => {
    mockStore["serverUrl"] = SERVER;
    mockStore["userId"] = "user-123";
    mockGetPassword.mockResolvedValue(null);

    await migrateConfigIfNeeded();
    const firstCallCount = mockGetPassword.mock.calls.length;

    // Second call should be a no-op
    await migrateConfigIfNeeded();

    expect(mockGetPassword.mock.calls.length).toBe(firstCallCount);
  });

  it("handles missing keychain secrets gracefully", async () => {
    mockStore["serverUrl"] = SERVER;
    mockStore["userId"] = "user-123";
    mockStore["publicKey"] = "pk-base64";

    // No secrets in keytar
    mockGetPassword.mockResolvedValue(null);

    await migrateConfigIfNeeded();

    // Should not have written or deleted anything in keytar
    expect(mockSetPassword).not.toHaveBeenCalled();
    expect(mockDeletePassword).not.toHaveBeenCalled();

    // Config should still be migrated
    expect(mockStore["activeServer"]).toBe(SERVER);
    const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
    expect(servers[SERVER]["publicKey"]).toBe("pk-base64");
  });

  it("migrates plaintext conf secrets into per-server block", async () => {
    // Simulate headless env where secrets were in flat conf
    mockStore["serverUrl"] = SERVER;
    mockStore["userId"] = "user-123";
    mockStore["authToken"] = "plain-tok";
    mockStore["masterKey"] = "plain-mk";

    // No keytar available (getPassword returns null for flat keys)
    mockGetPassword.mockResolvedValue(null);
    // setPassword will fail (no keytar) — user confirms plaintext storage
    mockSetPassword.mockRejectedValue(new Error("no keychain"));
    mockQuestion.mockResolvedValue("y");

    await migrateConfigIfNeeded();

    // Flat authToken/masterKey should be removed from root
    expect(mockStore["authToken"]).toBeUndefined();
    expect(mockStore["masterKey"]).toBeUndefined();
  });
});
