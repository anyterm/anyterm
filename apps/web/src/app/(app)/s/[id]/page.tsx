"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { gql, useQuery } from "urql";
import TerminalView from "@/components/terminal/terminal-view";
import { useSessionNotifications } from "@/hooks/use-session-notifications";
import type { TerminalSessionMeta } from "@anyterm/utils/types";

const SESSION_QUERY = gql`
  query ($id: String!) {
    session(id: $id) {
      id userId name command status encryptedSessionKey
      cols rows forwardedPorts snapshotSeq snapshotData createdAt endedAt
    }
  }
`;

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [result] = useQuery<{ session: TerminalSessionMeta | null }>({
    query: SESSION_QUERY,
    variables: { id },
  });

  const { data, fetching, error } = result;
  const { notifySessionEnded, notifyTerminal } = useSessionNotifications();

  const handleSessionEnded = useCallback((sessionId: string) => {
    const name = data?.session?.name ?? "Terminal";
    notifySessionEnded(name);
  }, [data?.session?.name, notifySessionEnded]);

  const handleNotification = useCallback((sessionId: string, title: string, body: string) => {
    const name = data?.session?.name ?? "Terminal";
    notifyTerminal(name, title, body);
  }, [data?.session?.name, notifyTerminal]);

  if (error) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-red-400">Failed to load session</div>
      </div>
    );
  }

  if (fetching || !data) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-zinc-500">Loading session...</div>
      </div>
    );
  }

  if (!data.session) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-red-400">Session not found</div>
      </div>
    );
  }

  return (
    <TerminalView
      session={data.session}
      onSessionEnded={handleSessionEnded}
      onNotification={handleNotification}
    />
  );
}
