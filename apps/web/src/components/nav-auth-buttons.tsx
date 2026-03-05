"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function NavAuthButtons() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <>
        <div className="h-8 w-16 animate-pulse rounded-md bg-zinc-800" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-zinc-800" />
      </>
    );
  }

  if (session) {
    return (
      <Link
        href="/dashboard"
        className="rounded-lg bg-white px-4 py-2 font-medium text-zinc-950 transition hover:bg-zinc-200"
      >
        Dashboard
      </Link>
    );
  }

  return (
    <>
      <Link href="/login" className="text-zinc-400 transition hover:text-white">Sign in</Link>
      <Link
        href="/register"
        className="rounded-lg bg-white px-4 py-2 font-medium text-zinc-950 transition hover:bg-zinc-200"
      >
        Get Started
      </Link>
    </>
  );
}
