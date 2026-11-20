/**
 * Protection at the last metre — where real money is usually lost.
 *
 * 1. Payout-account (Raast alias) change protection:
 *      family PIN → officer approval (not the requester) → 48 h cooling-off → applied.
 *      The OLD number gets an SMS + IVR notice: "if this wasn't you, call and press 9" → frozen.
 *      While a change is pending/cooling/frozen, no payout can be released (S10).
 * 2. Exact-amount receipt: the citizen confirms by voice / IVR / app the amount that arrived.
 *      "Received less" or "nothing" opens a complaint linked to the helper who handled the case.
 * 3. Officer complaint & correction queue (the brief's role table: officers review claims AND complaints).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { payoutAliasChanges, citizens, payouts, payoutReceipts, cases, caseNotes, users, notifications, correctionRequests, scamReports } from "../db/schema";
import { newId } from "../lib/ids";
import { audit } from "../lib/audit";
import type { Actor } from "../lib/actor";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { checkPassword } from "../auth/tokens";
import { rateLimit } from "../http/ratelimit";
import { assertCitizenAccess, type AccessContext } from "./access";
import { enqueueJob, registerJob, emit } from "./events";
import { caseRef } from "./notices";
import { t } from "../lib/i18n";

export const PAYOUT_CHANGE_COOLING_HOURS = 48;
const ALIAS_RE = /^(03\d{9}|PK\d{2}[A-Z]{4}\d{16})$/;

function citizenOf(ctx: AccessContext): string {
  const a = ctx.actor;
  if (a.type === "user" && a.role === "citizen" && a.citizenId) return a.citizenId;
  if (a.type === "user" && a.role === "helper" && ctx.actFor) return ctx.actFor.citizenId;
  throw forbidden("CITIZEN_OR_FAMILY_SESSION", "Only the person, or a helper in their PIN-unlocked family session, can do this.");
}

async function smsTo(db: DB, tenantId: string, citizenId: string, phone: string | null, title: string, body: { en: string; ur: string }, audioKey: string) {
  const id = newId("ntf");
  await db.insert(notifications).values({ id, tenantId, userId: null, citizenId, channel: "sms", title: `${title}${phone ? ` → ${phone.slice(0, 4)}*****${phone.slice(-2)}` : ""}`, body, audioKey, status: "queued" });
  await enqueueJob(db, "notification.send", { notificationId: id });
  const ivr = newId("ntf");
  await db.insert(notifications).values({ id: ivr, tenantId, userId: null, citizenId, channel: "ivr", title, body, audioKey, status: "queued" });
  await enqueueJob(db, "notification.send", { notificationId: ivr });
}

export async function requestPayoutAccountChange(db: DB, ctx: AccessContext, newAlias: string, pin: string) {
  const citizenId = citizenOf(ctx);
  await assertCitizenAccess(db, ctx, citizenId, "case.write", { write: true });
  if (!ALIAS_RE.test(newAlias)) throw badRequest("RAAST_ALIAS_INVALID", "Use a mobile wallet number (03xxxxxxxxx) or a PK IBAN.");
  const rl = rateLimit(`alias-pin:${citizenId}`, 5, 15 * 60_000);
  if (!rl.ok) throw new AppError(429, "PIN_LOCKED", "Too many wrong PINs. Try again in 15 minutes.");
  const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
  if (!c) throw notFound("Citizen");
  if (!c.pinHash || !(await checkPassword(pin, c.pinHash))) {
    await audit(db, { actor: ctx.actor, action: "payout_account.change_requested", targetType: "citizen", targetId: citizenId, outcome: "denied", detail: { reason: "WRONG_PIN" } });
    throw forbidden("WRONG_PIN", `Wrong PIN. ${rl.remaining} attempts left.`);
  }
  if (c.payoutAlias === newAlias) throw conflict("SAME_ACCOUNT", "That is already the payment account.");
  const open = await db.select().from(payoutAliasChanges).where(and(eq(payoutAliasChanges.citizenId, citizenId), inArray(payoutAliasChanges.status, ["pending_officer", "cooling_off"])));
  if (open.length) throw conflict("CHANGE_ALREADY_PENDING", "A change is already being processed.");
  const id = newId("pac");
  await db.insert(payoutAliasChanges).values({ id, tenantId: c.tenantId, citizenId, oldAlias: c.payoutAlias, newAlias, requestedBy: ctx.actor.id, status: "pending_officer" });
  // Tell the OLD number — the person most likely to be robbed — how to stop it.
  await smsTo(db, c.tenantId, citizenId, c.payoutAlias ?? c.phone, "payout_account.change_requested", t("payout.change_requested_old_number"), "payout.change_requested_old_number");
  // Reserved / approved payouts must not go to an account in flux.
  await db.update(payouts).set({ status: "cancelled", cancelledReason: "payout account change requested (S10)" }).where(and(eq(payouts.citizenId, citizenId), inArray(payouts.status, ["reserved"])));
  await audit(db, { actor: ctx.actor, action: "payout_account.change_requested", targetType: "citizen", targetId: citizenId, detail: { changeId: id, newAliasMasked: "****" + newAlias.slice(-3), viaHelper: ctx.actor.type === "user" && ctx.actor.role === "helper" } });
  await emit(db, c.tenantId, "case.escalated", { citizenId, reason: "PAYOUT_ACCOUNT_CHANGE_REQUESTED" });
  return { changeId: id, status: "pending_officer" as const, next: "An officer must approve, then a 48-hour waiting period. Your old number has been told how to stop it.", spoken: t("payout.change_requested") };
}

export async function approvePayoutAccountChange(db: DB, actor: Actor, changeId: string) {
  const [ch] = await db.select().from(payoutAliasChanges).where(eq(payoutAliasChanges.id, changeId));
  if (!ch || actor.tenantId !== ch.tenantId) throw notFound("Change request");
  if (actor.type !== "user" || !["officer", "admin"].includes(actor.role)) throw forbidden("OFFICER_ONLY", "Officers approve account changes");
  if (ch.requestedBy === actor.id) throw forbidden("SEGREGATION_OF_DUTIES", "The person who requested the change cannot approve it.");
  if (ch.status !== "pending_officer") throw conflict("NOT_PENDING", `Change is ${ch.status}`);
  const effectiveAt = new Date(Date.now() + PAYOUT_CHANGE_COOLING_HOURS * 3600_000);
  await db.update(payoutAliasChanges).set({ status: "cooling_off", approvedBy: actor.id, effectiveAt }).where(eq(payoutAliasChanges.id, changeId));
  await enqueueJob(db, "payout_account.apply", { changeId }, effectiveAt);
  await audit(db, { actor, action: "payout_account.change_approved", targetType: "citizen", targetId: ch.citizenId, detail: { changeId, effectiveAt: effectiveAt.toISOString() } });
  return { changeId, status: "cooling_off" as const, effectiveAt };
}

export async function rejectPayoutAccountChange(db: DB, actor: Actor, changeId: string, reason: string) {
  const [ch] = await db.select().from(payoutAliasChanges).where(eq(payoutAliasChanges.id, changeId));
  if (!ch || actor.tenantId !== ch.tenantId) throw notFound("Change request");
  if (actor.type !== "user" || !["officer", "admin"].includes(actor.role)) throw forbidden("OFFICER_ONLY", "Officers decide account changes");
  if (!["pending_officer", "cooling_off", "frozen"].includes(ch.status)) throw conflict("NOT_OPEN", `Change is ${ch.status}`);
  await db.update(payoutAliasChanges).set({ status: "rejected" }).where(eq(payoutAliasChanges.id, changeId));
  await audit(db, { actor, action: "payout_account.change_rejected", targetType: "citizen", targetId: ch.citizenId, detail: { changeId, reason } });
  return { changeId, status: "rejected" as const };
}

/** "Press 9" (IVR from the old number), the app, or an officer: stop a change immediately. */
export async function freezePayoutAccountChange(db: DB, actor: Actor, args: { changeId?: string; citizenId?: string; via: "ivr" | "app" | "officer" }) {
  let ch: typeof payoutAliasChanges.$inferSelect | undefined;
  if (args.changeId) [ch] = await db.select().from(payoutAliasChanges).where(eq(payoutAliasChanges.id, args.changeId));
  else if (args.citizenId)
    [ch] = await db
      .select()
      .from(payoutAliasChanges)
      .where(and(eq(payoutAliasChanges.citizenId, args.citizenId), inArray(payoutAliasChanges.status, ["pending_officer", "cooling_off"])))
      .orderBy(desc(payoutAliasChanges.createdAt))
      .limit(1);
  if (!ch) throw notFound("Pending account change");
  if (args.via === "app" && !(actor.type === "user" && actor.role === "citizen" && actor.citizenId === ch.citizenId)) throw notFound("Pending account change");
  if (args.via === "officer" && !(actor.type === "user" && ["officer", "admin"].includes(actor.role) && actor.tenantId === ch.tenantId)) throw notFound("Pending account change");
  if (!["pending_officer", "cooling_off"].includes(ch.status)) throw conflict("NOT_OPEN", `Change is ${ch.status}`);
  await db.update(payoutAliasChanges).set({ status: "frozen", frozenAt: new Date(), frozenVia: args.via }).where(eq(payoutAliasChanges.id, ch.id));
  const [latest] = await db.select().from(cases).where(eq(cases.citizenId, ch.citizenId)).orderBy(desc(cases.createdAt)).limit(1);
  if (latest) {
    await db.update(cases).set({ lane: "human", priority: 95, status: ["paid", "closed", "rejected"].includes(latest.status) ? latest.status : "in_review", updatedAt: new Date() }).where(eq(cases.id, latest.id));
    await db.insert(caseNotes).values({ id: newId("nte"), caseId: latest.id, authorType: "system", authorId: "account-guard", kind: "handoff", body: `Payment-account change FROZEN via ${args.via}. Possible account-takeover attempt by ${ch.requestedBy}. Call the person on their OLD number.`, data: { changeId: ch.id } });
  }
  await audit(db, { actor, action: "payout_account.change_frozen", targetType: "citizen", targetId: ch.citizenId, detail: { changeId: ch.id, via: args.via, requestedBy: ch.requestedBy } });
  return { changeId: ch.id, status: "frozen" as const, spoken: t("payout.change_frozen") };
}

