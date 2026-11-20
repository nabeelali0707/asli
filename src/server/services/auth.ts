import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { users, citizens, tenants, consents } from "../db/schema";
import { issueToken, hashPassword, checkPassword } from "../auth/tokens";
import { newId } from "../lib/ids";
import { audit } from "../lib/audit";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/errors";
import type { Actor } from "../lib/actor";
import { normalizeName, normalizeCnic } from "../domain/names";
import { rateLimit } from "../http/ratelimit";
import { grantConsent } from "./consent";
import { helperFamilies, presentCitizen } from "./access";
import type { Role } from "../db/schema";

export function publicUser(u: typeof users.$inferSelect) {
  return { id: u.id, email: u.email, role: u.role, displayName: u.displayName, tenantId: u.tenantId, citizenId: u.citizenId, canSecondApprove: u.canSecondApprove, phone: u.phone };
}

export async function login(db: DB, email: string, password: string, ip: string) {
  const rl = rateLimit(`login:${ip}:${email.toLowerCase()}`, 10, 15 * 60_000);
  if (!rl.ok) throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many sign-in attempts. Try again in 15 minutes.");
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  const system: Actor = { type: "system", id: "auth", tenantId: u?.tenantId ?? null, role: "system" };
  if (!u || !u.active || !(await checkPassword(password, u.passwordHash))) {
    await audit(db, { actor: system, action: "auth.login", outcome: "denied", detail: { email: email.toLowerCase() } });
    throw unauthorized("Wrong email or password");
  }
  const { token, expiresAt } = await issueToken({ sub: u.id, tid: u.tenantId, role: u.role, tv: u.tokenVersion, typ: "access" });
  await audit(db, { actor: { type: "user", id: u.id, role: u.role, tenantId: u.tenantId, citizenId: u.citizenId, displayName: u.displayName, canSecondApprove: u.canSecondApprove }, action: "auth.login" });
  return { token, expiresAt, user: publicUser(u) };
}

export async function logoutEverywhere(db: DB, actor: Actor) {
  if (actor.type !== "user") throw forbidden("USERS_ONLY", "Only user sessions can be revoked");
  const [u] = await db.select().from(users).where(eq(users.id, actor.id));
  await db.update(users).set({ tokenVersion: (u?.tokenVersion ?? 0) + 1 }).where(eq(users.id, actor.id));
  await audit(db, { actor, action: "auth.logout_all" });
  return { ok: true };
}

export async function defaultTenantId(db: DB, slug?: string) {
  const [tn] = slug ? await db.select().from(tenants).where(eq(tenants.slug, slug)) : await db.select().from(tenants).limit(1);
  if (!tn) throw notFound("Department");
  return tn.id;
}

/** Self sign-up for a citizen (phone-first; email optional → we derive a login id from the phone). */
export async function registerCitizen(
  db: DB,
  input: { fullName: string; phone: string; password: string; pin?: string; email?: string; tenantSlug?: string; fatherName?: string; cnic?: string; dob?: string; district?: string; language?: "ur" | "en"; payoutAlias?: string },
) {
  const tenantId = await defaultTenantId(db, input.tenantSlug);
  const email = (input.email ?? `${input.phone.replace(/\D/g, "")}@phone.asli`).toLowerCase();
  const [exists] = await db.select().from(users).where(eq(users.email, email));
  if (exists) throw conflict("ACCOUNT_EXISTS", "An account already exists for this phone/email");
  if (input.pin && !/^\d{4,6}$/.test(input.pin)) throw badRequest("BAD_PIN", "PIN must be 4-6 digits");
  const citizenId = newId("ctz");
  await db.insert(citizens).values({
    id: citizenId,
    tenantId,
    fullName: input.fullName,
    nameKey: normalizeName(input.fullName),
    fatherName: input.fatherName ?? null,
    cnic: normalizeCnic(input.cnic) ?? null,
    dob: input.dob ?? null,
    district: input.district ?? null,
    phone: input.phone,
    language: input.language ?? "ur",
    payoutAlias: input.payoutAlias ?? null,
    pinHash: input.pin ? await hashPassword(input.pin) : null,
  });
  const userId = newId("usr");
  await db.insert(users).values({ id: userId, tenantId, email, phone: input.phone, passwordHash: await hashPassword(input.password), role: "citizen", displayName: input.fullName, citizenId });
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const actor: Actor = { type: "user", id: userId, role: "citizen", tenantId, citizenId, displayName: input.fullName, canSecondApprove: false };
  await audit(db, { actor, action: "auth.registered", targetType: "citizen", targetId: citizenId });
  const { token, expiresAt } = await issueToken({ sub: userId, tid: tenantId, role: "citizen", tv: 0, typ: "access" });
  return { token, expiresAt, user: publicUser(u!) };
}

