import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock keytar before importing secure-store
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

// Mock readline for plaintext confirmation prompt
const mockQuestion = vi.fn();
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: vi.fn(),
  }),
}));

// Import after mocks are set up
const { getSecret, setSecret, deleteSecret, _resetPlaintextConfirmation } = await import("../secure-store.js");

function clearMockStore() {
  for (const key of Object.keys(mockStore)) delete mockStore[key];
}

const SERVER = "https://anyterm.dev";

describe("secure-store", () => {
  const origIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
    clearMockStore();
    _resetPlaintextConfirmation();
    delete process.env.ANYTERM_AUTH_TOKEN;
    delete process.env.ANYTERM_MASTER_KEY;
    // Default to TTY so confirmation prompt tests work
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    delete process.env.ANYTERM_AUTH_TOKEN;
    delete process.env.ANYTERM_MASTER_KEY;
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  describe("getSecret() env var priority", () => {
    it("returns ANYTERM_AUTH_TOKEN when set", async () => {
      process.env.ANYTERM_AUTH_TOKEN = "env-token-123";
      mockGetPassword.mockResolvedValueOnce("keychain-token");

      const val = await getSecret("authToken", SERVER);

      expect(val).toBe("env-token-123");
      expect(mockGetPassword).not.toHaveBeenCalled();
    });

    it("returns ANYTERM_MASTER_KEY when set", async () => {
      process.env.ANYTERM_MASTER_KEY = "env-master-key";

      const val = await getSecret("masterKey", SERVER);

      expect(val).toBe("env-master-key");
      expect(mockGetPassword).not.toHaveBeenCalled();
    });

    it("falls through to keychain when env var not set", async () => {
      mockGetPassword.mockResolvedValueOnce("keychain-token");

      const val = await getSecret("authToken", SERVER);

      expect(val).toBe("keychain-token");
    });

    it("env var takes priority even when keychain and conf have values", async () => {
      process.env.ANYTERM_AUTH_TOKEN = "env-wins";
      mockGetPassword.mockResolvedValueOnce("keychain-val");
      mockStore["servers"] = { [SERVER]: { authToken: "conf-val" } };

      const val = await getSecret("authToken", SERVER);

      expect(val).toBe("env-wins");
    });

    it("does not check env vars for unknown keys", async () => {
      mockGetPassword.mockResolvedValueOnce("from-keychain");

      const val = await getSecret("userId", SERVER);

      expect(val).toBe("from-keychain");
    });
  });

  describe("getSecret() with serverUrl (host-scoped)", () => {
    it("reads from keytar with host-scoped key", async () => {
      mockGetPassword.mockResolvedValueOnce("keychain-token");

      const val = await getSecret("authToken", SERVER);

      expect(val).toBe("keychain-token");
      expect(mockGetPassword).toHaveBeenCalledWith("anyterm", `authToken:${SERVER}`);
    });

    it("falls back to per-server conf when keytar returns null", async () => {
      mockGetPassword.mockResolvedValueOnce(null);
      mockStore["servers"] = { [SERVER]: { authToken: "conf-token" } };

      const val = await getSecret("authToken", SERVER);

      expect(val).toBe("conf-token");
    });

    it("falls back to per-server conf when keytar throws", async () => {
      mockGetPassword.mockRejectedValueOnce(new Error("no keychain"));
      mockStore["servers"] = { [SERVER]: { authToken: "conf-fallback" } };

      const val = await getSecret("authToken", SERVER);

      expect(val).toBe("conf-fallback");
    });

    it("returns null when neither keytar nor per-server conf has the value", async () => {
      mockGetPassword.mockResolvedValueOnce(null);

      const val = await getSecret("authToken", SERVER);

      expect(val).toBeNull();
    });

    it("returns null when servers block exists but key is missing", async () => {
      mockGetPassword.mockResolvedValueOnce(null);
      mockStore["servers"] = { [SERVER]: { userId: "abc" } };

      const val = await getSecret("authToken", SERVER);

      expect(val).toBeNull();
    });
  });

  describe("getSecret() without serverUrl (legacy flat)", () => {
    it("reads from keytar with flat key", async () => {
      mockGetPassword.mockResolvedValueOnce("flat-token");

      const val = await getSecret("authToken");

      expect(val).toBe("flat-token");
      expect(mockGetPassword).toHaveBeenCalledWith("anyterm", "authToken");
    });

    it("falls back to flat conf", async () => {
      mockGetPassword.mockResolvedValueOnce(null);
      mockStore["authToken"] = "conf-token";

      const val = await getSecret("authToken");

      expect(val).toBe("conf-token");
    });
  });

  describe("setSecret() env var skip", () => {
    it("skips storage when ANYTERM_AUTH_TOKEN is set", async () => {
      process.env.ANYTERM_AUTH_TOKEN = "env-token";

      await setSecret("authToken", "some-token", SERVER);

      expect(mockSetPassword).not.toHaveBeenCalled();
      expect(mockStore["servers"]).toBeUndefined();
    });

    it("skips storage when ANYTERM_MASTER_KEY is set", async () => {
      process.env.ANYTERM_MASTER_KEY = "env-key";

      await setSecret("masterKey", "some-key", SERVER);

      expect(mockSetPassword).not.toHaveBeenCalled();
    });

    it("proceeds normally for unknown keys even with env vars set", async () => {
      process.env.ANYTERM_AUTH_TOKEN = "env-token";
      mockSetPassword.mockResolvedValueOnce(undefined);

      await setSecret("userId", "user-123", SERVER);

      expect(mockSetPassword).toHaveBeenCalled();
    });
  });

  describe("setSecret() with serverUrl (host-scoped)", () => {
    it("stores in keytar with host-scoped key and cleans per-server conf", async () => {
      mockSetPassword.mockResolvedValueOnce(undefined);
      mockStore["servers"] = { [SERVER]: { authToken: "old-plain-text" } };

      await setSecret("authToken", "new-token", SERVER);

      expect(mockSetPassword).toHaveBeenCalledWith("anyterm", `authToken:${SERVER}`, "new-token");
      const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
      expect(servers[SERVER]["authToken"]).toBeUndefined();
    });

    it("stores in per-server conf when keytar throws and user confirms", async () => {
      mockSetPassword.mockRejectedValueOnce(new Error("no keychain"));
      mockQuestion.mockResolvedValueOnce("y");

      await setSecret("authToken", "fallback-token", SERVER);

      const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
      expect(servers[SERVER]["authToken"]).toBe("fallback-token");
    });

    it("throws when keytar unavailable and user declines plaintext", async () => {
      mockSetPassword.mockRejectedValueOnce(new Error("no keychain"));
      mockQuestion.mockResolvedValueOnce("n");

      await expect(setSecret("authToken", "token", SERVER))
        .rejects.toThrow("Credentials not saved");
    });

    it("throws in non-TTY when keychain unavailable", async () => {
      mockSetPassword.mockRejectedValueOnce(new Error("no keychain"));
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      await expect(setSecret("authToken", "token", SERVER))
        .rejects.toThrow("non-interactive mode");
    });

    it("only prompts once per process for plaintext confirmation", async () => {
      mockSetPassword.mockRejectedValue(new Error("no keychain"));
      mockQuestion.mockResolvedValueOnce("y");

      await setSecret("authToken", "token1", SERVER);
      await setSecret("masterKey", "key1", SERVER);

      // Only one confirmation prompt
      expect(mockQuestion).toHaveBeenCalledTimes(1);
      const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
      expect(servers[SERVER]["authToken"]).toBe("token1");
      expect(servers[SERVER]["masterKey"]).toBe("key1");
    });

    it("creates servers block if it does not exist", async () => {
      mockSetPassword.mockRejectedValueOnce(new Error("no keychain"));
      mockQuestion.mockResolvedValueOnce("y");

      await setSecret("authToken", "new-token", SERVER);

      const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
      expect(servers[SERVER]["authToken"]).toBe("new-token");
    });
  });

  describe("setSecret() without serverUrl (legacy flat)", () => {
    it("stores in keytar and removes from flat conf", async () => {
      mockSetPassword.mockResolvedValueOnce(undefined);
      mockStore["authToken"] = "old-plain-text";

      await setSecret("authToken", "new-token");

      expect(mockSetPassword).toHaveBeenCalledWith("anyterm", "authToken", "new-token");
      expect(mockStore["authToken"]).toBeUndefined();
    });

    it("falls back to flat conf when keytar throws and user confirms", async () => {
      mockSetPassword.mockRejectedValueOnce(new Error("no keychain"));
      mockQuestion.mockResolvedValueOnce("y");

      await setSecret("authToken", "fallback-token");

      expect(mockStore["authToken"]).toBe("fallback-token");
    });
  });

  describe("deleteSecret() with serverUrl (host-scoped)", () => {
    it("deletes from keytar and per-server conf", async () => {
      mockDeletePassword.mockResolvedValueOnce(true);
      mockStore["servers"] = { [SERVER]: { authToken: "leftover" } };

      await deleteSecret("authToken", SERVER);

      expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", `authToken:${SERVER}`);
      const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
      expect(servers[SERVER]["authToken"]).toBeUndefined();
    });

    it("still clears per-server conf when keytar throws", async () => {
      mockDeletePassword.mockRejectedValueOnce(new Error("no keychain"));
      mockStore["servers"] = { [SERVER]: { masterKey: "leftover-key" } };

      await deleteSecret("masterKey", SERVER);

      const servers = mockStore["servers"] as Record<string, Record<string, unknown>>;
      expect(servers[SERVER]["masterKey"]).toBeUndefined();
    });
  });

  describe("deleteSecret() without serverUrl (legacy flat)", () => {
    it("deletes from both keytar and flat conf", async () => {
      mockDeletePassword.mockResolvedValueOnce(true);
      mockStore["authToken"] = "leftover";

      await deleteSecret("authToken");

      expect(mockDeletePassword).toHaveBeenCalledWith("anyterm", "authToken");
      expect(mockStore["authToken"]).toBeUndefined();
    });

    it("still clears flat conf when keytar throws", async () => {
      mockDeletePassword.mockRejectedValueOnce(new Error("no keychain"));
      mockStore["masterKey"] = "leftover-key";

      await deleteSecret("masterKey");

      expect(mockStore["masterKey"]).toBeUndefined();
    });
  });
});
