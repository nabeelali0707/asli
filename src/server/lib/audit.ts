/**
 * Append-only, hash-chained audit log — enforced INSIDE Postgres (see drizzle/0002_audit_trigger.sql):
 *  - a BEFORE INSERT trigger assigns a contiguous chain_index and hash = sha256(prev_hash || canonical(row));
 *  - UPDATE / DELETE are rejected by a trigger;
 *  - audit_head remembers the newest index + hash, so deleting the newest rows is detected too.
 * The app only inserts; it cannot choose the hash. `verifyAuditChain` names the first broken row.
 * Every user, AI, agent, API-key and system action is written here, including denials.
 */
import { sql } from "drizzle-orm";
import { auditLog } from "../db/schema";
import type { DbOrTx } from "../db/client";
import type { Actor } from "./actor";

export const GENESIS_HASH = "0".repeat(64);

export type AuditEntry = {
  actor: Actor;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: "ok" | "denied" | "error";
  detail?: Record<string, unknown>;
  tenantId?: string | null;
  requestId?: string;
};

export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    tenantId: entry.tenantId ?? entry.actor.tenantId ?? null,
    at: new Date(),
    actorType: entry.actor.type,
    actorId: entry.actor.id,
    actorRole: entry.actor.role,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    outcome: entry.outcome ?? "ok",
    detail: entry.detail ?? null,
    requestId: entry.requestId ?? null,
    prevHash: "", // set by the database trigger
    hash: "", // set by the database trigger
  });
}

export type ChainVerification = { ok: boolean; checked: number; brokenAtSeq?: number; brokenAtIndex?: number; problem?: string };

export async function verifyAuditChain(db: DbOrTx): Promise<ChainVerification> {
  const res = (await db.execute(sql`select * from audit_verify()`)) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  const r = rows[0] ?? { ok: true, checked: 0 };
  return {
    ok: Boolean(r.ok),
    checked: Number(r.checked ?? 0),
    brokenAtSeq: r.first_broken_seq == null ? undefined : Number(r.first_broken_seq),
    brokenAtIndex: r.first_broken_index == null ? undefined : Number(r.first_broken_index),
    problem: (r.problem as string | null) ?? undefined,
  };
}
