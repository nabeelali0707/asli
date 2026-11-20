/**
 * Offline-first sync (bonus): the client keeps an outbox of operations made with no signal and
 * replays them here in order. Each op carries a client-generated opId used as an idempotency key,
 * so a replay after a dropped connection never duplicates a case or a document.
 * Ops may refer to a case created earlier in the same batch by its clientRef.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { cases, idempotencyKeys } from "../db/schema";
import { AppError } from "../lib/errors";
import { canonicalJson, sha256Hex } from "../lib/crypto";
import type { AccessContext } from "./access";
import { createCase, updateClaim, addDocument, submitCase } from "./cases";

export type SyncOp =
  | { opId: string; type: "create_case"; clientRef: string; payload: { claim?: Record<string, unknown>; type?: "relief_claim" | "complaint" } }
  | { opId: string; type: "update_claim"; caseRef: string; payload: Record<string, unknown> }
  | { opId: string; type: "add_document"; caseRef: string; payload: { kind: "cnic" | "income_proof" | "other"; mime: string; contentBase64: string } }
  | { opId: string; type: "submit_case"; caseRef: string };

export type SyncResult = { opId: string; status: "applied" | "replayed" | "failed"; result?: unknown; error?: { code: string; message: string } };

export async function applySync(db: DB, ctx: AccessContext, ops: SyncOp[]): Promise<{ results: SyncResult[]; caseMap: Record<string, string> }> {
  const results: SyncResult[] = [];
  const caseMap: Record<string, string> = {};
  const resolve = async (ref: string) => {
    if (ref.startsWith("case_")) return ref;
    if (caseMap[ref]) return caseMap[ref]!;
    const [c] = await db.select({ id: cases.id }).from(cases).where(and(eq(cases.createdBy, ctx.actor.id), eq(cases.clientRef, ref)));
    if (!c) throw new AppError(404, "UNKNOWN_CASE_REF", `No case for clientRef ${ref}`);
    caseMap[ref] = c.id;
    return c.id;
  };
  for (const op of ops) {
    const scope = `${ctx.actor.id}:sync`;
    const hash = sha256Hex(canonicalJson(op));
    const [seen] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, op.opId)));
    if (seen) {
      if (op.type === "create_case") caseMap[op.clientRef] = (seen.body as { caseId?: string }).caseId ?? caseMap[op.clientRef]!;
      results.push({ opId: op.opId, status: seen.requestHash === hash ? "replayed" : "failed", result: seen.body, error: seen.requestHash === hash ? undefined : { code: "OP_ID_REUSED", message: "opId reused with different content" } });
      continue;
    }
    try {
      let result: Record<string, unknown>;
      switch (op.type) {
        case "create_case": {
          const r = await createCase(db, ctx, { type: op.payload.type, claim: op.payload.claim as never, clientRef: op.clientRef, createdVia: "sync" });
          caseMap[op.clientRef] = r.case.id;
          result = { caseId: r.case.id, deduplicated: r.replayed };
          break;
        }
        case "update_claim":
          await updateClaim(db, ctx, await resolve(op.caseRef), op.payload as never);
          result = { caseId: await resolve(op.caseRef) };
          break;
        case "add_document": {
          const d = await addDocument(db, ctx, await resolve(op.caseRef), op.payload);
          result = { documentId: d.id, blurry: d.blurry, retakePrompt: d.retakePrompt };
          break;
        }
        case "submit_case": {
          const s = await submitCase(db, ctx, await resolve(op.caseRef));
          result = { caseId: s.caseId, lane: s.decision.lane, userReason: s.decision.userReason };
          break;
        }
      }
      await db.insert(idempotencyKeys).values({ scope, key: op.opId, requestHash: hash, status: 200, body: result }).onConflictDoNothing();
      results.push({ opId: op.opId, status: "applied", result });
    } catch (e) {
      const err = e instanceof AppError ? { code: e.code, message: e.message } : { code: "INTERNAL", message: (e as Error).message };
      results.push({ opId: op.opId, status: "failed", error: err });
      // Later ops for the same case would fail too; continue so independent ops still apply.
    }
  }
  return { results, caseMap };
}
