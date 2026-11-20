/**
 * Append-only, hash-chained audit log. Each row stores the hash of the previous row,
 * so editing or deleting any past row breaks the chain — `verifyAuditChain` proves it.
 * Every user, AI, agent, API-key and system action is written here, including denials.
 */
import { asc, desc, sql } from "drizzle-orm";
import { auditLog } from "../db/schema";
import type { DbOrTx } from "../db/client";
import type { Actor } from "./actor";
import { canonicalJson, sha256Hex } from "./crypto";

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

function rowHash(prevHash: string, body: Record<string, unknown>): string {
  return sha256Hex(prevHash + canonicalJson(body));
}

export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialise writers so the chain never forks.
    await tx.execute(sql`select pg_advisory_xact_lock(7316551)`);
    const [last] = await tx.select({ hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
    const prevHash = last?.hash ?? GENESIS_HASH;
    const at = new Date();
    const body = {
      tenantId: entry.tenantId ?? entry.actor.tenantId ?? null,
      at: at.toISOString(),
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      actorRole: entry.actor.role,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      outcome: entry.outcome ?? "ok",
      detail: entry.detail ?? null,
      requestId: entry.requestId ?? null,
    };
    await tx.insert(auditLog).values({
      ...body,
      at,
      actorType: entry.actor.type,
      prevHash,
      hash: rowHash(prevHash, body),
    });
  });
}

export async function verifyAuditChain(db: DbOrTx): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
  const rows = await db.select().from(auditLog).orderBy(asc(auditLog.seq));
  let prev = GENESIS_HASH;
  for (const r of rows) {
    const body = {
      tenantId: r.tenantId ?? null,
      at: r.at.toISOString(),
      actorType: r.actorType,
      actorId: r.actorId,
      actorRole: r.actorRole,
      action: r.action,
      targetType: r.targetType ?? null,
      targetId: r.targetId ?? null,
      outcome: r.outcome,
      detail: r.detail ?? null,
      requestId: r.requestId ?? null,
    };
    if (r.prevHash !== prev || r.hash !== rowHash(prev, body)) {
      return { ok: false, checked: rows.length, brokenAtSeq: r.seq };
    }
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
