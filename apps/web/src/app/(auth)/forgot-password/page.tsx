"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { FormBanner } from "@/components/ui/form-banner";

const schema = z.object({
  email: z.string().email("Invalid email address"),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setServerError("");
    try {
      const result = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        setServerError(result.error.message || "Something went wrong");
        return;
      }
      setSent(true);
    } catch {
      setServerError("Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="text-sm text-zinc-400">
          Enter your email and we'll send you a reset link
        </p>
      </div>

      {sent ? (
        <div className="flex flex-col gap-4">
          <FormBanner variant="success">
            Check your email for a password reset link.
          </FormBanner>
          <Link
            href="/login"
            className="text-center text-sm text-zinc-400 hover:text-white"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {serverError && (
            <FormBanner variant="error">{serverError}</FormBanner>
          )}

          <div>
            <input
              type="email"
              placeholder="Email"
              {...register("email")}
              autoFocus
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
          >
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>

          <Link
            href="/login"
            className="text-center text-sm text-zinc-500 hover:text-white"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
