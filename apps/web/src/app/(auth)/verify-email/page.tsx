"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { FormBanner } from "@/components/ui/form-banner";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">(
    token ? "verifying" : "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");

  const verify = useCallback(async () => {
    if (!token) return;
    try {
      const result = await authClient.verifyEmail({ query: { token } });
      if (result.error) {
        setStatus("error");
        setErrorMsg(result.error.message || "Verification failed");
        return;
      }
      setStatus("success");
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setStatus("error");
      setErrorMsg("Verification failed");
    }
  }, [token, router]);

  useEffect(() => {
    if (token) verify();
  }, [token, verify]);

  // Token present — verifying or showing result
  if (token) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 text-center">
          {status === "verifying" && (
            <>
              <h1 className="text-2xl font-bold">Verifying...</h1>
              <p className="text-sm text-zinc-400">Hold on while we verify your email</p>
            </>
          )}
          {status === "success" && (
            <>
              <h1 className="text-2xl font-bold">Email verified</h1>
              <FormBanner variant="success">Redirecting to sign in...</FormBanner>
            </>
          )}
          {status === "error" && (
            <>
              <h1 className="text-2xl font-bold">Verification failed</h1>
              <FormBanner variant="error">{errorMsg}</FormBanner>
              <Link
                href="/login"
                className="mt-2 text-sm text-zinc-400 hover:text-white"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  // No token — show "check your email" state
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-sm text-zinc-400">
          We sent a verification link to your email address.
          Click the link to activate your account.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-center text-sm text-zinc-500">
          Didn&apos;t receive it? Try signing in again to resend.
        </p>
        <Link
          href="/login"
          className="rounded-lg border border-zinc-800 px-4 py-3 text-center text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-300"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
