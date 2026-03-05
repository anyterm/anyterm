import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  setServerConfig,
  setActiveServer,
} from "../config.js";
import { setSecret } from "../secure-store.js";
import {
  deriveKeysFromPassword,
  decryptPrivateKey,
  fromBase64,
  toBase64,
} from "@anyterm/utils/crypto";
import { gql } from "../graphql.js";
import { readPassword } from "../shared/auth.js";

export const loginCommand = new Command("login")
  .description("Authenticate with anyterm server")
  .option("-s, --server <url>", "Server URL (default: anyterm.dev)")
  .action(async (opts) => {
    const rl = createInterface({ input: stdin, output: stdout });

    try {
      const serverUrl: string = normalizeServerUrl(
        opts.server || DEFAULT_SERVER_URL,
      );

      if (opts.server && opts.server !== DEFAULT_SERVER_URL) {
        console.log(`\x1b[33mConnecting to self-hosted server: ${serverUrl}\x1b[0m`);
        console.log(`\x1b[33mNote: For the official cloud service, use: anyterm login\x1b[0m\n`);
      }
      const email = await rl.question("Email: ");
      rl.close();

      const password = await readPassword("Password: ");

      console.log("Signing in...");

      // Sign in via better-auth API
      // Origin header required for better-auth CSRF protection
      const res = await fetch(`${serverUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: serverUrl,
        },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        console.error("Login failed:", res.statusText);
        process.exit(1);
      }

      const data = await res.json();
      const token = data.session?.token ?? data.token;
      const userId = data.user?.id;

      if (!token || !userId) {
        console.error("Login failed: invalid response");
        process.exit(1);
      }

      // Fetch user keys
      const keysData = await gql<{
        userKeys: { publicKey: string; encryptedPrivateKey: string; keySalt: string } | null;
      }>(serverUrl, token, `query { userKeys { publicKey encryptedPrivateKey keySalt } }`);

      if (!keysData.userKeys?.keySalt) {
        console.error("Failed to fetch encryption keys");
        process.exit(1);
      }

      // Verify we can decrypt with this password (validates key ownership)
      const salt = fromBase64(keysData.userKeys.keySalt);
      const { masterKey } = await deriveKeysFromPassword(password, salt);
      const encPk = fromBase64(keysData.userKeys.encryptedPrivateKey);
      await decryptPrivateKey(encPk, masterKey);

      // Fetch server config (WS URL)
      let wsUrl = serverUrl.replace(/^http/, "ws");
      try {
        const configRes = await fetch(`${serverUrl}/api/config`);
        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData.wsUrl) wsUrl = configData.wsUrl;
        }
      } catch {
        // Fallback to derived wsUrl
      }

      // Store secrets in OS keychain (scoped to server)
      await setSecret("authToken", token, serverUrl);
      await setSecret("masterKey", toBase64(masterKey), serverUrl);

      // Store non-sensitive config in per-server block
      setServerConfig(serverUrl, {
        wsUrl,
        userId,
        publicKey: keysData.userKeys.publicKey,
        encryptedPrivateKey: keysData.userKeys.encryptedPrivateKey,
        keySalt: keysData.userKeys.keySalt,
      });

      // Set this as the active server
      setActiveServer(serverUrl);

      // Auto-activate personal org (slug === userId)
      try {
        const orgsRes = await fetch(
          `${serverUrl}/api/auth/organization/list`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (orgsRes.ok) {
          const orgsData = await orgsRes.json();
          const orgs = orgsData ?? [];
          const personalOrg = orgs.find((o: unknown) => {
            const org = o as Record<string, unknown>;
            return org.slug === userId;
          });
          if (personalOrg) {
            await fetch(`${serverUrl}/api/auth/organization/set-active`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ organizationId: personalOrg.id }),
            });
          }
        }
      } catch {
        // Non-critical — org activation can be done later
      }

      console.log("Logged in successfully. Credentials stored in system keychain.");
    } catch (err) {
      console.error("Login failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    } finally {
      rl.close();
    }
  });
