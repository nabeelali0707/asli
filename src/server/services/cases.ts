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
import { checkDocument } from "../domain/documents";
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

// ─────────────────────────── the decision run ───────────────────────────

async function recentPaymentDays(db: DB, citizenId: string, excludeCaseId: string): Promise<number> {
  const rows = await db
    .select({ releasedAt: payouts.releasedAt })
    .from(payouts)
    .where(and(eq(payouts.citizenId, citizenId), eq(payouts.status, "released"), ne(payouts.caseId, excludeCaseId)))
    .orderBy(desc(payouts.releasedAt))
    .limit(1);
  if (!rows[0]?.releasedAt) return 99999;
  return Math.floor((Date.now() - rows[0].releasedAt.getTime()) / 864e5);
}

function ageFrom(dob: string | null | undefined): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob + "T00:00:00Z");
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export async function runDecision(db: DB, caseId: string, opts: { trigger: string; requestId?: string }) {
  const c = await getCaseOr404(db, caseId);
  const ai = AI_ACTOR(c.tenantId);
  const ctx: AccessContext = { actor: ai, requestId: opts.requestId };
  const [citizen] = await db.select().from(citizens).where(eq(citizens.id, c.citizenId));
  const claim = c.claim as ClaimInput;
  const docs = await db.select().from(documents).where(eq(documents.caseId, caseId));

  // Evidence from mock DPI, via consent. A 403 here means consent is missing/withdrawn → hard stop.
  let consentOk = true;
  const missingScopes: string[] = [];
  const guarded = async <T>(scope: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError && e.status === 403) {
        consentOk = false;
        missingScopes.push(scope);
        return null;
      }
      throw e;
    }
  };
  const registry = await guarded("identity.read", () => nadraLookup(db, ctx, c.citizenId));
  const income = await guarded("income.read", () => incomeLookup(db, ctx, c.citizenId));

  const docQr = docs.map((d) => (d.extracted ?? {}) as Record<string, unknown>).find((x) => x.cnic);
  const identityClaim = {
    fullName: claim.fullName ?? citizen!.fullName,
    fatherName: claim.fatherName ?? citizen!.fatherName ?? (docQr?.fatherName as string | undefined) ?? null,
    cnic: claim.cnic ?? citizen!.cnic ?? (docQr?.cnic as string | undefined) ?? null,
    dob: claim.dob ?? citizen!.dob ?? (docQr?.dob as string | undefined) ?? null,
  };
  const identity = matchIdentity(identityClaim, registry ? { fullName: registry.fullName, fatherName: registry.fatherName, cnic: registry.cnic, dob: registry.dob } : null);

  const documentEvidence: DocumentEvidence[] = docs.map((d) => {
    const ch = (d.checks ?? {}) as { readable?: boolean; blurry?: boolean; qr?: { valid: boolean | null }; tamperScore?: number };
    const ex = (d.extracted ?? {}) as { cnic?: string | null; fullName?: string | null };
    const cnicMismatch = ex.cnic && identityClaim.cnic ? normalizeCnic(ex.cnic) !== normalizeCnic(identityClaim.cnic) : false;
    return {
      kind: d.kind,
      readable: !!ch.readable,
      blurry: !!ch.blurry,
      qrValid: ch.qr?.valid ?? null,
      tamperScore: ch.tamperScore ?? 0,
      fieldsMatchClaim: cnicMismatch ? false : null,
    };
  });

  const others = await db
    .select()
    .from(citizens)
    .where(and(eq(citizens.tenantId, c.tenantId), ne(citizens.id, c.citizenId), or(eq(citizens.nameKey, citizen!.nameKey), identityClaim.cnic ? eq(citizens.cnic, identityClaim.cnic) : sql`false`)));
  const nameish = await db.select().from(citizens).where(and(eq(citizens.tenantId, c.tenantId), ne(citizens.id, c.citizenId))).limit(2000);
  const duplicates = findDuplicateCandidates({ id: citizen!.id, fullName: citizen!.fullName, fatherName: identityClaim.fatherName, cnic: identityClaim.cnic, dob: identityClaim.dob }, [...others, ...nameish.filter((o) => !others.some((x) => x.id === o.id))]);

  const docIncome = docs.map((d) => (d.extracted as { monthlyIncome?: number | null } | null)?.monthlyIncome).find((x) => typeof x === "number") ?? null;
  const facts: Facts = {
    monthly_income: income?.monthlyIncome ?? docIncome ?? null,
    household_size: income?.householdSize ?? claim.householdSize ?? null,
    age: ageFrom(registry?.dob ?? identityClaim.dob),
    marital_status: registry?.maritalStatus ?? claim.maritalStatus ?? null,
    gender: registry?.gender ?? citizen!.gender ?? null,
    district: registry?.district ?? citizen!.district ?? null,
    alive: registry ? registry.alive : null,
    has_valid_cnic: !!normalizeCnic(identityClaim.cnic),
    recent_payment_days: await recentPaymentDays(db, c.citizenId, caseId),
  };
  const factSources: Record<string, string> = {
    monthly_income: income ? "mock_income_registry" : docIncome !== null ? "document" : "missing",
    household_size: income ? "mock_income_registry" : claim.householdSize ? "applicant_statement" : "missing",
    age: registry ? "mock_nadra" : identityClaim.dob ? "applicant_statement" : "missing",
    marital_status: registry ? "mock_nadra" : claim.maritalStatus ? "applicant_statement" : "missing",
    alive: registry ? "mock_nadra" : "missing",
    recent_payment_days: "payout_ledger",
  };

  const sig = await caseSignals({
    documentsPresent: documentEvidence.some((d) => d.kind === "cnic" && d.readable) && documentEvidence.some((d) => d.kind === "income_proof" && d.readable),
    incomeStated: claim.monthlyIncome ?? null,
    incomeOnRecord: income?.monthlyIncome ?? null,
    incomeOnDocument: docIncome,
    nameVariants: [identityClaim.fullName, registry?.fullName, ...docs.map((d) => (d.extracted as { fullName?: string } | null)?.fullName)].filter((x): x is string => !!x),
    dobValues: [identityClaim.dob, registry?.dob].filter((x): x is string => !!x),
    householdSizes: [claim.householdSize, income?.householdSize].filter((x): x is number => typeof x === "number"),
  });

  const ruleSet = await activeRuleSet(db, c.tenantId);
  const input: DecisionInput = {
    ruleSet: { id: ruleSet.id, version: ruleSet.version, definition: ruleSet.definition },
    facts,
    factSources,
    identity,
    documents: documentEvidence,
    duplicates,
    consent: { ok: consentOk, missingScopes },
    signals: sig.signals,
    amountRequested: c.amountRequested,
  };
  const out = decide(input);
  const urg = await urgencyAndKind([claim.statement ?? "", out.lane === "human" ? "needs human review" : ""].join(" "));
  const priority = Math.round(
    Math.min(100, (out.lane === "human" ? 40 : out.lane === "ask_proof" ? 20 : 10) + urg.urgency * 40 + (out.hardStops.length ? 15 : 0) + (1 - out.score) * 10),
  );

  const { ruleSet: _rs, ...inputWithoutRules } = input;
  void _rs;
  const trace = {
    trigger: opts.trigger,
    input: inputWithoutRules,
    output: { ...out, userReason: undefined },
    weights: { identity: 0.4, documents: 0.35, eligibilityEvidence: 0.25 },
    thresholds: ruleSet.definition.thresholds,
    fastLaneEnabled: ruleSet.definition.fastLaneEnabled,
  };
  const modelInfo = {
    caseSignals: sig.meta,
    urgency: urg.meta,
    documentVision: docs.map((d) => (d.checks as { visionMeta?: unknown } | null)?.visionMeta ?? null),
    decisionEngine: "asli-decision@1 (deterministic)",
    identityMatcher: "asli-names@1 (deterministic)",
  };
  const decisionId = newId("dcs");
  await db.insert(decisions).values({
    id: decisionId,
    caseId,
    tenantId: c.tenantId,
    ruleSetId: ruleSet.id,
    ruleVersion: ruleSet.version,
    lane: out.lane,
    eligible: out.eligible,
    score: out.score,
    reasonCodes: out.reasonCodes,
    hardStops: out.hardStops,
    userReason: { en: out.userReason.en, ur: out.userReason.ur },
    counterfactuals: out.counterfactuals,
    trace,
    modelInfo,
    inputHash: sha256Hex(canonicalJson(inputWithoutRules)),
  });

  const th = ruleSet.definition.thresholds;
  let status: CaseStatus = "in_review";
  let proofDeadline: Date | null = null;
  if (out.lane === "ask_proof") {
    status = "needs_proof";
    proofDeadline = new Date(Date.now() + th.proofDeadlineHours * 3600_000);
  }
  await db
    .update(cases)
    .set({ status, lane: out.lane, confidence: out.score, priority, proofRequested: out.lane === "ask_proof" ? out.proofItems : null, proofDeadline, updatedAt: new Date() })
    .where(eq(cases.id, caseId));

  if (out.lane === "human") {
    await db.insert(caseNotes).values({
      id: newId("nte"),
      caseId,
      authorType: "ai",
      authorId: ai.id,
      kind: "handoff",
      body: `I am not sure — handing to a human. Reasons: ${[...out.hardStops, ...out.reasonCodes].join(", ")}. Evidence score ${out.score} (identity ${out.components.identity}, documents ${out.components.documents}, eligibility facts ${out.components.eligibilityEvidence}). Identity: ${identity.verdict}. ${duplicates.length ? `Possible duplicates: ${duplicates.map((d) => `${d.id} (${d.reason})`).join("; ")}.` : ""} ${out.eligible === false ? "Rule failed: " + out.ruleResults.filter((r) => r.result === "fail").map((r) => r.ruleId).join(", ") : ""}`.trim(),
      data: { decisionId, hardStops: out.hardStops, reasonCodes: out.reasonCodes, identity, duplicates, missingScopes },
    });
  }
  if (out.lane === "ask_proof") {
    await db.insert(caseNotes).values({ id: newId("nte"), caseId, authorType: "ai", authorId: ai.id, kind: "proof_request", body: `Asked for: ${out.proofItems.join(", ")}. Deadline ${proofDeadline!.toISOString()}; escalates to a human if not supplied.`, data: { decisionId } });
    await enqueueJob(db, "case.proof_deadline", { caseId, decisionId }, proofDeadline!);
  }
  const notice = await issueNotice(db, { tenantId: c.tenantId, caseId, citizenId: c.citizenId, type: out.lane === "ask_proof" ? "proof_requested" : "decision" });
  await audit(db, {
    actor: ai,
    action: "decision.made",
    targetType: "case",
    targetId: caseId,
    detail: { decisionId, lane: out.lane, score: out.score, eligible: out.eligible, ruleVersion: ruleSet.version, hardStops: out.hardStops, reasonCodes: out.reasonCodes, signalsSource: sig.meta.source },
    tenantId: c.tenantId,
    requestId: opts.requestId,
  });
  await emit(db, c.tenantId, out.lane === "ask_proof" ? "case.needs_proof" : "case.decided", { caseId, decisionId, lane: out.lane, ruleVersion: ruleSet.version });

  return {
    id: decisionId,
    lane: out.lane,
    status,
    eligible: out.eligible,
    score: out.score,
    ruleVersion: ruleSet.version,
    proofItems: out.proofItems,
    proofDeadline,
    userReason: out.userReason,
    counterfactuals: out.counterfactuals,
    reasonCodes: out.reasonCodes,
    hardStops: out.hardStops,
    benefitAmount: out.benefitAmount,
    notice: { code: notice.code, spokenCode: notice.spokenCode },
  };
}

