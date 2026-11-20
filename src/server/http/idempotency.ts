/**
 * Idempotency-Key support (weak connections retry; offline outbox replays).
 * Same key + same body → the stored response is returned, nothing runs twice.
 * Same key + different body → 409.
 */
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "./context";
import { idempotencyKeys } from "../db/schema";
import { canonicalJson, sha256Hex } from "../lib/crypto";
import { AppError, conflict } from "../lib/errors";

export async function idempotent<T>(
  c: Context<AppEnv>,
  body: unknown,
  run: () => Promise<{ status: number; body: T }>,
  explicitKey?: string | null,
  opts: { required?: boolean } = {},
): Promise<{ status: number; body: T; replayed: boolean }> {
  const key = explicitKey ?? c.req.header("idempotency-key");
  if (!key && opts.required) throw new AppError(428, "IDEMPOTENCY_KEY_REQUIRED", "Money-moving requests need an Idempotency-Key header so a retry on a weak connection can never pay twice.");
  if (key && (key.length < 8 || key.length > 128)) throw new AppError(400, "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 8-128 characters.");
  if (!key) return { ...(await run()), replayed: false };
  const actor = c.get("actor");
  const scope = `${actor?.id ?? "anon"}:${c.req.method}:${c.req.routePath}`;
  const hash = sha256Hex(canonicalJson(body ?? null));
  const db = c.get("db");
  const [existing] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  if (existing) {
    if (existing.requestHash !== hash) throw conflict("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request body.");
    return { status: existing.status, body: existing.body as T, replayed: true };
  }
  const result = await run();
  if (result.status < 500) {
    await db
      .insert(idempotencyKeys)
      .values({ scope, key, requestHash: hash, status: result.status, body: result.body as object })
      .onConflictDoNothing();
  }
  return { ...result, replayed: false };
}
