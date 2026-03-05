"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const invitationId = searchParams.get("id");

  useEffect(() => {
    if (!invitationId) {
      setStatus("error");
      setErrorMsg("Missing invitation ID");
      return;
    }

    (authClient as any).organization
      .acceptInvitation({ invitationId })
      .then((result: any) => {
        if (result.error) {
          setStatus("error");
          setErrorMsg(result.error.message || "Failed to accept invitation");
        } else {
          setStatus("success");
          setTimeout(() => router.push("/dashboard"), 2000);
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("Failed to accept invitation");
      });
  }, [invitationId, router]);

  return (
    <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
      {status === "loading" && (
        <>
          <h2 className="mb-2 text-lg font-bold">Accepting invitation...</h2>
          <p className="text-sm text-zinc-400">Please wait</p>
        </>
      )}
      {status === "success" && (
        <>
          <h2 className="mb-2 text-lg font-bold text-green-400">Invitation accepted!</h2>
          <p className="text-sm text-zinc-400">Redirecting to dashboard...</p>
        </>
      )}
      {status === "error" && (
        <>
          <h2 className="mb-2 text-lg font-bold text-red-400">Failed</h2>
          <p className="mb-4 text-sm text-zinc-400">{errorMsg}</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200"
          >
            Go to Dashboard
          </button>
        </>
      )}
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Suspense
        fallback={
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
            <h2 className="mb-2 text-lg font-bold">Loading...</h2>
          </div>
        }
      >
        <AcceptInvitationContent />
      </Suspense>
    </div>
  );
}
