"use client";

import dynamic from "next/dynamic";
import type { TerminalSessionMeta } from "@anyterm/utils/types";

const TerminalView = dynamic(
  () => import("@/components/terminal/terminal-view"),
  { ssr: false },
);

interface SessionWorkspaceProps {
  tabs: TerminalSessionMeta[];
  activeId: string;
  onSessionEnded?: (sessionId: string) => void;
  onNotification?: (sessionId: string, title: string, body: string) => void;
  onCliPresenceChange?: (sessionId: string, connected: boolean) => void;
}

export function SessionWorkspace({ tabs, activeId, onSessionEnded, onNotification, onCliPresenceChange }: SessionWorkspaceProps) {
  return (
    <div className="flex-1 overflow-hidden">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="h-full"
          style={{ display: tab.id === activeId ? "block" : "none" }}
        >
          <TerminalView session={tab} onSessionEnded={onSessionEnded} onNotification={onNotification} onCliPresenceChange={onCliPresenceChange} />
        </div>
      ))}
    </div>
  );
}
