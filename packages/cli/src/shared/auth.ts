import {
  deriveKeysFromPassword,
  decryptPrivateKey,
  fromBase64,
} from "@anyterm/utils/crypto";

/**
 * Read password from stdin without echoing characters.
 */
export async function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const buf: Buffer[] = [];

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (ch: string) => {
      if (ch === "\n" || ch === "\r" || ch === "\u0004") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(Buffer.concat(buf).toString("utf8"));
      } else if (ch === "\u0003") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.exit(130);
      } else if (ch === "\u007F" || ch === "\b") {
        buf.pop();
      } else {
        buf.push(Buffer.from(ch, "utf8"));
      }
    };

    process.stdin.on("data", onData);
  });
}

type KeyConfig = {
  masterKey?: string;
  encryptedPrivateKey: string;
  keySalt: string;
};

/**
 * Decrypt private key from config — uses cached masterKey if available,
 * otherwise prompts for password.
 */
export async function decryptPrivateKeyFromConfig(
  cfg: KeyConfig,
): Promise<Uint8Array> {
  if (cfg.masterKey) {
    try {
      const mk = fromBase64(cfg.masterKey);
      return await decryptPrivateKey(fromBase64(cfg.encryptedPrivateKey), mk);
    } catch {
      console.error("Cached master key is invalid. Please run: anyterm login");
      process.exit(1);
    }
  }

  const password = await readPassword("Password (to unlock keys): ");
  try {
    const salt = fromBase64(cfg.keySalt);
    const { masterKey } = await deriveKeysFromPassword(password, salt);
    return await decryptPrivateKey(
      fromBase64(cfg.encryptedPrivateKey),
      masterKey,
    );
  } catch {
    console.error("Incorrect password.");
    process.exit(1);
  }
}
