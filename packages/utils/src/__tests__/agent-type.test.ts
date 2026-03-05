import { describe, it, expect } from "vitest";
import { detectAgentType } from "../types/index.js";

describe("detectAgentType", () => {
  it("detects claude-code", () => {
    expect(detectAgentType("claude")).toBe("claude-code");
    expect(detectAgentType("npx claude")).toBe("claude-code");
  });

  it("detects cursor", () => {
    expect(detectAgentType("cursor agent run")).toBe("cursor");
  });

  it("detects codex", () => {
    expect(detectAgentType("codex --model o4-mini")).toBe("codex");
  });

  it("detects copilot", () => {
    expect(detectAgentType("gh copilot suggest")).toBe("copilot");
  });

  it("detects aider", () => {
    expect(detectAgentType("aider --4o")).toBe("aider");
  });

  it("detects devin", () => {
    expect(detectAgentType("devin run task")).toBe("devin");
  });

  it("detects cline", () => {
    expect(detectAgentType("cline start")).toBe("cline");
  });

  it("detects continue", () => {
    expect(detectAgentType("continue dev")).toBe("continue");
  });

  it("is case insensitive", () => {
    expect(detectAgentType("CLAUDE")).toBe("claude-code");
    expect(detectAgentType("Cursor Agent")).toBe("cursor");
    expect(detectAgentType("CODEX")).toBe("codex");
  });

  it("returns null for empty string", () => {
    expect(detectAgentType("")).toBeNull();
  });

  it("returns null for no match", () => {
    expect(detectAgentType("npm run dev")).toBeNull();
    expect(detectAgentType("python app.py")).toBeNull();
    expect(detectAgentType("ls -la")).toBeNull();
  });

  it("matches substrings", () => {
    expect(detectAgentType("run-claude-code-here")).toBe("claude-code");
    expect(detectAgentType("/usr/bin/aider --model gpt-4")).toBe("aider");
  });

  it("returns first match when multiple patterns match", () => {
    // "claude" comes before "cursor" in the list
    expect(detectAgentType("claude cursor")).toBe("claude-code");
  });
});
