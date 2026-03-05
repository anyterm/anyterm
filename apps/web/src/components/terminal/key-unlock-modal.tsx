"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { deriveKeysFromPassword, fromBase64, toBase64 } from "@anyterm/utils/crypto";
import { urqlClient } from "@/lib/urql";
import { USER_KEYS_QUERY } from "@/lib/graphql-queries";
import { FormBanner } from "@/components/ui/form-banner";

const unlockSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

type UnlockValues = z.infer<typeof unlockSchema>;

interface KeyUnlockModalProps {
  error?: string;
  onUnlock: (masterKey: Uint8Array) => void;
}

export function KeyUnlockModal({ error, onUnlock }: KeyUnlockModalProps) {
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UnlockValues>({
    resolver: zodResolver(unlockSchema),
  });

  async function onSubmit(values: UnlockValues) {
    setServerError("");

    try {
      const { data: keysData, error: keysError } = await urqlClient
        .query(USER_KEYS_QUERY, {})
        .toPromise();

      if (keysError) throw keysError;

      if (!keysData?.userKeys?.keySalt) {
        throw new Error("No keys found");
      }

      const salt = fromBase64(keysData.userKeys.keySalt);
      const { masterKey } = await deriveKeysFromPassword(values.password, salt);

      sessionStorage.setItem("anyterm_master_key", toBase64(masterKey));
      onUnlock(masterKey);
    } catch {
      setServerError("Failed to decrypt. Wrong password?");
    }
  }

  const displayError = error || serverError;

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
            <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
          </div>
          <h2 className="font-display text-lg font-bold tracking-tight">Unlock encryption</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Enter your password to decrypt this session
          </p>
        </div>

        {displayError && (
          <FormBanner variant="error">{displayError}</FormBanner>
        )}

        <div>
          <input
            type="password"
            placeholder="Password"
            {...register("password")}
            autoFocus
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
          />
          {errors.password && (
            <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
        >
          {isSubmitting ? "Decrypting..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}
