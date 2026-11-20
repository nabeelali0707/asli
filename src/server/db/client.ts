/**
 * Database client.
 * - DATABASE_URL set  → Postgres (Supabase) via postgres.js.
 * - otherwise          → embedded PGlite (real Postgres in WASM), on disk or in memory.
 * Migrations in ./drizzle are applied automatically for PGlite; for Postgres run `npm run db:migrate`.
 */
import path from "node:path";
import fs from "node:fs";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "../env";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

type Holder = { db?: DB; ready?: Promise<DB>; close?: () => Promise<void> };
const g = globalThis as unknown as { __asliDb?: Holder };
const holder: Holder = (g.__asliDb ??= {});

const migrationsFolder = path.join(process.cwd(), "drizzle");

async function create(): Promise<DB> {
  const e = env();
  if (e.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const sql = postgres(e.DATABASE_URL, { max: 5, prepare: false });
    holder.close = async () => {
      await sql.end();
    };
    return drizzle(sql, { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client;
  if (e.ASLI_DB === "memory") {
    client = new PGlite();
  } else {
    fs.mkdirSync(e.ASLI_DB_DIR, { recursive: true });
    client = new PGlite(e.ASLI_DB_DIR);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  holder.close = async () => {
    await client.close();
  };
  return db as unknown as DB;
}

export async function getDb(): Promise<DB> {
  if (holder.db) return holder.db;
  holder.ready ??= create().then((db) => {
    holder.db = db;
    return db;
  });
  return holder.ready;
}

/** Tests: drop the singleton so the next getDb() builds a fresh database. */
export async function resetDb(): Promise<void> {
  if (holder.close) await holder.close();
  holder.db = undefined;
  holder.ready = undefined;
  holder.close = undefined;
}

export { schema };
