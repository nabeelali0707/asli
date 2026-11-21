import { desc, eq } from "drizzle-orm";
import { router, route, z, body, param, need, IdParam, JsonAny } from "../http/route";
import { activeRuleSet, listRuleSets, createDraft, publishRuleSet, simulate, setFastLane } from "../services/rules";
import { createStaffUser, setUserActive } from "../services/auth";
import { createApiKey, listApiKeys, revokeApiKey, createWebhook, listWebhooks, deleteWebhook, testWebhook, listUsers, tenantInfo, setPlan, setMockLatency, API_SCOPES } from "../services/admin";
import { BREAK_IT, runBreakIt } from "../services/breakit";
import { EVENT_TYPES } from "../services/events";
import { ruleSets, settings } from "../db/schema";
import { notFound } from "../lib/errors";
import { FACTS } from "../domain/rules";

export const adminRoutes = router();

// ───────── rules ─────────

adminRoutes.openapi(route({ method: "get", path: "/rules/active", tags: ["Rules"], summary: "The rule version that applies to the next decision" }), async (c) => {
  const a = await need(c, ["officer", "admin", "auditor"], "rules:read");
  return c.json({ ...(await activeRuleSet(c.get("db"), a.tenantId!)), facts: FACTS }, 200);
});

adminRoutes.openapi(route({ method: "get", path: "/rules", tags: ["Rules"], summary: "All rule versions (drafts, published, archived)" }), async (c) => {
  const a = await need(c, ["admin", "auditor", "officer"], "rules:read");
  return c.json({ versions: await listRuleSets(c.get("db"), a.tenantId!) }, 200);
});

const Draft = z.object({ definition: JsonAny.openapi({ description: "Full RuleSetDefinition JSON (see /rules/active for the current one)" }), note: z.string().optional() }).openapi("RuleDraft");
adminRoutes.openapi(route({ method: "post", path: "/rules/drafts", tags: ["Rules"], summary: "Create a draft rule version (validated; no code change, no redeploy)", body: Draft, status: 201 }), async (c) => {
  const a = await need(c, ["admin"]);
  const b = body(c, Draft);
  return c.json(await createDraft(c.get("db"), a, a.tenantId!, b.definition, b.note), 201);
});

adminRoutes.openapi(
  route({
    method: "post",
    path: "/rules/{id}/simulate",
    tags: ["Rules"],
    summary: "Digital Twin: replay a draft on every past case before it goes live",
    description: "Reports who would flip lane or eligibility, the change in money paid out, and the extra human-review load. Writes nothing to cases.",
    params: IdParam,
  }),
  async (c) => {
    const a = await need(c, ["admin", "officer"]);
    const [rs] = await c.get("db").select().from(ruleSets).where(eq(ruleSets.id, param(c)));
    if (!rs || rs.tenantId !== a.tenantId) throw notFound("Rule set");
    return c.json(await simulate(c.get("db"), a.tenantId!, rs.definition, { draftVersion: rs.version }), 200);
  },
);

const SimInline = z.object({ definition: JsonAny }).openapi("SimulateInline");
adminRoutes.openapi(route({ method: "post", path: "/rules/simulate", tags: ["Rules"], summary: "Digital Twin for an unsaved definition", body: SimInline }), async (c) => {
  const a = await need(c, ["admin", "officer"]);
  return c.json(await simulate(c.get("db"), a.tenantId!, body(c, SimInline).definition), 200);
});

adminRoutes.openapi(route({ method: "post", path: "/rules/{id}/publish", tags: ["Rules"], summary: "Publish a draft → applies to the next decision at once", params: IdParam }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await publishRuleSet(c.get("db"), a, a.tenantId!, param(c)), 200);
});

const FastLane = z.object({ enabled: z.boolean(), reason: z.string().min(3) }).openapi("FastLaneSwitch");
adminRoutes.openapi(route({ method: "post", path: "/rules/fast-lane", tags: ["Rules"], summary: "Kill switch: turn the AI fast lane off/on (publishes a new rule version)", body: FastLane }), async (c) => {
  const a = await need(c, ["admin"]);
  const b = body(c, FastLane);
  return c.json(await setFastLane(c.get("db"), a, a.tenantId!, b.enabled, b.reason), 200);
});

// ───────── users, keys, webhooks, tenant ─────────

adminRoutes.openapi(route({ method: "get", path: "/admin/users", tags: ["Admin"], summary: "Staff users in this department" }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json({ users: await listUsers(c.get("db"), a) }, 200);
});

const NewUser = z
  .object({ email: z.string().email(), password: z.string().min(8), role: z.enum(["helper", "officer", "admin", "auditor"]), displayName: z.string().min(2), phone: z.string().optional(), canSecondApprove: z.boolean().optional() })
  .openapi("NewStaffUser");
adminRoutes.openapi(route({ method: "post", path: "/admin/users", tags: ["Admin"], summary: "Create a helper, officer, admin or auditor", body: NewUser, status: 201 }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await createStaffUser(c.get("db"), a, body(c, NewUser)), 201);
});

const Active = z.object({ active: z.boolean() }).openapi("SetActive");
adminRoutes.openapi(route({ method: "post", path: "/admin/users/{id}/active", tags: ["Admin"], summary: "Activate / deactivate a user (revokes their sessions)", params: IdParam, body: Active }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await setUserActive(c.get("db"), a, param(c), body(c, Active).active), 200);
});

