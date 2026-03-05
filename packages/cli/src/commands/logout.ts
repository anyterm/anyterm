import { Command } from "commander";
import { config, getActiveServer, deleteServerConfig } from "../config.js";
import { getSecret, deleteSecret } from "../secure-store.js";
import { migrateConfigIfNeeded } from "../migrate.js";

export const logoutCommand = new Command("logout")
  .description("Clear saved credentials")
  .action(async () => {
    await migrateConfigIfNeeded();

    const serverUrl = getActiveServer();
    const authToken = serverUrl
      ? await getSecret("authToken", serverUrl)
      : null;

    // Attempt server-side session revocation
    if (serverUrl && authToken) {
      try {
        await fetch(`${serverUrl}/api/auth/sign-out`, {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // Best effort — still clear local credentials
      }
    }

    if (serverUrl) {
      // Clear host-scoped secrets from keychain
      await deleteSecret("authToken", serverUrl);
      await deleteSecret("masterKey", serverUrl);

      // Remove per-server config block
      deleteServerConfig(serverUrl);

      // Clear activeServer pointer
      const store = config.store as Record<string, unknown>;
      delete store["activeServer"];
      config.store = store as typeof config.store;
    }

    console.log("Logged out. Credentials cleared.");
  });