registerJob("case.proof_deadline", async (db, payload) => {
  const c = (await db.select().from(cases).where(eq(cases.id, String(payload.caseId))))[0];
  if (!c || c.status !== "needs_proof") return; // proof arrived in time
  const system: Actor = { type: "system", id: "deadline-timer", tenantId: c.tenantId, role: "system" };
  await db.update(cases).set({ status: "in_review", lane: "human", priority: Math.max(c.priority, 60), updatedAt: new Date() }).where(eq(cases.id, c.id));
  await db.insert(caseNotes).values({ id: newId("nte"), caseId: c.id, authorType: "system", authorId: system.id, kind: "handoff", body: "Proof deadline passed without the requested items. Escalated to a human — never auto-rejected.", data: { requested: c.proofRequested } });
  await audit(db, { actor: system, action: "case.escalated", targetType: "case", targetId: c.id, detail: { reason: "PROOF_DEADLINE_PASSED" }, tenantId: c.tenantId });
  await emit(db, c.tenantId, "case.escalated", { caseId: c.id, reason: "PROOF_DEADLINE_PASSED" });
});

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

/** Officer approves the CLAIM. This creates a payout that still needs its approval count before any money moves. */
export async function approveCase(db: DB, actor: Actor, caseId: string, args: { amount?: number; note?: string }) {
  const c = await getCaseOr404(db, caseId);
  assertOfficer(actor, c.tenantId);
  if (!["in_review", "submitted"].includes(c.status)) throw conflict("NOT_REVIEWABLE", `Case is ${c.status}`);
  const d = await latestDecision(db, caseId);
  if (!d) throw conflict("NO_DECISION", "Run a decision first");
  if (c.type === "appeal" && c.parentCaseId) {
    const [rejectedBy] = await db.select().from(auditLog).where(and(eq(auditLog.targetId, c.parentCaseId), eq(auditLog.action, "case.rejected"))).limit(1);
    if (rejectedBy?.actorId === actor.id) throw forbidden("APPEAL_NEEDS_DIFFERENT_OFFICER", "An appeal must be decided by a different officer than the one who rejected the original case.");
  }
  const [citizen] = await db.select().from(citizens).where(eq(citizens.id, c.citizenId));
  if (!citizen?.payoutAlias) throw unprocessablePayout();
  const rs = await activeRuleSet(db, c.tenantId);
  const benefit = (d.trace as { output?: { benefitAmount?: number } }).output?.benefitAmount ?? rs.definition.program.benefit.base;
  const amount = args.amount ?? benefit;
  if (amount <= 0 || amount > rs.definition.program.benefit.max) throw badRequest("INVALID_AMOUNT", `Amount must be between 1 and ${rs.definition.program.benefit.max}`);
  const required = amount > rs.definition.thresholds.secondApproverAbovePKR ? 2 : 1;
  const payoutId = newId("pay");
  await db.insert(payouts).values({
    id: payoutId,
    tenantId: c.tenantId,
    caseId,
    citizenId: c.citizenId,
    amount,
    alias: citizen.payoutAlias,
    requiredApprovals: required,
    approvals: [{ userId: actor.id, at: new Date().toISOString() }],
    status: required === 1 ? "approved" : "pending_approval",
    createdBy: actor.id,
  });
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
  if (p.status !== "pending_approval") throw conflict("NOT_PENDING", `Payout is ${p.status}`);
  if (p.approvals.some((a) => a.userId === actor.id)) throw forbidden("SAME_APPROVER", "The second approval must come from a different officer.");
  if (actor.type === "user" && !actor.canSecondApprove) throw forbidden("NOT_SECOND_APPROVER", "Your account is not allowed to give second approvals.");
  const approvals = [...p.approvals, { userId: actor.id, at: new Date().toISOString() }];
  const status = approvals.length >= p.requiredApprovals ? "approved" : "pending_approval";
  await db.update(payouts).set({ approvals, status }).where(eq(payouts.id, payoutId));
  await audit(db, { actor, action: "payout.approved", targetType: "payout", targetId: payoutId, detail: { approvals: approvals.length, required: p.requiredApprovals }, tenantId: p.tenantId });
  if (status === "approved") return { payoutId, status: "released" as const, release: await releasePayout(db, actor, payoutId) };
  return { payoutId, status, release: null };
}

