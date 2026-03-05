import { text, timestamp as pgTimestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export function id() {
  return text();
}

export function idPrimary() {
  return text()
    .primaryKey()
    .$defaultFn(() => nanoid(12));
}

export function createdAt() {
  return pgTimestamp({ withTimezone: true }).notNull().defaultNow();
}

export function updatedAt() {
  return pgTimestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
}

export function timestamp() {
  return pgTimestamp({ withTimezone: true });
}

export function textEnum<T extends string>(enumObj: Record<string, T>) {
  const values = Object.values(enumObj) as [T, ...T[]];
  return text({ enum: values });
}
