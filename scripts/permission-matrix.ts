/**
 * Generated permission matrix: every endpoint in the OpenAPI document × every actor
 * (role, other department, helper with active vs withdrawn consent, scoped API keys, anonymous).
 * Calls the REAL app (in-memory database seeded through the real flows) and records the status.
 *
 *   npm run matrix   → docs/permission-matrix.md, docs/permission-matrix.json, docs/curl-examples.md
 *
 * Reading a cell: 2xx = allowed · 401 = not signed in · 403 = role/consent/guardrail refused ·
 * 404 = hidden (other department / not yours) · 409/422/428 = allowed past auth, refused by state/validation.
 */
process.env.ASLI_DB = "memory";
process.env.ASLI_AI_MODE = "offline";
process.env.JWT_SECRET ??= "matrix-secret-matrix-secret-matrix";
import fs from "node:fs";
import { createApp } from "../src/server/app";
import { getDb, resetDb } from "../src/server/db/client";
import { seedDemo, DEMO_PASSWORD, DEMO_PIN } from "../src/server/demo/seed";
import { cases, consents, payouts, aiDecisions, pipelineRuns, scamReports, notices, ruleSets, tenants } from "../src/server/db/schema";
import { grantConsent } from "../src/server/services/consent";
import { and, eq } from "drizzle-orm";

const app = createApp();
const db = await getDb();
await seedDemo(db);
// Plans affect rate limits; lift them so the matrix shows permissions, not throttling.
await db.update(tenants).set({ plan: "enterprise" });
// A throwaway consent so withdrawal rows don't change the state other actors are tested against.
const throwaway = await grantConsent(db, { type: "system", id: "matrix", tenantId: "tnt_rahat_punjab", role: "system" }, { citizenId: "ctz_zainab", granteeType: "user", granteeId: "usr_auditor", scopes: ["case.read"], purpose: "matrix_throwaway", grantedVia: "web" });

