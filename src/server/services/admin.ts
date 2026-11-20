import { and, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { apiKeys, webhooks, webhookDeliveries, tenants, settings, users, usageCounters } from "../db/schema";
import type { Actor } from "../lib/actor";
import { audit } from "../lib/audit";
import { newId } from "../lib/ids";
import { randomToken, sha256Hex } from "../lib/crypto";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { EVENT_TYPES, enqueueJob } from "./events";
import { publicUser } from "./auth";

export const API_SCOPES = ["cases:read", "cases:write", "verify", "scam:read", "analytics:read", "rules:read", "*"] as const;

function adminOnly(actor: Actor) {
  if (actor.type !== "user" || actor.role !== "admin") throw forbidden("ADMIN_ONLY", "Admins only");
  return actor;
}

export async function createApiKey(db: DB, actor: Actor, name: string, scopes: string[]) {
  const a = adminOnly(actor);
  const bad = scopes.filter((s) => !(API_SCOPES as readonly string[]).includes(s));
  if (bad.length || !scopes.length) throw badRequest("INVALID_SCOPES", `Scopes: ${API_SCOPES.join(", ")}`);
  const prefix = randomToken(4).replace(/[^a-zA-Z0-9]/g, "x").slice(0, 6);
  const secret = `asli_${prefix}_${randomToken(24)}`;
  const id = newId("key");
  await db.insert(apiKeys).values({ id, tenantId: a.tenantId, name, prefix, keyHash: sha256Hex(secret), scopes, createdBy: a.id });
  await audit(db, { actor, action: "admin.api_key_created", targetType: "api_key", targetId: id, detail: { name, scopes } });
  return { id, name, scopes, key: secret, note: "Shown once. Store it securely; send it as the X-API-Key header." };
}

export async function listApiKeys(db: DB, actor: Actor) {
  const a = adminOnly(actor);
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.tenantId, a.tenantId)).orderBy(desc(apiKeys.createdAt));
  return rows.map(({ keyHash: _k, ...r }) => r);
}

export async function revokeApiKey(db: DB, actor: Actor, id: string) {
  const a = adminOnly(actor);
  const [k] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, a.tenantId), isNull(apiKeys.revokedAt)));
  if (!k) throw notFound("API key");
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  await audit(db, { actor, action: "admin.api_key_revoked", targetType: "api_key", targetId: id });
  return { id, revoked: true };
}

export async function createWebhook(db: DB, actor: Actor, url: string, events: string[]) {
  const a = adminOnly(actor);
  if (!/^https?:\/\//.test(url)) throw badRequest("BAD_URL", "Webhook URL must be http(s)");
  const bad = events.filter((e) => e !== "*" && !(EVENT_TYPES as readonly string[]).includes(e));
  if (bad.length) throw badRequest("UNKNOWN_EVENTS", `Events: ${EVENT_TYPES.join(", ")} or *`);
  const id = newId("whk");
  const secret = `whsec_${randomToken(24)}`;
  await db.insert(webhooks).values({ id, tenantId: a.tenantId, url, secret, events, createdBy: a.id });
  await audit(db, { actor, action: "admin.webhook_created", targetType: "webhook", targetId: id, detail: { url, events } });
  return { id, url, events, secret, verify: "HMAC-SHA256 of `${x-asli-timestamp}.${body}` with this secret, sent as x-asli-signature: sha256=<hex>" };
}

export async function listWebhooks(db: DB, actor: Actor) {
  const a = adminOnly(actor);
  const hooks = await db.select().from(webhooks).where(eq(webhooks.tenantId, a.tenantId));
  const out = [];
  for (const { secret: _s, ...h } of hooks) {
    const recent = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, h.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(10);
    out.push({ ...h, recentDeliveries: recent.map(({ payload: _p, ...d }) => d) });
  }
  return out;
}

export async function deleteWebhook(db: DB, actor: Actor, id: string) {
  const a = adminOnly(actor);
  await db.update(webhooks).set({ active: false }).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, a.tenantId)));
  await audit(db, { actor, action: "admin.webhook_disabled", targetType: "webhook", targetId: id });
  return { id, active: false };
}

export async function testWebhook(db: DB, actor: Actor, id: string) {
  const a = adminOnly(actor);
  const [h] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, a.tenantId)));
  if (!h) throw notFound("Webhook");
  const dId = newId("whd");
  await db.insert(webhookDeliveries).values({ id: dId, webhookId: id, event: "test", payload: { id: dId, event: "test", createdAt: new Date().toISOString(), data: { hello: "from Asli" } } });
  await enqueueJob(db, "webhook.deliver", { deliveryId: dId });
  return { deliveryId: dId, queued: true };
}

export async function listUsers(db: DB, actor: Actor) {
  const a = adminOnly(actor);
  const rows = await db.select().from(users).where(eq(users.tenantId, a.tenantId));
  return rows.filter((u) => u.role !== "citizen").map(publicUser);
}

export async function tenantInfo(db: DB, actor: Actor) {
  if (!actor.tenantId) throw forbidden("NO_TENANT", "No department");
  const [tn] = await db.select().from(tenants).where(eq(tenants.id, actor.tenantId));
  const usage = await db.select().from(usageCounters).where(eq(usageCounters.tenantId, actor.tenantId)).orderBy(desc(usageCounters.period)).limit(6);
  return { ...tn, usage };
}

export async function setPlan(db: DB, actor: Actor, plan: "free" | "standard" | "enterprise") {
  const a = adminOnly(actor);
  await db.update(tenants).set({ plan }).where(eq(tenants.id, a.tenantId));
  await audit(db, { actor, action: "admin.plan_changed", targetType: "tenant", targetId: a.tenantId, detail: { plan } });
  return { tenantId: a.tenantId, plan };
}

/** Demo control: simulate a slow network on the mock government services. */
export async function setMockLatency(db: DB, actor: Actor, ms: number) {
  adminOnly(actor);
  const v = Math.max(0, Math.min(5000, Math.round(ms)));
  await db.insert(settings).values({ key: "mock_latency_ms", value: { ms: v } }).onConflictDoUpdate({ target: settings.key, set: { value: { ms: v }, updatedAt: new Date() } });
  await audit(db, { actor, action: "admin.mock_latency_set", detail: { ms: v } });
  return { mockLatencyMs: v };
}
