"use client";

import { useState, useEffect } from "react";
import { gql } from "urql";
import { urqlClient } from "@/lib/urql";
import { USER_KEYS_QUERY } from "@/lib/graphql-queries";
import {
  deriveKeysFromPassword,
  fromBase64,
  decryptPrivateKey,
  generateKeyPair,
  encryptPrivateKey,
  toBase64,
} from "@anyterm/utils/crypto";
import { FormBanner } from "@/components/ui/form-banner";

const SETUP_KEYS_MUTATION = gql`
  mutation SetupEncryptionKeys($publicKey: String!, $encryptedPrivateKey: String!, $keySalt: String!) {
    setupEncryptionKeys(publicKey: $publicKey, encryptedPrivateKey: $encryptedPrivateKey, keySalt: $keySalt)
  }
`;

type KeysState =
  | { status: "loading" }
  | { status: "has-keys"; keySalt: string; encryptedPrivateKey: string }
  | { status: "no-keys" }
  | { status: "unlocked" };

export function EncryptionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<KeysState>({ status: "loading" });
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // If masterKey already in sessionStorage, skip the gate
    if (sessionStorage.getItem("anyterm_master_key")) {
      setState({ status: "unlocked" });
      return;
    }

    urqlClient.query(USER_KEYS_QUERY, {}).toPromise().then(({ data }) => {
      if (data?.userKeys?.keySalt) {
        setState({
          status: "has-keys",
          keySalt: data.userKeys.keySalt,
          encryptedPrivateKey: data.userKeys.encryptedPrivateKey,
        });
      } else {
        setState({ status: "no-keys" });
      }
    });
  }, []);

  if (state.status === "loading" || state.status === "unlocked") {
    return <>{state.status === "unlocked" ? children : null}</>;
  }

  const isSetup = state.status === "no-keys";

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;

    if (isSetup && passphrase !== confirm) {
      setError("Passphrases don't match");
      return;
    }
    if (isSetup && passphrase.length < 10) {
      setError("Passphrase must be at least 10 characters");
      return;
    }
    if (isSetup) {
      // Check character class diversity (at least 2 of: lower, upper, digit, special)
      const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
      const classCount = classes.filter((r) => r.test(passphrase)).length;
      if (classCount < 2) {
        setError("Passphrase must contain at least 2 of: lowercase, uppercase, number, special character");
        return;
      }
    }

    setError("");
    setSubmitting(true);

    try {
      if (state.status === "has-keys") {
        // Derive masterKey from passphrase + stored salt
        const salt = fromBase64(state.keySalt);
        const { masterKey } = await deriveKeysFromPassword(passphrase, salt);

        // Verify by decrypting the private key
        const encPk = fromBase64(state.encryptedPrivateKey);
        await decryptPrivateKey(encPk, masterKey);

        sessionStorage.setItem("anyterm_master_key", toBase64(masterKey));
        setState({ status: "unlocked" });
      } else {
        // Generate new keys for first-time social login user
        const { masterKey, salt } = await deriveKeysFromPassword(passphrase);
        const { publicKey, privateKey } = await generateKeyPair();
        const encryptedPk = await encryptPrivateKey(privateKey, masterKey);

        const { error: mutError } = await urqlClient
          .mutation(SETUP_KEYS_MUTATION, {
            publicKey: toBase64(publicKey),
            encryptedPrivateKey: toBase64(encryptedPk),
            keySalt: toBase64(salt),
          })
          .toPromise();

        if (mutError) throw mutError;

        sessionStorage.setItem("anyterm_master_key", toBase64(masterKey));
        setState({ status: "unlocked" });
      }
    } catch {
      setError(
        isSetup
          ? "Failed to set up encryption keys"
          : "Invalid passphrase. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {isSetup ? "Set up encryption" : "Unlock encryption"}
            </h1>
            <p className="text-sm text-zinc-500">
              {isSetup
                ? "Create a passphrase to protect your end-to-end encryption keys. This is separate from your social login."
                : "Enter your encryption passphrase to decrypt your terminal sessions."}
            </p>
          </div>

          <form onSubmit={handleUnlock} className="flex flex-col gap-4">
            {error && (
              <FormBanner variant="error">{error}</FormBanner>
            )}

            <input
              type="password"
              placeholder={isSetup ? "Encryption passphrase" : "Encryption passphrase"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
            />

            {isSetup && (
              <input
                type="password"
                placeholder="Confirm passphrase"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
              />
            )}

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
            >
              {submitting
                ? isSetup
                  ? "Setting up..."
                  : "Unlocking..."
                : isSetup
                  ? "Set up encryption"
                  : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
