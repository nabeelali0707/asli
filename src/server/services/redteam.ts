/**
 * "Try to fool Asli" — judge-facing red-team panel. Each attack goes through the REAL code paths
 * (verifier, consent checks, payout guardrail, QR forensics, identity matcher, audit chain) and
 * reports whether it was caught. Results are audited. Nothing here fakes a pass.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import type { DB } from "../db/client";
import { notices, citizens, users, consents } from "../db/schema";
import { AGENT_ACTOR, type Actor } from "../lib/actor";
import { AppError } from "../lib/errors";
import { audit, verifyAuditChain } from "../lib/audit";
import { verifyMessage } from "./verify";
import { releasePayout } from "./cases";
import { assertCitizenAccess } from "./access";
import { grantConsent, withdrawConsent } from "./consent";
import { renderMockCnic, checkQr } from "../domain/documents";
import { matchIdentity, findDuplicateCandidates } from "../domain/names";

export const ATTACKS = [
  { id: "tamper_amount", name: "Edit the amount in a real payment message", expect: "tampered" },
  { id: "genuine_link_plus_fee", name: "Wrap a real verify link in a 'pay a fee' message", expect: "scam" },
  { id: "copied_code", name: "Copy a real code into a fake message for another family", expect: "code_mismatch or scam" },
  { id: "forwarded_to_other_person", name: "Forward someone else's genuine notice as if it were yours", expect: "code_mismatch" },
  { id: "fee_scam", name: "Classic 'BISP Rs 25,000 approved — send Rs 500 fee' SMS", expect: "scam" },
  { id: "forged_cnic_qr", name: "Mock CNIC whose QR was edited after signing", expect: "QR signature fails" },
  { id: "name_variant_merge", name: "'Mohammad Aslam' vs 'Muhammad Aslam' with different father & DOB", expect: "no automatic match" },
  { id: "revoked_consent", name: "Helper keeps using a family after consent is withdrawn", expect: "403 CONSENT_REVOKED" },
  { id: "ai_payout", name: "The AI agent tries to release money", expect: "403 AI_CANNOT_INITIATE_PAYMENT" },
  { id: "cross_tenant", name: "Officer from another department reads a citizen", expect: "403 CROSS_TENANT" },
  { id: "audit_chain", name: "Check the audit log has not been edited", expect: "hash chain intact" },
] as const;
export type AttackId = (typeof ATTACKS)[number]["id"];

type Result = { id: AttackId; name: string; expected: string; actual: string; caught: boolean; detail: unknown };

export async function runAttack(db: DB, actor: Actor, id: AttackId): Promise<Result> {
  const meta = ATTACKS.find((a) => a.id === id);
  if (!meta) throw new AppError(404, "UNKNOWN_ATTACK", "Unknown attack");
  const tenantId = actor.tenantId!;
  const base = { id, name: meta.name, expected: meta.expect };
  const realPayment = async () => (await db.select().from(notices).where(and(eq(notices.tenantId, tenantId), eq(notices.type, "payment_released"))).orderBy(desc(notices.issuedAt)).limit(1))[0];
  const anyNotice = async () => (await db.select().from(notices).where(eq(notices.tenantId, tenantId)).orderBy(desc(notices.issuedAt)).limit(1))[0];
  const skipped = (why: string): Result => ({ ...base, actual: `skipped: ${why}`, caught: false, detail: null });

  let result: Result;
  switch (id) {
    case "tamper_amount": {
      const n = await realPayment();
      if (!n) return skipped("no payment notice yet — run the demo seed or release a payout");
      const [p, body, sig] = n.token.split(".");
      const obj = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
      obj.amt = (obj.amt ?? 0) * 3;
      const forged = `${p}.${Buffer.from(JSON.stringify(obj)).toString("base64url")}.${sig}`;
      const v = await verifyMessage(db, actor, { text: `Asli: Rs ${obj.amt} sent. Verify: https://asli.example/v/${forged}`, citizenId: n.citizenId });
      result = { ...base, actual: v.verdict, caught: v.verdict === "tampered", detail: v.checks };
      break;
    }
    case "genuine_link_plus_fee": {
      const n = await realPayment();
      if (!n) return skipped("no payment notice yet");
      const v = await verifyMessage(db, actor, { text: `URGENT: your relief is on hold. Send Rs 500 processing fee to 03001234567 to unlock it. Verify: ${n.token}`, citizenId: n.citizenId });
      result = { ...base, actual: v.verdict, caught: v.verdict === "scam", detail: v.checks };
      break;
    }
    case "copied_code": {
      const n = await anyNotice();
      if (!n) return skipped("no notices yet");
      const [other] = await db.select().from(citizens).where(and(eq(citizens.tenantId, tenantId), ne(citizens.id, n.citizenId))).limit(1);
      if (!other) return skipped("need a second citizen");
      const v = await verifyMessage(db, actor, { text: `Asli: Rs 25,000 has been sent to your account. Your code is ${n.code}.`, citizenId: other.id });
      result = { ...base, actual: v.verdict, caught: ["code_mismatch", "scam", "not_linked"].includes(v.verdict), detail: v.checks };
      break;
    }
    case "forwarded_to_other_person": {
      const n = await anyNotice();
      if (!n) return skipped("no notices yet");
      const [other] = await db.select().from(citizens).where(and(eq(citizens.tenantId, tenantId), ne(citizens.id, n.citizenId))).limit(1);
      if (!other) return skipped("need a second citizen");
      const v = await verifyMessage(db, actor, { token: n.token, citizenId: other.id });
      result = { ...base, actual: v.verdict, caught: v.verdict === "code_mismatch", detail: v.checks };
      break;
    }
    case "fee_scam": {
      const v = await verifyMessage(db, actor, { text: "BISP: Mubarak ho! Aap ki Rs. 25,000 relief payment approve ho gayi hai. Payment release karne ke liye Rs 500 processing fee is number par jama karwayen: 03451234567. Aaj hi.", sender: "03451234567" });
      result = { ...base, actual: v.verdict, caught: v.verdict === "scam", detail: { checks: v.checks, classifier: v.classification?.meta } };
      break;
    }
    case "forged_cnic_qr": {
      const png = await renderMockCnic(db, { fullName: "Red Team Test", fatherName: "Test Father", cnic: "4210100000001", dob: "1980-01-01", gender: "F", district: "Karachi" }, { tamperQr: true });
      const qr = await checkQr(db, png);
      result = { ...base, actual: qr.found ? (qr.valid ? "QR valid" : `QR invalid (${qr.reason})`) : "QR not found", caught: qr.found && qr.valid === false, detail: qr };
      break;
    }
    case "name_variant_merge": {
      const registry = { fullName: "Muhammad Aslam", fatherName: "Allah Ditta", cnic: "3520112345671", dob: "1975-03-14" };
      const claim = { fullName: "Mohammad Aslam", fatherName: "Ghulam Nabi", cnic: "3520112345671", dob: "1988-11-02" };
      const m = matchIdentity(claim, registry);
      const dups = findDuplicateCandidates({ id: "a", fullName: "Mohammad Aslam", fatherName: "Ghulam Nabi", dob: "1988-11-02", cnic: "3520199999999" }, [{ id: "b", fullName: "Muhammad Aslam", fatherName: "Allah Ditta", dob: "1975-03-14", cnic: "3520112345671" }]);
      result = { ...base, actual: `identity verdict "${m.verdict}", duplicate candidates ${dups.length}`, caught: m.verdict !== "verified" && dups.length === 0, detail: { identity: m, duplicates: dups } };
      break;
    }
    case "revoked_consent": {
      const [helper] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, "helper"))).limit(1);
      const [cz] = await db.select().from(citizens).where(eq(citizens.tenantId, tenantId)).limit(1);
      if (!helper || !cz) return skipped("need a helper and a citizen");
      const sys: Actor = { type: "system", id: "red-team", tenantId, role: "system" };
      const g = await grantConsent(db, sys, { citizenId: cz.id, granteeType: "user", granteeId: helper.id, scopes: ["identity.read"], purpose: "red_team_test", grantedVia: "web" });
      const helperActor: Actor = { type: "user", id: helper.id, role: "helper", tenantId, citizenId: null, displayName: helper.displayName, canSecondApprove: false };
      const before = await assertCitizenAccess(db, { actor: helperActor, actFor: { citizenId: cz.id, consentId: g.id } }, cz.id, "identity.read").then(() => "allowed", (e: AppError) => e.code);
      await withdrawConsent(db, helperActor, g.id, "red-team test");
      const after = await assertCitizenAccess(db, { actor: helperActor, actFor: { citizenId: cz.id, consentId: g.id } }, cz.id, "identity.read").then(() => "allowed", (e: AppError) => e.code);
      // Remove the test grant from view (status already withdrawn; keep the audit trail).
      await db.update(consents).set({ purpose: "red_team_test (withdrawn)" }).where(eq(consents.id, g.id));
      result = { ...base, actual: `before withdrawal: ${before}; after: ${after}`, caught: before === "allowed" && after === "CONSENT_REVOKED", detail: { consentId: g.id } };
      break;
    }
    case "ai_payout": {
      const outcome = await releasePayout(db, AGENT_ACTOR(tenantId), "pay_red_team").then(() => "allowed", (e: AppError) => `${e.status} ${e.code}`);
      result = { ...base, actual: outcome, caught: outcome === "403 AI_CANNOT_INITIATE_PAYMENT", detail: null };
      break;
    }
    case "cross_tenant": {
      const [cz] = await db.select().from(citizens).where(eq(citizens.tenantId, tenantId)).limit(1);
      if (!cz) return skipped("need a citizen");
      const outsider: Actor = { type: "user", id: "usr_outsider", role: "officer", tenantId: "tnt_other_department", citizenId: null, displayName: "Outsider", canSecondApprove: false };
      const outcome = await assertCitizenAccess(db, { actor: outsider }, cz.id, "identity.read").then(() => "allowed", (e: AppError) => `${e.status} ${e.code}`);
      result = { ...base, actual: outcome, caught: outcome === "403 CROSS_TENANT", detail: null };
      break;
    }
    case "audit_chain": {
      const v = await verifyAuditChain(db);
      result = { ...base, actual: v.ok ? `intact (${v.checked} rows)` : `BROKEN at seq ${v.brokenAtSeq}`, caught: v.ok, detail: v };
      break;
    }
  }
  await audit(db, { actor, action: "redteam.attack", targetType: "attack", targetId: id, outcome: result.caught ? "ok" : "error", detail: { actual: result.actual, caught: result.caught } });
  return result;
}

export async function runAllAttacks(db: DB, actor: Actor) {
  const results: Result[] = [];
  for (const a of ATTACKS) results.push(await runAttack(db, actor, a.id));
  const ran = results.filter((r) => !r.actual.startsWith("skipped"));
  return { caught: ran.filter((r) => r.caught).length, ran: ran.length, total: results.length, results };
}
