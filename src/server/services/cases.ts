/**
 * Case lifecycle: create → documents → submit → decision (AI, three lanes) → officer → payout → signed notice.
 * Appeals open a linked case that must be decided by a different officer.
 */
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  cases,
  citizens,
  documents,
  decisions,
  caseNotes,
  payouts,
  notices,
  consents,
  users,
  auditLog,
  payoutAliasChanges,
  type CaseStatus,
} from "../db/schema";
import { newId } from "../lib/ids";
import { audit } from "../lib/audit";
import { AI_ACTOR, type Actor } from "../lib/actor";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { canonicalJson, sha256Hex } from "../lib/crypto";
import { t, STATUS_WORDS } from "../lib/i18n";
import { assertCitizenAccess, presentCitizen, activeConsentFor, type AccessContext } from "./access";
import { nadraLookup, incomeLookup, raastTransfer } from "./mockdpi";
import { activeRuleSet } from "./rules";
import { issueNotice, notifyUser, caseRef } from "./notices";
import { emit, enqueueJob, registerJob } from "./events";
import { grantConsent } from "./consent";
import { checkDocument, dhash } from "../domain/documents";
import { runDecision } from "./decisionPipeline";
import { readDocumentImage, type AiMeta } from "../ai/claude";
import { caseSignals, urgencyAndKind } from "../ai/signals";
import { matchIdentity, findDuplicateCandidates, normalizeCnic, normalizeName } from "../domain/names";
import { decide, type DecisionInput, type DocumentEvidence } from "../domain/decision";
import type { Facts } from "../domain/rules";

export const MAX_DOC_BYTES = 6 * 1024 * 1024;
const DEPT_SCOPES = ["identity.read", "income.read", "documents.read", "case.read"] as const;

type ClaimInput = {
  fullName?: string | null;
  fatherName?: string | null;
  cnic?: string | null;
  dob?: string | null;
  maritalStatus?: string | null;
  householdSize?: number | null;
  monthlyIncome?: number | null;
  district?: string | null;
  phone?: string | null;
  payoutAlias?: string | null;
  statement?: string | null; // free text / transcript
};

async function getCaseOr404(db: DB, caseId: string) {
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) throw notFound("Case");
  return c;
}

/** Resolve which citizen a create/update request is for, enforcing who may act for whom. */
function targetCitizen(ctx: AccessContext, requested?: string | null): string {
  const a = ctx.actor;
  if (a.type === "user" && a.role === "citizen") {
    if (!a.citizenId) throw forbidden("NO_CITIZEN_PROFILE", "Your account has no citizen profile.");
    return a.citizenId;
  }
  if (a.type === "user" && a.role === "helper") {
    if (!ctx.actFor) throw forbidden("FAMILY_SESSION_REQUIRED", "Switch to the family with their PIN first.");
    if (requested && requested !== ctx.actFor.citizenId) throw forbidden("WRONG_FAMILY", "This session is for a different family.");
    return ctx.actFor.citizenId;
  }
  if (!requested) throw badRequest("CITIZEN_REQUIRED", "citizenId is required");
  return requested;
}

