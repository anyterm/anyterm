"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { FormBanner } from "@/components/ui/form-banner";

const nameSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

type NameValues = z.infer<typeof nameSchema>;

export function AccountSection({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [success, setSuccess] = useState("");
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: userName },
  });

  async function onSubmit(values: NameValues) {
    setServerError("");
    setSuccess("");

    try {
      const result = await authClient.updateUser({ name: values.name });
      if (result.error) {
        setServerError(result.error.message || "Failed to update name");
        return;
      }
      setSuccess("Name updated");
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setServerError("Failed to update name");
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
      <h3 className="mb-4 font-medium">Account</h3>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Name</label>
          <input
            type="text"
            {...register("name")}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-400">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-400">Email</label>
          <input
            type="email"
            value={userEmail}
            disabled
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-500"
          />
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
          {isSubmitting ? "Saving..." : "Save"}
        </button>
      </form>
    </section>
  );
}
