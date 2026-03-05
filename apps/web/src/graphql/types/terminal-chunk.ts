import { builder } from "../builder";

export const TerminalChunk = builder.objectRef<{
  id: number;
  sessionId: string;
  seq: number;
  data: string;
  timestamp: Date;
}>("TerminalChunk");

builder.objectType(TerminalChunk, {
  fields: (t) => ({
    id: t.exposeInt("id"),
    sessionId: t.exposeString("sessionId"),
    seq: t.exposeInt("seq"),
    data: t.exposeString("data"),
    timestamp: t.string({ resolve: (parent) => parent.timestamp.toISOString() }),
  }),
});