export async function createCase(
  db: DB,
  ctx: AccessContext,
  input: { citizenId?: string | null; type?: "relief_claim" | "complaint" | "appeal"; claim?: ClaimInput; amountRequested?: number | null; clientRef?: string | null; createdVia?: string; parentCaseId?: string | null },
) {
  const citizenId = targetCitizen(ctx, input.citizenId);
  await assertCitizenAccess(db, ctx, citizenId, "case.write", { write: true });
  const actor = ctx.actor;
  if (input.clientRef) {
    const [existing] = await db.select().from(cases).where(and(eq(cases.createdBy, actor.id), eq(cases.clientRef, input.clientRef)));
    if (existing) return { case: existing, replayed: true };
  }
  const [citizen] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
  const id = newId("case");
  const claim = Object.fromEntries(Object.entries(input.claim ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  if (claim.cnic) claim.cnic = normalizeCnic(String(claim.cnic)) ?? claim.cnic;
  const [row] = await db
    .insert(cases)
    .values({
      id,
      tenantId: citizen!.tenantId,
      citizenId,
      type: input.type ?? "relief_claim",
      status: "draft",
      claim,
      amountRequested: input.amountRequested ?? null,
      createdBy: actor.id,
      createdVia: input.createdVia ?? (actor.type === "user" && actor.role === "helper" ? "helper" : "web"),
      clientRef: input.clientRef ?? null,
      parentCaseId: input.parentCaseId ?? null,
    })
    .returning();
  // Fill gaps in the citizen profile from the claim (never overwrite existing values silently).
  const patch: Record<string, unknown> = {};
  for (const [k, col] of [["fatherName", "fatherName"], ["cnic", "cnic"], ["dob", "dob"], ["district", "district"], ["phone", "phone"], ["payoutAlias", "payoutAlias"]] as const) {
    if (claim[k] && !(citizen as Record<string, unknown>)[col]) patch[col] = claim[k];
  }
  if (Object.keys(patch).length) await db.update(citizens).set(patch).where(eq(citizens.id, citizenId));
  await audit(db, { actor, action: "case.created", targetType: "case", targetId: id, detail: { citizenId, via: row!.createdVia, clientRef: input.clientRef }, tenantId: row!.tenantId, requestId: ctx.requestId });
  await emit(db, row!.tenantId, "case.created", { caseId: id, citizenId });
  return { case: row!, replayed: false };
}

export async function updateClaim(db: DB, ctx: AccessContext, caseId: string, claim: ClaimInput) {
  const c = await getCaseOr404(db, caseId);
  await assertCitizenAccess(db, ctx, c.citizenId, "case.write", { write: true });
  if (!["draft", "needs_proof"].includes(c.status)) throw conflict("CASE_LOCKED", `Case is ${c.status}; claim can no longer be edited.`);
  const merged = { ...c.claim, ...Object.fromEntries(Object.entries(claim).filter(([, v]) => v !== undefined)) };
  if (merged.cnic) merged.cnic = normalizeCnic(String(merged.cnic)) ?? merged.cnic;
  await db.update(cases).set({ claim: merged, updatedAt: new Date() }).where(eq(cases.id, caseId));
  await audit(db, { actor: ctx.actor, action: "case.claim_updated", targetType: "case", targetId: caseId, detail: { fields: Object.keys(claim) }, tenantId: c.tenantId, requestId: ctx.requestId });
  return { ...c, claim: merged };
}

export async function addDocument(db: DB, ctx: AccessContext, caseId: string, input: { kind: "cnic" | "income_proof" | "other"; mime: string; contentBase64: string }) {
  const c = await getCaseOr404(db, caseId);
  await assertCitizenAccess(db, ctx, c.citizenId, "case.write", { write: true });
  if (["approved", "paid", "closed", "rejected"].includes(c.status)) throw conflict("CASE_LOCKED", `Case is ${c.status}`);
  const buf = Buffer.from(input.contentBase64, "base64");
  if (!buf.length) throw badRequest("EMPTY_FILE", "File is empty");
  if (buf.length > MAX_DOC_BYTES) throw badRequest("FILE_TOO_LARGE", `Max ${MAX_DOC_BYTES / 1024 / 1024} MB`);
  const sha = sha256Hex(buf);
  const reading = await readDocumentImage(input.contentBase64, input.mime).catch((e: Error) => ({ data: null, meta: { provider: "heuristic", model: "none", promptVersion: "none", latencyMs: 0, note: `vision error: ${e.message}` } as AiMeta }));
  const check = await checkDocument(db, buf, input.mime, c.claim as ClaimInput, reading.data);
  // Same photo already used by a different applicant → strong fraud signal.
  const reused = await db.select({ citizenId: documents.citizenId }).from(documents).where(and(eq(documents.sha256, sha), ne(documents.citizenId, c.citizenId))).limit(1);
  const checks = {
    ...check,
    reusedByAnotherApplicant: reused.length > 0,
    tamperScore: reused.length ? Math.max(check.tamperScore, 0.7) : check.tamperScore,
    tamperReasons: reused.length ? [...check.tamperReasons, "The same image was uploaded for a different applicant"] : check.tamperReasons,
    visionMeta: reading.meta,
  };
  const id = newId("doc");
  await db.insert(documents).values({
    id,
    tenantId: c.tenantId,
    caseId,
    citizenId: c.citizenId,
    kind: input.kind,
    mime: input.mime,
    sizeBytes: buf.length,
    sha256: sha,
    dhash: /^image\//.test(input.mime) ? await dhash(buf) : null,
    contentBase64: input.contentBase64,
    extracted: check.extracted,
    checks: checks as unknown as Record<string, unknown>,
    uploadedBy: ctx.actor.id,
  });
  await audit(db, { actor: ctx.actor, action: "document.uploaded", targetType: "case", targetId: caseId, detail: { documentId: id, kind: input.kind, sha256: sha, sizeBytes: buf.length }, tenantId: c.tenantId, requestId: ctx.requestId });
  // Incomplete records: a VERIFIED signed QR may fill gaps (never overwrite) in the citizen profile.
  if (check.qr.valid && !checks.reusedByAnotherApplicant) {
    const [cz] = await db.select().from(citizens).where(eq(citizens.id, c.citizenId));
    const fill: Record<string, string> = {};
    if (cz && !cz.cnic && check.extracted.cnic) fill.cnic = check.extracted.cnic;
    if (cz && !cz.dob && check.extracted.dob) fill.dob = check.extracted.dob;
    if (cz && !cz.fatherName && check.extracted.fatherName) fill.fatherName = check.extracted.fatherName;
    if (Object.keys(fill).length) {
      await db.update(citizens).set(fill).where(eq(citizens.id, c.citizenId));
      await audit(db, { actor: AI_ACTOR(c.tenantId), action: "citizen.gaps_filled_from_signed_document", targetType: "citizen", targetId: c.citizenId, detail: { fields: Object.keys(fill), documentId: id }, tenantId: c.tenantId });
    }
  }
  await audit(db, {
    actor: AI_ACTOR(c.tenantId),
    action: "document.checked",
    targetType: "document",
    targetId: id,
    detail: { readable: check.readable, blurry: check.blurry, qr: { found: check.qr.found, valid: check.qr.valid }, tamperScore: checks.tamperScore, tamperReasons: checks.tamperReasons, notChecked: check.notChecked, vision: reading.meta },
    tenantId: c.tenantId,
  });
  const retake = check.blurry ? t("proof.retake_photo") : null;
  return {
    id,
    kind: input.kind,
    readable: check.readable,
    blurry: check.blurry,
    qr: { found: check.qr.found, valid: check.qr.valid },
    tamperScore: checks.tamperScore,
    tamperReasons: checks.tamperReasons,
    extracted: check.extracted,
    notChecked: check.notChecked,
    retakePrompt: retake,
  };
}

/** Submit: ensures the department has consent (receipt read aloud), sends a signed "received" notice, decides. */
export async function submitCase(db: DB, ctx: AccessContext, caseId: string) {
  const c = await getCaseOr404(db, caseId);
  await assertCitizenAccess(db, ctx, c.citizenId, "case.write", { write: true });
  if (!["draft", "needs_proof"].includes(c.status)) throw conflict("ALREADY_SUBMITTED", `Case is already ${c.status}`);
  let consentReceipt = null;
  const has = await activeConsentFor(db, c.citizenId, { type: "department", id: c.tenantId }, "identity.read");
  if (!has) {
    consentReceipt = await grantConsent(db, ctx.actor, {
      citizenId: c.citizenId,
      granteeType: "department",
      granteeId: c.tenantId,
      scopes: [...DEPT_SCOPES],
      purpose: "relief_case",
      expiresInDays: 365,
      grantedVia: ctx.actor.type === "user" && ctx.actor.role === "helper" ? "pin" : "web",
      actFor: ctx.actFor ? { citizenId: ctx.actFor.citizenId } : undefined,
    });
  }
  const wasNeedsProof = c.status === "needs_proof";
  await db.update(cases).set({ status: "submitted", updatedAt: new Date() }).where(eq(cases.id, caseId));
  await audit(db, { actor: ctx.actor, action: wasNeedsProof ? "case.resubmitted" : "case.submitted", targetType: "case", targetId: caseId, tenantId: c.tenantId, requestId: ctx.requestId });
  await emit(db, c.tenantId, "case.submitted", { caseId });
  const notice = wasNeedsProof ? null : await issueNotice(db, { tenantId: c.tenantId, caseId, citizenId: c.citizenId, type: "case_received" });
  const decision = await runDecision(db, caseId, { trigger: wasNeedsProof ? "proof_supplied" : "submitted", requestId: ctx.requestId });
  return { caseId, consentReceipt, notice: notice ? { code: notice.code, spokenCode: notice.spokenCode, message: notice.message } : null, decision };
}

export { runDecision } from "./decisionPipeline";

// ─────────────────────────── officer actions ───────────────────────────

function assertOfficer(actor: Actor, tenantId: string) {
  if (actor.type === "ai" || actor.type === "agent") throw forbidden("AI_CANNOT_DECIDE", "Only a human officer can take this action.");
  if (actor.type !== "user" || !["officer", "admin"].includes(actor.role)) throw forbidden("OFFICER_ONLY", "Only an officer can take this action.");
  if (actor.tenantId !== tenantId) throw forbidden("CROSS_TENANT", "Case belongs to another department.");
}

export async function addNote(db: DB, actor: Actor, caseId: string, body: string) {
  const c = await getCaseOr404(db, caseId);
  assertOfficer(actor, c.tenantId);
  const id = newId("nte");
  await db.insert(caseNotes).values({ id, caseId, authorType: "user", authorId: actor.id, kind: "note", body });
  await audit(db, { actor, action: "case.note_added", targetType: "case", targetId: caseId, tenantId: c.tenantId });
  return { id };
}

export async function assignCase(db: DB, actor: Actor, caseId: string, officerId: string | null) {
  const c = await getCaseOr404(db, caseId);
  assertOfficer(actor, c.tenantId);
  if (officerId) {
    const [o] = await db.select().from(users).where(eq(users.id, officerId));
    if (!o || o.tenantId !== c.tenantId || !["officer", "admin"].includes(o.role)) throw badRequest("INVALID_ASSIGNEE", "Assignee must be an officer in this department");
  }
  await db.update(cases).set({ assignedTo: officerId, updatedAt: new Date() }).where(eq(cases.id, caseId));
  await audit(db, { actor, action: "case.assigned", targetType: "case", targetId: caseId, detail: { officerId }, tenantId: c.tenantId });
  return { caseId, assignedTo: officerId };
}

export async function escalateCase(db: DB, actor: Actor, caseId: string, reason: string) {
  const c = await getCaseOr404(db, caseId);
  if (actor.type === "user" && actor.role === "citizen" && actor.citizenId !== c.citizenId) throw forbidden("NOT_YOUR_CASE", "Not your case");
  await db.update(cases).set({ lane: "human", status: ["draft", "closed", "paid"].includes(c.status) ? c.status : "in_review", priority: Math.min(100, c.priority + 25), updatedAt: new Date() }).where(eq(cases.id, caseId));
  await db.insert(caseNotes).values({ id: newId("nte"), caseId, authorType: actor.type === "user" ? "user" : "system", authorId: actor.id, kind: "handoff", body: `Escalated: ${reason}` });
  await audit(db, { actor, action: "case.escalated", targetType: "case", targetId: caseId, detail: { reason }, tenantId: c.tenantId });
  await emit(db, c.tenantId, "case.escalated", { caseId, reason });
  return { caseId, lane: "human" as const, spoken: t("handoff.created") };
}

export async function requestProof(db: DB, actor: Actor, caseId: string, items: string[], note?: string) {
  const c = await getCaseOr404(db, caseId);
  assertOfficer(actor, c.tenantId);
  const rs = await activeRuleSet(db, c.tenantId);
  const deadline = new Date(Date.now() + rs.definition.thresholds.proofDeadlineHours * 3600_000);
  await db.update(cases).set({ status: "needs_proof", lane: "ask_proof", proofRequested: items, proofDeadline: deadline, updatedAt: new Date() }).where(eq(cases.id, caseId));
  await db.insert(caseNotes).values({ id: newId("nte"), caseId, authorType: "user", authorId: actor.id, kind: "proof_request", body: `Officer requested: ${items.join(", ")}${note ? ` — ${note}` : ""}` });
  await enqueueJob(db, "case.proof_deadline", { caseId }, deadline);
  const notice = await issueNotice(db, { tenantId: c.tenantId, caseId, citizenId: c.citizenId, type: "proof_requested" });
  await audit(db, { actor, action: "case.proof_requested", targetType: "case", targetId: caseId, detail: { items }, tenantId: c.tenantId });
  return { caseId, status: "needs_proof" as const, deadline, code: notice.code };
}

async function latestDecision(db: DB, caseId: string) {
  const [d] = await db.select().from(decisions).where(and(eq(decisions.caseId, caseId), eq(decisions.simulated, false))).orderBy(desc(decisions.createdAt)).limit(1);
  return d ?? null;
}

/**
 * Officer approves the CLAIM. Creates (or, for a provisionally approved case, joins) the payout.
 * Money moves only when the approval count is met, the cooling-off window (if any) is over, and
 * no payout-account change is pending.
 */
export async function approveCase(db: DB, actor: Actor, caseId: string, args: { amount?: number; note?: string }) {
  const c = await getCaseOr404(db, caseId);
  assertOfficer(actor, c.tenantId);
  const [existing] = await db.select().from(payouts).where(eq(payouts.caseId, caseId));
  const provisional = !!existing && ["reserved", "pending_approval"].includes(existing.status) && existing.provisional;
  if (!provisional && !["in_review", "submitted"].includes(c.status)) throw conflict("NOT_REVIEWABLE", `Case is ${c.status}`);
  const d = await latestDecision(db, caseId);
  if (!d) throw conflict("NO_DECISION", "Run a decision first");
  if (c.type === "appeal" && c.parentCaseId) {
    const [rejectedBy] = await db.select().from(auditLog).where(and(eq(auditLog.targetId, c.parentCaseId), eq(auditLog.action, "case.rejected"))).limit(1);
    if (rejectedBy?.actorId === actor.id) throw forbidden("APPEAL_NEEDS_DIFFERENT_OFFICER", "An appeal must be decided by a different officer than the one who rejected the original case.");
  }
  const [citizen] = await db.select().from(citizens).where(eq(citizens.id, c.citizenId));
  if (!citizen?.payoutAlias) throw unprocessablePayout();
  if (provisional && existing) {
    // Join the provisional reservation made by the auto lane: add this officer's approval.
    if (existing.approvals.some((ap) => ap.userId === actor.id)) throw forbidden("SAME_APPROVER", "You have already approved this payout.");
    const approvals = [...existing.approvals, { userId: actor.id, at: new Date().toISOString() }];
    const coolingOver = !existing.coolingOffUntil || existing.coolingOffUntil <= new Date();
    const status = approvals.length >= existing.requiredApprovals && coolingOver ? "approved" : existing.status;
    await db.update(payouts).set({ approvals, status, alias: citizen.payoutAlias }).where(eq(payouts.id, existing.id));
    await audit(db, { actor, action: "case.approved", targetType: "case", targetId: caseId, detail: { payoutId: existing.id, provisional: true, approvals: approvals.length, required: existing.requiredApprovals, coolingOffUntil: existing.coolingOffUntil } });
    const release = status === "approved" ? await releasePayout(db, actor, existing.id) : null;
    const until = existing.coolingOffUntil ? existing.coolingOffUntil.toISOString() : "";
    return { caseId, payoutId: existing.id, amount: existing.amount, requiredApprovals: existing.requiredApprovals, approvals: approvals.length, released: !!release, release, waitingFor: release ? null : !coolingOver ? `cooling-off until ${until}` : "second approver" };
  }
  const rs = await activeRuleSet(db, c.tenantId);
  const benefit = (d.trace as { output?: { benefitAmount?: number } }).output?.benefitAmount ?? rs.definition.program.benefit.base;
  const amount = args.amount ?? benefit;
  if (amount <= 0 || amount > rs.definition.program.benefit.max) throw badRequest("INVALID_AMOUNT", `Amount must be between 1 and ${rs.definition.program.benefit.max}`);
  const required = amount > rs.definition.thresholds.secondApproverAbovePKR ? 2 : 1;
  const payoutId = existing?.id ?? newId("pay");
  const values = {
    tenantId: c.tenantId,
    caseId,
    citizenId: c.citizenId,
    amount,
    alias: citizen.payoutAlias,
    requiredApprovals: required,
    approvals: [{ userId: actor.id, at: new Date().toISOString() }],
    status: (required === 1 ? "approved" : "pending_approval") as "approved" | "pending_approval",
    provisional: false,
    coolingOffUntil: null,
    cancelledReason: null,
    createdBy: actor.id,
  };
  if (existing) {
    if (existing.status === "released") throw conflict("ALREADY_PAID", "This case is already paid");
    await db.update(payouts).set(values).where(eq(payouts.id, payoutId));
  } else await db.insert(payouts).values({ id: payoutId, ...values });
  await db.update(cases).set({ status: "approved", updatedAt: new Date() }).where(eq(cases.id, caseId));
  if (args.note) await db.insert(caseNotes).values({ id: newId("nte"), caseId, authorType: "user", authorId: actor.id, kind: "note", body: args.note });
  await audit(db, { actor, action: "case.approved", targetType: "case", targetId: caseId, detail: { payoutId, amount, requiredApprovals: required, decisionId: d.id, aiLane: d.lane, overrideOfAi: d.lane === "human" ? "human-lane case approved by officer" : null }, tenantId: c.tenantId });
  await emit(db, c.tenantId, "case.approved", { caseId, payoutId, amount });
  let release = null;
  if (required === 1) release = await releasePayout(db, actor, payoutId);
  return { caseId, payoutId, amount, requiredApprovals: required, approvals: 1, released: !!release, release };
}

function unprocessablePayout() {
  return new AppError(422, "PAYOUT_ALIAS_MISSING", "The citizen has no payout alias (mobile account). Ask them to add one first.");
}

export async function addPayoutApproval(db: DB, actor: Actor, payoutId: string) {
  const [p] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p) throw notFound("Payout");
  assertOfficer(actor, p.tenantId);
  if (!["pending_approval", "reserved"].includes(p.status)) throw conflict("NOT_PENDING", `Payout is ${p.status}`);
  if (p.approvals.some((a) => a.userId === actor.id)) throw forbidden("SAME_APPROVER", "The second approval must come from a different officer.");
  if (p.approvals.length >= 1 && actor.type === "user" && !actor.canSecondApprove) throw forbidden("NOT_SECOND_APPROVER", "Your account is not allowed to give second approvals.");
  const approvals = [...p.approvals, { userId: actor.id, at: new Date().toISOString() }];
  const coolingOver = !p.coolingOffUntil || p.coolingOffUntil <= new Date();
  const status = approvals.length >= p.requiredApprovals && coolingOver ? "approved" : p.status;
  await db.update(payouts).set({ approvals, status }).where(eq(payouts.id, payoutId));
  await audit(db, { actor, action: "payout.approved", targetType: "payout", targetId: payoutId, detail: { approvals: approvals.length, required: p.requiredApprovals, coolingOver }, tenantId: p.tenantId });
  if (status === "approved") return { payoutId, status: "released" as const, release: await releasePayout(db, actor, payoutId) };
  const until = p.coolingOffUntil ? p.coolingOffUntil.toISOString() : "";
  return { payoutId, status, release: null, waitingFor: !coolingOver ? `cooling-off until ${until}` : "more approvals" };
}

/** Moves (mock) money. Humans only — any AI/agent attempt is refused and logged. */
export async function releasePayout(db: DB, actor: Actor, payoutId: string) {
  // Guardrail first: no AI, agent, API key or citizen can move money — checked before anything else.
  if (actor.type !== "user" || !["officer", "admin"].includes(actor.role)) {
    await audit(db, { actor, action: "payout.release", targetType: "payout", targetId: payoutId, outcome: "denied", detail: { code: "AI_CANNOT_INITIATE_PAYMENT" }, tenantId: actor.tenantId });
    throw forbidden("AI_CANNOT_INITIATE_PAYMENT", "Only a human officer can release money. This attempt has been logged.");
  }
  const [p] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p || p.tenantId !== actor.tenantId) throw notFound("Payout");
  if (p.status === "released") return { payoutId, raastRef: p.raastRef, alreadyReleased: true };
  if (p.coolingOffUntil && p.coolingOffUntil > new Date()) throw conflict("PAYOUT_IN_COOLING_OFF", `Provisional approval: money stays reserved until ${p.coolingOffUntil.toISOString()}.`);
  if (p.status !== "approved") throw conflict("NOT_APPROVED", `Payout needs ${p.requiredApprovals} approval(s); has ${p.approvals.length}.`);
  // S10 at the last metre: never pay into an account that is being changed.
  const pending = await db.select({ id: payoutAliasChanges.id }).from(payoutAliasChanges).where(and(eq(payoutAliasChanges.citizenId, p.citizenId), inArray(payoutAliasChanges.status, ["pending_officer", "cooling_off", "frozen"])));
  if (pending.length) throw conflict("PAYOUT_ACCOUNT_CHANGE_PENDING", "A change to this person's payment account is pending or frozen. Resolve it before paying.");
  const [cz] = await db.select({ alias: citizens.payoutAlias }).from(citizens).where(eq(citizens.id, p.citizenId));
  if (cz?.alias && cz.alias !== p.alias) throw conflict("PAYOUT_ACCOUNT_CHANGED", "The payment account changed after approval. Re-approve.");
  const tx = await raastTransfer(db, { payoutId, caseId: p.caseId, alias: p.alias, amount: p.amount, actorId: actor.id, tenantId: p.tenantId });
  await db.update(payouts).set({ status: "released", raastRef: tx.ref, releasedAt: new Date() }).where(eq(payouts.id, payoutId));
  await db.update(cases).set({ status: "paid", updatedAt: new Date() }).where(eq(cases.id, p.caseId));
  const notice = await issueNotice(db, { tenantId: p.tenantId, caseId: p.caseId, citizenId: p.citizenId, type: "payment_released", amount: p.amount });
  await audit(db, { actor, action: "payout.released", targetType: "payout", targetId: payoutId, detail: { amount: p.amount, raastRef: tx.ref, simulated: true, noticeId: notice.id, provisionalFirst: p.provisional }, tenantId: p.tenantId });
  await emit(db, p.tenantId, "payout.released", { payoutId, caseId: p.caseId, amount: p.amount });
  return { payoutId, raastRef: tx.ref, notice: { id: notice.id, code: notice.code, spokenCode: notice.spokenCode, token: notice.token, verifyUrl: notice.verifyUrl, message: notice.message } };
}

