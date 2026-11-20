/**
 * Consent management (Challenge 06): see who has my data, share, withdraw, correct.
 * - Every grant produces a bilingual receipt (read aloud on the client) and a receipt hash.
 * - Withdrawal is checked live on every access, so it truly stops access — the next helper or
 *   AI call returns 403 CONSENT_REVOKED — and the audit log records both the withdrawal and the denial.
 * - "Who used my data" comes straight from the hash-chained audit log.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { DB } from "../db/client";
import { consents, users, correctionRequests, auditLog, tenants, citizens } from "../db/schema";
import { newId } from "../lib/ids";
import { canonicalJson, sha256Hex } from "../lib/crypto";
import { audit } from "../lib/audit";
import { t } from "../lib/i18n";
import type { Actor } from "../lib/actor";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { SCOPES, type Scope, getCitizenOr404 } from "./access";
import { emit } from "./events";
import { notifyUser } from "./notices";

const SCOPE_WORDS: Record<Scope, { en: string; ur: string }> = {
  "identity.read": { en: "identity details", ur: "شناختی معلومات" },
  "income.read": { en: "income details", ur: "آمدنی کی معلومات" },
  "documents.read": { en: "documents", ur: "کاغذات" },
  "case.write": { en: "case (to act for you)", ur: "کیس (آپ کی طرف سے کام کرنے کے لیے)" },
  "case.read": { en: "case status", ur: "کیس کی صورتحال" },
  "payout.read": { en: "payment status", ur: "ادائیگی کی صورتحال" },
};

async function granteeName(db: DB, type: "user" | "department", id: string) {
  if (type === "user") {
    const [u] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, id));
    return u?.n ?? id;
  }
  const [tn] = await db.select({ n: tenants.name }).from(tenants).where(eq(tenants.id, id));
  return tn?.n ?? id;
}

export async function grantConsent(
  db: DB,
  actor: Actor,
  args: {
    citizenId: string;
    granteeType: "user" | "department";
    granteeId: string;
    scopes: Scope[];
    purpose: string;
    expiresInDays?: number;
    grantedVia: "web" | "voice" | "pin" | "ivr";
    actFor?: { citizenId: string };
  },
) {
  const citizen = await getCitizenOr404(db, args.citizenId);
  // Who may grant: the citizen; or a helper in a PIN-unlocked family session granting the DEPARTMENT access.
  const isSelf = actor.type === "user" && actor.role === "citizen" && actor.citizenId === args.citizenId;
  const isHelperForDept = actor.type === "user" && actor.role === "helper" && args.actFor?.citizenId === args.citizenId && args.granteeType === "department";
  const isSystem = actor.type === "system";
  if (!isSelf && !isHelperForDept && !isSystem) throw forbidden("CANNOT_GRANT", "Only the person themselves can give this permission.");
  if (args.granteeType === "user" && args.granteeId === actor.id && !isSelf && !isSystem) throw forbidden("SELF_GRANT", "A helper cannot grant consent to themselves.");
  const scopes = [...new Set(args.scopes)];
  if (!scopes.length || scopes.some((s) => !SCOPES.includes(s))) throw badRequest("INVALID_SCOPES", `Scopes must be from: ${SCOPES.join(", ")}`);

  const expiresAt = args.expiresInDays ? new Date(Date.now() + args.expiresInDays * 864e5) : null;
  const name = await granteeName(db, args.granteeType, args.granteeId);
  const words = scopes.map((s) => SCOPE_WORDS[s]);
  const until = expiresAt ? expiresAt.toISOString().slice(0, 10) : "you take it back";
  const receipt = t("consent.receipt", { grantee: name, scopes: words.map((w) => w.en).join(", "), purpose: args.purpose.replace(/_/g, " "), until });
  const receiptUr = t("consent.receipt", { grantee: name, scopes: words.map((w) => w.ur).join("، "), purpose: args.purpose.replace(/_/g, " "), until: expiresAt ? until : "آپ واپس نہ لیں" });
  const receiptText = { en: receipt.en, ur: receiptUr.ur };
  const id = newId("cns");
  const receiptHash = sha256Hex(canonicalJson({ id, citizenId: citizen.id, granteeType: args.granteeType, granteeId: args.granteeId, scopes, purpose: args.purpose, expiresAt, receiptText }));
  await db.insert(consents).values({
    id,
    tenantId: citizen.tenantId,
    citizenId: citizen.id,
    granteeType: args.granteeType,
    granteeId: args.granteeId,
    purpose: args.purpose,
    scopes,
    grantedVia: args.grantedVia,
    receiptHash,
    receiptText,
    expiresAt,
  });
  await audit(db, { actor, action: "consent.granted", targetType: "consent", targetId: id, detail: { citizenId: citizen.id, granteeType: args.granteeType, granteeId: args.granteeId, scopes, via: args.grantedVia, receiptHash }, tenantId: citizen.tenantId });
  return { id, receiptText, receiptHash, audioKey: "consent.receipt", scopes, expiresAt };
}

export async function withdrawConsent(db: DB, actor: Actor, consentId: string, reason?: string) {
  const [c] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!c) throw notFound("Consent");
  const isOwner = actor.type === "user" && actor.role === "citizen" && actor.citizenId === c.citizenId;
  const isGranteeHelper = actor.type === "user" && actor.role === "helper" && c.granteeType === "user" && c.granteeId === actor.id;
  const isAdminRecording = actor.type === "user" && (actor.role === "admin" || actor.role === "officer") && actor.tenantId === c.tenantId;
  if (!isOwner && !isGranteeHelper && !isAdminRecording) throw forbidden("CANNOT_WITHDRAW", "Only the person (or the helper giving up access) can withdraw this.");
  if (c.status !== "active") return { id: c.id, status: c.status, alreadyWithdrawn: true };
  await db.update(consents).set({ status: "withdrawn", withdrawnAt: new Date(), withdrawnReason: reason ?? null }).where(eq(consents.id, consentId));
  await audit(db, { actor, action: "consent.withdrawn", targetType: "consent", targetId: consentId, detail: { citizenId: c.citizenId, granteeType: c.granteeType, granteeId: c.granteeId, reason }, tenantId: c.tenantId });
  await emit(db, c.tenantId, "consent.withdrawn", { consentId, citizenId: c.citizenId, granteeType: c.granteeType });
  const name = await granteeName(db, c.granteeType, c.granteeId);
  const msg = t("consent.withdrawn", { grantee: name });
  if (c.granteeType === "user") {
    await notifyUser(db, { tenantId: c.tenantId, userId: c.granteeId, citizenId: c.citizenId, title: "consent.withdrawn", body: { en: `Access to a family was withdrawn.`, ur: "ایک خاندان نے اجازت واپس لے لی ہے۔" } });
  }
  return { id: consentId, status: "withdrawn" as const, spoken: msg };
}

/** Everything a citizen needs to see: active + past grants, and who actually used their data. */
export async function consentDashboard(db: DB, citizenId: string) {
  const rows = await db.select().from(consents).where(eq(consents.citizenId, citizenId)).orderBy(desc(consents.createdAt));
  const grants = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      grantee: { type: r.granteeType, id: r.granteeId, name: await granteeName(db, r.granteeType, r.granteeId) },
      scopes: r.scopes,
      purpose: r.purpose,
      status: r.status !== "active" ? r.status : r.expiresAt && r.expiresAt < new Date() ? "expired" : "active",
      grantedVia: r.grantedVia,
      receiptText: r.receiptText,
      receiptHash: r.receiptHash,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      withdrawnAt: r.withdrawnAt,
    })),
  );
  const access = await db
    .select({ at: auditLog.at, actorType: auditLog.actorType, actorId: auditLog.actorId, actorRole: auditLog.actorRole, action: auditLog.action, outcome: auditLog.outcome })
    .from(auditLog)
    .where(and(eq(auditLog.targetType, "citizen"), eq(auditLog.targetId, citizenId)))
    .orderBy(desc(auditLog.seq))
    .limit(100);
  const corrections = await db.select().from(correctionRequests).where(eq(correctionRequests.citizenId, citizenId)).orderBy(desc(correctionRequests.createdAt));
  return { grants, accessLog: access, corrections };
}

