/**
 * Analytics, transparency, Scam Map, anomaly detection, drift guard, attestations, break-glass.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { cases, decisions, scamReports, payouts, citizens, documents, auditLog, users, attestations, notices, settings, breakGlassGrants, payoutAliasChanges } from "../db/schema";
import type { Actor } from "../lib/actor";
import { audit } from "../lib/audit";
import { newId } from "../lib/ids";
import { signPayload, verifyToken } from "../lib/signing";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { registerJob, enqueueJob } from "./events";
import { setFastLane, activeRuleSet } from "./rules";
import { getCitizenOr404, presentCitizen } from "./access";
import { notifyUser } from "./notices";

const DAY = 864e5;

// ─────────────── analytics (per tenant) ───────────────

export async function tenantAnalytics(db: DB, tenantId: string) {
  const byStatus = await db.select({ status: cases.status, n: count() }).from(cases).where(eq(cases.tenantId, tenantId)).groupBy(cases.status);
  const byLane = await db.select({ lane: decisions.lane, n: count() }).from(decisions).where(and(eq(decisions.tenantId, tenantId), eq(decisions.simulated, false))).groupBy(decisions.lane);
  const byVia = await db.select({ via: cases.createdVia, n: count() }).from(cases).where(eq(cases.tenantId, tenantId)).groupBy(cases.createdVia);
  const paid = await db.select({ n: count(), total: sql<number>`coalesce(sum(${payouts.amount}),0)` }).from(payouts).where(and(eq(payouts.tenantId, tenantId), eq(payouts.status, "released")));
  const overrides = await overrideStats(db, tenantId);
  const scams = await falseAlarmStats(db, tenantId);
  const waiting = await db
    .select({ avgHours: sql<number>`coalesce(avg(extract(epoch from (now() - ${cases.createdAt})) / 3600), 0)` })
    .from(cases)
    .where(and(eq(cases.tenantId, tenantId), inArray(cases.status, ["submitted", "in_review", "needs_proof"])));
  return {
    casesByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    decisionsByLane: Object.fromEntries(byLane.map((r) => [r.lane, r.n])),
    casesByChannel: Object.fromEntries(byVia.map((r) => [r.via, r.n])),
    payouts: { count: paid[0]?.n ?? 0, totalPKR: Number(paid[0]?.total ?? 0), simulated: true },
    officerOverrides: overrides,
    scamDetection: scams,
    openCasesAvgAgeHours: Math.round(Number(waiting[0]?.avgHours ?? 0) * 10) / 10,
  };
}

/** How often humans disagreed with the AI lane — the honest health signal. */
export async function overrideStats(db: DB, tenantId: string, sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * DAY);
  const rows = await db
    .select({ caseId: cases.id, status: cases.status, lane: decisions.lane })
    .from(cases)
    .innerJoin(decisions, eq(decisions.caseId, cases.id))
    .where(and(eq(cases.tenantId, tenantId), gte(cases.updatedAt, since), inArray(cases.status, ["approved", "paid", "rejected"]), eq(decisions.simulated, false)));
  const latest = new Map<string, { status: string; lane: string }>();
  for (const r of rows) latest.set(r.caseId, r);
  let fastRejected = 0;
  let fastTotal = 0;
  let humanApproved = 0;
  let humanTotal = 0;
  for (const r of latest.values()) {
    if (r.lane === "fast") {
      fastTotal++;
      if (r.status === "rejected") fastRejected++;
    } else if (r.lane === "human") {
      humanTotal++;
      if (r.status !== "rejected") humanApproved++;
    }
  }
  return {
    fastLaneDecided: fastTotal,
    fastLaneRejectedByOfficer: fastRejected,
    fastLaneOverrideRate: fastTotal ? Math.round((fastRejected / fastTotal) * 1000) / 1000 : null,
    humanLaneDecided: humanTotal,
    humanLaneApproved: humanApproved,
  };
}