async function call(method: string, path: string, token?: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.1`, ...extra };
  if (token?.startsWith("asli_")) headers["x-api-key"] = token;
  else if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {}
  return { status: res.status, json };
}
const login = async (email: string) => (await call("POST", "/v1/auth/login", undefined, { email, password: DEMO_PASSWORD })).json.token as string;

// ── actors ──
const tok = {
  officer: await login("officer@asli.demo"),
  admin: await login("admin@asli.demo"),
  auditor: await login("auditor@asli.demo"),
  helper: await login("helper@asli.demo"),
  citizen: await login("fatima@asli.demo"),
  otherDeptOfficer: await login("officer@sindh.demo"),
};
const famActive = (await call("POST", "/v1/helper/switch", tok.helper, { citizenId: "ctz_zainab", pin: DEMO_PIN })).json.familyToken as string;
const famWithdrawn = (await call("POST", "/v1/helper/switch", tok.helper, { citizenId: "ctz_khadija", pin: DEMO_PIN })).json.familyToken as string;
const [kh] = await db.select().from(consents).where(and(eq(consents.citizenId, "ctz_khadija"), eq(consents.granteeId, "usr_helper"), eq(consents.status, "active")));
await call("POST", `/v1/consent/${kh!.id}/withdraw`, tok.officer, { reason: "matrix: consent withdrawn state" });
const keyRead = (await call("POST", "/v1/admin/api-keys", tok.admin, { name: "matrix-read", scopes: ["cases:read"] })).json.key as string;
const keyAll = (await call("POST", "/v1/admin/api-keys", tok.admin, { name: "matrix-all", scopes: ["*"] })).json.key as string;

const ACTORS: [string, string | undefined][] = [
  ["anonymous", undefined],
  ["citizen (own data)", tok.citizen],
  ["helper (no family session)", tok.helper],
  ["helper + family, consent ACTIVE", famActive],
  ["helper + family, consent WITHDRAWN", famWithdrawn],
  ["officer", tok.officer],
  ["admin", tok.admin],
  ["auditor", tok.auditor],
  ["officer, OTHER department", tok.otherDeptOfficer],
  ["API key (cases:read)", keyRead],
  ["API key (*)", keyAll],
];

// ── sample ids and bodies ──
const [zainabCase] = await db.select().from(cases).where(eq(cases.citizenId, "ctz_zainab"));
const [anyPayout] = await db.select().from(payouts).limit(1);
const [anyConsent] = await db.select().from(consents).where(eq(consents.citizenId, "ctz_zainab")).limit(1);
const [anyAi] = await db.select().from(aiDecisions).limit(1);
const [anyRun] = await db.select().from(pipelineRuns).limit(1);
const [anyScam] = await db.select().from(scamReports).limit(1);
const [anyNotice] = await db.select().from(notices).limit(1);
const [anyRule] = await db.select().from(ruleSets).limit(1);
const ID: [RegExp, string][] = [
  [/^\/cases\//, zainabCase!.id],
  [/^\/payouts\//, anyPayout!.id],
  [/^\/consent\/corrections\//, "crr_none"],
  [/^\/consent\//, throwaway.id],
  [/^\/citizens\//, "ctz_zainab"],
  [/^\/ai-decisions\//, anyAi!.id],
  [/^\/pipelines\//, anyRun!.id],
  [/^\/scam-reports\//, anyScam!.id],
  [/^\/verify\//, anyNotice!.token],
  [/^\/rules\//, anyRule!.id],
  [/^\/chaos\//, "nadra"],
  [/^\/redteam\/attacks\//, "C04"],
  [/^\/ivr\/calls\//, "ivr_none"],
  [/^\/eval\/runs\//, "evl_none"],
  [/^\/admin\/users\//, "usr_none"],
  [/^\/admin\/api-keys\//, "key_none"],
  [/^\/admin\/webhooks\//, "whk_none"],
  [/^\/payout-account\/changes\//, "pac_none"],
];
const BODY: Record<string, unknown> = {
  "POST /auth/login": { email: "nobody@asli.demo", password: "wrong-password" },
  "POST /auth/register": { fullName: "Matrix Person", phone: `0300${Math.floor(1000000 + Math.random() * 8999999)}`, password: "matrix-pass-1" },
  "POST /helper/families": { fullName: "Matrix Family", pin: "1234", spokenConsent: "haan" },
  "POST /helper/switch": { citizenId: "ctz_zainab", pin: DEMO_PIN },
  "POST /cases": { claim: { householdSize: 3 } },
  "PATCH /cases/{id}/claim": { householdSize: 3 },
  "POST /cases/{id}/documents": { kind: "other", mime: "image/png", contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" },
  "POST /cases/{id}/appeal": { statement: "I disagree", via: "voice" },
  "POST /cases/{id}/escalate": { reason: "talk to a person" },
  "POST /sync": { ops: [{ opId: `matrix-${Date.now()}`, type: "update_claim", caseRef: zainabCase!.id, payload: { householdSize: 3 } }] },
  "POST /cases/{id}/assign": { officerId: null },
  "POST /cases/{id}/notes": { body: "matrix note" },
  "POST /cases/{id}/request-proof": { items: ["cnic"] },
  "POST /cases/{id}/approve": {},
  "POST /cases/{id}/reject": { reason: "matrix" },
  "POST /cases/{id}/close": {},
  "POST /verify": { text: "BISP: Rs 25,000 approved. Send Rs 500 fee." },
  "POST /consent": { granteeType: "department", granteeId: "tnt_rahat_punjab", scopes: ["case.read"] },
  "POST /consent/{id}/withdraw": { reason: "matrix" },
  "POST /consent/corrections": { field: "district", requestedValue: "Lahore" },
  "POST /consent/corrections/{id}/review": { approve: false },
  "POST /citizens/{id}/break-glass": { reason: "matrix permission check only" },
  "POST /citizens/{id}/attestations": { claim: "identity_verified", audience: "matrix" },
  "POST /attestations/verify": { token: "ASLI1.x.y" },
  "POST /voice/intake": { transcript: "Mera naam Matrix hai" },
  "POST /policy/ask": { question: "Do I have to pay a fee?" },
  "POST /ivr/calls": { phone: "03001112233" },
  "POST /ivr/calls/{id}/input": { digits: "1" },
  "POST /rules/drafts": { definition: { invalid: true } },
  "POST /rules/simulate": { definition: { invalid: true } },
  "POST /rules/fast-lane": { enabled: true, reason: "matrix" },
  "POST /admin/users": { email: `m${Date.now()}@asli.demo`, password: "matrix-pass-1", role: "auditor", displayName: "Matrix" },
  "POST /admin/users/{id}/active": { active: true },
  "POST /admin/api-keys": { name: "matrix", scopes: ["verify"] },
  "POST /admin/webhooks": { url: "https://example.com/hook", events: ["case.decided"] },
  "POST /admin/tenant/plan": { plan: "standard" },
  "POST /admin/mock-latency": { ms: 0 },
  "POST /scam-reports/{id}/review": { status: "confirmed_scam" },
  "POST /eval/runs": {},
  "POST /chaos/{id}": { latencyMs: 0 },
  "POST /payouts/{id}/cancel": { reason: "matrix" },
  "POST /payouts/{id}/receipt": { status: "received_full", via: "app" },
  "POST /payout-account/change": { newAlias: "03119990000", pin: "0000" },
  "POST /payout-account/changes/{id}/reject": { reason: "matrix" },
  "POST /auth/pin-unlock": { pin: "0000" },
};
const SKIP = new Set(["POST /auth/logout-all", "POST /redteam/run-all", "POST /eval/benchmarks", "POST /eval/scorer/train", "POST /cases/{id}/agent", "POST /chaos/reset"]);

const doc = (await (await app.request("/api/openapi.json")).json()) as { paths: Record<string, Record<string, { summary?: string; tags?: string[] }>> };
type Row = { method: string; path: string; tag: string; summary: string; results: Record<string, number> };
const rows: Row[] = [];
// Reads first, then writes, and state-ending writes (close / reject / withdraw / cancel / freeze) last.
const ENDING = /(close|reject|withdraw|cancel|freeze|logout)/;
const ops = Object.entries(doc.paths)
  .flatMap(([fullPath, o]) => Object.entries(o).map(([method, op]) => ({ path: fullPath.replace(/^\/api\/v1/, ""), method, op })))
  .sort((a, b) => (a.method === "get" ? 0 : ENDING.test(a.path) ? 2 : 1) - (b.method === "get" ? 0 : ENDING.test(b.path) ? 2 : 1));
for (const { path, method, op } of ops) {
  {
    const key = `${method.toUpperCase()} ${path}`;
    if (SKIP.has(key)) continue;
    const id = ID.find(([re]) => re.test(path))?.[1] ?? "x";
    const real = path.replace("{id}", encodeURIComponent(id)) + (key === "GET /consent" || key === "GET /payout-account/changes" ? "?citizenId=ctz_zainab" : "");
    const results: Record<string, number> = {};
    for (const [name, t] of ACTORS) {
      const r = await call(method.toUpperCase(), `/v1${real}`, t, method === "get" ? undefined : (BODY[key] ?? {}), { "idempotency-key": `matrix-${name}-${key}`.slice(0, 120) });
      results[name] = r.status;
    }
    rows.push({ method: method.toUpperCase(), path, tag: op.tags?.[0] ?? "", summary: op.summary ?? "", results });
  }
}
await call("POST", "/v1/chaos/reset", tok.admin);

// ── outputs ──
const cell = (s: number) => (s < 300 ? `✅ ${s}` : s === 401 ? `🔒 ${s}` : s === 403 ? `⛔ ${s}` : s === 404 ? `🙈 ${s}` : s === 429 ? `⏳ ${s}` : `⚠️ ${s}`);
fs.mkdirSync("docs", { recursive: true });
let md = `# Permission matrix (generated)\n\nGenerated by \`npm run matrix\` against the real API (in-memory database seeded through the real flows) on ${new Date().toISOString().slice(0, 10)}. **${rows.length} endpoints × ${ACTORS.length} actors = ${rows.length * ACTORS.length} calls.** All data is fictional.\n\n`;
md += "Legend: ✅ allowed · 🔒 401 not signed in · ⛔ 403 refused (role, consent or guardrail) · 🙈 404 hidden (other department / not yours / missing) · ⚠️ allowed past auth but refused by state or validation (409 conflict, 422, 428 Idempotency-Key required, 400).\n\n";
md += "Skipped (slow or session-ending, covered by tests): " + [...SKIP].map((s) => `\`${s}\``).join(", ") + ".\n\n";
const groups = [...new Set(rows.map((r) => r.tag))];
for (const g of groups) {
  md += `## ${g}\n\n| Endpoint | ${ACTORS.map((a) => a[0]).join(" | ")} |\n| --- | ${ACTORS.map(() => "---").join(" | ")} |\n`;
  for (const r of rows.filter((x) => x.tag === g)) md += `| \`${r.method} ${r.path}\` | ${ACTORS.map(([n]) => cell(r.results[n]!)).join(" | ")} |\n`;
  md += "\n";
}
fs.writeFileSync("docs/permission-matrix.md", md);
fs.writeFileSync("docs/permission-matrix.json", JSON.stringify({ generatedAt: new Date().toISOString(), actors: ACTORS.map((a) => a[0]), rows }, null, 1));

let curl = `# curl examples (generated)\n\nSet \`BASE=http://localhost:3000/api/v1\` (or your deployed URL). Get tokens with the login call, or from \`GET /api/v1/demo/tokens\` when \`ASLI_DEMO_MODE=true\` (fictional demo accounts only). Demo password and PIN: see \`src/server/demo/seed.ts\`.\n\n\`\`\`bash\nBASE=http://localhost:3000/api/v1\nTOKEN=$(curl -s $BASE/auth/login -H 'content-type: application/json' -d '{"email":"officer@asli.demo","password":"'"$DEMO_PASSWORD"'"}' | jq -r .token)\n\`\`\`\n\n`;
for (const r of rows) {
  const key = `${r.method} ${r.path}`;
  const b = BODY[key];
  curl += `### ${r.summary || key}\n\n\`\`\`bash\ncurl -s -X ${r.method} "$BASE${r.path.replace("{id}", "<ID>")}" -H "authorization: Bearer $TOKEN"${r.method !== "GET" ? ` -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)"` : ""}${b ? ` -d '${JSON.stringify(b).replace(/'/g, "'\\''")}'` : r.method !== "GET" ? " -d '{}'" : ""}\n\`\`\`\n\n`;
}
fs.writeFileSync("docs/curl-examples.md", curl);
const counts = rows.flatMap((r) => Object.values(r.results));
console.log(`Permission matrix: ${rows.length} endpoints × ${ACTORS.length} actors. Allowed ${counts.filter((s) => s < 300).length}, 401 ${counts.filter((s) => s === 401).length}, 403 ${counts.filter((s) => s === 403).length}, 404 ${counts.filter((s) => s === 404).length}, other ${counts.filter((s) => s >= 300 && ![401, 403, 404].includes(s)).length}.`);
await resetDb();
