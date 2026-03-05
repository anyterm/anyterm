"use client";

import { useState } from "react";
import type { TerminalSessionMeta } from "@anyterm/utils/types";

interface SessionCardProps {
  session: TerminalSessionMeta;
  onOpen?: () => void;
  onDelete?: () => void;
}

const AGENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  copilot: "Copilot",
  aider: "Aider",
  devin: "Devin",
  cline: "Cline",
  continue: "Continue",
};

export function SessionCard({ session, onOpen, onDelete }: SessionCardProps) {
  const isLive = session.status === "running";
  const isDisconnected = session.status === "disconnected";
  const [confirming, setConfirming] = useState(false);
  const agentLabel = session.agentType ? AGENT_LABELS[session.agentType] ?? session.agentType : null;

  const timeAgo = (dateStr: string) => {
    const seconds = Math.floor(
      (Date.now() - new Date(dateStr).getTime()) / 1000,
    );
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div
      onClick={onOpen}
      className={`card-hover flex items-center gap-4 rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 ${onOpen ? "cursor-pointer" : ""}`}
    >
      <div
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          isLive
            ? "animate-pulse-dot bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"
            : isDisconnected
              ? "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.3)]"
              : "bg-zinc-600"
        }`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-semibold tracking-tight">{session.name}</span>
          {isLive && (
            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-400">
              LIVE
            </span>
          )}
          {isDisconnected && (
            <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-bold text-yellow-400">
              DISCONNECTED
            </span>
          )}
          {agentLabel && (
            <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              {agentLabel}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 truncate font-code text-xs text-zinc-500">
          <span>{session.command}</span>
          {session.machineName && (
            <span className="rounded-md bg-zinc-800/60 px-1.5 py-0.5 font-sans text-[10px] text-zinc-400">
              {session.machineName}
            </span>
          )}
          {session.forwardedPorts && (
            <span className="flex items-center gap-1 rounded-md bg-teal-500/10 px-1.5 py-0.5 font-sans text-[10px] text-teal-400">
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
              {session.forwardedPorts.split(",").map((p) => `:${p.trim()}`).join(" ")}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 text-xs text-zinc-600">
        {timeAgo(session.createdAt)}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {onOpen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="rounded-lg border border-zinc-700/60 bg-zinc-800/40 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
          >
            Open
          </button>
        )}
        {onDelete && !confirming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            className="rounded-lg border border-transparent px-3 py-1.5 text-xs text-zinc-600 transition hover:border-red-500/30 hover:text-red-400"
          >
            Delete
          </button>
        )}
        {onDelete && confirming && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
                onDelete();
              }}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20"
            >
              Confirm
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 transition hover:text-white"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
