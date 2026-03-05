import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(url: string) {
  const queryClient = postgres(url);
  return drizzle(queryClient, { schema, casing: "snake_case" });
}

export type Database = ReturnType<typeof createDb>;
