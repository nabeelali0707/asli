/**
 * Chaos panel + circuit breaker for the SIMULATED government services (nadra, income, raast).
 * Admins can inject latency, random failures, timeouts or a full outage per service; the breaker
 * opens after repeated failures so callers fail fast, then half-opens to probe recovery.
 * The decision pipeline turns an unreachable registry into hard stop S12 ("we do not guess").
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { settings } from "../db/schema";
import { AppError } from "../lib/errors";

export const MOCK_SERVICES = ["nadra", "income", "raast"] as const;
export type MockService = (typeof MOCK_SERVICES)[number];

export type ChaosConfig = { latencyMs: number; failRate: number; timeoutRate: number; down: boolean };
const DEFAULT: ChaosConfig = { latencyMs: 0, failRate: 0, timeoutRate: 0, down: false };

export const BREAKER = { failureThreshold: 3, openMs: 30_000 };
type BreakerState = { state: "closed" | "open" | "half_open"; failures: number; openedAt: number; lastError?: string };
const g = globalThis as unknown as { __asliBreakers?: Record<string, BreakerState> };
const breakers: Record<string, BreakerState> = (g.__asliBreakers ??= {});

function breaker(name: MockService): BreakerState {
  return (breakers[name] ??= { state: "closed", failures: 0, openedAt: 0 });
}

export function resetBreakers() {
  for (const k of Object.keys(breakers)) delete breakers[k];
}

export async function getChaos(db: DbOrTx): Promise<Record<MockService, ChaosConfig>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "chaos"));
  const v = (row?.value ?? {}) as Partial<Record<MockService, Partial<ChaosConfig>>>;
  const [lat] = await db.select().from(settings).where(eq(settings.key, "mock_latency_ms"));
  const globalLatency = Number((lat?.value as { ms?: number } | undefined)?.ms ?? 0);
  return Object.fromEntries(MOCK_SERVICES.map((s) => [s, { ...DEFAULT, ...v[s], latencyMs: Math.max(globalLatency, v[s]?.latencyMs ?? 0) }])) as Record<MockService, ChaosConfig>;
}

export async function setChaos(db: DbOrTx, service: MockService, cfg: Partial<ChaosConfig>) {
  const all = await getChaos(db);
  all[service] = {
    latencyMs: Math.max(0, Math.min(10_000, cfg.latencyMs ?? all[service].latencyMs)),
    failRate: Math.max(0, Math.min(1, cfg.failRate ?? all[service].failRate)),
    timeoutRate: Math.max(0, Math.min(1, cfg.timeoutRate ?? all[service].timeoutRate)),
    down: cfg.down ?? all[service].down,
  };
  await db.insert(settings).values({ key: "chaos", value: all }).onConflictDoUpdate({ target: settings.key, set: { value: all, updatedAt: new Date() } });
  if (!all[service].down && !all[service].failRate) Object.assign(breaker(service), { state: "closed", failures: 0 });
  return all;
}

export function breakerStatus() {
  return Object.fromEntries(
    MOCK_SERVICES.map((s) => {
      const b = breaker(s);
      const remaining = b.state === "open" ? Math.max(0, BREAKER.openMs - (Date.now() - b.openedAt)) : 0;
      return [s, { state: b.state, failures: b.failures, openForMs: remaining, lastError: b.lastError ?? null }];
    }),
  );
}

/** Wrap a call to a simulated service with chaos + circuit breaker. Failures throw 503 SERVICE_UNAVAILABLE. */
export async function withService<T>(db: DbOrTx, name: MockService, fn: () => Promise<T>, timeoutMs = 4_000): Promise<T> {
  const b = breaker(name);
  if (b.state === "open") {
    if (Date.now() - b.openedAt < BREAKER.openMs) throw new AppError(503, "CIRCUIT_OPEN", `${name} is unavailable (circuit open); not retrying yet`, { service: name });
    b.state = "half_open";
  }
  const cfg = (await getChaos(db))[name];
  try {
    const result = await Promise.race([
      (async () => {
        if (cfg.down) throw new AppError(503, "SERVICE_DOWN", `${name} is down (chaos panel)`, { service: name });
        if (cfg.latencyMs) await new Promise((r) => setTimeout(r, cfg.latencyMs));
        if (cfg.timeoutRate && Math.random() < cfg.timeoutRate) await new Promise((r) => setTimeout(r, timeoutMs + 1_000));
        if (cfg.failRate && Math.random() < cfg.failRate) throw new AppError(503, "SERVICE_ERROR", `${name} returned an error (chaos panel)`, { service: name });
        return fn();
      })(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new AppError(503, "SERVICE_TIMEOUT", `${name} timed out after ${timeoutMs} ms`, { service: name })), timeoutMs)),
    ]);
    b.failures = 0;
    b.state = "closed";
    return result;
  } catch (e) {
    if (e instanceof AppError && e.status === 503) {
      b.failures++;
      b.lastError = e.code;
      if (b.state === "half_open" || b.failures >= BREAKER.failureThreshold) {
        b.state = "open";
        b.openedAt = Date.now();
      }
    }
    throw e;
  }
}
