import { builder } from "../builder";

export const SessionStatus = builder.enumType("SessionStatus", {
  values: ["running", "disconnected", "stopped", "error"] as const,
});

export const TerminalSession = builder.objectRef<{
  id: string;
  userId: string;
  organizationId: string | null;
  name: string;
  command: string;
  status: string;
  encryptedSessionKey: string;
  cols: number;
  rows: number;
  agentType: string | null;
  machineId: string | null;
  machineName: string | null;
  forwardedPorts: string | null;
  snapshotSeq: number | null;
  snapshotData: string | null;
  createdAt: Date;
  endedAt: Date | null;
}>("TerminalSession");

builder.objectType(TerminalSession, {
  fields: (t) => ({
    id: t.exposeString("id"),
    userId: t.exposeString("userId"),
    organizationId: t.exposeString("organizationId", { nullable: true }),
    name: t.exposeString("name"),
    command: t.exposeString("command"),
    status: t.field({
      type: SessionStatus,
      resolve: (parent) => parent.status as "running" | "disconnected" | "stopped" | "error",
    }),
    encryptedSessionKey: t.exposeString("encryptedSessionKey"),
    cols: t.exposeInt("cols"),
    rows: t.exposeInt("rows"),
    agentType: t.exposeString("agentType", { nullable: true }),
    machineId: t.exposeString("machineId", { nullable: true }),
    machineName: t.exposeString("machineName", { nullable: true }),
    forwardedPorts: t.exposeString("forwardedPorts", { nullable: true }),
    snapshotSeq: t.exposeInt("snapshotSeq", { nullable: true }),
    snapshotData: t.exposeString("snapshotData", { nullable: true }),
    createdAt: t.string({ resolve: (parent) => parent.createdAt.toISOString() }),
    endedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.endedAt?.toISOString() ?? null,
    }),
  }),
});