registerJob("payout_account.apply", async (db, payload) => {
  const [ch] = await db.select().from(payoutAliasChanges).where(eq(payoutAliasChanges.id, String(payload.changeId)));
  if (!ch || ch.status !== "cooling_off" || !ch.effectiveAt || ch.effectiveAt > new Date()) return;
  await db.update(citizens).set({ payoutAlias: ch.newAlias }).where(eq(citizens.id, ch.citizenId));
  await db.update(payoutAliasChanges).set({ status: "applied" }).where(eq(payoutAliasChanges.id, ch.id));
  const system: Actor = { type: "system", id: "account-guard", tenantId: ch.tenantId, role: "system" };
  await audit(db, { actor: system, action: "payout_account.change_applied", targetType: "citizen", targetId: ch.citizenId, detail: { changeId: ch.id } });
  await smsTo(db, ch.tenantId, ch.citizenId, ch.oldAlias, "payout_account.change_applied", t("payout.change_applied"), "payout.change_applied");
});

export async function listPayoutAccountChanges(db: DB, actor: Actor, citizenId?: string) {
  if (actor.type === "user" && actor.role === "citizen") return db.select().from(payoutAliasChanges).where(eq(payoutAliasChanges.citizenId, actor.citizenId!)).orderBy(desc(payoutAliasChanges.createdAt));
  if (!actor.tenantId) throw forbidden("NO_TENANT", "No department");
  const where = citizenId ? and(eq(payoutAliasChanges.tenantId, actor.tenantId), eq(payoutAliasChanges.citizenId, citizenId)) : eq(payoutAliasChanges.tenantId, actor.tenantId);
  return db.select().from(payoutAliasChanges).where(where).orderBy(desc(payoutAliasChanges.createdAt)).limit(200);
}

