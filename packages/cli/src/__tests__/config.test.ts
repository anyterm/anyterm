import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeServerUrl,
  getActiveServer,
  setActiveServer,
  getServerConfig,
  setServerConfig,
  deleteServerConfig,
  getMachineName,
  setMachineName,
  config,
} from "../config.js";

describe("normalizeServerUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeServerUrl("https://anyterm.dev/")).toBe("https://anyterm.dev");
    expect(normalizeServerUrl("https://anyterm.dev///")).toBe("https://anyterm.dev");
  });

  it("lowercases host", () => {
    expect(normalizeServerUrl("https://ANYTERM.DEV")).toBe("https://anyterm.dev");
    expect(normalizeServerUrl("https://MyServer.Example.COM")).toBe("https://myserver.example.com");
  });

  it("preserves protocol", () => {
    expect(normalizeServerUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeServerUrl("https://anyterm.dev")).toBe("https://anyterm.dev");
  });

  it("preserves port", () => {
    expect(normalizeServerUrl("https://localhost:3456/")).toBe("https://localhost:3456");
  });

  it("preserves path (without trailing slash)", () => {
    expect(normalizeServerUrl("https://example.com/app/v1/")).toBe("https://example.com/app/v1");
  });

  it("throws on invalid URL", () => {
    expect(() => normalizeServerUrl("not-a-url")).toThrow();
  });
});

describe("server config CRUD", () => {
  // Save and restore config state to avoid test pollution
  let originalStore: unknown;

  beforeEach(() => {
    originalStore = JSON.parse(JSON.stringify(config.store));
  });

  afterEach(() => {
    config.store = originalStore as typeof config.store;
  });

  it("set and get active server", () => {
    setActiveServer("https://test.example.com");
    expect(getActiveServer()).toBe("https://test.example.com");
  });

  it("set and get server config", () => {
    const serverUrl = "https://test-crud.example.com";
    const data = {
      wsUrl: "wss://test-crud.example.com",
      userId: "user-123",
      publicKey: "pk-base64",
      encryptedPrivateKey: "epk-base64",
      keySalt: "salt-base64",
    };

    setServerConfig(serverUrl, data);
    const retrieved = getServerConfig(serverUrl);

    expect(retrieved).toBeDefined();
    expect(retrieved!.wsUrl).toBe(data.wsUrl);
    expect(retrieved!.userId).toBe(data.userId);
    expect(retrieved!.publicKey).toBe(data.publicKey);
    expect(retrieved!.encryptedPrivateKey).toBe(data.encryptedPrivateKey);
    expect(retrieved!.keySalt).toBe(data.keySalt);
  });

  it("returns undefined for unknown server", () => {
    expect(getServerConfig("https://nonexistent.example.com")).toBeUndefined();
  });

  it("merges updates into existing server config", () => {
    const serverUrl = "https://merge-test.example.com";
    setServerConfig(serverUrl, {
      wsUrl: "wss://merge-test.example.com",
      userId: "user-1",
      publicKey: "pk1",
      encryptedPrivateKey: "epk1",
      keySalt: "salt1",
    });

    setServerConfig(serverUrl, {
      wsUrl: "wss://merge-test-updated.example.com",
      userId: "user-1",
      publicKey: "pk2",
      encryptedPrivateKey: "epk1",
      keySalt: "salt1",
    });

    const retrieved = getServerConfig(serverUrl);
    expect(retrieved!.wsUrl).toBe("wss://merge-test-updated.example.com");
    expect(retrieved!.publicKey).toBe("pk2");
  });

  it("deletes server config", () => {
    const serverUrl = "https://delete-test.example.com";
    setServerConfig(serverUrl, {
      wsUrl: "wss://delete-test.example.com",
      userId: "user-1",
      publicKey: "pk",
      encryptedPrivateKey: "epk",
      keySalt: "salt",
    });

    expect(getServerConfig(serverUrl)).toBeDefined();
    deleteServerConfig(serverUrl);
    expect(getServerConfig(serverUrl)).toBeUndefined();
  });

  it("delete is no-op for nonexistent server", () => {
    // Should not throw
    deleteServerConfig("https://nonexistent-delete.example.com");
  });
});

describe("machine name", () => {
  let originalStore: unknown;

  beforeEach(() => {
    originalStore = JSON.parse(JSON.stringify(config.store));
  });

  afterEach(() => {
    config.store = originalStore as typeof config.store;
  });

  it("set and get machine name", () => {
    setMachineName("my-workstation");
    expect(getMachineName()).toBe("my-workstation");
  });

  it("falls back to hostname when no name set", () => {
    // Clear any stored name
    config.delete("machineName" as keyof typeof config.store);
    const name = getMachineName();
    // Should be a non-empty string (OS hostname)
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });
});
