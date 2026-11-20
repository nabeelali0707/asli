/**
 * Signed Truth — verifying side (Challenge 08). Ledger truth first, text classification second.
 *
 * Order of checks:
 *  1. Signed token in the message? Verify Ed25519 signature → load the notice → expiry/revocation
 *     → is it for THIS person? → does the payment exist in the mock Raast ledger with this amount?
 *     → were scam words (fee/OTP) added around a genuine link?
 *  2. No token: match spoken codes and amounts against this person's real notices and payouts
 *     (catches a real code copied into a fake message with a different amount).
 *  3. Then the classifier (Jev or heuristic) as a second signal. A fee/OTP/PIN request is always a scam.
 * Every verdict is explained, spoken (en/ur + audio key) and audited; bad ones open a scam report.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { notices, payouts, mockRaastLedger, scamReports, citizens } from "../db/schema";
import { verifyToken, extractToken } from "../lib/signing";
import { t, type MessageKey, type Spoken } from "../lib/i18n";
import { classifyMessage, type MessageClassification } from "../ai/signals";
import { newId } from "../lib/ids";
import { audit } from "../lib/audit";
import type { Actor } from "../lib/actor";
import { emit } from "./events";
import { canonicalJson } from "../lib/crypto";
import { recordAiDecision } from "./aidecisions";

export type Verdict = "genuine" | "tampered" | "scam" | "not_linked" | "code_mismatch" | "expired" | "suspicious" | "unrelated";
export type Check = { name: string; result: "pass" | "fail" | "skip" | "info"; detail: string };

export type VerifyInput = {
  text?: string | null;
  token?: string | null;
  sender?: string | null;
  citizenId?: string | null;
  district?: string | null;
  tenantId?: string | null;
  /** Whose message is this? A shopkeeper checking a customer's SMS sets "someone_else":
   *  the checker's own case/ledger is then NOT used as evidence (that would be a false alarm). */
  about?: "me" | "someone_else";
};

export type VerifyOutcome = {
  verdict: Verdict;
  spoken: Spoken;
  checks: Check[];
  notice: { id: string; type: string; amount: number | null; caseId: string; issuedAt: Date; expiresAt: Date } | null;
  classification: Omit<MessageClassification, "features"> & { features: MessageClassification["features"] } | null;
  reportId: string | null;
};

const MESSAGE: Record<Verdict, MessageKey> = {
  genuine: "verify.genuine",
  tampered: "verify.tampered",
  scam: "verify.scam",
  not_linked: "verify.not_linked",
  code_mismatch: "verify.code_mismatch",
  expired: "verify.expired",
  suspicious: "verify.suspicious",
  unrelated: "verify.unrelated",
};

