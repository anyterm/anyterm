"use client";

import Link from "next/link";

export default function SessionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
      <h1 className="text-xl font-medium text-zinc-100">Failed to load session</h1>
      <p className="text-sm text-zinc-400">
        {error.digest
          ? `Error ID: ${error.digest}`
          : "The terminal session could not be loaded."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          Retry
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          Back to sessions
        </Link>
      </div>
    </div>
  );
}