// ─────────────── exact-amount receipt ───────────────

export async function confirmReceipt(db: DB, ctx: AccessContext | null, payoutId: string, args: { status: "received_full" | "received_less" | "not_received"; amount?: number; via: "voice" | "ivr" | "app" | "helper"; statement?: string; ivrCitizenId?: string }) {
  const [p] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p) throw notFound("Payout");
  let actor: Actor;
  if (ctx) {
    const cid = citizenOf(ctx);
    if (cid !== p.citizenId) throw notFound("Payout");
    actor = ctx.actor;
  } else {
    if (args.ivrCitizenId !== p.citizenId) throw notFound("Payout");
    actor = { type: "system", id: "ivr", tenantId: p.tenantId, role: "system" };
  }
  if (p.status !== "released") throw conflict("NOT_RELEASED", "This payment has not been sent yet.");
  const confirmed = args.status === "received_full" ? p.amount : args.status === "not_received" ? 0 : (args.amount ?? null);
  if (args.status === "received_less" && (confirmed === null || confirmed >= p.amount)) throw badRequest("AMOUNT_REQUIRED", `Say how much arrived (less than Rs ${p.amount}).`);
  let complaintCaseId: string | null = null;
  if (args.status !== "received_full") {
    const [orig] = await db.select().from(cases).where(eq(cases.id, p.caseId));
    const [creator] = orig ? await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, orig.createdBy)) : [];
    const helperId = creator?.role === "helper" ? creator.id : null;
    complaintCaseId = newId("case");
    await db.insert(cases).values({
      id: complaintCaseId,
      tenantId: p.tenantId,
      citizenId: p.citizenId,
      type: "complaint",
      status: "in_review",
      lane: "human",
      priority: 90,
      claim: { kind: "receipt_shortfall", payoutId, expected: p.amount, confirmed, helperId, statement: args.statement ?? null, raastRef: p.raastRef },
      createdBy: actor.id,
      createdVia: args.via,
      parentCaseId: p.caseId,
    });
    await db.insert(caseNotes).values({ id: newId("nte"), caseId: complaintCaseId, authorType: "system", authorId: "receipt", kind: "handoff", body: `Citizen says ${args.status === "not_received" ? "NOTHING arrived" : `only Rs ${confirmed} arrived`} for payout ${payoutId} (sent Rs ${p.amount}, Raast ref ${p.raastRef}).${helperId ? ` The case was handled by helper ${helperId}.` : ""}`, data: { helperId } });
    await emit(db, p.tenantId, "case.created", { caseId: complaintCaseId, kind: "receipt_shortfall" });
  }
  const id = newId("rcp");
  await db.insert(payoutReceipts).values({ id, tenantId: p.tenantId, payoutId, citizenId: p.citizenId, expectedAmount: p.amount, confirmedAmount: confirmed, status: args.status, via: args.via, complaintCaseId });
  await audit(db, { actor, action: "payout.receipt_confirmed", targetType: "payout", targetId: payoutId, outcome: args.status === "received_full" ? "ok" : "error", detail: { status: args.status, expected: p.amount, confirmed, complaintCaseId } });
  return {
    receiptId: id,
    status: args.status,
    expected: p.amount,
    confirmed,
    complaintCaseId,
    complaintRef: complaintCaseId ? caseRef(complaintCaseId) : null,
    spoken: args.status === "received_full" ? t("receipt.thanks") : t("receipt.complaint_opened"),
  };
}

