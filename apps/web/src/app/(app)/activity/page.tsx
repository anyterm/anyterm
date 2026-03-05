"use client";

import { useQuery, gql } from "urql";
import { useSubscription } from "@/lib/subscription-context";
import Link from "next/link";

const ACTIVITY_LOGS_QUERY = gql`
  query ($limit: Int) {
    activityLogs(limit: $limit) {
      id
      action
      target
      detail
      userName
      createdAt
    }
  }
`;

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  "session.create": { label: "Create Session", color: "text-green-400" },
  "session.delete": { label: "Delete Session", color: "text-red-400" },
  "session.update": { label: "Update Session", color: "text-zinc-400" },
  "org.keys.setup": { label: "Setup Encryption", color: "text-blue-400" },
  "org.keys.grant": { label: "Grant Key", color: "text-blue-400" },
  "sso.provider.create": { label: "Configure SSO", color: "text-purple-400" },
  "sso.provider.delete": { label: "Remove SSO", color: "text-red-400" },
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function groupByDate(logs: Array<{ createdAt: string }>): Map<string, typeof logs> {
  const groups = new Map<string, typeof logs>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();

  for (const log of logs) {
    const dateStr = new Date(log.createdAt).toDateString();
    let label: string;
    if (dateStr === today) label = "Today";
    else if (dateStr === yesterday) label = "Yesterday";
    else label = new Date(log.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const group = groups.get(label) ?? [];
    group.push(log);
    groups.set(label, group);
  }

  return groups;
}

export default function ActivityPage() {
  const { planName, loading: planLoading } = useSubscription();
  const isTeam = planName === "team";

  const [{ data, fetching }] = useQuery({
    query: ACTIVITY_LOGS_QUERY,
    variables: { limit: 50 },
    pause: !isTeam,
  });

  if (planLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!isTeam) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight">Activity Log</h2>
        <p className="mt-3 text-sm text-zinc-500">
          Audit logs are available on the Team plan. Track who did what, when.
        </p>
        <Link
          href="/settings"
          className="mt-6 inline-block rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
        >
          Upgrade to Team
        </Link>
      </div>
    );
  }

  const logs = data?.activityLogs ?? [];
  const grouped = groupByDate(logs);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="mb-8 font-display text-2xl font-bold tracking-tight">Activity</h2>

      {fetching ? (
        <div className="text-sm text-zinc-500">Loading activity...</div>
      ) : logs.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-8 text-center">
          <p className="text-sm text-zinc-500">No activity yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-600">
                {dateLabel}
              </h3>
              <div className="space-y-1">
                {items.map((log: any) => {
                  const config = ACTION_CONFIG[log.action] ?? {
                    label: log.action,
                    color: "text-zinc-400",
                  };
                  return (
                    <div
                      key={log.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-zinc-900/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-zinc-300">
                            {log.userName ?? "System"}
                          </span>
                          <span className={`rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium ${config.color}`}>
                            {config.label}
                          </span>
                        </div>
                        {(log.target || log.detail) && (
                          <p className="mt-0.5 truncate text-xs text-zinc-600">
                            {log.target}
                            {log.target && log.detail && " — "}
                            {log.detail}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-zinc-700">
                        {formatRelativeTime(log.createdAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
