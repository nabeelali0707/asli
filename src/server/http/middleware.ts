/**
 * Request pipeline: request id → db → authenticate (JWT or API key) → rate limit → plan usage.
 * All access control is enforced here and in services, on the server. The client is never trusted.
 */
import type { MiddlewareHandler } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "./context";
import { getDb } from "../db/client";
import { users, apiKeys, tenants, usageCounters, consents } from "../db/schema";
import { verifyAccessToken } from "../auth/tokens";
import { AppError, forbidden, unauthorized } from "../lib/errors";
import { newId } from "../lib/ids";
import { sha256Hex } from "../lib/crypto";
import { audit } from "../lib/audit";
import type { Actor } from "../lib/actor";
import type { Role } from "../db/schema";
import { rateLimit, PLAN_LIMITS } from "./ratelimit";

export const base: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("requestId", c.req.header("x-request-id") ?? newId("req", 12));
  c.set("db", await getDb());
  await next();
  c.header("x-request-id", c.get("requestId"));
};

function clientIp(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
}

/** Resolve the actor if credentials are present. Does not require them. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = c.get("db");
  const authz = c.req.header("authorization");
  const apiKey = c.req.header("x-api-key");
  if (authz?.startsWith("Bearer ")) {
    const claims = await verifyAccessToken(authz.slice(7));
    if (!claims) throw unauthorized("Invalid or expired token");
    const [u] = await db.select().from(users).where(eq(users.id, claims.sub));
    if (!u || !u.active) throw unauthorized("Account disabled");
    if (u.tokenVersion !== claims.tv) throw unauthorized("Token revoked — please sign in again");
    const actor: Actor = {
      type: "user",
      id: u.id,
      role: u.role,
      tenantId: u.tenantId,
      citizenId: u.citizenId,
      displayName: u.displayName,
      canSecondApprove: u.canSecondApprove,
    };
    c.set("actor", actor);
    if (claims.typ === "family" && claims.af && claims.afc) {
      // Re-check consent on EVERY request: withdrawal must stop access immediately.
      const [consent] = await db.select().from(consents).where(eq(consents.id, claims.afc));
      if (!consent || consent.status !== "active" || consent.citizenId !== claims.af || (consent.expiresAt && consent.expiresAt < new Date())) {
        await audit(db, { actor, action: "helper.family_session.denied", targetType: "citizen", targetId: claims.af, outcome: "denied", detail: { reason: "CONSENT_REVOKED" }, requestId: c.get("requestId") });
        throw forbidden("CONSENT_REVOKED", "The family has withdrawn consent. This session can no longer act for them.");
      }
      c.set("actFor", { citizenId: claims.af, consentId: claims.afc });
    }
  } else if (apiKey) {
    const [k] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, sha256Hex(apiKey)), isNull(apiKeys.revokedAt)));
    if (!k) throw unauthorized("Invalid API key");
    c.set("actor", { type: "api_key", id: k.id, tenantId: k.tenantId, scopes: k.scopes, role: "api" });
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
  }

  // Rate limit per actor (or IP when anonymous), sized by the tenant's plan.
  const actor = c.get("actor");
  let perMinute = 60;
  if (actor && actor.tenantId) {
    const [tn] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, actor.tenantId));
    perMinute = PLAN_LIMITS[tn?.plan ?? "standard"]?.requestsPerMinute ?? 120;
  }
  const rl = rateLimit(actor ? `a:${actor.id}` : `ip:${clientIp(c)}`, perMinute, 60_000);
  c.header("x-ratelimit-remaining", String(rl.remaining));
  if (!rl.ok) {
    c.header("retry-after", String(Math.ceil(rl.resetMs / 1000)));
    throw new AppError(429, "RATE_LIMITED", "Too many requests. Please slow down.");
  }

  // Monthly usage limits for API keys (subscription plans).
  if (actor?.type === "api_key") {
    const period = new Date().toISOString().slice(0, 7);
    const [row] = await db
      .insert(usageCounters)
      .values({ tenantId: actor.tenantId, period, apiCalls: 1 })
      .onConflictDoUpdate({ target: [usageCounters.tenantId, usageCounters.period], set: { apiCalls: sql`${usageCounters.apiCalls} + 1` } })
      .returning();
    const [tn] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, actor.tenantId));
    const limit = PLAN_LIMITS[tn?.plan ?? "standard"]!.apiCallsPerMonth;
    if (row && row.apiCalls > limit) throw new AppError(429, "PLAN_LIMIT_REACHED", `Monthly API limit of ${limit} calls reached for this plan.`);
  }
  await next();
};

export function getActor(c: { get(k: "actor"): Actor | undefined }): Actor {
  const a = c.get("actor");
  if (!a) throw unauthorized();
  return a;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  getActor(c);
  await next();
};

/** Roles allowed for a route. API keys pass only with the listed scope. */
export function requireRole(roles: Role[], apiScope?: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const actor = getActor(c);
    if (actor.type === "user" && roles.includes(actor.role)) return next();
    if (actor.type === "api_key" && apiScope && actor.scopes.includes(apiScope)) return next();
    await audit(c.get("db"), {
      actor,
      action: "access.denied",
      targetType: "route",
      targetId: `${c.req.method} ${c.req.path}`,
      outcome: "denied",
      detail: { needed: roles, apiScope },
      requestId: c.get("requestId"),
    });
    throw forbidden("FORBIDDEN_ROLE", `This action needs one of: ${roles.join(", ")}${apiScope ? ` (or API scope ${apiScope})` : ""}`);
  };
}

export const ipKey = clientIp;
