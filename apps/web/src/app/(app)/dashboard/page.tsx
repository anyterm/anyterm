"use client";

import { useEffect, useState, useCallback } from "react";
import { gql, useQuery, useMutation } from "urql";
import { urqlClient } from "@/lib/urql";
import { authClient } from "@/lib/auth-client";
import { SessionList } from "@/components/dashboard/session-list";
import { SessionTabs } from "@/components/dashboard/session-tabs";
import { SessionWorkspace } from "@/components/dashboard/session-workspace";
import { SpawnTerminalModal } from "@/components/dashboard/spawn-terminal-modal";
import { useSessionNotifications } from "@/hooks/use-session-notifications";
import type { TerminalSessionMeta, MachineInfo } from "@anyterm/utils/types";

const PAGE_SIZE = 50;

const SESSIONS_QUERY = gql`
  query ($limit: Int!, $offset: Int!) {
    sessions(limit: $limit, offset: $offset) {
      id userId name command status encryptedSessionKey
      cols rows agentType machineId machineName forwardedPorts snapshotSeq snapshotData createdAt endedAt
    }
  }
`;

const DELETE_SESSION_MUTATION = gql`
  mutation ($id: String!) {
    deleteSession(id: $id)
  }
`;

export default function DashboardPage() {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [result, reexecuteQuery] = useQuery<{ sessions: TerminalSessionMeta[] }>({
    query: SESSIONS_QUERY,
    variables: { limit: pageSize, offset: 0 },
  });

  const { data, fetching, error } = result;
  const hasMore = (data?.sessions?.length ?? 0) >= pageSize;

  const loadMore = useCallback(() => {
    setPageSize((prev) => prev + PAGE_SIZE);
  }, []);

  const [, executeDelete] = useMutation(DELETE_SESSION_MUTATION);

  const [openTabs, setOpenTabs] = useState<TerminalSessionMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [daemonMachines, setDaemonMachines] = useState<MachineInfo[]>([]);
  const [showSpawnModal, setShowSpawnModal] = useState(false);

  // Refetch sessions immediately when active organization changes
  const { data: activeOrg } = (authClient as unknown as { useActiveOrganization: () => { data: { id: string } | null } }).useActiveOrganization();
  useEffect(() => {
    if (activeOrg?.id) {
      reexecuteQuery({ requestPolicy: "network-only" });
    }
  }, [activeOrg?.id, reexecuteQuery]);

  // Poll sessions + daemon status every 5s (pauses when tab is hidden)
  useEffect(() => {
    const checkDaemonStatus = async () => {
      try {
        const res = await fetch("/api/daemon/status");
        if (res.ok) {
          const data = await res.json();
          setDaemonMachines(Array.isArray(data.machines) ? data.machines : []);
        }
      } catch {
        setDaemonMachines([]);
      }
    };

    // Initial check
    checkDaemonStatus();

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        reexecuteQuery({ requestPolicy: "network-only" });
        checkDaemonStatus();
      }
    }, 5000);

    // Refetch immediately when tab becomes visible again
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reexecuteQuery({ requestPolicy: "network-only" });
        checkDaemonStatus();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reexecuteQuery]);

  // Sync open tab statuses when polled data arrives
  useEffect(() => {
    if (!data?.sessions) return;
    setOpenTabs((prev) =>
      prev.map((tab) => {
        const fresh = data.sessions.find((s) => s.id === tab.id);
        if (fresh && fresh.status !== tab.status) {
          return { ...tab, status: fresh.status };
        }
        return tab;
      })
    );
  }, [data?.sessions]);

  const openSession = useCallback((session: TerminalSessionMeta) => {
    setOpenTabs((prev) => {
      if (prev.some((t) => t.id === session.id)) return prev;
      return [...prev, session];
    });
    setActiveTabId(session.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      setActiveTabId((prevActive) => {
        if (prevActive !== id) return prevActive;
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
      return remaining;
    });
  }, []);

  const deleteSession = useCallback(async (session: TerminalSessionMeta) => {
    await executeDelete({ id: session.id });
    // Close tab if open
    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== session.id);
      setActiveTabId((prevActive) => {
        if (prevActive !== session.id) return prevActive;
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
      return remaining;
    });
    // Refetch sessions
    reexecuteQuery({ requestPolicy: "network-only" });
  }, [executeDelete, reexecuteQuery]);

  const handleSpawned = useCallback(async (sessionId: string) => {
    setShowSpawnModal(false);
    // Fetch fresh session list to get real encryptedSessionKey before opening tab
    const result = await urqlClient
      .query(SESSIONS_QUERY, { limit: pageSize, offset: 0 }, { requestPolicy: "network-only" })
      .toPromise();
    reexecuteQuery({ requestPolicy: "network-only" });

    const sessions: TerminalSessionMeta[] = result.data?.sessions ?? [];
    const newSession = sessions.find((s) => s.id === sessionId);
    if (newSession) {
      openSession(newSession);
    }
  }, [openSession, pageSize, reexecuteQuery]);

  const { notifySessionEnded, notifyTerminal } = useSessionNotifications();

  const handleSessionEnded = useCallback((sessionId: string) => {
    const tab = openTabs.find((t) => t.id === sessionId);
    notifySessionEnded(tab?.name ?? "Terminal");
  }, [openTabs, notifySessionEnded]);

  const handleNotification = useCallback((sessionId: string, title: string, body: string) => {
    const tab = openTabs.find((t) => t.id === sessionId);
    notifyTerminal(tab?.name ?? "Terminal", title, body);
  }, [openTabs, notifyTerminal]);

  const handleCliPresenceChange = useCallback((sessionId: string, connected: boolean) => {
    setOpenTabs((prev) =>
      prev.map((t) =>
        t.id === sessionId
          ? { ...t, status: connected ? "running" : "disconnected" }
          : t
      )
    );
  }, []);

  const hasOpenTabs = openTabs.length > 0;

  return (
    <div className="flex h-full flex-col">
      {hasOpenTabs && (
        <SessionTabs
          tabs={openTabs}
          activeId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
        />
      )}

      {activeTabId === null ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-8">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight">Sessions</h2>
                <p className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
                  <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                  End-to-end encrypted
                </p>
              </div>
              <button
                onClick={() => setShowSpawnModal(true)}
                disabled={daemonMachines.length === 0}
                className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 shadow-lg shadow-white/5 transition-all hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                title={daemonMachines.length > 0 ? "Spawn a new terminal" : "Start daemon first: anyterm daemon"}
              >
                {daemonMachines.length > 0 ? (
                  <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
                ) : (
                  <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                )}
                New Terminal
              </button>
            </div>

            {fetching && !data ? (
              <div className="grid gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
                    <div className="h-2.5 w-2.5 rounded-full bg-zinc-800 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-32 rounded bg-zinc-800 animate-pulse" />
                      <div className="h-3 w-48 rounded bg-zinc-800/60 animate-pulse" />
                    </div>
                    <div className="h-3 w-12 rounded bg-zinc-800/60 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                Failed to load sessions. Please try refreshing.
              </div>
            ) : (
              <SessionList
                sessions={data?.sessions ?? []}
                onOpen={openSession}
                onDelete={deleteSession}
                hasMore={hasMore}
                onLoadMore={loadMore}
              />
            )}
          </div>
        </div>
      ) : (
        <SessionWorkspace tabs={openTabs} activeId={activeTabId} onSessionEnded={handleSessionEnded} onNotification={handleNotification} onCliPresenceChange={handleCliPresenceChange} />
      )}

      {showSpawnModal && (
        <SpawnTerminalModal
          machines={daemonMachines}
          onClose={() => setShowSpawnModal(false)}
          onSpawned={handleSpawned}
        />
      )}
    </div>
  );
}
