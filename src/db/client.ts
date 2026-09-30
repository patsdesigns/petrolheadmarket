import { drizzle } from "drizzle-orm/d1";
import { env } from "cloudflare:workers";
import * as schema from "./schema";

export function getDb() {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

/**
 * D1 refuses a statement with more than 100 bound parameters, and every value
 * in an inArray() list is one. Split any list that is not strictly bounded
 * into groups of 90 and run one query per group.
 */
export const MAX_IN_LIST = 90;

export function chunks<T>(items: T[], size = MAX_IN_LIST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