const CORRECTABLE = ["fullName", "fatherName", "dob", "district", "phone", "payoutAlias"] as const;

export async function requestCorrection(db: DB, actor: Actor, citizenId: string, field: string, requestedValue: string, reason?: string) {
  if (!(CORRECTABLE as readonly string[]).includes(field)) throw badRequest("FIELD_NOT_CORRECTABLE", `Correctable fields: ${CORRECTABLE.join(", ")}`);
  const c = await getCitizenOr404(db, citizenId);
  const id = newId("crr");
  const current = (c as Record<string, unknown>)[field];
  await db.insert(correctionRequests).values({ id, tenantId: c.tenantId, citizenId, field, currentValue: current == null ? null : String(current), requestedValue, reason: reason ?? null });
  await audit(db, { actor, action: "consent.correction_requested", targetType: "citizen", targetId: citizenId, detail: { field, correctionId: id }, tenantId: c.tenantId });
  return { id, status: "open" as const };
}

export async function reviewCorrection(db: DB, actor: Actor, correctionId: string, approve: boolean) {
  const [cr] = await db.select().from(correctionRequests).where(eq(correctionRequests.id, correctionId));
  if (!cr) throw notFound("Correction request");
  if (cr.status !== "open") return { id: cr.id, status: cr.status };
  if (approve) {
    const patch: Record<string, unknown> = { [cr.field]: cr.requestedValue };
    if (cr.field === "fullName") {
      const { normalizeName } = await import("../domain/names");
      patch.nameKey = normalizeName(cr.requestedValue);
    }
    await db.update(citizens).set(patch).where(eq(citizens.id, cr.citizenId));
  }
  await db.update(correctionRequests).set({ status: approve ? "applied" : "rejected", reviewedBy: actor.id }).where(eq(correctionRequests.id, correctionId));
  await audit(db, { actor, action: approve ? "consent.correction_applied" : "consent.correction_rejected", targetType: "citizen", targetId: cr.citizenId, detail: { field: cr.field, correctionId }, tenantId: cr.tenantId });
  return { id: correctionId, status: approve ? "applied" : "rejected" };
}

export async function openCorrections(db: DB, tenantId: string) {
  return db.select().from(correctionRequests).where(and(eq(correctionRequests.tenantId, tenantId), eq(correctionRequests.status, "open")));
}

