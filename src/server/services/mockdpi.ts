/**
 * SIMULATED digital public infrastructure — clearly labelled, no real data.
 *   mock NADRA  → identity registry lookup + search (identity.read)
 *   mock income → income/household registry (income.read)
 *   mock Raast  → instant payment ledger (idempotent per payout)
 * Every read is consent-checked for the calling actor and audited; withdrawn consent → 403.
 * Every call goes through the chaos panel + circuit breaker (services/chaos.ts).
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { mockNadra, mockIncome, mockRaastLedger, citizens } from "../db/schema";
import { assertCitizenAccess, type AccessContext } from "./access";
import { audit } from "../lib/audit";
import { forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { normalizeCnic, fsCandidates, type FsRecord } from "../domain/names";
import { withService } from "./chaos";

export async function nadraLookup(db: DbOrTx, ctx: AccessContext, citizenId: string) {
  await assertCitizenAccess(db, ctx, citizenId, "identity.read");
  const rec = await withService(db, "nadra", async () => {
    const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
    const cnic = normalizeCnic(c?.cnic);
    const [r] = cnic ? await db.select().from(mockNadra).where(eq(mockNadra.cnic, cnic)) : [];
    return r ?? null;
  });
  await audit(db, { actor: ctx.actor, action: "mock_nadra.lookup", targetType: "citizen", targetId: citizenId, detail: { found: !!rec, simulated: true }, requestId: ctx.requestId });
  return rec;
}

/** Search the registry when the CNIC is missing: Fellegi–Sunter ranking with an ambiguity flag. */
export async function nadraSearch(db: DbOrTx, ctx: AccessContext, citizenId: string, claim: FsRecord) {
  await assertCitizenAccess(db, ctx, citizenId, "identity.read");
  const result = await withService(db, "nadra", async () => {
    const all = await db.select().from(mockNadra);
    return fsCandidates(claim, all.map((r) => ({ id: r.cnic, fullName: r.fullName, fatherName: r.fatherName, cnic: r.cnic, dob: r.dob, gender: r.gender, district: r.district })));
  });
  await audit(db, { actor: ctx.actor, action: "mock_nadra.search", targetType: "citizen", targetId: citizenId, detail: { candidates: result.candidates.length, bestBits: result.best?.bits ?? null, ambiguous: result.ambiguous, simulated: true }, requestId: ctx.requestId });
  return result;
}

export async function incomeLookup(db: DbOrTx, ctx: AccessContext, citizenId: string) {
  await assertCitizenAccess(db, ctx, citizenId, "income.read");
  const rec = await withService(db, "income", async () => {
    const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
    const cnic = normalizeCnic(c?.cnic);
    const [r] = cnic ? await db.select().from(mockIncome).where(eq(mockIncome.cnic, cnic)) : [];
    return r ?? null;
  });
  await audit(db, { actor: ctx.actor, action: "mock_income.lookup", targetType: "citizen", targetId: citizenId, detail: { found: !!rec, simulated: true }, requestId: ctx.requestId });
  return rec;
}

/** Mock Raast transfer. Only callable from the payout service after human approval(s). */
export async function raastTransfer(db: DbOrTx, args: { payoutId: string; caseId: string; alias: string; amount: number; actorId: string; tenantId: string }) {
  const [existing] = await db.select().from(mockRaastLedger).where(eq(mockRaastLedger.payoutId, args.payoutId));
  if (existing) return existing; // idempotent: a retried release never pays twice
  if (!/^(03\d{9}|PK\d{2}[A-Z]{4}\d{16})$/.test(args.alias)) throw forbidden("RAAST_ALIAS_INVALID", "Payout alias is not a valid mock Raast alias (mobile 03xxxxxxxxx or PK IBAN).");
  return withService(db, "raast", async () => {
    const [row] = await db
      .insert(mockRaastLedger)
      .values({ ref: newId("rst", 12).toUpperCase(), alias: args.alias, amount: args.amount, caseId: args.caseId, payoutId: args.payoutId })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [again] = await db.select().from(mockRaastLedger).where(eq(mockRaastLedger.payoutId, args.payoutId));
    return again!;
  });
}

export async function raastLookup(db: DbOrTx, ref: string) {
  const [row] = await db.select().from(mockRaastLedger).where(eq(mockRaastLedger.ref, ref));
  if (!row) throw notFound("Raast transaction");
  return row;
}
