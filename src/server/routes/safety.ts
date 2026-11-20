import { and, desc, eq } from "drizzle-orm";
import { router, route, z, body, param, query, actx, need, IdParam } from "../http/route";
import { getActor } from "../http/middleware";
import { idempotent } from "../http/idempotency";
import { HARD_STOPS } from "../domain/hardstops";
import { getAiDecision, listAiDecisions, replayAiDecision } from "../services/aidecisions";
import { pipelineRuns, citizens, users } from "../db/schema";
import { runDecision } from "../services/decisionPipeline";
import { getChaos, setChaos, breakerStatus, resetBreakers, MOCK_SERVICES } from "../services/chaos";
import { trainScorer, autoThresholdCurve, runBenchmarks } from "../eval/benchmarks";
import { activeScoringModel, listScoringModels } from "../services/scoring";
import { manifest } from "../eval/freeze";
import { cancelPayout } from "../services/cases";
import { requestPayoutAccountChange, approvePayoutAccountChange, rejectPayoutAccountChange, freezePayoutAccountChange, listPayoutAccountChanges, confirmReceipt, receiptPrompt, complaintQueue } from "../services/lastmile";
import { issueToken, checkPassword } from "../auth/tokens";
import { AppError, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { rateLimit } from "../http/ratelimit";
import { DEMO_PASSWORD } from "../demo/seed";

export const safetyRoutes = router();

// ───────── hard stops ─────────
safetyRoutes.openapi(route({ method: "get", path: "/hard-stops", tags: ["Decisions"], summary: "The 12 named hard stops (S1–S12). Any one sends a case to a human, whatever the score.", auth: false }), async (c) =>
  c.json({ hardStops: Object.entries(HARD_STOPS).map(([id, h]) => ({ id, ...h })), rule: "Evaluated by deterministic code only. No model output can clear a hard stop." }, 200),
);

// ───────── AI decisions: two views + replay ─────────
const AiQ = z.object({ subjectId: z.string().optional(), kind: z.string().optional(), citizenId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
safetyRoutes.openapi(route({ method: "get", path: "/ai-decisions", tags: ["Decisions"], summary: "Every AI judgement (case decisions, scam verdicts, routing, signals, policy answers, extractions)", query: AiQ }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"]);
  return c.json({ decisions: await listAiDecisions(c.get("db"), { tenantId: a.tenantId!, ...query(c, AiQ) }) }, 200);
});

const ViewQ = z.object({ view: z.enum(["citizen", "auditor"]).default("citizen") });
safetyRoutes.openapi(
  route({ method: "get", path: "/ai-decisions/{id}", tags: ["Decisions"], summary: "One AI decision — citizen view (plain words) or auditor view (input, versions, confidence, trace; personal fields removed after consent withdrawal)", params: IdParam, query: ViewQ }),
  async (c) => {
    const a = getActor(c);
    const view = query(c, ViewQ).view;
    const db = c.get("db");
    const d = await getAiDecision(db, param(c), "citizen");
    const full = await db.query.aiDecisions.findFirst({ where: (t, { eq: e }) => e(t.id, param(c)) });
    if (!full) throw notFound("AI decision");
    const own = a.type === "user" && a.role === "citizen" && a.citizenId === full.citizenId;
    const staff = a.type === "user" && ["officer", "admin", "auditor"].includes(a.role) && a.tenantId === full.tenantId;
    if (!own && !staff) throw notFound("AI decision");
    if (view === "auditor" && !staff) throw forbidden("AUDITOR_VIEW_STAFF_ONLY", "The full trace is for staff and auditors.");
    return c.json(view === "auditor" ? await getAiDecision(db, param(c), "auditor") : d, 200);
  },
);

safetyRoutes.openapi(route({ method: "post", path: "/ai-decisions/{id}/replay", tags: ["Decisions"], summary: "Replay: same stored input, same rule version (must reproduce) and current version (shows drift)", params: IdParam }), async (c) => {
  const a = await need(c, ["auditor", "admin", "officer"]);
  const db = c.get("db");
  const full = await db.query.aiDecisions.findFirst({ where: (t, { eq: e }) => e(t.id, param(c)) });
  if (!full || full.tenantId !== a.tenantId) throw notFound("AI decision");
  const r = await replayAiDecision(db, param(c));
  await audit(db, { actor: a, action: "ai_decision.replayed", targetType: "ai_decision", targetId: param(c), detail: { reproduced: r.reproduced, changed: r.changedFields } });
  return c.json(r, 200);
});

// ───────── durable pipeline ─────────
const RunsQ = z.object({ caseId: z.string().optional(), status: z.enum(["running", "done", "failed", "halted"]).optional() });
safetyRoutes.openapi(route({ method: "get", path: "/pipelines", tags: ["Decisions"], summary: "Decision pipeline runs (steps, attempts, timings, halts on consent withdrawal)", query: RunsQ }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"]);
  const q = query(c, RunsQ);
  const where = [eq(pipelineRuns.tenantId, a.tenantId!)];
  if (q.caseId) where.push(eq(pipelineRuns.caseId, q.caseId));
  if (q.status) where.push(eq(pipelineRuns.status, q.status));
  const rows = await c.get("db").select({ id: pipelineRuns.id, caseId: pipelineRuns.caseId, status: pipelineRuns.status, trigger: pipelineRuns.trigger, steps: pipelineRuns.steps, error: pipelineRuns.error, createdAt: pipelineRuns.createdAt, updatedAt: pipelineRuns.updatedAt }).from(pipelineRuns).where(and(...where)).orderBy(desc(pipelineRuns.createdAt)).limit(100);
  return c.json({ runs: rows }, 200);
});

safetyRoutes.openapi(route({ method: "post", path: "/pipelines/{id}/resume", tags: ["Decisions"], summary: "Resume a run that stopped mid-way (continues from the first unfinished step)", params: IdParam }), async (c) => {
  const a = await need(c, ["officer", "admin"]);
  const db = c.get("db");
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, param(c)));
  if (!run || run.tenantId !== a.tenantId) throw notFound("Pipeline run");
  if (run.status !== "running") throw new AppError(409, "NOT_RESUMABLE", `Run is ${run.status}`);
  return c.json(await runDecision(db, run.caseId, { trigger: "manual_resume", resumeRunId: run.id, requestId: c.get("requestId") }), 200);
});

// ───────── chaos panel ─────────
safetyRoutes.openapi(route({ method: "get", path: "/chaos", tags: ["Chaos panel"], summary: "Fault injection settings + circuit breaker state for the mock services" }), async (c) => {
  await need(c, ["admin", "officer", "auditor"]);
  return c.json({ services: await getChaos(c.get("db")), breakers: breakerStatus() }, 200);
});

const Chaos = z.object({ latencyMs: z.number().int().min(0).max(10_000).optional(), failRate: z.number().min(0).max(1).optional(), timeoutRate: z.number().min(0).max(1).optional(), down: z.boolean().optional() }).openapi("ChaosSettings");
safetyRoutes.openapi(
  route({ method: "post", path: "/chaos/{id}", tags: ["Chaos panel"], summary: "Set latency / failure rate / timeouts / outage for nadra | income | raast", params: z.object({ id: z.enum(MOCK_SERVICES).openapi({ param: { name: "id", in: "path" } }) }), body: Chaos }),
  async (c) => {
    const a = await need(c, ["admin"]);
    const svc = c.req.param("id") as (typeof MOCK_SERVICES)[number];
    const r = await setChaos(c.get("db"), svc, body(c, Chaos));
    await audit(c.get("db"), { actor: a, action: "chaos.set", targetType: "mock_service", targetId: svc, detail: r[svc] });
    return c.json({ services: r, breakers: breakerStatus() }, 200);
  },
);

safetyRoutes.openapi(route({ method: "post", path: "/chaos/reset", tags: ["Chaos panel"], summary: "Clear all faults and close all breakers" }), async (c) => {
  const a = await need(c, ["admin"]);
  for (const s of MOCK_SERVICES) await setChaos(c.get("db"), s, { latencyMs: 0, failRate: 0, timeoutRate: 0, down: false });
  resetBreakers();
  await audit(c.get("db"), { actor: a, action: "chaos.reset" });
  return c.json({ services: await getChaos(c.get("db")), breakers: breakerStatus() }, 200);
});

// ───────── calibrated scorer + frozen benchmarks ─────────
safetyRoutes.openapi(route({ method: "post", path: "/eval/scorer/train", tags: ["Evaluation"], summary: "Train logistic regression + isotonic calibration on frozen D1 (300/100/100 by scenario) and activate it", status: 201 }), async (c) => {
  const a = await need(c, ["admin"]);
  const r = await trainScorer(c.get("db"));
  await audit(c.get("db"), { actor: a, action: "scorer.trained", targetType: "scoring_model", targetId: r.id, detail: { version: r.version, datasetHash: r.datasetHash } });
  return c.json({ id: r.id, version: r.version, datasetHash: r.datasetHash, metrics: r.metrics }, 201);
});

safetyRoutes.openapi(route({ method: "get", path: "/eval/scorer", tags: ["Evaluation"], summary: "Scoring model versions, calibration metrics (Brier, ECE, reliability bins)" }), async (c) => {
  await need(c, ["admin", "officer", "auditor"]);
  return c.json({ models: await listScoringModels(c.get("db")) }, 200);
});

safetyRoutes.openapi(route({ method: "get", path: "/eval/auto-threshold", tags: ["Evaluation"], summary: "Cost curve over the auto-approve threshold: empirical minimum beside the formula threshold, rule-of-three bound" }), async (c) => {
  await need(c, ["admin", "officer", "auditor"]);
  const m = await activeScoringModel(c.get("db"));
  if (!m) throw new AppError(409, "NO_SCORER", "Train the scorer first (POST /v1/eval/scorer/train)");
  return c.json(autoThresholdCurve(m), 200);
});

safetyRoutes.openapi(route({ method: "post", path: "/eval/benchmarks", tags: ["Evaluation"], summary: "Run all frozen benchmarks (D1–D5) with denominators and listed misses" }), async (c) => {
  await need(c, ["admin", "officer", "auditor"]);
  return c.json(await runBenchmarks(c.get("db"), await activeScoringModel(c.get("db"))), 200);
});

safetyRoutes.openapi(route({ method: "get", path: "/eval/datasets", tags: ["Evaluation"], summary: "Frozen dataset manifest: sizes, label counts, sha256", auth: false }), async (c) => c.json(manifest(), 200));

// ───────── payouts: cancel + receipt ─────────
const Cancel = z.object({ reason: z.string().min(3) }).openapi("CancelPayout");
safetyRoutes.openapi(route({ method: "post", path: "/payouts/{id}/cancel", tags: ["Officer"], summary: "Cancel a reserved / pending payout before money moves (citizen or officer). Requires Idempotency-Key.", params: IdParam, body: Cancel }), async (c) => {
  const b = body(c, Cancel);
  const r = await idempotent(c, { id: param(c), ...b }, async () => ({ status: 200, body: await cancelPayout(c.get("db"), getActor(c), param(c), b.reason) }), null, { required: true });
  return c.json(r.body, 200);
});

safetyRoutes.openapi(route({ method: "get", path: "/payouts/{id}/receipt-prompt", tags: ["Money received"], summary: "The spoken question: 'Did you receive exactly Rs X?'", params: IdParam }), async (c) => {
  getActor(c);
  return c.json(await receiptPrompt(c.get("db"), param(c)), 200);
});

const Receipt = z.object({ status: z.enum(["received_full", "received_less", "not_received"]), amount: z.number().int().min(0).optional(), via: z.enum(["voice", "app", "helper"]).default("voice"), statement: z.string().max(2000).optional() }).openapi("Receipt");
safetyRoutes.openapi(
  route({ method: "post", path: "/payouts/{id}/receipt", tags: ["Money received"], summary: "Confirm the exact amount that arrived; 'less' or 'nothing' opens a complaint linked to the helper", params: IdParam, body: Receipt, status: 201 }),
  async (c) => {
    const b = body(c, Receipt);
    const r = await idempotent(c, { id: param(c), ...b }, async () => ({ status: 201, body: await confirmReceipt(c.get("db"), actx(c), param(c), b) }));
    return c.json(r.body, 201);
  },
);

// ───────── payout-account change protection ─────────
const Change = z.object({ newAlias: z.string().openapi({ example: "03007654321" }), pin: z.string().regex(/^\d{4,6}$/) }).openapi("PayoutAccountChange");
safetyRoutes.openapi(
  route({
    method: "post",
    path: "/payout-account/change",
    tags: ["Payment account protection"],
    summary: "Ask to change where money is sent: family PIN → officer → 48 h cooling-off; old number told to press 9",
    body: Change,
    status: 201,
  }),
  async (c) => {
    const b = body(c, Change);
    return c.json(await requestPayoutAccountChange(c.get("db"), actx(c), b.newAlias, b.pin), 201);
  },
);

safetyRoutes.openapi(route({ method: "get", path: "/payout-account/changes", tags: ["Payment account protection"], summary: "Account change requests (citizen: own; staff: department)", query: z.object({ citizenId: z.string().optional() }) }), async (c) =>
  c.json({ changes: await listPayoutAccountChanges(c.get("db"), getActor(c), c.req.query("citizenId")) }, 200),
);

safetyRoutes.openapi(route({ method: "post", path: "/payout-account/changes/{id}/approve", tags: ["Payment account protection"], summary: "Officer approval (not the requester) → 48 h cooling-off", params: IdParam }), async (c) => {
  const a = await need(c, ["officer", "admin"]);
  return c.json(await approvePayoutAccountChange(c.get("db"), a, param(c)), 200);
});

const Reject = z.object({ reason: z.string().min(3) }).openapi("RejectChange");
safetyRoutes.openapi(route({ method: "post", path: "/payout-account/changes/{id}/reject", tags: ["Payment account protection"], summary: "Officer rejects an account change", params: IdParam, body: Reject }), async (c) => {
  const a = await need(c, ["officer", "admin"]);
  return c.json(await rejectPayoutAccountChange(c.get("db"), a, param(c), body(c, Reject).reason), 200);
});

safetyRoutes.openapi(route({ method: "post", path: "/payout-account/changes/{id}/freeze", tags: ["Payment account protection"], summary: "Freeze a pending change (citizen in the app, or officer). By phone: IVR option 9.", params: IdParam }), async (c) => {
  const a = getActor(c);
  const via = a.type === "user" && a.role === "citizen" ? "app" : "officer";
  return c.json(await freezePayoutAccountChange(c.get("db"), a, { changeId: param(c), via }), 200);
});

// ───────── officer complaint & correction queue ─────────
safetyRoutes.openapi(route({ method: "get", path: "/officer/complaints", tags: ["Officer"], summary: "Complaints, appeals, data corrections, frozen account changes and scam reports awaiting review" }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"]);
  return c.json(await complaintQueue(c.get("db"), a), 200);
});

// ───────── citizen app on a shared phone: PIN unlock ─────────
const Unlock = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).openapi("PinUnlock");
safetyRoutes.openapi(
  route({ method: "post", path: "/auth/pin-unlock", tags: ["Auth"], summary: "Citizen app lock screen: family PIN → 10-minute session (the app auto-locks after inactivity)", body: Unlock }),
  async (c) => {
    const a = getActor(c);
    if (a.type !== "user" || a.role !== "citizen" || !a.citizenId) throw forbidden("CITIZEN_ONLY", "Only for the citizen app");
    const rl = rateLimit(`unlock:${a.id}`, 5, 15 * 60_000);
    if (!rl.ok) throw new AppError(429, "PIN_LOCKED", "Too many wrong PINs. Try again in 15 minutes.");
    const db = c.get("db");
    const [cz] = await db.select().from(citizens).where(eq(citizens.id, a.citizenId));
    if (!cz?.pinHash || !(await checkPassword(body(c, Unlock).pin, cz.pinHash))) {
      await audit(db, { actor: a, action: "auth.pin_unlock", outcome: "denied" });
      throw forbidden("WRONG_PIN", `Wrong PIN. ${rl.remaining} attempts left.`);
    }
    const [u] = await db.select().from(users).where(eq(users.id, a.id));
    const t = await issueToken({ sub: a.id, tid: a.tenantId, role: "citizen", tv: u!.tokenVersion, typ: "access", pv: Math.floor(Date.now() / 1000) }, 10 * 60);
    await audit(db, { actor: a, action: "auth.pin_unlock" });
    return c.json({ ...t, autoLockSeconds: 120 }, 200);
  },
);

