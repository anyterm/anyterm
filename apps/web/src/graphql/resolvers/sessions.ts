import { builder } from "../builder";
import { TerminalSession } from "../types/terminal-session";
import { db } from "@/db";
import { terminalSessions, terminalChunks, members } from "@anyterm/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { GraphQLError } from "graphql";
import { getRedisPublisher } from "@/lib/redis";
import { createSessionEndedFrame } from "@anyterm/utils/protocol";
import { REDIS_CHANNEL_EVENT } from "@anyterm/utils/types";
import { getOrgPlan } from "@/lib/plan";
import { PLAN_LIMITS, getOrgSessionCap } from "@/lib/plan-limits";
import { logActivity } from "@/lib/log-activity";
import { requireOrg } from "../helpers";

// --- Queries ---

builder.queryField("sessions", (t) =>
  t.field({
    type: [TerminalSession],
    args: {
      limit: t.arg.int({ defaultValue: 50 }),
      offset: t.arg.int({ defaultValue: 0 }),
    },
    resolve: async (_root, args, ctx) => {
      const org = requireOrg(ctx);
      const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
      const offset = Math.max(0, args.offset ?? 0);
      return db
        .select()
        .from(terminalSessions)
        .where(eq(terminalSessions.organizationId, org.id))
        .orderBy(desc(terminalSessions.createdAt))
        .limit(limit)
        .offset(offset);
    },
  }),
);

builder.queryField("session", (t) =>
  t.field({
    type: TerminalSession,
    nullable: true,
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const org = requireOrg(ctx);
      const [session] = await db
        .select()
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.id, args.id),
            eq(terminalSessions.organizationId, org.id),
          ),
        );
      return session ?? null;
    },
  }),
);

// --- Input types ---

const CreateSessionInput = builder.inputType("CreateSessionInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    command: t.string({ required: true }),
    encryptedSessionKey: t.string({ required: true }),
    cols: t.int(),
    rows: t.int(),
    agentType: t.string(),
    machineId: t.string(),
    machineName: t.string(),
    forwardedPorts: t.string(),
  }),
});

const UpdateSessionInput = builder.inputType("UpdateSessionInput", {
  fields: (t) => ({
    id: t.string({ required: true }),
    status: t.string(),
    cols: t.int(),
    rows: t.int(),
    endedAt: t.string(),
  }),
});

// --- Mutations ---

