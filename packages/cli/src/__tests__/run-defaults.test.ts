import { describe, it, expect } from "vitest";
import { resolveRunArgs } from "../commands/run.js";

describe("resolveRunArgs", () => {
  it("defaults to $SHELL with name 'shell' when no command given", () => {
    const result = resolveRunArgs([], {}, "linux", "/bin/zsh");
    expect(result.isInteractiveShell).toBe(true);
    expect(result.command).toBe("/bin/zsh");
    expect(result.name).toBe("shell");
  });

  it("falls back to /bin/bash when $SHELL is not set", () => {
    const result = resolveRunArgs([], {}, "linux", "");
    expect(result.isInteractiveShell).toBe(true);
    expect(result.command).toBe("/bin/bash");
    expect(result.name).toBe("shell");
  });

  it("uses powershell on Windows when no command given", () => {
    const result = resolveRunArgs([], {}, "win32");
    expect(result.isInteractiveShell).toBe(true);
    expect(result.command).toBe("powershell.exe");
    expect(result.name).toBe("shell");
  });

  it("uses $SHELL on macOS", () => {
    const result = resolveRunArgs([], {}, "darwin", "/bin/zsh");
    expect(result.isInteractiveShell).toBe(true);
    expect(result.command).toBe("/bin/zsh");
    expect(result.name).toBe("shell");
  });

  it("uses $SHELL on Linux", () => {
    const result = resolveRunArgs([], {}, "linux", "/usr/bin/fish");
    expect(result.isInteractiveShell).toBe(true);
    expect(result.command).toBe("/usr/bin/fish");
    expect(result.name).toBe("shell");
  });

  it("uses explicit command when provided", () => {
    const result = resolveRunArgs(["echo", "hello"], {}, "linux", "/bin/zsh");
    expect(result.isInteractiveShell).toBe(false);
    expect(result.command).toBe("echo hello");
    expect(result.name).toBe("echo");
  });

  it("--name overrides default name for interactive shell", () => {
    const result = resolveRunArgs([], { name: "my-session" }, "linux", "/bin/zsh");
    expect(result.isInteractiveShell).toBe(true);
    expect(result.command).toBe("/bin/zsh");
    expect(result.name).toBe("my-session");
  });

  it("--name overrides default name for explicit command", () => {
    const result = resolveRunArgs(["claude"], { name: "coding" }, "linux", undefined);
    expect(result.isInteractiveShell).toBe(false);
    expect(result.command).toBe("claude");
    expect(result.name).toBe("coding");
  });

  it("handles single-word command", () => {
    const result = resolveRunArgs(["vim"], {});
    expect(result.isInteractiveShell).toBe(false);
    expect(result.command).toBe("vim");
    expect(result.name).toBe("vim");
  });

  it("uses first word of multi-word command as name", () => {
    const result = resolveRunArgs(["npm", "run", "dev"], {});
    expect(result.command).toBe("npm run dev");
    expect(result.name).toBe("npm");
  });

  it("Windows ignores $SHELL and uses powershell", () => {
    const result = resolveRunArgs([], {}, "win32", "/bin/zsh");
    expect(result.command).toBe("powershell.exe");
    expect(result.name).toBe("shell");
  });
});
