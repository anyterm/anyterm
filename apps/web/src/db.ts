import { createDb } from "@anyterm/db";

export const db = createDb(process.env.DATABASE_URL!);
