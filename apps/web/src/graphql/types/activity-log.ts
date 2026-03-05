import { builder } from "../builder";

export const ActivityLog = builder.objectRef<{
  id: string;
  organizationId: string;
  userId: string | null;
  userName: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: Date;
}>("ActivityLog");

builder.objectType(ActivityLog, {
  fields: (t) => ({
    id: t.exposeString("id"),
    organizationId: t.exposeString("organizationId"),
    userId: t.exposeString("userId", { nullable: true }),
    userName: t.exposeString("userName", { nullable: true }),
    action: t.exposeString("action"),
    target: t.exposeString("target", { nullable: true }),
    detail: t.exposeString("detail", { nullable: true }),
    createdAt: t.string({ resolve: (parent) => parent.createdAt.toISOString() }),
  }),
});
