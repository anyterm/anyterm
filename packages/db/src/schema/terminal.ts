import { pgTable, text, integer, serial, index, uniqueIndex } from "drizzle-orm/pg-core";
import { idPrimary, id, createdAt, timestamp, textEnum } from "./columns";
import { users, organizations } from "./auth";

export const TerminalStatus = {
  Running: "running",
  Disconnected: "disconnected",
  Stopped: "stopped",
  Error: "error",
} as const;

export const terminalSessions = pgTable(
  "terminal_sessions",
  {
    id: idPrimary(),
    userId: id()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: id()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    command: text().notNull(),
    status: textEnum(TerminalStatus).notNull().default(TerminalStatus.Running),
    encryptedSessionKey: text().notNull(),
    cols: integer().notNull().default(80),
    rows: integer().notNull().default(24),
    agentType: text(), // auto-detected AI agent: "claude-code", "cursor", etc.
    machineId: text(), // UUID of the daemon machine that spawned this session
    machineName: text(), // display name of the machine
    forwardedPorts: text(), // comma-separated: "3000,8080"
    snapshotSeq: integer(), // seq number this snapshot covers up to
    snapshotData: text(), // base64(encrypted serialized terminal state)
    createdAt: createdAt(),
    endedAt: timestamp(),
  },
  (table) => [
    index().on(table.userId),
    index().on(table.organizationId),
    index().on(table.status),
    index("terminal_sessions_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const terminalChunks = pgTable(
  "terminal_chunks",
  {
    id: serial().primaryKey(),
    sessionId: id()
      .notNull()
      .references(() => terminalSessions.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    data: text().notNull(), // base64(nonce + ciphertext)
    timestamp: timestamp().defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex().on(table.sessionId, table.seq),
    index("terminal_chunks_session_id_idx").on(table.sessionId),
  ],
);