export async function createStaffUser(db: DB, actor: Actor, input: { email: string; password: string; role: Role; displayName: string; phone?: string; canSecondApprove?: boolean }) {
  if (actor.type !== "user" || actor.role !== "admin") throw forbidden("ADMIN_ONLY", "Only admins manage users");
  if (input.role === "citizen") throw badRequest("USE_SIGNUP", "Citizens register themselves or are enrolled by a helper");
  const [exists] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase()));
  if (exists) throw conflict("ACCOUNT_EXISTS", "Email already used");
  const id = newId("usr");
  await db.insert(users).values({ id, tenantId: actor.tenantId, email: input.email.toLowerCase(), phone: input.phone ?? null, passwordHash: await hashPassword(input.password), role: input.role, displayName: input.displayName, canSecondApprove: !!input.canSecondApprove });
  await audit(db, { actor, action: "admin.user_created", targetType: "user", targetId: id, detail: { role: input.role } });
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return publicUser(u!);
}

export async function setUserActive(db: DB, actor: Actor, userId: string, active: boolean) {
  if (actor.type !== "user" || actor.role !== "admin") throw forbidden("ADMIN_ONLY", "Only admins manage users");
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.tenantId, actor.tenantId)));
  if (!u) throw notFound("User");
  await db.update(users).set({ active, tokenVersion: u.tokenVersion + 1 }).where(eq(users.id, userId));
  await audit(db, { actor, action: active ? "admin.user_activated" : "admin.user_deactivated", targetType: "user", targetId: userId });
  return { id: userId, active };
}

// ─────────────────────────── helper mode ───────────────────────────

/** A helper enrols a family on the shared phone. The family sets their own PIN and confirms consent aloud. */
export async function enrolFamily(
  db: DB,
  helper: Actor,
  input: { fullName: string; fatherName?: string; cnic?: string; dob?: string; phone?: string; district?: string; payoutAlias?: string; pin: string; spokenConsent: string; householdLabel?: string },
) {
  if (helper.type !== "user" || helper.role !== "helper") throw forbidden("HELPER_ONLY", "Only community helpers enrol families");
  if (!/^\d{4,6}$/.test(input.pin)) throw badRequest("BAD_PIN", "PIN must be 4-6 digits");
  if (input.spokenConsent.trim().length < 2) throw badRequest("CONSENT_REQUIRED", "The family must confirm consent (spoken confirmation transcript)");
  const citizenId = newId("ctz");
  await db.insert(citizens).values({
    id: citizenId,
    tenantId: helper.tenantId,
    fullName: input.fullName,
    nameKey: normalizeName(input.fullName),
    fatherName: input.fatherName ?? null,
    cnic: normalizeCnic(input.cnic) ?? null,
    dob: input.dob ?? null,
    phone: input.phone ?? null,
    district: input.district ?? null,
    payoutAlias: input.payoutAlias ?? null,
    pinHash: await hashPassword(input.pin),
  });
  const enrolment: Actor = { type: "system", id: `enrolment:${helper.id}`, tenantId: helper.tenantId, role: "system" };
  const consent = await grantConsent(db, enrolment, {
    citizenId,
    granteeType: "user",
    granteeId: helper.id,
    scopes: ["case.write", "case.read", "documents.read", "identity.read", "payout.read"],
    purpose: "helper_assistance",
    expiresInDays: 180,
    grantedVia: "voice",
  });
  await audit(db, { actor: helper, action: "helper.family_enrolled", targetType: "citizen", targetId: citizenId, detail: { consentId: consent.id, spokenConsent: input.spokenConsent.slice(0, 300) } });
  return { citizenId, consent };
}

