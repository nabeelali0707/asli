/**
 * Who may touch a citizen's data, and how much of it they see.
 *
 * - citizen  → only their own record, full view.
 * - helper   → only while holding a family session (PIN switch) for that citizen AND an active
 *              consent naming the helper with the needed scope. Checked live on every call.
 * - officer  → same tenant; sees MASKED identity data by default ("prove, don't share").
 *              Full identity fields need a logged break-glass read with a reason.
 * - admin    → same tenant, masked.
 * - auditor  → same tenant, read-only, masked.
 * - AI/agent → acts for the department; needs an active department consent with the scope.
 * - api_key  → tenant + scope.
 */
import { and, eq, or } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { citizens, consents } from "../db/schema";
import type { Actor } from "../lib/actor";
import { forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { maskCnic } from "../domain/names";

export const SCOPES = ["identity.read", "income.read", "documents.read", "case.write", "case.read", "payout.read"] as const;
export type Scope = (typeof SCOPES)[number];

export type AccessContext = { actor: Actor; actFor?: { citizenId: string; consentId: string }; requestId?: string };

export async function activeConsentFor(db: DbOrTx, citizenId: string, grantee: { type: "user" | "department"; id: string }, scope: Scope) {
  const rows = await db
    .select()
    .from(consents)
    .where(and(eq(consents.citizenId, citizenId), eq(consents.granteeType, grantee.type), eq(consents.granteeId, grantee.id), eq(consents.status, "active")));
  const now = new Date();
  return rows.find((r) => r.scopes.includes(scope) && (!r.expiresAt || r.expiresAt > now)) ?? null;
}

export async function getCitizenOr404(db: DbOrTx, citizenId: string) {
  const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
  if (!c) throw notFound("Citizen");
  return c;
}

/**
 * Throws 403 (and writes a denied audit row) unless the actor may use `scope` on this citizen.
 * Returns the view level the actor is entitled to.
 */
export async function assertCitizenAccess(
  db: DbOrTx,
  ctx: AccessContext,
  citizenId: string,
  scope: Scope,
  opts: { write?: boolean } = {},
): Promise<{ view: "full" | "masked"; consentId: string | null }> {
  const { actor } = ctx;
  const citizen = await getCitizenOr404(db, citizenId);
  const deny = async (code: string, message: string) => {
    await audit(db, {
      actor,
      action: `citizen.${scope}`,
      targetType: "citizen",
      targetId: citizenId,
      outcome: "denied",
      detail: { code },
      requestId: ctx.requestId,
    });
    return forbidden(code, message);
  };

  if (actor.tenantId && citizen.tenantId !== actor.tenantId) throw await deny("CROSS_TENANT", "This record belongs to another department.");

  if (actor.type === "user") {
    switch (actor.role) {
      case "citizen":
        if (actor.citizenId !== citizenId) throw await deny("NOT_YOUR_RECORD", "You can only see your own record.");
        return { view: "full", consentId: null };
      case "helper": {
        if (!ctx.actFor || ctx.actFor.citizenId !== citizenId)
          throw await deny("FAMILY_SESSION_REQUIRED", "Switch to this family with their PIN first.");
        const consent = await activeConsentFor(db, citizenId, { type: "user", id: actor.id }, scope);
        if (!consent) throw await deny("CONSENT_REVOKED", `The family has not given (or has withdrawn) consent for ${scope}.`);
        return { view: "full", consentId: consent.id };
      }
      case "officer":
      case "admin":
        return { view: "masked", consentId: null };
      case "auditor":
        if (opts.write) throw await deny("READ_ONLY", "Auditors have read-only access.");
        return { view: "masked", consentId: null };
    }
  }
  if (actor.type === "api_key") {
    if (!actor.scopes.includes(scope) && !actor.scopes.includes("*")) throw await deny("API_SCOPE_MISSING", `API key lacks scope ${scope}.`);
    return { view: "masked", consentId: null };
  }
  // AI / agent / system acting for the department: needs the department's consent.
  if (actor.type === "ai" || actor.type === "agent") {
    const consent = await activeConsentFor(db, citizenId, { type: "department", id: citizen.tenantId }, scope);
    if (!consent) throw await deny("CONSENT_REVOKED", `No active consent for the department to use ${scope}.`);
    return { view: "full", consentId: consent.id };
  }
  return { view: "full", consentId: null };
}

/** Citizen record as the given view level may see it. */
export function presentCitizen(c: typeof citizens.$inferSelect, view: "full" | "masked") {
  const base = {
    id: c.id,
    householdId: c.householdId,
    district: c.district,
    language: c.language,
    gender: c.gender,
    mergedInto: c.mergedInto,
    createdAt: c.createdAt,
  };
  if (view === "full") {
    return { ...base, fullName: c.fullName, fatherName: c.fatherName, cnic: c.cnic, dob: c.dob, phone: c.phone, payoutAlias: c.payoutAlias, view };
  }
  return {
    ...base,
    fullName: c.fullName.split(" ")[0] + " " + c.fullName.split(" ").slice(1).map((p) => p[0] + ".").join(" "),
    fatherName: c.fatherName ? c.fatherName[0] + "." : null,
    cnic: maskCnic(c.cnic),
    dob: c.dob ? c.dob.slice(0, 4) + "-**-**" : null,
    phone: c.phone ? c.phone.slice(0, 4) + "*****" + c.phone.slice(-2) : null,
    payoutAlias: c.payoutAlias ? "****" + c.payoutAlias.slice(-3) : null,
    view,
  };
}

/** Consents where this helper is grantee (for the helper's family list). */
export async function helperFamilies(db: DbOrTx, helperId: string) {
  return db
    .select({ consent: consents, citizen: citizens })
    .from(consents)
    .innerJoin(citizens, eq(consents.citizenId, citizens.id))
    .where(and(eq(consents.granteeType, "user"), eq(consents.granteeId, helperId), or(eq(consents.status, "active"))));
}
