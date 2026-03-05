import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  containsClear,
  CLEAR_PATTERNS,
  getSafeEnv,
  SNAPSHOT_CHUNK_THRESHOLD,
  SNAPSHOT_INTERVAL_MS,
} from "../shared/terminal.js";

describe("containsClear", () => {
  it("detects ESC[2J (erase display)", () => {
    expect(containsClear("\x1b[2J")).toBe(true);
  });

  it("detects ESC[3J (erase scrollback)", () => {
    expect(containsClear("\x1b[3J")).toBe(true);
  });

  it("detects ESCc (full reset)", () => {
    expect(containsClear("\x1bc")).toBe(true);
  });

  it("returns false for normal text", () => {
    expect(containsClear("hello world")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(containsClear("")).toBe(false);
  });

  it("detects clear pattern embedded in other data", () => {
    expect(containsClear("prefix\x1b[2Jsuffix")).toBe(true);
  });

  it("returns false for partial escape sequence", () => {
    expect(containsClear("\x1b[2")).toBe(false);
  });

  it("CLEAR_PATTERNS has exactly 3 patterns", () => {
    expect(CLEAR_PATTERNS).toHaveLength(3);
  });
});

describe("getSafeEnv", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Start with a clean env for predictable tests
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("includes PATH, HOME, USER when set", () => {
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/test";
    process.env.USER = "testuser";

    const env = getSafeEnv();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/test");
    expect(env.USER).toBe("testuser");
  });

  it("excludes dangerous environment variables", () => {
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    process.env.DATABASE_URL = "postgres://localhost/db";
    process.env.API_KEY = "key123";
    process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
    process.env.BETTER_AUTH_SECRET = "auth-secret";

    const env = getSafeEnv();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.API_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
  });

  it("defaults TERM to xterm-256color when unset", () => {
    const env = getSafeEnv();
    expect(env.TERM).toBe("xterm-256color");
  });

  it("preserves existing TERM value", () => {
    process.env.TERM = "screen-256color";
    const env = getSafeEnv();
    expect(env.TERM).toBe("screen-256color");
  });

  it("includes all safe keys when present", () => {
    const safeKeys = [
      "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM",
      "TERM_PROGRAM", "LANG", "LC_ALL", "LC_CTYPE", "EDITOR",
      "VISUAL", "PAGER", "COLORTERM", "TMPDIR", "XDG_RUNTIME_DIR",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
    ];
    for (const key of safeKeys) {
      process.env[key] = `test-${key}`;
    }

    const env = getSafeEnv();
    for (const key of safeKeys) {
      expect(env[key]).toBe(`test-${key}`);
    }
  });

  it("returns only safe keys even with many env vars set", () => {
    process.env.PATH = "/usr/bin";
    process.env.SECRET = "should-not-appear";
    process.env.NODE_ENV = "production";

    const env = getSafeEnv();
    const keys = Object.keys(env);
    // PATH + TERM (default)
    expect(keys).toContain("PATH");
    expect(keys).toContain("TERM");
    expect(keys).not.toContain("SECRET");
    expect(keys).not.toContain("NODE_ENV");
  });
});

describe("constants", () => {
  it("SNAPSHOT_CHUNK_THRESHOLD is 100", () => {
    expect(SNAPSHOT_CHUNK_THRESHOLD).toBe(100);
  });

  it("SNAPSHOT_INTERVAL_MS is 60000", () => {
    expect(SNAPSHOT_INTERVAL_MS).toBe(60_000);
  });
});
