import { builder } from "../builder";
import { TerminalChunk } from "../types/terminal-chunk";
import { db } from "@/db";
import { terminalChunks, terminalSessions } from "@anyterm/db";
import { eq, and, gt, asc } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { requireOrg } from "../helpers";

// --- Input type ---

const ChunkInput = builder.inputType("ChunkInput", {
  fields: (t) => ({
    seq: t.int({ required: true }),
    data: t.string({ required: true }),
  }),
});

// --- Query ---

builder.queryField("chunks", (t) =>
  t.field({
    type: [TerminalChunk],
    args: {
      sessionId: t.arg.string({ required: true }),
      after: t.arg.int({ defaultValue: 0 }),
      limit: t.arg.int({ defaultValue: 1000 }),
    },
    resolve: async (_root, args, ctx) => {
      const org = requireOrg(ctx);

      // Verify org ownership
      const [session] = await db
        .select({ id: terminalSessions.id })
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.id, args.sessionId),
            eq(terminalSessions.organizationId, org.id),
          ),
        );

      if (!session) {
        throw new GraphQLError("Session not found");
      }

      const after = Math.max(0, args.after ?? 0);
      const limit = Math.max(1, Math.min(args.limit ?? 1000, 1000));

      return db
        .select()
        .from(terminalChunks)
        .where(
          and(
            eq(terminalChunks.sessionId, args.sessionId),
            gt(terminalChunks.seq, after),
          ),
        )
        .orderBy(asc(terminalChunks.seq))
        .limit(limit);
    },
  }),
);

// --- Mutation ---

builder.mutationField("storeChunks", (t) =>
  t.field({
    type: "Boolean",
    args: {
      sessionId: t.arg.string({ required: true }),
      chunks: t.arg({ type: [ChunkInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const MAX_BATCH_SIZE = 100;
      const MAX_CHUNK_DATA_LENGTH = 1024 * 1024; // 1MB
      const org = requireOrg(ctx);

      // Verify org + user ownership
      const [session] = await db
        .select({ id: terminalSessions.id })
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.id, args.sessionId),
            eq(terminalSessions.organizationId, org.id),
            eq(terminalSessions.userId, ctx.user.id),
          ),
        );

      if (!session) {
        throw new GraphQLError("Session not found");
      }

      if (args.chunks.length > MAX_BATCH_SIZE) {
        throw new GraphQLError(`Batch size exceeds maximum of ${MAX_BATCH_SIZE}`);
      }

      for (const c of args.chunks) {
        if (c.seq < 0) {
          throw new GraphQLError("Invalid chunk seq");
        }
        if (c.data.length > MAX_CHUNK_DATA_LENGTH) {
          throw new GraphQLError("Oversized chunk data");
        }
      }

      const values = args.chunks.map((c) => ({
        sessionId: args.sessionId,
        seq: c.seq,
        data: c.data,
      }));

      await db.insert(terminalChunks).values(values).onConflictDoNothing();
      return true;
    },
  }),
);