builder.mutationField("createSession", (t) =>
  t.field({
    type: TerminalSession,
    args: { input: t.arg({ type: CreateSessionInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const org = requireOrg(ctx);

      // Validate inputs before entering transaction
      const name = input.name.slice(0, 255);
      const command = input.command.slice(0, 4096);
      const encryptedSessionKey = input.encryptedSessionKey;

      if (!name || !command || !encryptedSessionKey) {
        throw new GraphQLError(
          "Missing required fields: name, command, encryptedSessionKey",
        );
      }

      if (encryptedSessionKey.length > 4096) {
        throw new GraphQLError("encryptedSessionKey too large");
      }

      const cols = Math.max(1, Math.min(input.cols ?? 80, 500));
      const rows = Math.max(1, Math.min(input.rows ?? 24, 200));

      // Validate forwardedPorts: only digits and commas, each port 1-65535, max 20 ports
      let forwardedPorts: string | null = null;
      if (input.forwardedPorts) {
        const ports = input.forwardedPorts.split(",").map((p) => p.trim()).filter(Boolean);
        if (ports.length > 20) throw new GraphQLError("Too many forwardedPorts (max 20)");
        const valid = ports.every((p) => {
          const n = Number(p);
          return Number.isInteger(n) && n >= 1 && n <= 65535;
        });
        if (!valid) throw new GraphQLError("Invalid forwardedPorts");
        forwardedPorts = ports.join(",");
      }

      const agentType = input.agentType?.slice(0, 64) || null;
      const machineId = input.machineId?.slice(0, 255) || null;
      const machineName = input.machineName?.slice(0, 255) || null;

      // Enforce concurrent session limits inside a serialized transaction
      const tier = await getOrgPlan(org.id);
      const limits = PLAN_LIMITS[tier];

      const session = await db.transaction(async (tx) => {
        // Advisory lock keyed on user ID to serialize per-user session creation
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.user.id}))`);

        const [orgCount, userCount, seatCount] = await Promise.all([
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(terminalSessions)
            .where(
              and(
                eq(terminalSessions.organizationId, org.id),
                eq(terminalSessions.status, "running"),
              ),
            )
            .then((r) => r[0]?.count ?? 0),
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(terminalSessions)
            .where(
              and(
                eq(terminalSessions.userId, ctx.user.id),
                eq(terminalSessions.status, "running"),
              ),
            )
            .then((r) => r[0]?.count ?? 0),
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(members)
            .where(eq(members.organizationId, org.id))
            .then((r) => r[0]?.count ?? 1),
        ]);

        const orgCap = getOrgSessionCap(tier, seatCount);

        if (userCount >= limits.maxSessionsPerUser) {
          throw new GraphQLError(
            `You have reached your concurrent session limit (${limits.maxSessionsPerUser}). Upgrade your plan for more sessions.`,
          );
        }
        if (orgCount >= orgCap) {
          throw new GraphQLError(
            `Your organization has reached its concurrent session limit (${orgCap}). Upgrade your plan for more sessions.`,
          );
        }

        const id = nanoid(12);
        const [s] = await tx
          .insert(terminalSessions)
          .values({ id, userId: ctx.user.id, organizationId: org.id, name, command, encryptedSessionKey, cols, rows, agentType, machineId, machineName, forwardedPorts })
          .returning();

        return s;
      });

      logActivity(ctx, "session.create", name, command);

      return session;
    },
  }),
);

builder.mutationField("updateSession", (t) =>
  t.field({
    type: TerminalSession,
    nullable: true,
    args: { input: t.arg({ type: UpdateSessionInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const VALID_STATUSES = new Set(["running", "disconnected", "stopped", "error"]);

      const updates: Record<string, unknown> = {};
      if (input.status) {
        if (!VALID_STATUSES.has(input.status)) {
          throw new GraphQLError("Invalid status");
        }
        updates.status = input.status;
      }
      if (input.cols) updates.cols = Math.max(1, Math.min(input.cols, 500));
      if (input.rows) updates.rows = Math.max(1, Math.min(input.rows, 200));
      if (input.endedAt) {
        const d = new Date(input.endedAt);
        if (isNaN(d.getTime())) {
          throw new GraphQLError("Invalid endedAt date");
        }
        updates.endedAt = d;
      }

      const org = requireOrg(ctx);
      const [session] = await db
        .update(terminalSessions)
        .set(updates)
        .where(
          and(
            eq(terminalSessions.id, input.id),
            eq(terminalSessions.organizationId, org.id),
            eq(terminalSessions.userId, ctx.user.id),
          ),
        )
        .returning();

      if (session && input.status) {
        logActivity(ctx, "session.update", input.id, input.status);
      }

      return session ?? null;
    },
  }),
);

builder.mutationField("deleteSession", (t) =>
  t.field({
    type: "Boolean",
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, { id }, ctx) => {
      const org = requireOrg(ctx);

      // Verify ownership (org-scoped + user or admin/owner)
      const [session] = await db
        .select({ id: terminalSessions.id, userId: terminalSessions.userId })
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.id, id),
            eq(terminalSessions.organizationId, org.id),
          ),
        );

      if (!session) {
        throw new GraphQLError("Session not found");
      }

      if (session.userId !== ctx.user.id && org.role === "member") {
        throw new GraphQLError("Only the session owner or admins can delete sessions");
      }

      // Notify connected clients (CLI + browsers) before deleting
      try {
        const redis = getRedisPublisher();
        const frame = createSessionEndedFrame(id);
        await redis.publish(REDIS_CHANNEL_EVENT(id), Buffer.from(frame));
      } catch {
        // Best effort — client notification is non-critical
      }

      // Delete chunks and session atomically
      await db.transaction(async (tx) => {
        await tx
          .delete(terminalChunks)
          .where(eq(terminalChunks.sessionId, id));

        await tx
          .delete(terminalSessions)
          .where(
            and(
              eq(terminalSessions.id, id),
              eq(terminalSessions.organizationId, org.id),
            ),
          );
      });

      logActivity(ctx, "session.delete", id);

      return true;
    },
  }),
);

