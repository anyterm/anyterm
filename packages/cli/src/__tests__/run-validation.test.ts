import { describe, it, expect } from "vitest";
import { parseForwardedPorts } from "../commands/run.js";
import { MAX_COMMAND_LENGTH } from "../shared/constants.js";

describe("parseForwardedPorts", () => {
  it("returns empty for undefined", () => {
    expect(parseForwardedPorts(undefined)).toEqual([]);
  });

  it("parses single port", () => {
    expect(parseForwardedPorts("3000")).toEqual([3000]);
  });

  it("parses multiple comma-separated ports", () => {
    expect(parseForwardedPorts("3000,8080,9090")).toEqual([3000, 8080, 9090]);
  });

  it("trims whitespace around ports", () => {
    expect(parseForwardedPorts(" 3000 , 8080 ")).toEqual([3000, 8080]);
  });

  it("rejects port 0", () => {
    const result = parseForwardedPorts("0");
    expect(result).toHaveProperty("error");
  });

  it("rejects negative port", () => {
    const result = parseForwardedPorts("-1");
    expect(result).toHaveProperty("error");
  });

  it("rejects port above 65535", () => {
    const result = parseForwardedPorts("65536");
    expect(result).toHaveProperty("error");
  });

  it("rejects non-numeric port", () => {
    const result = parseForwardedPorts("abc");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("abc");
  });

  it("accepts boundary port 1", () => {
    expect(parseForwardedPorts("1")).toEqual([1]);
  });

  it("accepts boundary port 65535", () => {
    expect(parseForwardedPorts("65535")).toEqual([65535]);
  });

  it("rejects mixed valid and invalid ports", () => {
    const result = parseForwardedPorts("3000,abc,8080");
    expect(result).toHaveProperty("error");
  });

  it("parseInt truncates floats (matches real behavior)", () => {
    expect(parseForwardedPorts("3000.5")).toEqual([3000]);
  });
});

describe("command length validation", () => {
  it("MAX_COMMAND_LENGTH is 4096", () => {
    expect(MAX_COMMAND_LENGTH).toBe(4096);
  });

  it("resolveRunArgs joins args into command for length checking", async () => {
    const { resolveRunArgs } = await import("../commands/run.js");
    const longArg = "x".repeat(MAX_COMMAND_LENGTH + 1);
    const result = resolveRunArgs([longArg], {});
    expect(result.command.length).toBeGreaterThan(MAX_COMMAND_LENGTH);
  });
});