export async function listFamilies(db: DB, helper: Actor) {
  if (helper.type !== "user" || helper.role !== "helper") throw forbidden("HELPER_ONLY", "Helpers only");
  const rows = await helperFamilies(db, helper.id);
  const seen = new Map<string, { citizen: ReturnType<typeof presentCitizen>; consentId: string; scopes: string[]; expiresAt: Date | null }>();
  for (const r of rows) {
    if (r.consent.status !== "active" || (r.consent.expiresAt && r.consent.expiresAt < new Date())) continue;
    // On the shared phone the list shows first name + initial only; full data needs the PIN switch.
    seen.set(r.citizen.id, { citizen: presentCitizen(r.citizen, "masked"), consentId: r.consent.id, scopes: r.consent.scopes, expiresAt: r.consent.expiresAt });
  }
  return [...seen.values()];
}

/** PIN switch: returns a short-lived token that can act ONLY for this family, checked live against consent. */
export async function switchFamily(db: DB, helper: Actor, citizenId: string, pin: string) {
  if (helper.type !== "user" || helper.role !== "helper") throw forbidden("HELPER_ONLY", "Helpers only");
  const rl = rateLimit(`pin:${helper.id}:${citizenId}`, 5, 15 * 60_000);
  if (!rl.ok) {
    await audit(db, { actor: helper, action: "helper.switch", targetType: "citizen", targetId: citizenId, outcome: "denied", detail: { reason: "PIN_LOCKED" } });
    throw new AppError(429, "PIN_LOCKED", "Too many wrong PINs. This family is locked on this phone for 15 minutes.");
  }
  const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId));
  if (!c || c.tenantId !== helper.tenantId) throw notFound("Family");
  if (!c.pinHash || !(await checkPassword(pin, c.pinHash))) {
    await audit(db, { actor: helper, action: "helper.switch", targetType: "citizen", targetId: citizenId, outcome: "denied", detail: { reason: "WRONG_PIN", attemptsLeft: rl.remaining } });
    throw forbidden("WRONG_PIN", `Wrong PIN. ${rl.remaining} attempts left.`);
  }
  const [consent] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.citizenId, citizenId), eq(consents.granteeType, "user"), eq(consents.granteeId, helper.id), eq(consents.status, "active")));
  if (!consent || (consent.expiresAt && consent.expiresAt < new Date())) {
    await audit(db, { actor: helper, action: "helper.switch", targetType: "citizen", targetId: citizenId, outcome: "denied", detail: { reason: "CONSENT_REVOKED" } });
    throw forbidden("CONSENT_REVOKED", "This family has not given (or has withdrawn) permission.");
  }
  const [u] = await db.select().from(users).where(eq(users.id, helper.id));
  const { token, expiresAt } = await issueToken({ sub: helper.id, tid: helper.tenantId, role: "helper", tv: u!.tokenVersion, af: citizenId, afc: consent.id, typ: "family" }, 20 * 60);
  await audit(db, { actor: helper, action: "helper.switch", targetType: "citizen", targetId: citizenId, detail: { consentId: consent.id } });
  return { familyToken: token, expiresAt, citizen: presentCitizen(c, "full"), consentScopes: consent.scopes };
}
