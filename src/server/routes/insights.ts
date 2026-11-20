import { desc, eq } from "drizzle-orm";
import { router, route, z, body, param, query, need, IdParam } from "../http/route";
import { getActor } from "../http/middleware";
import { tenantAnalytics, transparency, scamMap, listScamReports, reviewScamReport, anomalies, driftCheck, auditTrail } from "../services/insights";
import { runEvaluation, draftFromEval, DEFAULT_COSTS } from "../services/eval";
import { verifyAuditChain } from "../lib/audit";
import { evalRuns, notifications } from "../db/schema";
import { notFound } from "../lib/errors";

export const insightRoutes = router();

insightRoutes.openapi(route({ method: "get", path: "/analytics", tags: ["Analytics"], summary: "Department dashboard: cases, lanes, channels, payouts, officer overrides, false alarms" }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"], "analytics:read");
  return c.json(await tenantAnalytics(c.get("db"), a.tenantId!), 200);
});

insightRoutes.openapi(route({ method: "get", path: "/transparency", tags: ["Analytics"], summary: "Public numbers, including false alarms and share sent to humans", auth: false }), async (c) => c.json(await transparency(c.get("db")), 200));

const MapQ = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });
insightRoutes.openapi(route({ method: "get", path: "/scam-map", tags: ["Scam Map"], summary: "Scam reports by district, category and day, with spike alerts", query: MapQ }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"], "scam:read");
  return c.json(await scamMap(c.get("db"), a.tenantId!, query(c, MapQ).days ?? 30), 200);
});

insightRoutes.openapi(route({ method: "get", path: "/scam-map/public", tags: ["Scam Map"], summary: "Public, anonymous scam map (all departments)", query: MapQ, auth: false }), async (c) => {
  const m = await scamMap(c.get("db"), null, query(c, MapQ).days ?? 30);
  return c.json({ ...m, topSenders: m.topSenders.map((s) => ({ sender: s.sender ? s.sender.slice(0, 4) + "****" + s.sender.slice(-2) : null, n: s.n })) }, 200);
});

const RQ = z.object({ status: z.enum(["open", "confirmed_scam", "false_alarm"]).optional() });
insightRoutes.openapi(route({ method: "get", path: "/scam-reports", tags: ["Scam Map"], summary: "Scam reports for review", query: RQ }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"], "scam:read");
  return c.json({ reports: await listScamReports(c.get("db"), a.tenantId!, query(c, RQ).status) }, 200);
});

const ScamReview = z.object({ status: z.enum(["confirmed_scam", "false_alarm"]), note: z.string().optional() }).openapi("ScamReview");
insightRoutes.openapi(route({ method: "post", path: "/scam-reports/{id}/review", tags: ["Scam Map"], summary: "Confirm a scam or record a FALSE ALARM (counted publicly; reporter told)", params: IdParam, body: ScamReview }), async (c) => {
  const a = await need(c, ["officer", "admin"]);
  const b = body(c, ScamReview);
  return c.json(await reviewScamReport(c.get("db"), a, param(c), b.status, b.note), 200);
});

insightRoutes.openapi(route({ method: "get", path: "/anomalies", tags: ["AI"], summary: "Anomaly detection: shared payout accounts, repeated claims, reused documents, helper spikes, scam spikes" }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"]);
  return c.json({ anomalies: await anomalies(c.get("db"), a.tenantId!) }, 200);
});

insightRoutes.openapi(route({ method: "post", path: "/drift/check", tags: ["AI"], summary: "Drift guard: if officers overturn too many fast-lane cases, switch the fast lane off" }), async (c) => {
  const a = await need(c, ["admin", "officer"]);
  return c.json(await driftCheck(c.get("db"), a.tenantId!), 200);
});

// ───────── evaluation ─────────

const EvalBody = z
  .object({
    seed: z.number().int().optional(),
    costs: z
      .object({
        wrongApprovalPKR: z.number().positive(),
        fastLaneMissRate: z.number().min(0).max(1),
        officerReviewPKR: z.number().nonnegative(),
        delayPerRealClaimantPKR: z.number().nonnegative(),
        wastedProofRequestPKR: z.number().nonnegative(),
      })
      .partial()
      .optional(),
  })
  .openapi("EvalRun");
insightRoutes.openapi(
  route({
    method: "post",
    path: "/eval/runs",
    tags: ["Evaluation"],
    summary: "Fit lane cutoffs on ~200 labelled synthetic cases by minimising expected cost; report on a held-out split",
    description: `Default cost assumptions: ${JSON.stringify(DEFAULT_COSTS)}. Returns the cost-vs-automation curve, confusion matrix, wrong approvals and false alarms.`,
    body: EvalBody,
    status: 201,
  }),
  async (c) => {
    const a = await need(c, ["admin", "officer", "auditor"]);
    const b = body(c, EvalBody);
    return c.json(await runEvaluation(c.get("db"), a, a.tenantId!, b), 201);
  },
);

insightRoutes.openapi(route({ method: "get", path: "/eval/runs", tags: ["Evaluation"], summary: "Past evaluation runs" }), async (c) => {
  const a = await need(c, ["admin", "officer", "auditor"]);
  const rows = await c.get("db").select().from(evalRuns).where(eq(evalRuns.tenantId, a.tenantId!)).orderBy(desc(evalRuns.createdAt)).limit(20);
  return c.json({ runs: rows }, 200);
});

insightRoutes.openapi(route({ method: "post", path: "/eval/runs/{id}/draft-rules", tags: ["Evaluation"], summary: "Turn an evaluation's recommended cutoffs into a rule DRAFT (admin publishes)", params: IdParam, status: 201 }), async (c) => {
  const a = await need(c, ["admin"]);
  const [run] = await c.get("db").select().from(evalRuns).where(eq(evalRuns.id, param(c)));
  if (!run || run.tenantId !== a.tenantId) throw notFound("Evaluation run");
  return c.json(await draftFromEval(c.get("db"), a, a.tenantId!, run.thresholds as { fastLaneMinScore: number; askProofMinScore: number }, run.id), 201);
});

// ───────── audit ─────────

const AuditQ = z.object({ targetId: z.string().optional(), actorId: z.string().optional(), action: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).optional() });
insightRoutes.openapi(route({ method: "get", path: "/audit", tags: ["Audit"], summary: "Audit log (every user, AI, agent and API action, including denials)", query: AuditQ }), async (c) => {
  const a = await need(c, ["auditor", "admin"]);
  return c.json({ entries: await auditTrail(c.get("db"), { tenantId: a.tenantId!, ...query(c, AuditQ) }) }, 200);
});

insightRoutes.openapi(route({ method: "get", path: "/audit/verify", tags: ["Audit"], summary: "Recompute the hash chain — proves no row was edited or deleted" }), async (c) => {
  await need(c, ["auditor", "admin"]);
  return c.json(await verifyAuditChain(c.get("db")), 200);
});

// ───────── notifications ─────────

insightRoutes.openapi(route({ method: "get", path: "/notifications", tags: ["Notifications"], summary: "My in-app notifications (with audio keys for voice playback)" }), async (c) => {
  const a = getActor(c);
  const rows = await c.get("db").select().from(notifications).where(eq(notifications.userId, a.id)).orderBy(desc(notifications.createdAt)).limit(50);
  return c.json({ notifications: rows }, 200);
});