export async function falseAlarmStats(db: DB, tenantId?: string) {
  const where = tenantId ? eq(scamReports.tenantId, tenantId) : undefined;
  const rows = await db.select({ status: scamReports.status, verdict: scamReports.verdict, n: count() }).from(scamReports).where(where).groupBy(scamReports.status, scamReports.verdict);
  const reviewedScam = rows.filter((r) => r.status === "confirmed_scam").reduce((a, r) => a + r.n, 0);
  const falseAlarms = rows.filter((r) => r.status === "false_alarm").reduce((a, r) => a + r.n, 0);
  const open = rows.filter((r) => r.status === "open").reduce((a, r) => a + r.n, 0);
  return {
    flagged: reviewedScam + falseAlarms + open,
    confirmedScam: reviewedScam,
    falseAlarms,
    awaitingReview: open,
    falseAlarmRate: reviewedScam + falseAlarms ? Math.round((falseAlarms / (reviewedScam + falseAlarms)) * 1000) / 1000 : null,
    byVerdict: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + r.n }), {}),
  };
}

/** Public, anonymous numbers — including the uncomfortable ones. */
export async function transparency(db: DB) {
  const lanes = await db.select({ lane: decisions.lane, n: count() }).from(decisions).where(eq(decisions.simulated, false)).groupBy(decisions.lane);
  const totalDecisions = lanes.reduce((a, r) => a + r.n, 0);
  const statuses = await db.select({ status: cases.status, n: count() }).from(cases).groupBy(cases.status);
  const paid = await db.select({ n: count(), total: sql<number>`coalesce(sum(${payouts.amount}),0)` }).from(payouts).where(eq(payouts.status, "released"));
  const median = await db
    .select({ hours: sql<number>`coalesce(percentile_cont(0.5) within group (order by extract(epoch from (${payouts.releasedAt} - ${cases.createdAt})) / 3600), 0)` })
    .from(payouts)
    .innerJoin(cases, eq(cases.id, payouts.caseId))
    .where(eq(payouts.status, "released"));
  const verified = await db.select({ n: sql<number>`coalesce(sum(${notices.verifyCount}),0)` }).from(notices);
  const [people] = await db.select({ n: count() }).from(citizens);
  const [reports] = await db.select({ n: count() }).from(scamReports);
  const [rt] = await db.select().from(settings).where(eq(settings.key, "redteam_last"));
  return {
    redTeam: (rt?.value as { attacksCaught: { count: number; of: number }; controlsPassed: { count: number; of: number }; ranAt: string } | undefined) ?? null,
    peopleServed: people?.n ?? 0,
    messagesChecked: (reports?.n ?? 0) + Number(verified[0]?.n ?? 0),
    generatedAt: new Date().toISOString(),
    prototype: true,
    decisions: totalDecisions,
    shareSentToHumans: totalDecisions ? Math.round(((lanes.find((l) => l.lane === "human")?.n ?? 0) / totalDecisions) * 1000) / 1000 : null,
    shareAskedForProof: totalDecisions ? Math.round(((lanes.find((l) => l.lane === "ask_proof")?.n ?? 0) / totalDecisions) * 1000) / 1000 : null,
    casesByStatus: Object.fromEntries(statuses.map((s) => [s.status, s.n])),
    paymentsReleased: paid[0]?.n ?? 0,
    amountReleasedPKR: Number(paid[0]?.total ?? 0),
    medianHoursApplicationToPayment: Math.round(Number(median[0]?.hours ?? 0) * 10) / 10,
    scam: await falseAlarmStats(db),
    genuineNoticesVerified: Number(verified[0]?.n ?? 0),
    aiNeverMovesMoney: true,
  };
}

// ─────────────── Scam Map ───────────────

