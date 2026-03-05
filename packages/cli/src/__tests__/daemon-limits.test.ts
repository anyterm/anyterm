import { describe, it, expect } from "vitest";
import {
  MAX_ACTIVE_SESSIONS,
  parseSpawnForwardedPorts,
  extractCommandName,
  deriveSessionName,
} from "../commands/daemon.js";

describe("MAX_ACTIVE_SESSIONS", () => {
  it("is 20", () => {
    expect(MAX_ACTIVE_SESSIONS).toBe(20);
  });
});

describe("parseSpawnForwardedPorts", () => {
  it("returns empty for non-array", () => {
    expect(parseSpawnForwardedPorts(undefined)).toEqual([]);
    expect(parseSpawnForwardedPorts(null)).toEqual([]);
    expect(parseSpawnForwardedPorts("3000")).toEqual([]);
  });

  it("parses valid port numbers", () => {
    expect(parseSpawnForwardedPorts([3000, 8080])).toEqual([3000, 8080]);
  });

  it("parses string port numbers", () => {
    expect(parseSpawnForwardedPorts(["3000", "8080"])).toEqual([3000, 8080]);
  });

  it("filters out invalid ports", () => {
    expect(parseSpawnForwardedPorts([3000, 0, -1, 65536, NaN])).toEqual([3000]);
  });

  it("filters out non-integer ports", () => {
    expect(parseSpawnForwardedPorts([3000.5, 8080])).toEqual([8080]);
  });

  it("accepts boundary ports", () => {
    expect(parseSpawnForwardedPorts([1, 65535])).toEqual([1, 65535]);
  });
});

describe("extractCommandName", () => {
  it("extracts simple command name", () => {
    expect(extractCommandName("claude")).toBe("claude");
  });

  it("extracts first word from multi-word command", () => {
    expect(extractCommandName("npm run dev")).toBe("npm");
  });

  it("extracts basename from full path", () => {
    expect(extractCommandName("/bin/zsh")).toBe("zsh");
    expect(extractCommandName("/usr/bin/python3")).toBe("python3");
  });

  it("extracts basename from path with args", () => {
    expect(extractCommandName("/bin/zsh -c echo")).toBe("zsh");
  });
});

describe("deriveSessionName", () => {
  it("uses explicit spawn name when provided", () => {
    expect(deriveSessionName("my-session", "echo hello")).toBe("my-session");
  });

  it("falls back to command name when no spawn name", () => {
    expect(deriveSessionName("", "npm run dev")).toBe("npm");
  });

  it("truncates long command names to 256 chars", () => {
    const longCmd = "x".repeat(300);
    expect(deriveSessionName("", longCmd).length).toBe(256);
  });

  it("uses basename from full path", () => {
    expect(deriveSessionName("", "/usr/local/bin/node server.js")).toBe("node");
  });
});
