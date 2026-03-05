import { pgTable, text, index } from "drizzle-orm/pg-core";
import { idPrimary, createdAt } from "./columns";
import { organizations } from "./auth";

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: idPrimary(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    userName: text("user_name"),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (table) => [
    index("activity_logs_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);
