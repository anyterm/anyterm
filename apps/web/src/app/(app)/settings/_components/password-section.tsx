"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "urql";
import { gql } from "urql";
import { authClient } from "@/lib/auth-client";
import { USER_KEYS_QUERY } from "@/lib/graphql-queries";
import { urqlClient } from "@/lib/urql";
import { FormBanner } from "@/components/ui/form-banner";
import {
  deriveKeysFromPassword,
  fromBase64,
  decryptPrivateKey,
  encryptPrivateKey,
  toBase64,
} from "@anyterm/utils/crypto";

const UPDATE_KEYS_MUTATION = gql`
  mutation ($encryptedPrivateKey: String!, $keySalt: String!, $currentPassword: String!) {
    updateUserKeys(encryptedPrivateKey: $encryptedPrivateKey, keySalt: $keySalt, currentPassword: $currentPassword)
  }
`;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type PasswordValues = z.infer<typeof passwordSchema>;

export function PasswordSection() {
  const [success, setSuccess] = useState("");
  const [serverError, setServerError] = useState("");
  const [, executeUpdateKeys] = useMutation(UPDATE_KEYS_MUTATION);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
  });

  async function onSubmit(values: PasswordValues) {
    setServerError("");
    setSuccess("");

    try {
      // 1. Fetch current encryption keys
      const { data: keysData, error: keysError } = await urqlClient
        .query(USER_KEYS_QUERY, {})
        .toPromise();

      if (keysError || !keysData?.userKeys?.keySalt) {
        setServerError("Failed to fetch encryption keys");
        return;
      }

      // 2. Derive old masterKey and decrypt privateKey
      const oldSalt = fromBase64(keysData.userKeys.keySalt);
      const { masterKey: oldMasterKey } = await deriveKeysFromPassword(
        values.currentPassword,
        oldSalt,
      );

      let privateKey: Uint8Array;
      try {
        const encPk = fromBase64(keysData.userKeys.encryptedPrivateKey);
        privateKey = await decryptPrivateKey(encPk, oldMasterKey);
      } catch {
        setServerError("Current password is incorrect");
        return;
      }

      // 3. Derive new masterKey and re-encrypt privateKey
      const { masterKey: newMasterKey, salt: newSalt } =
        await deriveKeysFromPassword(values.newPassword);
      const newEncryptedPk = await encryptPrivateKey(privateKey, newMasterKey);

      // 4. Store new encryption keys FIRST (safe — new ciphertext is useless without new password)
      const keysResult = await executeUpdateKeys({
        encryptedPrivateKey: toBase64(newEncryptedPk),
        keySalt: toBase64(newSalt),
        currentPassword: values.currentPassword,
      });

      if (keysResult.error) {
        setServerError("Failed to update encryption keys");
        return;
      }

      // 5. Change password in better-auth (revokes all other sessions)
      // Done after key update so we can't end up with changed password but old keys
      const result = await authClient.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      });

      if (result.error) {
        // Keys were already updated with new encryption — revert them
        try {
          const revertEncPk = await encryptPrivateKey(privateKey, oldMasterKey);
          await executeUpdateKeys({
            encryptedPrivateKey: toBase64(revertEncPk),
            keySalt: toBase64(oldSalt),
            currentPassword: values.currentPassword,
          });
        } catch {
          // Best effort revert
        }
        setServerError(result.error.message || "Failed to change password");
        return;
      }

      // 6. Update masterKey in sessionStorage
      sessionStorage.setItem("anyterm_master_key", toBase64(newMasterKey));

      setSuccess("Password changed");
      reset();
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setServerError("Failed to change password");
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
      <h3 className="mb-2 font-medium">Change Password</h3>
      <p className="mb-4 text-sm text-zinc-500">
        Changing your password will sign you out of all other devices and CLI sessions.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-400">
            Current password
          </label>
          <input
            type="password"
            {...register("currentPassword")}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
          />
          {errors.currentPassword && (
            <p className="mt-1 text-xs text-red-400">
              {errors.currentPassword.message}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-400">
            New password
          </label>
          <input
            type="password"
            {...register("newPassword")}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
          />
          {errors.newPassword && (
            <p className="mt-1 text-xs text-red-400">
              {errors.newPassword.message}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-400">
            Confirm new password
          </label>
          <input
            type="password"
            {...register("confirmPassword")}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
          />
          {errors.confirmPassword && (
            <p className="mt-1 text-xs text-red-400">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {serverError && (
          <FormBanner variant="error">{serverError}</FormBanner>
        )}
        {success && (
          <FormBanner variant="success">{success}</FormBanner>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
        >
          {isSubmitting ? "Changing..." : "Change password"}
        </button>
      </form>
    </section>
  );
}
