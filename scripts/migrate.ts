/** Apply SQL migrations to DATABASE_URL (Supabase/Postgres). PGlite migrates itself on start. */
import "./load-env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL not set — PGlite applies migrations automatically on first use. Nothing to do.");
  process.exit(0);
}
const sql = postgres(url, { max: 1, prepare: false });
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
await sql.end();
console.log("Migrations applied ✓");
