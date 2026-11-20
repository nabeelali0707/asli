import "./load-env";
import { getDb, resetDb } from "../src/server/db/client";
import { runEvaluation } from "../src/server/services/eval";

const db = await getDb();
const tenantId = process.argv[2] ?? "tnt_rahat_punjab";
const r = await runEvaluation(db, { type: "system", id: "cli", tenantId, role: "system" }, tenantId);
const m = r.metrics as any;
console.log(`Evaluation ${r.id} on rules v${r.ruleVersion} — ${m.syntheticCases} synthetic cases (${m.fitCases} fit / ${m.heldOutCases} held out)`);
console.log("Recommended cutoffs:", r.thresholds);
console.log("Held-out, recommended:", { costPerCase: m.recommended.heldOut.expectedCostPerCasePKR, automation: m.recommended.heldOut.automationRate, wrongFastLane: m.recommended.heldOut.wrongFastLane, falseAlarmRate: m.recommended.heldOut.falseAlarmRate });
console.log("Held-out, current:    ", { costPerCase: m.current.heldOut.expectedCostPerCasePKR, automation: m.current.heldOut.automationRate, wrongFastLane: m.current.heldOut.wrongFastLane, falseAlarmRate: m.current.heldOut.falseAlarmRate });
console.log(m.honesty);
await resetDb();
