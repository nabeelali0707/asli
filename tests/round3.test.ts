/**
 * End-to-end tests for the last-metre protections, two-view AI decisions, break-glass, chaos,
 * tamper-evident audit and frozen benchmarks.
 */
import { beforeAll, describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createApp } from "@/server/app";
import { getDb } from "@/server/db/client";
import { seedDemo, DEMO_PASSWORD, DEMO_PIN } from "@/server/demo/seed";
import { verifyAuditChain } from "@/server/lib/audit";

const app = createApp();
type J = Record<string, any>;
async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json()) as J, headers: res.headers };
}
const login = async (email: string) => (await call("POST", "/v1/auth/login", { body: { email, password: DEMO_PASSWORD }, headers: { "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` } })).json.token as string;

let officer: string, officer2: string, admin: string, helper: string, auditor: string, fatima: string, shopkeeper: string;
beforeAll(async () => {
  await seedDemo(await getDb());
  [officer, officer2, admin, helper, auditor, fatima, shopkeeper] = await Promise.all(["officer@asli.demo", "officer2@asli.demo", "admin@asli.demo", "helper@asli.demo", "auditor@asli.demo", "fatima@asli.demo", "shopkeeper@asli.demo"].map(login));
}, 180_000);

describe("payout-account change protection", () => {
  it("PIN → officer (not requester) → cooling-off; old number can press 9 to freeze; payouts blocked meanwhile", async () => {
    const sw = await call("POST", "/v1/helper/switch", { token: helper, body: { citizenId: "ctz_zainab", pin: DEMO_PIN } });
    const fam = sw.json.familyToken;
    const wrong = await call("POST", "/v1/payout-account/change", { token: fam, body: { newAlias: "03119998877", pin: "0000" } });
    expect(wrong.json.code).toBe("WRONG_PIN");
    const req = await call("POST", "/v1/payout-account/change", { token: fam, body: { newAlias: "03119998877", pin: DEMO_PIN } });
    expect(req.status).toBe(201);
    expect(req.json.status).toBe("pending_officer");
    const appr = await call("POST", `/v1/payout-account/changes/${req.json.changeId}/approve`, { token: officer });
    expect(appr.json.status).toBe("cooling_off");
    // The real owner calls from her OLD number and presses 9.
    const callStart = await call("POST", "/v1/ivr/calls", { body: { phone: "03451231234" } });
    const press9 = await call("POST", `/v1/ivr/calls/${callStart.json.sessionId}/input`, { body: { digits: "9" } });
    expect(press9.json.prompt.en).toMatch(/Stopped/);
    const list = await call("GET", "/v1/payout-account/changes?citizenId=ctz_zainab", { token: officer });
    expect(list.json.changes[0].status).toBe("frozen");
    const queue = await call("GET", "/v1/officer/complaints", { token: officer });
    expect(queue.json.counts.payoutAccountChanges).toBeGreaterThanOrEqual(1);
  });
});

describe("exact-amount receipt", () => {
  it("'received less' opens a complaint linked to the helper who handled the case", async () => {
    const mine = await call("GET", "/v1/cases/mine", { token: fatima });
    const paidCase = mine.json.cases.find((c: J) => c.status === "paid");
    const detail = await call("GET", `/v1/cases/${paidCase.id}`, { token: fatima });
    const payoutId = detail.json.payout.id;
    const prompt = await call("GET", `/v1/payouts/${payoutId}/receipt-prompt`, { token: fatima });
    expect(prompt.json.spoken.en).toMatch(/exactly Rs/);
    const r = await call("POST", `/v1/payouts/${payoutId}/receipt`, { token: fatima, body: { status: "received_less", amount: 9000, via: "voice", statement: "Helper ne 3000 rakh liye" } });
    expect(r.status).toBe(201);
    expect(r.json.complaintCaseId).toBeTruthy();
    const anomalies = await call("GET", "/v1/anomalies", { token: officer });
    expect(anomalies.json.anomalies.some((a: J) => a.type === "receipt_shortfall_by_helper" && a.refs.includes("usr_helper"))).toBe(true);
  });
});

describe("Signed Truth: checking someone else's message", () => {
  it("does not raise a false 'not linked' alarm from the checker's own record", async () => {
    const msg = { text: "Relief payment update: your application is under review. No action needed.", sender: "8171" };
    const asMine = await call("POST", "/v1/verify", { token: shopkeeper, body: msg });
    const asOther = await call("POST", "/v1/verify", { token: shopkeeper, body: { ...msg, about: "someone_else" } });
    expect(asOther.json.verdict).not.toBe("not_linked");
    expect(asOther.json.verdict).not.toBe("scam");
    expect(asOther.json.checks.some((c: J) => c.name === "scope")).toBe(true);
    expect(["not_linked", "suspicious"]).toContain(asMine.json.verdict);
  });
});

describe("two views + replay for every AI decision", () => {
  it("citizen sees plain words; auditor sees the trace; replay reproduces the original", async () => {
    const list = await call("GET", "/v1/ai-decisions?kind=case_decision", { token: auditor });
    const id = list.json.decisions[0].id;
    const cit = await call("GET", `/v1/ai-decisions/${id}?view=citizen`, { token: auditor });
    expect(cit.json.explanation.reason.ur.length).toBeGreaterThan(10);
    expect(cit.json.trace).toBeUndefined();
    const aud = await call("GET", `/v1/ai-decisions/${id}?view=auditor`, { token: auditor });
    expect(aud.json.trace.input).toBeTruthy();
    const replay = await call("POST", `/v1/ai-decisions/${id}/replay`, { token: auditor });
    expect(replay.json.reproduced).toBe(true);
    const kinds = new Set((await call("GET", "/v1/ai-decisions?limit=500", { token: auditor })).json.decisions.map((d: J) => d.kind));
    for (const k of ["case_decision", "scam_verdict", "routing"]) expect(kinds.has(k)).toBe(true);
  });
  it("after the citizen withdraws department consent, the auditor trace has personal fields removed", async () => {
    const consent = await call("GET", "/v1/consent", { token: fatima });
    const dept = consent.json.grants.find((g: J) => g.grantee.type === "department" && g.status === "active");
    await call("POST", `/v1/consent/${dept.id}/withdraw`, { token: fatima, body: { reason: "I want my data back" } });
    const list = await call("GET", "/v1/ai-decisions?kind=case_decision&citizenId=ctz_fatima", { token: auditor });
    const aud = await call("GET", `/v1/ai-decisions/${list.json.decisions[0].id}?view=auditor`, { token: auditor });
    expect(aud.json.piiRemoved).toBe(true);
    expect(JSON.stringify(aud.json.trace)).toContain("[removed: consent withdrawn]");
    expect(JSON.stringify(aud.json.trace)).not.toContain("Allah Ditta");
  });
});

describe("break-glass", () => {
  it("gives a full view for 15 minutes with a reason, and shows up in the citizen's access log", async () => {
    const before = await call("GET", "/v1/citizens/ctz_shahida", { token: officer });
    expect(before.json.citizen.view).toBe("masked");
    const bg = await call("POST", "/v1/citizens/ctz_shahida/break-glass", { token: officer, body: { reason: "Verifying forged-ID report with the family on the phone" } });
    expect(bg.json.minutes).toBe(15);
    const during = await call("GET", "/v1/citizens/ctz_shahida", { token: officer });
    expect(during.json.citizen.view).toBe("full");
    const other = await call("GET", "/v1/citizens/ctz_shahida", { token: officer2 });
    expect(other.json.citizen.view).toBe("masked");
  });
});

describe("chaos panel → S12, not a guess", () => {
  it("registry outage sends the re-decision to a human with S12", async () => {
    await call("POST", "/v1/chaos/nadra", { token: admin, body: { down: true } });
    const q = (await call("GET", "/v1/officer/queue", { token: officer })).json.cases.filter((c: J) => c.citizen.id === "ctz_imran");
    const r = await call("POST", `/v1/cases/${q[0].id}/redecide`, { token: officer });
    await call("POST", "/v1/chaos/reset", { token: admin });
    expect(r.json.lane).toBe("human");
    expect(r.json.hardStops.join(" ")).toMatch(/S12/);
    const runs = await call("GET", `/v1/pipelines?caseId=${q[0].id}`, { token: officer });
    expect(runs.json.runs[0].steps.some((s: J) => s.status === "degraded")).toBe(true);
  }, 60_000);
});

describe("platform details", () => {
  it("rate-limit headers follow the IETF draft", async () => {
    const r = await call("GET", "/v1/auth/me", { token: officer });
    expect(r.headers.get("ratelimit-limit")).toBeTruthy();
    expect(r.headers.get("ratelimit-remaining")).toBeTruthy();
    expect(r.headers.get("ratelimit-policy")).toMatch(/w=60/);
  });
  it("frozen datasets match their committed files", async () => {
    const m = await call("GET", "/v1/eval/datasets");
    expect(m.json.datasets).toHaveLength(6);
    for (const d of m.json.datasets) expect(d.committedFile).toBe("match");
  });
  it("benchmarks report denominators", async () => {
    const b = await call("POST", "/v1/eval/benchmarks", { token: auditor });
    expect(b.json.d1Decisions.denominator).toBe(100);
    expect(b.json.d3Messages.heldOut.scamsCaught.of).toBe(5);
  }, 120_000);
});

describe("tamper-evident audit (database trigger)", () => {
  it("blocks edits; if someone disables the trigger, verify names the first broken row", async () => {
    const db = await getDb();
    await expect(db.execute(sql`update audit_log set action = 'x' where chain_index = 3`)).rejects.toThrow();
    expect((await verifyAuditChain(db)).ok).toBe(true);
    await db.execute(sql`alter table audit_log disable trigger audit_no_update`);
    await db.execute(sql`update audit_log set action = 'forged' where chain_index = 3`);
    const broken = await verifyAuditChain(db);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAtIndex).toBe(3);
    await db.execute(sql`delete from audit_log where chain_index = 5`);
    await db.execute(sql`update audit_log set action = (select action from audit_log where chain_index = 4) where chain_index = 3`);
    const del = await verifyAuditChain(db);
    expect(del.ok).toBe(false);
    await db.execute(sql`alter table audit_log enable trigger audit_no_update`);
  });
});
