/**
 * SIMULATED digital public infrastructure — clearly labelled, no real data.
 *   mock NADRA  → identity registry lookup (identity.read)
 *   mock income → income/household registry (income.read)
 *   mock Raast  → instant payment ledger (idempotent per payout)
 * Every read is consent-checked for the calling actor and audited; withdrawn consent → 403.
 * Latency is simulated (configurable) so weak-network behaviour can be demonstrated.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { mockNadra, mockIncome, mockRaastLedger, citizens, settings } from "../db/schema";
import { assertCitizenAccess, type AccessContext } from "./access";
import { audit } from "../lib/audit";
import { forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { normalizeCnic } from "../domain/names";

async function simulatedLatency(db: DbOrTx) {
  const [row] = await db.select().from(settings).where(eq(settings.key, "mock_latency_ms"));
  const ms = Number((row?.value as { ms?: number } | undefined)?.ms ?? 0);
  if (ms > 0) await new Promise((r) => setTimeout(r, Math.min(ms, 5000)));
}

export async function nadraLookup(db: DbOrTx, ctx: AccessContext, citizenId: string) {
  await assertCitizenAccess(db, ctx, citizenId, "identity.read");
  await simulatedLatency(db);
  const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
  const cnic = normalizeCnic(c?.cnic);
  const [rec] = cnic ? await db.select().from(mockNadra).where(eq(mockNadra.cnic, cnic)) : [];
  await audit(db, {
    actor: ctx.actor,
    action: "mock_nadra.lookup",
    targetType: "citizen",
    targetId: citizenId,
    detail: { found: !!rec, simulated: true },
    requestId: ctx.requestId,
  });
  return rec ?? null;
}

export async function incomeLookup(db: DbOrTx, ctx: AccessContext, citizenId: string) {
  await assertCitizenAccess(db, ctx, citizenId, "income.read");
  await simulatedLatency(db);
  const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
  const cnic = normalizeCnic(c?.cnic);
  const [rec] = cnic ? await db.select().from(mockIncome).where(eq(mockIncome.cnic, cnic)) : [];
  await audit(db, {
    actor: ctx.actor,
    action: "mock_income.lookup",
    targetType: "citizen",
    targetId: citizenId,
    detail: { found: !!rec, simulated: true },
    requestId: ctx.requestId,
  });
  return rec ?? null;
}

/** Mock Raast transfer. Only callable from the payout service after human approval(s). */
export async function raastTransfer(db: DbOrTx, args: { payoutId: string; caseId: string; alias: string; amount: number; actorId: string; tenantId: string }) {
  const [existing] = await db.select().from(mockRaastLedger).where(eq(mockRaastLedger.payoutId, args.payoutId));
  if (existing) return existing; // idempotent: a retried release never pays twice
  if (!/^(03\d{9}|PK\d{2}[A-Z]{4}\d{16})$/.test(args.alias)) throw forbidden("RAAST_ALIAS_INVALID", "Payout alias is not a valid mock Raast alias (mobile 03xxxxxxxxx or PK IBAN).");
  const [row] = await db
    .insert(mockRaastLedger)
    .values({ ref: newId("rst", 12).toUpperCase(), alias: args.alias, amount: args.amount, caseId: args.caseId, payoutId: args.payoutId })
    .returning();
  return row!;
}

export async function raastLookup(db: DbOrTx, ref: string) {
  const [row] = await db.select().from(mockRaastLedger).where(eq(mockRaastLedger.ref, ref));
  if (!row) throw notFound("Raast transaction");
  return row;
}