export async function scamMap(db: DB, tenantId: string | null, days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const where = tenantId ? and(eq(scamReports.tenantId, tenantId), gte(scamReports.createdAt, since)) : gte(scamReports.createdAt, since);
  const byDistrict = await db
    .select({ district: scamReports.district, category: scamReports.category, verdict: scamReports.verdict, n: count() })
    .from(scamReports)
    .where(where)
    .groupBy(scamReports.district, scamReports.category, scamReports.verdict);
  const byDay = await db
    .select({ day: sql<string>`to_char(${scamReports.createdAt}, 'YYYY-MM-DD')`, n: count() })
    .from(scamReports)
    .where(where)
    .groupBy(sql`to_char(${scamReports.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`1`);
  const senders = await db
    .select({ sender: scamReports.sender, n: count() })
    .from(scamReports)
    .where(and(where, isNotNull(scamReports.sender)))
    .groupBy(scamReports.sender)
    .orderBy(desc(count()))
    .limit(10);
  const districts = new Map<string, { district: string; total: number; byCategory: Record<string, number> }>();
  for (const r of byDistrict) {
    const key = r.district ?? "unknown";
    const d = districts.get(key) ?? { district: key, total: 0, byCategory: {} };
    d.total += r.n;
    const cat = r.category ?? r.verdict;
    d.byCategory[cat] = (d.byCategory[cat] ?? 0) + r.n;
    districts.set(key, d);
  }
  return { days, districts: [...districts.values()].sort((a, b) => b.total - a.total), timeline: byDay, topSenders: senders, spikes: await scamSpikes(db, tenantId) };
}

export async function scamSpikes(db: DB, tenantId: string | null) {
  const now = Date.now();
  const where = tenantId ? and(eq(scamReports.tenantId, tenantId), gte(scamReports.createdAt, new Date(now - 8 * DAY))) : gte(scamReports.createdAt, new Date(now - 8 * DAY));
  const rows = await db.select({ district: scamReports.district, createdAt: scamReports.createdAt }).from(scamReports).where(where);
  const per = new Map<string, { last24: number; prior7: number }>();
  for (const r of rows) {
    const key = r.district ?? "unknown";
    const p = per.get(key) ?? { last24: 0, prior7: 0 };
    if (r.createdAt.getTime() >= now - DAY) p.last24++;
    else p.prior7++;
    per.set(key, p);
  }
  return [...per.entries()]
    .map(([district, p]) => ({ district, last24h: p.last24, dailyAvgPrior7d: Math.round((p.prior7 / 7) * 10) / 10 }))
    .filter((s) => s.last24h >= 3 && s.last24h > 3 * Math.max(0.5, s.dailyAvgPrior7d));
}

export async function listScamReports(db: DB, tenantId: string, status?: string) {
  const where = status ? and(eq(scamReports.tenantId, tenantId), eq(scamReports.status, status as "open")) : eq(scamReports.tenantId, tenantId);
  return db.select().from(scamReports).where(where).orderBy(desc(scamReports.createdAt)).limit(200);
}

/** Officer confirms a scam or marks a FALSE ALARM — false alarms are counted and shown, never hidden. */
export async function reviewScamReport(db: DB, actor: Actor, id: string, status: "confirmed_scam" | "false_alarm", note?: string) {
  const [r] = await db.select().from(scamReports).where(eq(scamReports.id, id));
  if (!r) throw notFound("Scam report");
  if (actor.type !== "user" || !["officer", "admin"].includes(actor.role) || actor.tenantId !== r.tenantId) throw forbidden("OFFICER_ONLY", "Only an officer of this department can review reports");
  await db.update(scamReports).set({ status, reviewedBy: actor.id, reviewNote: note ?? null }).where(eq(scamReports.id, id));
  await audit(db, { actor, action: status === "false_alarm" ? "scam.false_alarm" : "scam.confirmed", targetType: "scam_report", targetId: id, detail: { note, originalVerdict: r.verdict } });
  if (status === "false_alarm" && r.reporterId) {
    await notifyUser(db, {
      tenantId: r.tenantId,
      userId: r.reporterId,
      citizenId: r.citizenId,
      title: "scam.false_alarm",
      body: { en: "We checked the message you sent: it was genuine. Sorry for the false alarm.", ur: "ہم نے آپ کا بھیجا ہوا پیغام دیکھا: یہ اصلی تھا۔ غلط انتباہ پر معذرت۔" },
    });
  }
  return { id, status };
}

// ─────────────── anomaly detection ───────────────

export async function anomalies(db: DB, tenantId: string) {
  const out: { type: string; severity: "high" | "medium" | "low"; detail: string; refs: string[] }[] = [];
  const sharedAlias = await db
    .select({ alias: citizens.payoutAlias, n: count(), ids: sql<string[]>`array_agg(${citizens.id})` })
    .from(citizens)
    .where(and(eq(citizens.tenantId, tenantId), isNotNull(citizens.payoutAlias)))
    .groupBy(citizens.payoutAlias)
    .having(sql`count(*) > 1`);
  for (const r of sharedAlias) out.push({ type: "shared_payout_account", severity: "high", detail: `${r.n} different beneficiaries share payout account ****${String(r.alias).slice(-3)}`, refs: r.ids });

  const repeated = await db
    .select({ citizenId: cases.citizenId, n: count() })
    .from(cases)
    .where(and(eq(cases.tenantId, tenantId), eq(cases.type, "relief_claim"), gte(cases.createdAt, new Date(Date.now() - 90 * DAY))))
    .groupBy(cases.citizenId)
    .having(sql`count(*) > 2`);
  for (const r of repeated) out.push({ type: "repeated_claims", severity: "medium", detail: `${r.n} relief claims in 90 days by one beneficiary`, refs: [r.citizenId] });

  const reusedDocs = await db
    .select({ sha: documents.sha256, n: sql<number>`count(distinct ${documents.citizenId})`, ids: sql<string[]>`array_agg(distinct ${documents.citizenId})` })
    .from(documents)
    .where(eq(documents.tenantId, tenantId))
    .groupBy(documents.sha256)
    .having(sql`count(distinct ${documents.citizenId}) > 1`);
  for (const r of reusedDocs) out.push({ type: "same_document_many_people", severity: "high", detail: `One document image used by ${r.n} different beneficiaries`, refs: r.ids });

  const helperLoad = await db
    .select({ by: cases.createdBy, n: count() })
    .from(cases)
    .innerJoin(users, eq(users.id, cases.createdBy))
    .where(and(eq(cases.tenantId, tenantId), eq(users.role, "helper"), gte(cases.createdAt, new Date(Date.now() - DAY))))
    .groupBy(cases.createdBy);
  const loads = helperLoad.map((h) => h.n);
  const mean = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
  const sd = loads.length ? Math.sqrt(loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length) : 0;
  for (const h of helperLoad) {
    if (h.n > 15 || (loads.length >= 3 && h.n > mean + 3 * sd)) out.push({ type: "helper_volume_spike", severity: "medium", detail: `Helper filed ${h.n} cases in 24h (avg ${mean.toFixed(1)})`, refs: [h.by] });
  }
  for (const s of await scamSpikes(db, tenantId)) out.push({ type: "scam_spike", severity: "high", detail: `${s.last24h} scam reports in 24h in ${s.district} (prior daily avg ${s.dailyAvgPrior7d})`, refs: [s.district] });

  // Helper rules ─────────────────────────────────────────────
  // Night-time bulk edits: ≥ 10 case/document/consent actions by one helper between 22:00 and 05:00 PKT.
  const nightRows = await db
    .select({ actorId: auditLog.actorId, night: sql<string>`to_char((${auditLog.at} at time zone 'Asia/Karachi') - interval '5 hours', 'YYYY-MM-DD')`, n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, tenantId),
        eq(auditLog.actorRole, "helper"),
        gte(auditLog.at, new Date(Date.now() - 7 * DAY)),
        sql`extract(hour from (${auditLog.at} at time zone 'Asia/Karachi')) not between 5 and 21`,
        sql`(${auditLog.action} like 'case.%' or ${auditLog.action} like 'document.%' or ${auditLog.action} like 'payout_account.%' or ${auditLog.action} like 'consent.%')`,
      ),
    )
    .groupBy(auditLog.actorId, sql`2`)
    .having(sql`count(*) >= 10`);
  for (const r of nightRows) out.push({ type: "helper_night_bulk_edits", severity: "medium", detail: `Helper made ${r.n} changes between 22:00 and 05:00 on ${r.night}`, refs: [r.actorId ?? "unknown"] });

  // Payout account change requested within 30 days AFTER a payment was released → classic diversion pattern.
  const after = await db
    .select({ citizenId: payoutAliasChanges.citizenId, requestedBy: payoutAliasChanges.requestedBy })
    .from(payoutAliasChanges)
    .innerJoin(payouts, and(eq(payouts.citizenId, payoutAliasChanges.citizenId), eq(payouts.status, "released")))
    .where(and(eq(payoutAliasChanges.tenantId, tenantId), sql`${payoutAliasChanges.createdAt} > ${payouts.releasedAt}`, sql`${payoutAliasChanges.createdAt} < ${payouts.releasedAt} + interval '30 days'`));
  for (const r of after) out.push({ type: "payout_change_after_payment", severity: "high", detail: "Payment account change requested within 30 days after a payment", refs: [r.citizenId, r.requestedBy] });

  // "Received less" / "nothing" receipts grouped by the helper who handled the case.
  const shortfalls = await db
    .select({ helperId: sql<string>`${cases.claim}->>'helperId'`, n: count() })
    .from(cases)
    .where(and(eq(cases.tenantId, tenantId), eq(cases.type, "complaint"), sql`${cases.claim}->>'kind' = 'receipt_shortfall'`))
    .groupBy(sql`${cases.claim}->>'helperId'`);
  for (const r of shortfalls) if (r.helperId) out.push({ type: "receipt_shortfall_by_helper", severity: r.n >= 2 ? "high" : "medium", detail: `${r.n} citizen(s) assisted by this helper say they received less than was sent`, refs: [r.helperId] });

  // Near-identical images carrying the same identity across different applicants (S8 in decisions).
  const s8 = await db.select({ caseId: decisions.caseId }).from(decisions).where(and(eq(decisions.tenantId, tenantId), sql`${decisions.hardStops} @> '["DOCUMENT_REUSED"]'::jsonb`));
  if (s8.length) out.push({ type: "reused_images", severity: "high", detail: `${s8.length} decision(s) stopped because an image was reused across applicants`, refs: [...new Set(s8.map((r) => r.caseId))] });
  return out;
}

// ─────────────── drift guard ───────────────

export const DRIFT_LIMITS = { minSamples: 10, maxFastLaneOverrideRate: 0.1 };

export async function driftCheck(db: DB, tenantId: string) {
  const o = await overrideStats(db, tenantId, 14);
  const rs = await activeRuleSet(db, tenantId);
  const tripped = o.fastLaneDecided >= DRIFT_LIMITS.minSamples && (o.fastLaneOverrideRate ?? 0) > DRIFT_LIMITS.maxFastLaneOverrideRate;
  let action: string | null = null;
  if (tripped && rs.definition.fastLaneEnabled) {
    const system: Actor = { type: "system", id: "drift-guard", tenantId, role: "system" };
    const res = await setFastLane(db, system, tenantId, false, `officers overturned ${(o.fastLaneOverrideRate! * 100).toFixed(1)}% of fast-lane cases in 14 days`);
    action = `fast lane disabled (rules v${res.version}); every case now goes to a human until an admin re-enables it`;
  }
  return { tripped, fastLaneEnabled: tripped ? false : rs.definition.fastLaneEnabled, stats: o, limits: DRIFT_LIMITS, action };
}

registerJob("drift.check", async (db, payload) => {
  await driftCheck(db, String(payload.tenantId));
});
export const scheduleDriftCheck = (db: DB, tenantId: string) => enqueueJob(db, "drift.check", { tenantId });

// ─────────────── prove, don't share: attestations ───────────────

export const ATTESTATION_CLAIMS = ["identity_verified", "eligible_under_current_rules", "payment_received"] as const;

export async function issueAttestation(db: DB, actor: Actor, citizenId: string, claim: (typeof ATTESTATION_CLAIMS)[number], audience: string) {
  const citizen = await getCitizenOr404(db, citizenId);
  const isSelf = actor.type === "user" && actor.role === "citizen" && actor.citizenId === citizenId;
  const isStaff = actor.type === "user" && ["officer", "admin"].includes(actor.role) && actor.tenantId === citizen.tenantId;
  if (!isSelf && !isStaff) throw forbidden("CANNOT_ATTEST", "Only the person or their department can request an attestation");
  if (!ATTESTATION_CLAIMS.includes(claim)) throw badRequest("UNKNOWN_CLAIM", `Claims: ${ATTESTATION_CLAIMS.join(", ")}`);
  const [d] = await db.select().from(decisions).where(and(eq(decisions.tenantId, citizen.tenantId), eq(decisions.simulated, false), sql`${decisions.caseId} in (select id from cases where citizen_id = ${citizenId})`)).orderBy(desc(decisions.createdAt)).limit(1);
  let value = false;
  let basis = "no decision on record";
  if (claim === "identity_verified" && d) {
    const verdict = (d.trace as { input?: { identity?: { verdict?: string } } }).input?.identity?.verdict;
    value = verdict === "verified";
    basis = `identity matcher verdict "${verdict}" in decision ${d.id}`;
  } else if (claim === "eligible_under_current_rules" && d) {
    value = d.eligible === true;
    basis = `decision ${d.id} under rules v${d.ruleVersion}`;
  } else if (claim === "payment_received") {
    const [p] = await db.select().from(payouts).where(and(eq(payouts.citizenId, citizenId), eq(payouts.status, "released"))).limit(1);
    value = !!p;
    basis = p ? `payout ${p.id}` : "no released payout";
  }
  const exp = new Date(Date.now() + 7 * DAY);
  // The token carries NO personal data — only an opaque subject id and a yes/no.
  const signed = await signPayload(db, { typ: "attestation", sub: citizenId, claim, value, aud: audience, iat: new Date().toISOString(), exp: exp.toISOString() });
  const id = newId("att");
  await db.insert(attestations).values({ id, tenantId: citizen.tenantId, citizenId, claim, value, audience, token: signed.token, issuedBy: actor.id, expiresAt: exp });
  await audit(db, { actor, action: "attestation.issued", targetType: "citizen", targetId: citizenId, detail: { attestationId: id, claim, value, audience, basis } });
  return { id, claim, value, audience, token: signed.token, expiresAt: exp, sharedData: "none — yes/no only" };
}

export async function verifyAttestation(db: DB, token: string) {
  const v = await verifyToken(db, token);
  if (!v.ok) return { valid: false, reason: v.reason };
  if (v.payload.typ !== "attestation") return { valid: false, reason: "NOT_AN_ATTESTATION" };
  if (new Date(String(v.payload.exp)) < new Date()) return { valid: false, reason: "EXPIRED" };
  return { valid: true, claim: v.payload.claim, value: v.payload.value, audience: v.payload.aud, expiresAt: v.payload.exp };
}

// ─────────────── break-glass ───────────────

export const BREAK_GLASS_MINUTES = 15;

/** Officer full-detail access: reason required, 15-minute window, written to the citizen's access log. */
export async function breakGlass(db: DB, actor: Actor, citizenId: string, reason: string) {
  if (actor.type !== "user" || !["officer", "admin"].includes(actor.role)) throw forbidden("OFFICER_ONLY", "Break-glass is for officers");
  if (reason.trim().length < 10) throw badRequest("REASON_REQUIRED", "Give a specific reason (10+ characters); it is shown to the citizen.");
  const c = await getCitizenOr404(db, citizenId);
  if (c.tenantId !== actor.tenantId) throw notFound("Citizen");
  const expiresAt = new Date(Date.now() + BREAK_GLASS_MINUTES * 60_000);
  const id = newId("brk");
  await db.insert(breakGlassGrants).values({ id, tenantId: c.tenantId, officerId: actor.id, citizenId, reason, expiresAt });
  // targetType "citizen" → appears in the citizen's own "who used my data" log.
  await audit(db, { actor, action: "citizen.break_glass", targetType: "citizen", targetId: citizenId, detail: { reason, grantId: id, expiresAt: expiresAt.toISOString() } });
  return { grantId: id, citizen: presentCitizen(c, "full"), expiresAt, minutes: BREAK_GLASS_MINUTES, notice: "This access is logged and visible to the citizen. Full details stay visible for 15 minutes, then mask again." };
}

export async function auditTrail(db: DB, filter: { tenantId: string; targetId?: string; actorId?: string; action?: string; limit?: number }) {
  const where = [eq(auditLog.tenantId, filter.tenantId)];
  if (filter.targetId) where.push(eq(auditLog.targetId, filter.targetId));
  if (filter.actorId) where.push(eq(auditLog.actorId, filter.actorId));
  if (filter.action) where.push(sql`${auditLog.action} like ${filter.action + "%"}`);
  return db.select().from(auditLog).where(and(...where)).orderBy(desc(auditLog.seq)).limit(Math.min(filter.limit ?? 200, 1000));
}