export async function verifyMessage(db: DB, actor: Actor, inputArg: VerifyInput, requestId?: string): Promise<VerifyOutcome> {
  let input = inputArg;
  const checks: Check[] = [];
  const text = input.text ?? "";
  const aboutOther = input.about === "someone_else";
  if (aboutOther) {
    checks.push({ name: "scope", result: "info", detail: "Checking a message about someone else: the checker's own case is not used as evidence" });
    input = { ...input, citizenId: null };
  }
  const token = input.token ?? (text ? extractToken(text) : null);
  let verdict: Verdict | null = null;
  let noticeRow: typeof notices.$inferSelect | null = null;
  let tenantId = input.tenantId ?? actor.tenantId ?? null;

  // ── 1. signed token ──
  if (token) {
    const v = await verifyToken(db, token);
    if (!v.ok) {
      const nid = typeof v.payload?.nid === "string" ? v.payload.nid : null;
      const [orig] = nid ? await db.select().from(notices).where(eq(notices.id, nid)) : [];
      if (orig) {
        noticeRow = orig;
        tenantId ??= orig.tenantId;
        const original = orig.payload as Record<string, unknown>;
        const changed = Object.keys({ ...original, ...v.payload }).filter((k) => canonicalJson(original[k]) !== canonicalJson(v.payload?.[k]));
        checks.push({ name: "signature", result: "fail", detail: `Signature does not match. Fields changed after signing: ${changed.join(", ") || "unknown"}` });
        verdict = "tampered";
      } else {
        checks.push({ name: "signature", result: "fail", detail: `Token could not be verified (${v.reason})` });
        verdict = v.reason === "MALFORMED" ? null : "tampered";
      }
    } else if (v.payload.typ !== "notice") {
      checks.push({ name: "signature", result: "fail", detail: "Signed object is not a notice" });
      verdict = "suspicious";
    } else {
      checks.push({ name: "signature", result: "pass", detail: "Ed25519 signature is valid (issued by Asli)" });
      const [n] = await db.select().from(notices).where(eq(notices.id, String(v.payload.nid)));
      if (!n) {
        checks.push({ name: "notice_record", result: "fail", detail: "Signed but no matching notice on record" });
        verdict = "suspicious";
      } else {
        noticeRow = n;
        tenantId ??= n.tenantId;
        if (n.revokedAt) {
          checks.push({ name: "revocation", result: "fail", detail: "Notice was revoked" });
          verdict = "suspicious";
        } else if (n.expiresAt < new Date()) {
          checks.push({ name: "expiry", result: "fail", detail: `Expired at ${n.expiresAt.toISOString()}` });
          verdict = "expired";
        } else {
          checks.push({ name: "expiry", result: "pass", detail: `Valid until ${n.expiresAt.toISOString()}` });
        }
        if (!verdict && input.citizenId && n.citizenId !== input.citizenId) {
          checks.push({ name: "beneficiary", result: "fail", detail: "This genuine notice belongs to a different person — it was forwarded or copied" });
          verdict = "code_mismatch";
        } else if (!verdict && input.citizenId) {
          checks.push({ name: "beneficiary", result: "pass", detail: "Notice is addressed to this person" });
        }
        if (!verdict && n.type === "payment_released") {
          const [p] = await db.select().from(payouts).where(eq(payouts.caseId, n.caseId));
          const [ledger] = p ? await db.select().from(mockRaastLedger).where(eq(mockRaastLedger.payoutId, p.id)) : [];
          if (!ledger || ledger.amount !== n.amount || ledger.status !== "settled") {
            checks.push({ name: "ledger", result: "fail", detail: "No matching settled payment in the (mock) Raast ledger" });
            verdict = "not_linked";
          } else {
            checks.push({ name: "ledger", result: "pass", detail: `Mock Raast ledger shows Rs ${ledger.amount} settled (ref ${ledger.ref})` });
          }
        }
      }
    }
  }

  // ── 2/3. text: codes, amounts, ledger, classifier ──
  let classification: MessageClassification | null = null;
  if (text.trim()) {
    classification = await classifyMessage(text, input.sender);
    const f = classification.features;
    checks.push({
      name: "classifier",
      result: "info",
      detail: `${classification.meta.source} says "${classification.category}" (fee/OTP request p=${classification.asksForFeeOrCode.toFixed(2)})`,
    });

    if (f.asksForFee || f.asksForOtpOrPin || classification.asksForFeeOrCode >= 0.8) {
      checks.push({ name: "fee_or_code_request", result: "fail", detail: "Asks for a fee, OTP, PIN or code — genuine relief never does" });
      // Even a genuine link with scam text wrapped around it is a scam. Tampering stays the louder verdict.
      if (verdict !== "tampered") verdict = "scam";
    }

    if (!token && verdict === null && input.citizenId) {
      const mine = await db.select().from(notices).where(eq(notices.citizenId, input.citizenId)).orderBy(desc(notices.issuedAt)).limit(50);
      const codeHit = f.codes.length ? mine.find((n) => f.codes.includes(n.code)) : undefined;
      if (f.codes.length && !codeHit) {
        const others = await db.select().from(notices).where(inArray(notices.code, f.codes)).limit(5);
        if (others.length) {
          checks.push({ name: "code", result: "fail", detail: "This code belongs to someone else's notice — copied code" });
          verdict = "code_mismatch";
        } else {
          checks.push({ name: "code", result: "fail", detail: "No notice for this person carries this code" });
        }
      }
      if (codeHit && verdict === null) {
        noticeRow = codeHit;
        const amountOk = codeHit.amount === null || !f.amounts.length || f.amounts.includes(codeHit.amount);
        if (!amountOk) {
          checks.push({ name: "code", result: "fail", detail: `Code is real but the amount is wrong (real: Rs ${codeHit.amount}, message: Rs ${f.amounts.join("/")})` });
          verdict = "code_mismatch";
        } else if (codeHit.expiresAt < new Date()) {
          verdict = "expired";
        } else {
          checks.push({ name: "code", result: "pass", detail: "Code and amount match a real notice for this person" });
          verdict = "genuine";
        }
      }
      if (verdict === null && f.claimsPayment) {
        const [p] = await db.select().from(payouts).where(and(eq(payouts.citizenId, input.citizenId), inArray(payouts.status, ["approved", "released"])));
        if (!p) {
          checks.push({ name: "ledger", result: "fail", detail: "This person has no approved or released payment" });
          verdict = "not_linked";
        } else if (f.amounts.length && !f.amounts.includes(p.amount)) {
          checks.push({ name: "ledger", result: "fail", detail: `Real payment is Rs ${p.amount}; message says Rs ${f.amounts.join("/")}` });
          verdict = "not_linked";
        }
      }
    }

    if (verdict === null) {
      if (classification.category === "unrelated" && !f.claimsPayment) verdict = "unrelated";
      else if (classification.category === "relief_scam" && (classification.probabilities.relief_scam ?? 0) >= 0.6) verdict = "scam";
      else if (classification.category === "phishing_link") verdict = "scam";
      else verdict = "suspicious"; // "I am not sure" — no ledger link, no proof either way
      if (aboutOther && verdict === "suspicious") checks.push({ name: "advice", result: "info", detail: "Ask the person it is addressed to (or their helper) to forward it to Asli, so it can be checked against THEIR case." });
    }
  }
  if (verdict === null) verdict = token ? "genuine" : "suspicious";
  if (verdict === "genuine" && noticeRow) {
    await db.update(notices).set({ verifyCount: noticeRow.verifyCount + 1 }).where(eq(notices.id, noticeRow.id));
  }

  // ── report + audit ──
  let reportId: string | null = null;
  const reportable: Verdict[] = ["scam", "tampered", "code_mismatch", "not_linked", "suspicious"];
  if (reportable.includes(verdict) && text.trim()) {
    let district = input.district ?? null;
    if (!district && input.citizenId) {
      const [c] = await db.select({ district: citizens.district }).from(citizens).where(eq(citizens.id, input.citizenId));
      district = c?.district ?? null;
    }
    reportId = newId("scm");
    await db.insert(scamReports).values({
      id: reportId,
      tenantId: tenantId ?? "public",
      reporterId: actor.type === "user" ? actor.id : null,
      citizenId: input.citizenId ?? null,
      text: text.slice(0, 2000),
      sender: input.sender ?? null,
      district,
      verdict,
      category: classification?.category ?? null,
      classification: classification ? { ...classification, features: classification.features } : null,
      ledgerCheck: checks,
    });
    if (tenantId) await emit(db, tenantId, "scam.reported", { reportId, verdict, district });
  }
  await audit(db, {
    actor,
    action: "signed_truth.verify",
    targetType: noticeRow ? "notice" : "message",
    targetId: noticeRow?.id,
    detail: { verdict, checks: checks.map((c) => `${c.name}:${c.result}`), classifier: classification?.meta, reportId },
    tenantId,
    requestId,
  });

  const amount = noticeRow?.amount ?? "";
  const spoken = t(MESSAGE[verdict], { amount });
  await recordAiDecision(db, {
    tenantId,
    kind: "scam_verdict",
    subjectType: noticeRow ? "notice" : "message",
    subjectId: noticeRow?.id ?? reportId ?? undefined,
    citizenId: input.citizenId ?? null,
    input: { text: text.slice(0, 2000), sender: input.sender ?? null, hasToken: !!token, about: input.about ?? "me" },
    output: { verdict, category: classification?.category ?? null, asksForFeeOrCode: classification?.asksForFeeOrCode ?? null, source: classification?.meta.source ?? "none", checks },
    citizenView: spoken,
    model: { classifier: classification?.meta ?? null, verifier: "asli-signed-truth@2 (ledger first)" },
  });
  return {
    verdict,
    spoken,
    checks,
    notice: noticeRow
      ? { id: noticeRow.id, type: noticeRow.type, amount: noticeRow.amount, caseId: noticeRow.caseId, issuedAt: noticeRow.issuedAt, expiresAt: noticeRow.expiresAt }
      : null,
    classification,
    reportId,
  };
}
