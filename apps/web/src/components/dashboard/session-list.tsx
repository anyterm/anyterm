"use client";

import { useState } from "react";
import { SessionCard } from "./session-card";
import type { TerminalSessionMeta } from "@anyterm/utils/types";

type Filter = "all" | "agents";

interface SessionListProps {
  sessions: TerminalSessionMeta[];
  onOpen?: (session: TerminalSessionMeta) => void;
  onDelete?: (session: TerminalSessionMeta) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function SessionList({ sessions, onOpen, onDelete, hasMore, onLoadMore }: SessionListProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const agentCount = sessions.filter((s) => s.agentType).length;

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/60">
          <svg className="h-6 w-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <p className="font-display text-base font-semibold text-zinc-300">No sessions yet</p>
        <p className="mt-2 text-sm text-zinc-500">
          Run{" "}
          <code className="rounded-md bg-zinc-800/60 px-2 py-0.5 font-code text-xs text-zinc-300">
            anyterm run &quot;your command&quot;
          </code>{" "}
          to start streaming
        </p>
      </div>
    );
  }

  const filtered = filter === "agents" ? sessions.filter((s) => s.agentType) : sessions;
  const liveCount = filtered.filter((s) => s.status === "running").length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-xs text-zinc-600">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-md px-2 py-1 transition ${filter === "all" ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            All ({sessions.length})
          </button>
          {agentCount > 0 && (
            <button
              onClick={() => setFilter("agents")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 transition ${filter === "agents" ? "bg-violet-500/20 text-violet-300" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              AI Agents ({agentCount})
            </button>
          )}
        </div>
        {liveCount > 0 && (
          <>
            <span className="text-zinc-800">&middot;</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              {liveCount} live
            </span>
          </>
        )}
      </div>
      <div className="grid gap-2">
        {filtered.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onOpen={onOpen ? () => onOpen(session) : undefined}
            onDelete={onDelete ? () => onDelete(session) : undefined}
          />
        ))}
      </div>
      {hasMore && onLoadMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={onLoadMore}
            className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-300"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
