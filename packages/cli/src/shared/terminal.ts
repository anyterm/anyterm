// Common terminal clear sequences
export const CLEAR_PATTERNS = ["\x1b[2J", "\x1b[3J", "\x1bc"];

export function containsClear(data: string): boolean {
  return CLEAR_PATTERNS.some((p) => data.includes(p));
}

// Periodic snapshot configuration
export const SNAPSHOT_CHUNK_THRESHOLD = 100;
export const SNAPSHOT_INTERVAL_MS = 60_000;

// Safe environment variables to pass to PTY
const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "TERM_PROGRAM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "COLORTERM",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
]);

export function getSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }
  env.TERM = env.TERM || "xterm-256color";
  return env;
}

type HeadlessClasses = {
  Terminal: new (opts: { cols: number; rows: number }) => import("@xterm/headless").Terminal;
  SerializeAddon: new () => import("@xterm/addon-serialize").SerializeAddon;
};

/**
 * Dynamically import headless terminal classes.
 * Returns null if packages are unavailable (snapshots will be disabled).
 */
export async function loadHeadlessTerminal(): Promise<HeadlessClasses | null> {
  try {
    const headlessMod = await import("@xterm/headless");
    const serializeMod = await import("@xterm/addon-serialize");
    const Terminal =
      headlessMod.Terminal ??
      (headlessMod as Record<string, unknown>).default?.Terminal;
    const SerializeAddon =
      serializeMod.SerializeAddon ??
      (serializeMod as Record<string, unknown>).default?.SerializeAddon;
    if (Terminal && SerializeAddon) {
      return { Terminal, SerializeAddon };
    }
    return null;
  } catch {
    return null;
  }
}
