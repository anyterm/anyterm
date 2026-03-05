import { describe, it, expect } from "vitest";
import { formatStatus, formatRow, STATUS_COL_WIDTH } from "../commands/list.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

describe("formatStatus", () => {
  it("shows green dot for running", () => {
    const result = formatStatus("running");
    expect(result).toContain("●");
    expect(result).toContain("\x1b[32m"); // green ANSI
    expect(result).toContain("running");
  });

  it("shows yellow dot for disconnected", () => {
    const result = formatStatus("disconnected");
    expect(result).toContain("●");
    expect(result).toContain("\x1b[33m"); // yellow ANSI
    expect(result).toContain("disconnected");
  });

  it("shows empty circle for stopped", () => {
    expect(formatStatus("stopped")).toBe("○ stopped");
  });

  it("shows stopped for unknown status", () => {
    expect(formatStatus("error")).toBe("○ stopped");
  });
});

describe("formatRow", () => {
  it("formats a normal session row", () => {
    const row = formatRow({
      id: "abc123",
      name: "my-session",
      status: "running",
      command: "echo hello",
    });
    expect(row).toContain("abc123");
    expect(row).toContain("my-session");
    expect(row).toContain("echo hello");
  });

  it("truncates long session names to 22 chars", () => {
    const longName = "a".repeat(50);
    const row = formatRow({ id: "x", name: longName, status: "stopped", command: "cmd" });
    expect(row).not.toContain(longName);
    expect(row).toContain("a".repeat(22));
  });

  it("truncates long commands to 30 chars", () => {
    const longCmd = "b".repeat(60);
    const row = formatRow({ id: "x", name: "n", status: "stopped", command: longCmd });
    expect(row).toContain("b".repeat(30));
    expect(row).not.toContain("b".repeat(31));
  });

  it("pads short IDs to fixed column width", () => {
    const row = formatRow({ id: "ab", name: "n", status: "stopped", command: "c" });
    expect(row.startsWith("ab" + " ".repeat(13))).toBe(true);
  });

  it("aligns COMMAND column consistently regardless of status ANSI codes", () => {
    const make = (status: string) =>
      formatRow({ id: "x", name: "n", status, command: "CMD" });

    const extract = (row: string) => row.replace(ANSI_RE, "");
    const cmdOffset = (row: string) => extract(row).indexOf("CMD");

    const runningOffset = cmdOffset(make("running"));
    const stoppedOffset = cmdOffset(make("stopped"));
    const disconnectedOffset = cmdOffset(make("disconnected"));

    expect(runningOffset).toBe(stoppedOffset);
    expect(runningOffset).toBe(disconnectedOffset);
    // STATUS column visible width should match STATUS_COL_WIDTH
    expect(runningOffset).toBe(15 + 25 + STATUS_COL_WIDTH);
  });
});
