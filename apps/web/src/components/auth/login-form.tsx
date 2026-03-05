"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { urqlClient } from "@/lib/urql";
import { USER_KEYS_QUERY } from "@/lib/graphql-queries";
import {
  deriveKeysFromPassword,
  fromBase64,
  decryptPrivateKey,
  toBase64,
} from "@anyterm/utils/crypto";
import { SocialButtons } from "./social-buttons";
import { FormBanner } from "@/components/ui/form-banner";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState("");
  const [ssoMode, setSsoMode] = useState(false);
  const [ssoEmail, setSsoEmail] = useState("");
  const [ssoLoading, setSsoLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginValues) {
    setServerError("");

    try {
      const result = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });

      if (result.error) {
        if (result.error.status === 403) {
          router.push("/verify-email");
          return;
        }
        setServerError(result.error.message || "Login failed");
        return;
      }

      // Fetch user keys and derive masterKey
      const { data: keysData, error: keysError } = await urqlClient
        .query(USER_KEYS_QUERY, {})
        .toPromise();

      if (keysError) throw keysError;

      if (keysData?.userKeys?.keySalt) {
        const salt = fromBase64(keysData.userKeys.keySalt);
        const { masterKey } = await deriveKeysFromPassword(values.password, salt);

        // Verify we can decrypt the private key
        const encPk = fromBase64(keysData.userKeys.encryptedPrivateKey);
        await decryptPrivateKey(encPk, masterKey);

        // Store masterKey in sessionStorage (cleared on tab close)
        sessionStorage.setItem("anyterm_master_key", toBase64(masterKey));
      }

      router.push("/dashboard");
    } catch {
      setServerError("Login failed");
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
        <div className="mt-1 flex items-center justify-between">
          {errors.password ? (
            <p className="text-xs text-red-400">{errors.password.message}</p>
          ) : <span />}
          <Link href="/forgot-password" className="text-xs text-zinc-500 hover:text-zinc-300">
            Forgot password?
          </Link>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-zinc-300 hover:text-white">
          Sign up
        </Link>
      </p>
      </form>

      <div className="relative flex items-center gap-4 py-1">
        <div className="h-px flex-1 bg-zinc-800" />
        <span className="text-xs text-zinc-600">or</span>
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      {ssoMode ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setServerError("");
            const domain = ssoEmail.split("@")[1];
            if (!domain) {
              setServerError("Enter a valid work email");
              return;
            }
            setSsoLoading(true);
            try {
              await (authClient as any).signIn.sso({
                organizationSlug: domain,
                callbackURL: "/dashboard",
              });
            } catch {
              setServerError("SSO sign-in failed. Check your organization's SSO configuration.");
              setSsoLoading(false);
            }
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="email"
            placeholder="Work email (e.g. you@company.com)"
            value={ssoEmail}
            onChange={(e) => setSsoEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
            autoFocus
          />
          <button
            type="submit"
            disabled={ssoLoading}
            className="rounded-lg border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {ssoLoading ? "Redirecting..." : "Continue with SSO"}
          </button>
          <button
            type="button"
            onClick={() => { setSsoMode(false); setServerError(""); }}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Back to password sign in
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => { setSsoMode(true); setServerError(""); }}
          className="w-full rounded-lg border border-zinc-800 px-4 py-3 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-300"
        >
          Sign in with SSO
        </button>
      )}
    </div>
  );
}