/** The prompt the IVR / voice app reads out: "Did you receive exactly Rs X?" */
export async function receiptPrompt(db: DB, payoutId: string) {
  const [p] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p) throw notFound("Payout");
  return { payoutId, amount: p.amount, spoken: t("receipt.ask", { amount: p.amount }) };
}

// ─────────────── officer complaint & correction queue ───────────────

export async function complaintQueue(db: DB, actor: Actor) {
  if (actor.type !== "user" || !["officer", "admin", "auditor"].includes(actor.role)) throw forbidden("STAFF_ONLY", "Staff only");
  const tenantId = actor.tenantId;
  const complaints = await db.select().from(cases).where(and(eq(cases.tenantId, tenantId), inArray(cases.type, ["complaint", "appeal"]), inArray(cases.status, ["submitted", "in_review"]))).orderBy(desc(cases.priority), desc(cases.createdAt));
  const corrections = await db.select().from(correctionRequests).where(and(eq(correctionRequests.tenantId, tenantId), eq(correctionRequests.status, "open")));
  const accountChanges = await db.select().from(payoutAliasChanges).where(and(eq(payoutAliasChanges.tenantId, tenantId), inArray(payoutAliasChanges.status, ["pending_officer", "frozen"])));
  const scam = await db.select({ id: scamReports.id, verdict: scamReports.verdict, district: scamReports.district, createdAt: scamReports.createdAt }).from(scamReports).where(and(eq(scamReports.tenantId, tenantId), eq(scamReports.status, "open"))).limit(100);
  return {
    complaints: complaints.map((c) => ({ id: c.id, ref: caseRef(c.id), type: c.type, priority: c.priority, kind: (c.claim as { kind?: string }).kind ?? c.type, parentCaseId: c.parentCaseId, createdAt: c.createdAt })),
    corrections,
    payoutAccountChanges: accountChanges.map((a) => ({ ...a, newAlias: "****" + a.newAlias.slice(-3), oldAlias: a.oldAlias ? "****" + a.oldAlias.slice(-3) : null })),
    scamReportsToReview: scam,
    counts: { complaints: complaints.length, corrections: corrections.length, payoutAccountChanges: accountChanges.length, scamReports: scam.length },
  };
}
