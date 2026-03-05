import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runMigrations(url: string) {
  console.log("[db] Running migrations...");
  const start = Date.now();
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  const migrationsFolder = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../drizzle",
  );
  await migrate(db, { migrationsFolder });
  await sql.end();
  console.log(`[db] Migrations complete (${Date.now() - start}ms)`);
}