/** Citizen (own case) or officer cancels a provisional/pending payout before any money moves. */
export async function cancelPayout(db: DB, actor: Actor, payoutId: string, reason: string) {
  const [p] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p) throw notFound("Payout");
  const isOwner = actor.type === "user" && actor.role === "citizen" && actor.citizenId === p.citizenId;
  const isOfficer = actor.type === "user" && ["officer", "admin"].includes(actor.role) && actor.tenantId === p.tenantId;
  if (!isOwner && !isOfficer) throw notFound("Payout");
  if (!["reserved", "pending_approval", "approved"].includes(p.status)) throw conflict("CANNOT_CANCEL", `Payout is ${p.status}`);
  await db.update(payouts).set({ status: "cancelled", cancelledReason: reason }).where(eq(payouts.id, payoutId));
  await db.update(cases).set({ status: "in_review", lane: "human", priority: 70, updatedAt: new Date() }).where(eq(cases.id, p.caseId));
  await db.insert(caseNotes).values({ id: newId("nte"), caseId: p.caseId, authorType: "user", authorId: actor.id, kind: "handoff", body: `Payout cancelled before release by ${isOwner ? "the citizen" : "an officer"}: ${reason}` });
  await audit(db, { actor, action: "payout.cancelled", targetType: "payout", targetId: payoutId, detail: { reason, wasProvisional: p.provisional, movedMoney: false }, tenantId: p.tenantId });
  return { payoutId, status: "cancelled" as const, spoken: t("handoff.created") };
}

