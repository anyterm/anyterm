import { Command } from "commander";
import { getConfig } from "../config.js";
import { gql } from "../graphql.js";

export type SessionRow = { id: string; name: string; status: string; command: string };

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const STATUS_COL_WIDTH = 18;

/** Format session status with ANSI color indicator. */
export function formatStatus(status: string): string {
  return status === "running"
    ? "\x1b[32m●\x1b[0m running"
    : status === "disconnected"
      ? "\x1b[33m●\x1b[0m disconnected"
      : "○ stopped";
}

/** Format a session as a fixed-width table row. */
export function formatRow(s: SessionRow): string {
  const status = formatStatus(s.status);
  const visibleLen = status.replace(ANSI_RE, "").length;
  const paddedStatus = status + " ".repeat(Math.max(0, STATUS_COL_WIDTH - visibleLen));
  return (
    s.id.padEnd(15) +
    s.name.slice(0, 22).padEnd(25) +
    paddedStatus +
    s.command.slice(0, 30)
  );
}

export const listCommand = new Command("list")
  .alias("ls")
  .description("List terminal sessions")
  .action(async () => {
    const { serverUrl, authToken } = await getConfig();

    let sessions: Array<{ id: string; name: string; status: string; command: string }>;
    try {
      const data = await gql<{
        sessions: Array<{ id: string; name: string; status: string; command: string }>;
      }>(serverUrl, authToken, `
        query { sessions { id name status command } }
      `);
      sessions = data.sessions;
    } catch {
      console.error("Failed to fetch sessions");
      process.exit(1);
    }

    if (sessions.length === 0) {
      console.log("No sessions.");
      return;
    }

    console.log(
      "\n" +
        "ID".padEnd(15) +
        "NAME".padEnd(25) +
        "STATUS".padEnd(STATUS_COL_WIDTH) +
        "COMMAND",
    );
    console.log("-".repeat(70));

    for (const s of sessions) {
      console.log(formatRow(s));
    }
    console.log();
  });
