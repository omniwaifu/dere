import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getDb } from "../db.js";

export async function createContext(_opts: FetchCreateContextFnOptions) {
  const db = await getDb();
  return { db };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