export async function rejectCase(db: DB, actor: Actor, caseId: string, reason: string) {
  const c = await getCaseOr404(db, caseId);
  assertOfficer(actor, c.tenantId);
  if (!["in_review", "submitted", "needs_proof"].includes(c.status)) throw conflict("NOT_REVIEWABLE", `Case is ${c.status}`);
  await db.update(cases).set({ status: "rejected", updatedAt: new Date() }).where(eq(cases.id, caseId));
  await db.insert(caseNotes).values({ id: newId("nte"), caseId, authorType: "user", authorId: actor.id, kind: "note", body: `Rejected: ${reason}` });
  await issueNotice(db, { tenantId: c.tenantId, caseId, citizenId: c.citizenId, type: "decision" });
  await audit(db, { actor, action: "case.rejected", targetType: "case", targetId: caseId, detail: { reason }, tenantId: c.tenantId });
  await emit(db, c.tenantId, "case.rejected", { caseId });
  return { caseId, status: "rejected" as const };
}

export async function closeCase(db: DB, actor: Actor, caseId: string, reason?: string) {
  const c = await getCaseOr404(db, caseId);
  assertOfficer(actor, c.tenantId);
  await db.update(cases).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(cases.id, caseId));
  await audit(db, { actor, action: "case.closed", targetType: "case", targetId: caseId, detail: { reason }, tenantId: c.tenantId });
  await emit(db, c.tenantId, "case.closed", { caseId });
  return { caseId, status: "closed" as const };
}

