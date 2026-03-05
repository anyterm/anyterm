import * as fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { config } from "./config.js";
import type { ServerConfig } from "./config.js";

const SERVICE = "anyterm";

/** Map secret keys to environment variable names. */
const ENV_VAR_MAP: Record<string, string> = {
  authToken: "ANYTERM_AUTH_TOKEN",
  masterKey: "ANYTERM_MASTER_KEY",
};

/** Harden config file permissions to owner-only (0600) on Unix systems. */
function hardenConfigPermissions(): void {
  try {
    if (process.platform !== "win32") {
      fs.chmodSync(config.path, 0o600);
    }
  } catch {
    // Ignore — file may not exist yet
  }
}

let keytar: Awaited<typeof import("keytar")>["default"] | null = null;

/** Track whether user already confirmed plaintext storage in this process. */
let plaintextConfirmed = false;

/** Reset confirmation state (for testing only). */
export function _resetPlaintextConfirmation(): void {
  plaintextConfirmed = false;
}

async function getKeytar() {
  if (keytar) return keytar;
  try {
    const mod = await import("keytar");
    keytar = mod.default;
    return keytar;
  } catch {
    return null;
  }
}

/**
 * Read a secret from environment variable, OS keychain, or plaintext conf fallback.
 * Priority: env var → keychain → config file.
 * When serverUrl is provided, the keychain key is scoped: `key:serverUrl`.
 * Without serverUrl, uses a flat key (legacy, used only during migration).
 */
export async function getSecret(
  key: string,
  serverUrl?: string,
): Promise<string | null> {
  // Environment variable takes priority (CI/headless environments)
  const envVar = ENV_VAR_MAP[key];
  if (envVar) {
    const envValue = process.env[envVar];
    if (envValue) return envValue;
  }

  const keychainKey = serverUrl ? `${key}:${serverUrl}` : key;
  const kt = await getKeytar();
  if (kt) {
    try {
      const value = await kt.getPassword(SERVICE, keychainKey);
      if (value) return value;
    } catch {
      // Fall through to conf
    }
  }
  // Fallback: read from conf
  if (serverUrl) {
    const store = config.store as Record<string, unknown>;
    const servers = store["servers"] as
      | Record<string, ServerConfig>
      | undefined;
    const val = servers?.[serverUrl]?.[key as keyof ServerConfig];
    return typeof val === "string" ? val : null;
  }
  // Legacy flat fallback (pre-migration)
  const stored = config.store as Record<string, unknown>;
  const val = stored[key];
  return typeof val === "string" ? val : null;
}

/**
 * Store a secret in OS keychain (or plaintext conf fallback with confirmation).
 * When serverUrl is provided, the keychain key is scoped: `key:serverUrl`.
 * Skips storage when the corresponding env var is set.
 * In non-TTY environments without keychain, throws instead of storing plaintext.
 */
export async function setSecret(
  key: string,
  value: string,
  serverUrl?: string,
): Promise<void> {
  // If env var is set, don't persist — env var covers runtime needs
  const envVar = ENV_VAR_MAP[key];
  if (envVar && process.env[envVar]) return;

  const keychainKey = serverUrl ? `${key}:${serverUrl}` : key;
  const kt = await getKeytar();
  if (kt) {
    try {
      await kt.setPassword(SERVICE, keychainKey, value);
      // Remove from conf if it was stored there before (migration)
      if (serverUrl) {
        const store = config.store as Record<string, unknown>;
        const servers = store["servers"] as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (servers?.[serverUrl]?.[key]) {
          delete servers[serverUrl][key];
          (config as unknown as import("conf").default<Record<string, unknown>>).set(
            "servers",
            servers,
          );
        }
      } else {
        const stored = config.store as Record<string, unknown>;
        if (key in stored) {
          delete stored[key];
          config.store = stored as typeof config.store;
        }
      }
      return;
    } catch {
      // Fall through to conf
    }
  }

  // Keychain unavailable — require confirmation or reject in non-TTY
  if (!process.stdin.isTTY) {
    throw new Error(
      "OS keychain unavailable and running in non-interactive mode.\n" +
      "Set ANYTERM_AUTH_TOKEN and ANYTERM_MASTER_KEY environment variables for headless environments.",
    );
  }

  if (!plaintextConfirmed) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await rl.question(
        "\x1b[33mOS keychain unavailable. Store credentials in plaintext config file? (y/N): \x1b[0m",
      );
      if (answer.trim().toLowerCase() !== "y") {
        throw new Error(
          "Credentials not saved. Set ANYTERM_AUTH_TOKEN and ANYTERM_MASTER_KEY environment variables, or install a keychain provider.",
        );
      }
      plaintextConfirmed = true;
    } finally {
      rl.close();
    }
  }

  // User confirmed plaintext storage
  if (serverUrl) {
    const store = config.store as Record<string, unknown>;
    const servers = (store["servers"] as Record<
      string,
      Record<string, unknown>
    >) ?? {};
    if (!servers[serverUrl]) servers[serverUrl] = {};
    servers[serverUrl][key] = value;
    (config as unknown as import("conf").default<Record<string, unknown>>).set(
      "servers",
      servers,
    );
  } else {
    (config as unknown as import("conf").default<Record<string, unknown>>).set(
      key,
      value,
    );
  }
  hardenConfigPermissions();
}

/**
 * Delete a secret from OS keychain and conf.
 * When serverUrl is provided, the keychain key is scoped: `key:serverUrl`.
 */
export async function deleteSecret(
  key: string,
  serverUrl?: string,
): Promise<void> {
  const keychainKey = serverUrl ? `${key}:${serverUrl}` : key;
  const kt = await getKeytar();
  if (kt) {
    try {
      await kt.deletePassword(SERVICE, keychainKey);
    } catch {
      // Ignore
    }
  }
  // Also clear from conf
  if (serverUrl) {
    const store = config.store as Record<string, unknown>;
    const servers = store["servers"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (servers?.[serverUrl]?.[key]) {
      delete servers[serverUrl][key];
      (config as unknown as import("conf").default<Record<string, unknown>>).set(
        "servers",
        servers,
      );
    }
  } else {
    const stored = config.store as Record<string, unknown>;
    if (key in stored) {
      delete stored[key];
      config.store = stored as typeof config.store;
    }
  }
}
