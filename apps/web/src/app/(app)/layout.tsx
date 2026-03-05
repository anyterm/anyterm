"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { SubscriptionProvider } from "@/lib/subscription-context";
import { EncryptionGate } from "@/components/auth/encryption-gate";
import { AnytermLogo } from "@/components/anyterm-logo";
import { useAutoKeyGrant } from "@/hooks/use-auto-key-grant";

function OrgSwitcher({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: orgs } = (authClient as any).useListOrganizations();
  const { data: activeOrg } = (authClient as any).useActiveOrganization();

  // Auto-select personal org if none active
  useEffect(() => {
    if (orgs && !activeOrg) {
      const personalOrg = orgs.find((o: any) => o.slug === userId);
      if (personalOrg) {
        (authClient as any).organization.setActive({ organizationId: personalOrg.id });
      }
    }
  }, [orgs, activeOrg, userId]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!orgs || orgs.length <= 1) return null;

  const isPersonal = (org: any) => org.slug === userId;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
      >
        <span className="max-w-[120px] truncate">
          {activeOrg?.name ?? "Select org"}
        </span>
        {activeOrg && isPersonal(activeOrg) && (
          <span className="rounded-full bg-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-400">
            Personal
          </span>
        )}
        <svg className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
          {orgs.map((org: any) => (
            <button
              key={org.id}
              onClick={() => {
                (authClient as any).organization.setActive({ organizationId: org.id });
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-zinc-800 ${
                activeOrg?.id === org.id ? "text-white" : "text-zinc-400"
              }`}
            >
              <span className="flex-1 truncate">{org.name}</span>
              {isPersonal(org) && (
                <span className="rounded-full bg-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  Personal
                </span>
              )}
              {activeOrg?.id === org.id && (
                <svg className="h-3.5 w-3.5 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Auto-grant org encryption keys to pending members
  useAutoKeyGrant();

  const handleSignOut = useCallback(() => {
    setMenuOpen(false);
    authClient.signOut().then(() => router.push("/login"));
  }, [router]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="relative z-10 shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="transition hover:opacity-85" aria-label="Anyterm dashboard">
              <AnytermLogo textClassName="text-lg" />
            </Link>
            <span className="text-zinc-800">/</span>
            <OrgSwitcher userId={session.user.id} />
          </div>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 rounded-xl border border-transparent px-3 py-1.5 text-sm text-zinc-400 transition hover:border-zinc-800 hover:bg-zinc-900 hover:text-white"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 text-xs font-medium text-zinc-200">
                {session.user.name.charAt(0).toUpperCase()}
              </span>
              <span className="hidden sm:inline">{session.user.name}</span>
              <svg className={`h-3.5 w-3.5 text-zinc-600 transition ${menuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900 py-1 shadow-2xl shadow-black/40">
                <Link
                  href="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                  Sessions
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><circle cx="12" cy="12" r="3" /></svg>
                  Settings
                </Link>
                <Link
                  href="/activity"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Activity
                </Link>
                <div className="my-1 border-t border-zinc-800/60" />
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-300"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <EncryptionGate>
          <SubscriptionProvider>{children}</SubscriptionProvider>
        </EncryptionGate>
      </main>
    </div>
  );
}