export async function appealCase(db: DB, ctx: AccessContext, caseId: string, statement: string, via = "voice") {
  const parent = await getCaseOr404(db, caseId);
  await assertCitizenAccess(db, ctx, parent.citizenId, "case.write", { write: true });
  const { case: appeal } = await createCase(db, ctx, {
    citizenId: parent.citizenId,
    type: "appeal",
    claim: { ...(parent.claim as ClaimInput), statement },
    createdVia: via,
    parentCaseId: parent.id,
  });
  await db.update(cases).set({ status: "in_review", lane: "human", priority: Math.max(50, parent.priority) }).where(eq(cases.id, appeal.id));
  await db.insert(caseNotes).values({ id: newId("nte"), caseId: appeal.id, authorType: "system", authorId: "system", kind: "handoff", body: `Appeal of case ${parent.id} (${parent.status}). Must be decided by a different officer. Citizen said: "${statement.slice(0, 500)}"` });
  await audit(db, { actor: ctx.actor, action: "case.appealed", targetType: "case", targetId: parent.id, detail: { appealCaseId: appeal.id, via }, tenantId: parent.tenantId });
  return { appealCaseId: appeal.id, spoken: t("appeal.received") };
}

// ─────────────────────────── reading ───────────────────────────

export async function getCaseView(db: DB, ctx: AccessContext, caseId: string, opts: { breakGlass?: boolean } = {}) {
  const c = await getCaseOr404(db, caseId);
  const access = await assertCitizenAccess(db, ctx, c.citizenId, "case.read");
  const [citizen] = await db.select().from(citizens).where(eq(citizens.id, c.citizenId));
  const role = ctx.actor.type === "user" ? ctx.actor.role : ctx.actor.type;
  const isAuditor = role === "auditor";
  const isStaff = ["officer", "admin", "auditor"].includes(role);
  const docRows = await db
    .select({ id: documents.id, kind: documents.kind, mime: documents.mime, sizeBytes: documents.sizeBytes, sha256: documents.sha256, checks: documents.checks, extracted: documents.extracted, createdAt: documents.createdAt })
    .from(documents)
    .where(eq(documents.caseId, caseId));
  const decisionRows = await db.select().from(decisions).where(eq(decisions.caseId, caseId)).orderBy(desc(decisions.createdAt));
  const notes = isStaff || role === "helper" ? await db.select().from(caseNotes).where(eq(caseNotes.caseId, caseId)).orderBy(asc(caseNotes.createdAt)) : [];
  const [payout] = await db.select().from(payouts).where(eq(payouts.caseId, caseId));
  const noticeRows = await db.select({ id: notices.id, type: notices.type, amount: notices.amount, code: notices.code, issuedAt: notices.issuedAt, expiresAt: notices.expiresAt }).from(notices).where(eq(notices.caseId, caseId)).orderBy(desc(notices.issuedAt));
  const view = opts.breakGlass ? "full" : access.view;

  return {
    case: {
      id: c.id,
      ref: caseRef(c.id),
      type: c.type,
      status: c.status,
      statusWords: STATUS_WORDS[c.status],
      lane: c.lane,
      priority: c.priority,
      confidence: c.confidence,
      amountRequested: c.amountRequested,
      claim: view === "full" ? c.claim : { ...c.claim, cnic: c.claim.cnic ? "masked" : undefined },
      createdVia: c.createdVia,
      assignedTo: c.assignedTo,
      parentCaseId: c.parentCaseId,
      proofRequested: c.proofRequested,
      proofDeadline: c.proofDeadline,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    },
    citizen: presentCitizen(citizen!, view),
    documents: docRows.map((d) => ({ ...d, extracted: view === "full" ? d.extracted : { masked: true } })),
    decisions: decisionRows.map((d) => ({
      id: d.id,
      createdAt: d.createdAt,
      lane: d.lane,
      eligible: d.eligible,
      score: d.score,
      ruleVersion: d.ruleVersion,
      reasonCodes: d.reasonCodes,
      hardStops: d.hardStops,
      userReason: d.userReason,
      counterfactuals: d.counterfactuals,
      // Full trace only for staff (auditor: complete; officers: complete too, for review).
      trace: isStaff ? d.trace : undefined,
      modelInfo: isStaff ? d.modelInfo : undefined,
      inputHash: isAuditor || isStaff ? d.inputHash : undefined,
    })),
    notes,
    payout: payout ?? null,
    // Codes are shown to the person (and their helper) so they can compare; staff see them for support.
    notices: noticeRows,
  };
}

