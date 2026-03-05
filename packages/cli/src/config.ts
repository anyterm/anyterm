import * as os from "node:os";
import Conf from "conf";
import machineId from "node-machine-id";
import { getSecret } from "./secure-store.js";

export const DEFAULT_SERVER_URL = "https://anyterm.dev";
export const CONFIG_VERSION = 2;

export type ServerConfig = {
  wsUrl: string;
  userId: string;
  publicKey: string; // base64
  encryptedPrivateKey: string; // base64 (encrypted with masterKey — never stored decrypted)
  keySalt: string; // base64 (for re-deriving masterKey from password)
  // Plaintext fallback only (when keytar unavailable):
  authToken?: string;
  masterKey?: string;
};

type AnytermConfig = {
  configVersion?: number;
  activeServer?: string;
  machineName?: string;
  servers?: Record<string, ServerConfig>;
  // Legacy flat fields (pre-migration, v1):
  serverUrl?: string;
  wsUrl?: string;
  userId?: string;
  publicKey?: string;
  encryptedPrivateKey?: string;
  keySalt?: string;
  authToken?: string;
  masterKey?: string;
};

export const config = new Conf<AnytermConfig>({
  projectName: "anyterm",
});

/** Normalize a server URL for consistent keying. */
export function normalizeServerUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
}

/** Get the active server URL. */
export function getActiveServer(): string | undefined {
  return config.get("activeServer");
}

/** Set the active server URL. */
export function setActiveServer(serverUrl: string): void {
  (config as unknown as Conf<Record<string, unknown>>).set(
    "activeServer",
    serverUrl,
  );
}

/** Read per-server config block. */
export function getServerConfig(
  serverUrl: string,
): ServerConfig | undefined {
  const store = config.store;
  return store.servers?.[serverUrl];
}

/** Write per-server config block (merges with existing). */
export function setServerConfig(
  serverUrl: string,
  data: Omit<ServerConfig, "authToken" | "masterKey">,
): void {
  const store = config.store;
  const servers = store.servers ?? {};
  servers[serverUrl] = { ...servers[serverUrl], ...data } as ServerConfig;
  (config as unknown as Conf<Record<string, unknown>>).set("servers", servers);
}

/** Delete a server's config block. */
export function deleteServerConfig(serverUrl: string): void {
  const store = config.store;
  if (store.servers?.[serverUrl]) {
    delete store.servers[serverUrl];
    (config as unknown as Conf<Record<string, unknown>>).set(
      "servers",
      store.servers,
    );
  }
}

export async function getConfig() {
  // Lazy migration from v1 flat config to v2 per-server config
  const { migrateConfigIfNeeded } = await import("./migrate.js");
  await migrateConfigIfNeeded();

  const activeServer = config.get("activeServer");
  if (!activeServer) {
    console.error("Not logged in. Run: anyterm login");
    process.exit(1);
  }

  const serverConf = getServerConfig(activeServer);
  if (!serverConf?.userId) {
    console.error("Not logged in. Run: anyterm login");
    process.exit(1);
  }

  const authToken = await getSecret("authToken", activeServer);
  if (!authToken) {
    console.error("Not logged in. Run: anyterm login");
    process.exit(1);
  }

  const wsUrl =
    serverConf.wsUrl || activeServer.replace(/^http/, "ws");

  // masterKey may be null if keychain unavailable (will prompt for password)
  const masterKey = await getSecret("masterKey", activeServer);

  return {
    serverUrl: activeServer,
    wsUrl,
    authToken,
    userId: serverConf.userId,
    publicKey: serverConf.publicKey,
    encryptedPrivateKey: serverConf.encryptedPrivateKey,
    keySalt: serverConf.keySalt,
    masterKey,
  };
}

/** Get a short stable machine identifier derived from OS hardware. */
export function getMachineId(): string {
  return machineId.machineIdSync().slice(0, 8);
}

/** Get stored machine display name, falling back to hostname. */
export function getMachineName(): string {
  return config.get("machineName") || os.hostname();
}

/** Persist a machine display name. */
export function setMachineName(name: string): void {
  (config as unknown as Conf<Record<string, unknown>>).set(
    "machineName",
    name,
  );
}
