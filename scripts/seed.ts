import "./load-env";
import { getDb, resetDb } from "../src/server/db/client";
import { seedDemo, DEMO_PASSWORD, DEMO_PIN } from "../src/server/demo/seed";

const db = await getDb();
const r = await seedDemo(db, { log: (s) => console.log("•", s) });
if (!r.skipped) {
  console.log(`\nDemo accounts (password: ${DEMO_PASSWORD}; family PIN: ${DEMO_PIN}):`);
  for (const e of ["admin@asli.demo", "officer@asli.demo", "officer2@asli.demo", "helper@asli.demo", "auditor@asli.demo", "fatima@asli.demo", "shopkeeper@asli.demo", "officer@sindh.demo"]) console.log("  ", e);
}
await resetDb();
