import { describe, it, expect } from "vitest";
import { parseAllowedCommands, isCommandAllowed } from "../commands/daemon.js";

describe("parseAllowedCommands", () => {
  it("returns null for undefined input", () => {
    expect(parseAllowedCommands(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAllowedCommands("")).toBeNull();
  });

  it("returns null for string of only commas and spaces", () => {
    expect(parseAllowedCommands(", , ,")).toBeNull();
  });

  it("parses single pattern", () => {
    expect(parseAllowedCommands("claude")).toEqual(["claude"]);
  });

  it("parses multiple comma-separated patterns", () => {
    expect(parseAllowedCommands("claude,npm,node")).toEqual(["claude", "npm", "node"]);
  });

  it("trims whitespace around patterns", () => {
    expect(parseAllowedCommands(" claude , npm , node ")).toEqual(["claude", "npm", "node"]);
  });

  it("filters empty entries from extra commas", () => {
    expect(parseAllowedCommands("claude,,npm,")).toEqual(["claude", "npm"]);
  });
});

describe("isCommandAllowed", () => {
  it("allows any command when patterns is null", () => {
    expect(isCommandAllowed("rm -rf /", null)).toBe(true);
    expect(isCommandAllowed("claude", null)).toBe(true);
  });

  it("allows command matching a pattern (substring)", () => {
    const patterns = ["claude", "npm", "node"];
    expect(isCommandAllowed("claude --model opus", patterns)).toBe(true);
    expect(isCommandAllowed("npm run dev", patterns)).toBe(true);
    expect(isCommandAllowed("node server.js", patterns)).toBe(true);
  });

  it("rejects command not matching any pattern", () => {
    const patterns = ["claude", "npm"];
    expect(isCommandAllowed("rm -rf /", patterns)).toBe(false);
    expect(isCommandAllowed("python script.py", patterns)).toBe(false);
  });

  it("matches are case-sensitive", () => {
    const patterns = ["claude"];
    expect(isCommandAllowed("Claude", patterns)).toBe(false);
    expect(isCommandAllowed("claude", patterns)).toBe(true);
  });

  it("pattern can match anywhere in command string", () => {
    const patterns = ["dev"];
    expect(isCommandAllowed("npm run dev", patterns)).toBe(true);
    expect(isCommandAllowed("pnpm dev:start", patterns)).toBe(true);
    expect(isCommandAllowed("/usr/bin/devtools", patterns)).toBe(true);
  });

  it("works with full path patterns", () => {
    const patterns = ["/usr/bin/node", "claude"];
    expect(isCommandAllowed("/usr/bin/node app.js", patterns)).toBe(true);
    expect(isCommandAllowed("node app.js", patterns)).toBe(false);
  });

  it("empty patterns array returns null from parse (all allowed)", () => {
    const patterns = parseAllowedCommands("");
    expect(isCommandAllowed("anything", patterns)).toBe(true);
  });
});
