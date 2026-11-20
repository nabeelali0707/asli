/** Wipe local PGlite data (or every table on DATABASE_URL after confirmation flag) and reseed. */
import "./load-env";
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { getDb, resetDb } from "../src/server/db/client";
import { seedDemo } from "../src/server/demo/seed";

if (process.env.DATABASE_URL) {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to wipe DATABASE_URL without --yes");
    process.exit(1);
  }
  const db = await getDb();
  await db.execute(sql`drop schema public cascade; create schema public;`);
  await db.execute(sql`drop schema if exists drizzle cascade;`);
  await resetDb();
  console.log("Schema dropped. Run `npm run db:migrate` then `npm run db:seed`.");
  process.exit(0);
}
const dir = process.env.ASLI_DB_DIR ?? ".data/pglite";
fs.rmSync(dir, { recursive: true, force: true });
const db = await getDb();
await seedDemo(db, { log: (s) => console.log("•", s) });
await resetDb();
console.log("Local database reset and reseeded ✓");
