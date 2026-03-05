"use client";

import type { TerminalSessionMeta } from "@anyterm/utils/types";

interface SessionTabsProps {
  tabs: TerminalSessionMeta[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onClose: (id: string) => void;
}

export function SessionTabs({ tabs, activeId, onSelect, onClose }: SessionTabsProps) {
  return (
    <div className="border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-sm">
    <div className="mx-auto flex max-w-6xl items-center gap-0 overflow-x-auto px-6">
      <button
        onClick={() => onSelect(null)}
        className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
          activeId === null
            ? "border-zinc-300 text-white"
            : "border-transparent text-zinc-500 hover:text-zinc-300"
        }`}
      >
        Sessions
      </button>

      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isLive = tab.status === "running";
        const isDisconnected = tab.status === "disconnected";

        return (
          <div
            key={tab.id}
            className={`group flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${
              isActive
                ? "border-green-400 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <button onClick={() => onSelect(tab.id)} className="flex items-center gap-2">
              {isLive && (
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" />
              )}
              {isDisconnected && (
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.3)]" />
              )}
              {!isLive && !isDisconnected && (
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
              )}
              <span className="max-w-[140px] truncate">{tab.name}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
    </div>
  );
}