adminRoutes.openapi(route({ method: "get", path: "/admin/api-keys", tags: ["Admin"], summary: "API keys (secrets never shown again)" }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json({ keys: await listApiKeys(c.get("db"), a), availableScopes: API_SCOPES }, 200);
});

const NewKey = z.object({ name: z.string().min(2), scopes: z.array(z.enum(API_SCOPES)).min(1) }).openapi("NewApiKey");
adminRoutes.openapi(route({ method: "post", path: "/admin/api-keys", tags: ["Admin"], summary: "Create an API key for the public REST API (shown once)", body: NewKey, status: 201 }), async (c) => {
  const a = await need(c, ["admin"]);
  const b = body(c, NewKey);
  return c.json(await createApiKey(c.get("db"), a, b.name, b.scopes), 201);
});

adminRoutes.openapi(route({ method: "delete", path: "/admin/api-keys/{id}", tags: ["Admin"], summary: "Revoke an API key", params: IdParam }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await revokeApiKey(c.get("db"), a, param(c)), 200);
});

adminRoutes.openapi(route({ method: "get", path: "/admin/webhooks", tags: ["Admin"], summary: "Webhooks and recent deliveries" }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json({ webhooks: await listWebhooks(c.get("db"), a), events: EVENT_TYPES }, 200);
});

const NewHook = z.object({ url: z.string().url(), events: z.array(z.string()).min(1) }).openapi("NewWebhook");
adminRoutes.openapi(route({ method: "post", path: "/admin/webhooks", tags: ["Admin"], summary: "Subscribe an outside system to events (HMAC-signed, retried)", body: NewHook, status: 201 }), async (c) => {
  const a = await need(c, ["admin"]);
  const b = body(c, NewHook);
  return c.json(await createWebhook(c.get("db"), a, b.url, b.events), 201);
});

adminRoutes.openapi(route({ method: "delete", path: "/admin/webhooks/{id}", tags: ["Admin"], summary: "Disable a webhook", params: IdParam }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await deleteWebhook(c.get("db"), a, param(c)), 200);
});

adminRoutes.openapi(route({ method: "post", path: "/admin/webhooks/{id}/test", tags: ["Admin"], summary: "Send a test delivery", params: IdParam }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await testWebhook(c.get("db"), a, param(c)), 200);
});

adminRoutes.openapi(route({ method: "get", path: "/admin/tenant", tags: ["Admin"], summary: "Department workspace, plan and monthly usage" }), async (c) => {
  const a = await need(c, ["admin", "officer", "auditor"]);
  return c.json(await tenantInfo(c.get("db"), a), 200);
});

const Plan = z.object({ plan: z.enum(["free", "standard", "enterprise"]) }).openapi("SetPlan");
adminRoutes.openapi(route({ method: "post", path: "/admin/tenant/plan", tags: ["Admin"], summary: "Change subscription plan (rate + monthly API limits)", body: Plan }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await setPlan(c.get("db"), a, body(c, Plan).plan), 200);
});

const Latency = z.object({ ms: z.number().int().min(0).max(5000) }).openapi("MockLatency");
adminRoutes.openapi(route({ method: "post", path: "/admin/mock-latency", tags: ["Admin"], summary: "Demo: make the mock government services slow (weak-network demo)", body: Latency }), async (c) => {
  const a = await need(c, ["admin"]);
  return c.json(await setMockLatency(c.get("db"), a, body(c, Latency).ms), 200);
});

// ───────── Break It (red team) ─────────

adminRoutes.openapi(route({ method: "get", path: "/redteam/attacks", tags: ["Try to fool Asli"], summary: "Break It: 18 attacks + 8 legitimate controls" }), async (c) => {
  await need(c, ["admin", "officer", "auditor"]);
  return c.json({ items: BREAK_IT }, 200);
});

adminRoutes.openapi(route({ method: "post", path: "/redteam/attacks/{id}", tags: ["Try to fool Asli"], summary: "Run one attack or control (A01–A18, C01–C08)", params: z.object({ id: z.string().regex(/^[AC]\d{2}$/).openapi({ param: { name: "id", in: "path" } }) }) }), async (c) => {
  const a = await need(c, ["admin", "officer", "auditor"]);
  return c.json(await runBreakIt(c.get("db"), a, [c.req.param("id") ?? ""]), 200);
});

adminRoutes.openapi(route({ method: "post", path: "/redteam/run-all", tags: ["Try to fool Asli"], summary: "Run all 18 attacks and 8 controls; misses are listed" }), async (c) => {
  const a = await need(c, ["admin", "officer", "auditor"]);
  const db = c.get("db");
  const result = await runBreakIt(db, a);
  const sm = (result as { summary?: { attacksCaught: { count: number; of: number }; legitimateControlsPassed: { count: number; of: number } } }).summary;
  if (sm) {
    const value = { attacksCaught: sm.attacksCaught, controlsPassed: sm.legitimateControlsPassed, ranAt: new Date().toISOString() };
    await db.insert(settings).values({ key: "redteam_last", value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }
  return c.json(result, 200);
});

export { desc };