// ───────── demo tokens (judges) — only when ASLI_DEMO_MODE=true ─────────
safetyRoutes.openapi(
  route({ method: "get", path: "/demo/tokens", tags: ["Demo"], summary: "Ready-made tokens for every demo role (ONLY when ASLI_DEMO_MODE=true; all data is fictional)", auth: false }),
  async (c) => {
    if (process.env.ASLI_DEMO_MODE !== "true") throw notFound("Route");
    const db = c.get("db");
    const emails = ["fatima@asli.demo", "shopkeeper@asli.demo", "helper@asli.demo", "officer@asli.demo", "officer2@asli.demo", "admin@asli.demo", "auditor@asli.demo", "officer@sindh.demo"];
    const out: Record<string, unknown> = {};
    for (const e of emails) {
      const [u] = await db.select().from(users).where(eq(users.email, e));
      if (!u || !(await checkPassword(DEMO_PASSWORD, u.passwordHash))) continue;
      out[e] = { role: u.role, ...(await issueToken({ sub: u.id, tid: u.tenantId, role: u.role, tv: u.tokenVersion, typ: "access" }, 4 * 3600)) };
    }
    return c.json({ note: "Prototype demo tokens for fictional accounts. Disable ASLI_DEMO_MODE in any real deployment.", tokens: out }, 200);
  },
);