export async function officerQueue(db: DB, actor: Actor, opts: { status?: CaseStatus[]; lane?: string; assignedToMe?: boolean; limit?: number }) {
  if (!actor.tenantId) throw forbidden("NO_TENANT", "No department");
  const where = [eq(cases.tenantId, actor.tenantId)];
  where.push(inArray(cases.status, opts.status?.length ? opts.status : ["submitted", "in_review", "needs_proof", "approved"]));
  if (opts.lane) where.push(eq(cases.lane, opts.lane as "fast"));
  if (opts.assignedToMe) where.push(eq(cases.assignedTo, actor.id));
  const rows = await db
    .select({ case: cases, citizen: citizens })
    .from(cases)
    .innerJoin(citizens, eq(cases.citizenId, citizens.id))
    .where(and(...where))
    // Priority first, then the LEAST confident cases (they need eyes most), then oldest.
    .orderBy(desc(cases.priority), sql`${cases.confidence} asc nulls first`, asc(cases.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map(({ case: c, citizen }) => ({
    id: c.id,
    ref: caseRef(c.id),
    type: c.type,
    status: c.status,
    lane: c.lane,
    priority: c.priority,
    confidence: c.confidence,
    assignedTo: c.assignedTo,
    proofDeadline: c.proofDeadline,
    createdAt: c.createdAt,
    citizen: presentCitizen(citizen, "masked"),
  }));
}

export async function myCases(db: DB, ctx: AccessContext) {
  const citizenId = targetCitizen(ctx, null);
  await assertCitizenAccess(db, ctx, citizenId, "case.read");
  const rows = await db.select().from(cases).where(eq(cases.citizenId, citizenId)).orderBy(desc(cases.createdAt));
  const out = [];
  for (const c of rows) {
    const [d] = await db.select().from(decisions).where(eq(decisions.caseId, c.id)).orderBy(desc(decisions.createdAt)).limit(1);
    out.push({ id: c.id, ref: caseRef(c.id), type: c.type, status: c.status, statusWords: STATUS_WORDS[c.status], lane: c.lane, proofRequested: c.proofRequested, proofDeadline: c.proofDeadline, createdAt: c.createdAt, latestReason: d?.userReason ?? null, counterfactuals: d?.counterfactuals ?? [] });
  }
  return out;
}

