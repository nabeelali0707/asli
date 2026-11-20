/**
 * Domain events → webhooks (HMAC-signed, retried by the job queue) + background jobs.
 * Job types:
 *   webhook.deliver        POST to a subscriber with X-Asli-Signature
 *   notification.send      mock SMS/WhatsApp/IVR gateway (records "sent")
 *   case.proof_deadline    escalate an ask-for-proof case to a human when the deadline passes
 *   drift.check            drift guard: pause the fast lane if overrides/false alarms spike
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { DbOrTx, DB } from "../db/client";
import { jobs, webhooks, webhookDeliveries, notifications } from "../db/schema";
import { newId } from "../lib/ids";
import { hmacHex, canonicalJson } from "../lib/crypto";

export const EVENT_TYPES = [
  "case.created",
  "case.submitted",
  "case.decided",
  "case.needs_proof",
  "case.escalated",
  "case.approved",
  "case.rejected",
  "case.closed",
  "payout.released",
  "consent.withdrawn",
  "scam.reported",
  "rules.published",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export async function enqueueJob(db: DbOrTx, type: string, payload: Record<string, unknown>, runAt = new Date()) {
  const id = newId("job");
  await db.insert(jobs).values({ id, type, payload, runAt });
  return id;
}

export async function emit(db: DbOrTx, tenantId: string, event: EventType, data: Record<string, unknown>) {
  const subs = await db.select().from(webhooks).where(and(eq(webhooks.tenantId, tenantId), eq(webhooks.active, true)));
  for (const s of subs) {
    if (!s.events.includes(event) && !s.events.includes("*")) continue;
    const id = newId("whd");
    const payload = { id, event, createdAt: new Date().toISOString(), data };
    await db.insert(webhookDeliveries).values({ id, webhookId: s.id, event, payload });
    await enqueueJob(db, "webhook.deliver", { deliveryId: id });
  }
}

type JobHandler = (db: DB, payload: Record<string, unknown>) => Promise<void>;
const handlers: Record<string, JobHandler> = {};
export function registerJob(type: string, handler: JobHandler) {
  handlers[type] = handler;
}

registerJob("webhook.deliver", async (db, payload) => {
  const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, String(payload.deliveryId)));
  if (!d || d.status === "delivered") return;
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, d.webhookId));
  if (!hook || !hook.active) return;
  const body = canonicalJson(d.payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  let code: number | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-asli-event": d.event, "x-asli-timestamp": ts, "x-asli-signature": `sha256=${hmacHex(hook.secret, `${ts}.${body}`)}` },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    code = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await db.update(webhookDeliveries).set({ status: "delivered", attempts: d.attempts + 1, responseCode: code }).where(eq(webhookDeliveries.id, d.id));
  } catch (e) {
    await db
      .update(webhookDeliveries)
      .set({ status: d.attempts + 1 >= 5 ? "failed" : "pending", attempts: d.attempts + 1, responseCode: code, lastError: (e as Error).message })
      .where(eq(webhookDeliveries.id, d.id));
    throw e; // job runner schedules a retry with backoff
  }
});

registerJob("notification.send", async (db, payload) => {
  // Mock gateway: SMS/WhatsApp/IVR are simulated; we record that it was "sent".
  await db.update(notifications).set({ status: "sent" }).where(eq(notifications.id, String(payload.notificationId)));
});

/** Run due jobs. Called after requests (best-effort) and by the cron endpoint. */
export async function runDueJobs(db: DB, limit = 20): Promise<{ ran: number; failed: number }> {
  const due = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, new Date())))
    .orderBy(asc(jobs.runAt))
    .limit(limit);
  let ran = 0;
  let failed = 0;
  for (const j of due) {
    // Claim the job (avoid double-run across instances).
    const claimed = await db
      .update(jobs)
      .set({ status: "running", attempts: sql`${jobs.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(jobs.id, j.id), eq(jobs.status, "queued")))
      .returning();
    if (!claimed.length) continue;
    const handler = handlers[j.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${j.type}`);
      await handler(db, j.payload as Record<string, unknown>);
      await db.update(jobs).set({ status: "done", updatedAt: new Date() }).where(eq(jobs.id, j.id));
      ran++;
    } catch (e) {
      failed++;
      const attempts = j.attempts + 1;
      const backoffMs = Math.min(60 * 60_000, 2 ** attempts * 5_000);
      await db
        .update(jobs)
        .set({
          status: attempts >= j.maxAttempts ? "failed" : "queued",
          runAt: new Date(Date.now() + backoffMs),
          lastError: (e as Error).message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, j.id));
    }
  }
  return { ran, failed };
}
