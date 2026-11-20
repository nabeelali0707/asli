/**
 * Fixed-window in-memory rate limiter (per instance). Good enough for the prototype and
 * deterministic in tests; swap for Redis/Upstash in production (noted in README).
 */
type Bucket = { windowStart: number; count: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true, remaining: limit - 1, resetMs: windowMs };
  }
  b.count++;
  const resetMs = windowMs - (now - b.windowStart);
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), resetMs };
}

export function resetRateLimits() {
  buckets.clear();
}

export const PLAN_LIMITS: Record<string, { apiCallsPerMonth: number; requestsPerMinute: number }> = {
  free: { apiCallsPerMonth: 1_000, requestsPerMinute: 30 },
  standard: { apiCallsPerMonth: 100_000, requestsPerMinute: 120 },
  enterprise: { apiCallsPerMonth: 5_000_000, requestsPerMinute: 1_000 },
};