/** Moves (mock) money. Humans only — any AI/agent attempt is refused and logged. */
export async function releasePayout(db: DB, actor: Actor, payoutId: string) {
  // Guardrail first: no AI, agent, API key or citizen can move money — checked before anything else.
  if (actor.type !== "user" || !["officer", "admin"].includes(actor.role)) {
    await audit(db, { actor, action: "payout.release", targetType: "payout", targetId: payoutId, outcome: "denied", detail: { code: "AI_CANNOT_INITIATE_PAYMENT" }, tenantId: actor.tenantId });
    throw forbidden("AI_CANNOT_INITIATE_PAYMENT", "Only a human officer can release money. This attempt has been logged.");
  }
  const [p] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p) throw notFound("Payout");
  if (p.status === "released") return { payoutId, raastRef: p.raastRef, alreadyReleased: true };
  if (p.status !== "approved") throw conflict("NOT_APPROVED", `Payout needs ${p.requiredApprovals} approval(s); has ${p.approvals.length}.`);
  const tx = await raastTransfer(db, { payoutId, caseId: p.caseId, alias: p.alias, amount: p.amount, actorId: actor.id, tenantId: p.tenantId });
  await db.update(payouts).set({ status: "released", raastRef: tx.ref, releasedAt: new Date() }).where(eq(payouts.id, payoutId));
  await db.update(cases).set({ status: "paid", updatedAt: new Date() }).where(eq(cases.id, p.caseId));
  const notice = await issueNotice(db, { tenantId: p.tenantId, caseId: p.caseId, citizenId: p.citizenId, type: "payment_released", amount: p.amount });
  await audit(db, { actor, action: "payout.released", targetType: "payout", targetId: payoutId, detail: { amount: p.amount, raastRef: tx.ref, simulated: true, noticeId: notice.id }, tenantId: p.tenantId });
  await emit(db, p.tenantId, "payout.released", { payoutId, caseId: p.caseId, amount: p.amount });
  return { payoutId, raastRef: tx.ref, notice: { id: notice.id, code: notice.code, spokenCode: notice.spokenCode, token: notice.token, verifyUrl: notice.verifyUrl, message: notice.message } };
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

