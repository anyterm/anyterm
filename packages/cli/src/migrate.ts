import { config, CONFIG_VERSION } from "./config.js";
import { getSecret, setSecret, deleteSecret } from "./secure-store.js";

let migrated = false;

/**
 * One-time migration from v1 (flat) config to v2 (per-server) config.
 * Moves flat conf fields into servers[serverUrl] block,
 * migrates flat keychain entries to host-scoped entries,
 * and sets configVersion to prevent re-migration.
 *
 * Idempotent: runs at most once per process, skips if already at v2+.
 */
export async function migrateConfigIfNeeded(): Promise<void> {
  if (migrated) return;
  migrated = true;

  const store = config.store as Record<string, unknown>;
  const version = store["configVersion"] as number | undefined;

  if (version && version >= CONFIG_VERSION) return;

  // Check for legacy flat config
  const legacyServerUrl = store["serverUrl"] as string | undefined;
  if (!legacyServerUrl) {
    // Fresh install or already cleaned up — just stamp version
    (config as unknown as import("conf").default<Record<string, unknown>>).set(
      "configVersion",
      CONFIG_VERSION,
    );
    return;
  }

  // Build per-server config block from flat fields
  const serverConfig: Record<string, unknown> = {};
  const perServerKeys = [
    "wsUrl",
    "userId",
    "publicKey",
    "encryptedPrivateKey",
    "keySalt",
  ];
  for (const k of perServerKeys) {
    if (k in store) {
      serverConfig[k] = store[k];
    }
  }

  // Migrate secrets from flat keychain keys to host-scoped keys.
  // getSecret(key) without serverUrl reads the old flat key.
  // setSecret(key, val, serverUrl) writes the new host-scoped key.
  // deleteSecret(key) without serverUrl deletes the old flat key.
  for (const secretKey of ["authToken", "masterKey"] as const) {
    const value = await getSecret(secretKey);
    if (value) {
      await setSecret(secretKey, value, legacyServerUrl);
      await deleteSecret(secretKey);
    }
  }

  // Write new per-server structure
  const servers = (store["servers"] as Record<string, unknown>) ?? {};
  servers[legacyServerUrl] = serverConfig;
  (config as unknown as import("conf").default<Record<string, unknown>>).set(
    "servers",
    servers,
  );
  (config as unknown as import("conf").default<Record<string, unknown>>).set(
    "activeServer",
    legacyServerUrl,
  );
  (config as unknown as import("conf").default<Record<string, unknown>>).set(
    "configVersion",
    CONFIG_VERSION,
  );

  // Remove legacy flat keys (keep machineName at root)
  const legacyKeys = [
    "serverUrl",
    "wsUrl",
    "userId",
    "publicKey",
    "encryptedPrivateKey",
    "keySalt",
    "authToken",
    "masterKey",
  ];
  for (const k of legacyKeys) {
    if (k in store) {
      delete store[k];
    }
  }
  config.store = store as typeof config.store;
}

/** Reset migration state (for testing only). */
export function _resetMigrationState(): void {
  migrated = false;
}
