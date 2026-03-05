"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import {
  deriveKeysFromPassword,
  generateKeyPair,
  encryptPrivateKey,
  toBase64,
} from "@anyterm/utils/crypto";
import { SocialButtons } from "./social-buttons";
import { FormBanner } from "@/components/ui/form-banner";

const registerSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(10, "Password must be at least 10 characters").refine(
      (pw) => {
        const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
        return classes.filter((r) => r.test(pw)).length >= 2;
      },
      "Must contain at least 2 of: lowercase, uppercase, number, special character",
    ),
    confirm: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  async function onSubmit(values: RegisterValues) {
    setServerError("");

    try {
      // 1. Derive masterKey from password
      const { masterKey, salt } = await deriveKeysFromPassword(values.password);

      // 2. Generate X25519 keypair
      const { publicKey, privateKey } = await generateKeyPair();

      // 3. Encrypt privateKey with masterKey
      const encryptedPk = await encryptPrivateKey(privateKey, masterKey);

      // 4. Sign up with better-auth + E2E key data
      const result = await authClient.signUp.email({
        email: values.email,
        password: values.password,
        name: values.name,
        publicKey: toBase64(publicKey),
        encryptedPrivateKey: toBase64(encryptedPk),
        keySalt: toBase64(salt),
      });

      if (result.error) {
        setServerError(result.error.message || "Registration failed");
        return;
      }

      // 5. Store masterKey in sessionStorage
      sessionStorage.setItem("anyterm_master_key", toBase64(masterKey));

      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch {
      setServerError("Registration failed");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SocialButtons />
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {serverError && (
        <FormBanner variant="error">{serverError}</FormBanner>
      )}

      <div>
        <input
          type="text"
          placeholder="Name"
          {...register("name")}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
        />
        {errors.name && (
          <p className="mt-1 text-xs text-red-400">{errors.name.message}</p>
        )}
      </div>

      <div>
        <input
          type="email"
          placeholder="Email"
          {...register("email")}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
        />
        {errors.email && (
          <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>
        )}
      </div>

      <div>
        <input
          type="password"
          placeholder="Password"
          {...register("password")}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
        />
        {errors.password && (
          <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>
        )}
      </div>

      <div>
        <input
          type="password"
          placeholder="Confirm password"
          {...register("confirm")}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
        />
        {errors.confirm && (
          <p className="mt-1 text-xs text-red-400">{errors.confirm.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
      >
        {isSubmitting ? "Creating account..." : "Create account"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="text-zinc-300 hover:text-white">
          Sign in
        </Link>
      </p>
      </form>
    </div>
  );
}
