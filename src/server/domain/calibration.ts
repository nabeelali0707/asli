/**
 * Calibrated evidence scorer: logistic regression on deterministic features + isotonic calibration.
 *
 * HONESTY: trained and calibrated on a FROZEN SYNTHETIC benchmark (300 train / 100 calibration /
 * 100 test, split by scenario so templates don't leak). It measures calibration UNDER THAT BENCHMARK;
 * it is not a claim about real-world accuracy. The score can never clear a hard stop (S1–S12), and
 * advisory models (Jev, LLMs) can only add caution on top of it.
 */
import type { DecisionInput } from "./decision";
import { documentScore } from "./decision";
import { evaluateRules } from "./rules";

export const FEATURES = [
  "identity_score",
  "identity_verified",
  "document_score",
  "eligibility_known_share",
  "eligible",
  "max_tamper",
  "any_blurry",
  "duplicate",
] as const;

export function featurize(input: DecisionInput): number[] {
  const def = input.ruleSet.definition;
  const rules = evaluateRules(def, input.facts);
  const known = rules.results.filter((r) => r.result !== "unknown").length;
  return [
    input.identity.score,
    input.identity.verdict === "verified" ? 1 : 0,
    documentScore(def, input.documents),
    rules.results.length ? known / rules.results.length : 1,
    rules.eligible === true ? 1 : 0,
    Math.max(0, ...input.documents.map((d) => d.tamperScore)),
    input.documents.some((d) => d.blurry) ? 1 : 0,
    input.duplicates.length ? 1 : 0,
  ];
}

export type IsotonicMap = { x: number[]; y: number[] };
export type ScoringModel = { features: readonly string[]; weights: number[]; bias: number; isotonic: IsotonicMap; version: number };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function rawScore(m: Pick<ScoringModel, "weights" | "bias">, x: number[]) {
  return sigmoid(m.bias + x.reduce((a, v, i) => a + v * (m.weights[i] ?? 0), 0));
}

/** L2-regularised logistic regression by full-batch gradient descent (small data, deterministic). */
export function trainLogistic(X: number[][], y: number[], opts = { lr: 0.5, iters: 3000, l2: 0.01 }) {
  const d = X[0]?.length ?? 0;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const n = X.length;
  for (let it = 0; it < opts.iters; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(b + X[i]!.reduce((a, v, j) => a + v * w[j]!, 0));
      const e = p - y[i]!;
      for (let j = 0; j < d; j++) gw[j]! += e * X[i]![j]!;
      gb += e;
    }
    for (let j = 0; j < d; j++) w[j]! -= opts.lr * (gw[j]! / n + opts.l2 * w[j]!);
    b -= opts.lr * (gb / n);
  }
  return { weights: w.map((v) => Math.round(v * 1e4) / 1e4), bias: Math.round(b * 1e4) / 1e4 };
}

/** Pool-adjacent-violators: monotone non-decreasing map from raw score to observed frequency. */
export function fitIsotonic(scores: number[], labels: number[], minBlock = 8): IsotonicMap {
  type Block = { sum: number; n: number; lo: number; hi: number };
  const pts = scores.map((s, i) => ({ s, y: labels[i]! })).sort((a, b) => a.s - b.s);
  let blocks: Block[] = pts.map((p) => ({ sum: p.y, n: 1, lo: p.s, hi: p.s }));
  const join = (a: Block, b: Block): Block => ({ sum: a.sum + b.sum, n: a.n + b.n, lo: a.lo, hi: b.hi });
  // Pool-adjacent-violators, then merge blocks smaller than `minBlock` (tiny blocks over-fit a ~100-case
  // calibration set), and repeat until the map is monotone AND every block has enough support.
  for (let changed = true; changed; ) {
    changed = false;
    const pooled: Block[] = [];
    for (const b of blocks) {
      pooled.push(b);
      while (pooled.length > 1 && pooled.at(-2)!.sum / pooled.at(-2)!.n > pooled.at(-1)!.sum / pooled.at(-1)!.n) {
        const y = pooled.pop()!;
        pooled.push(join(pooled.pop()!, y));
        changed = true;
      }
    }
    blocks = pooled;
    const i = blocks.findIndex((b) => b.n < minBlock);
    if (i >= 0 && blocks.length > 1) {
      const j = i === 0 ? 1 : i === blocks.length - 1 ? i - 1 : blocks[i - 1]!.n <= blocks[i + 1]!.n ? i - 1 : i + 1;
      const lo = Math.min(i, j);
      blocks.splice(lo, 2, join(blocks[lo]!, blocks[lo + 1]!));
      changed = true;
    }
  }
  // Smoothed block rates (Jeffreys prior): n positives out of n → (n+0.5)/(n+1), so a model calibrated
  // on ~100 cases never claims certainty (p = 1.0 or 0.0).
  const y: number[] = [];
  for (const b of blocks) y.push(Math.max(y.at(-1) ?? 0, Math.round(((b.sum + 0.5) / (b.n + 1)) * 1e4) / 1e4)); // smoothing must not break monotonicity
  return { x: blocks.map((b) => Math.round(((b.lo + b.hi) / 2) * 1e4) / 1e4), y };
}

export function applyIsotonic(m: IsotonicMap, s: number): number {
  const { x, y } = m;
  if (!x.length) return s;
  if (s <= x[0]!) return y[0]!;
  if (s >= x.at(-1)!) return y.at(-1)!;
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - x[lo]!) / (x[hi]! - x[lo]! || 1);
  return y[lo]! + t * (y[hi]! - y[lo]!);
}

export function calibratedP(m: ScoringModel, input: DecisionInput) {
  const raw = rawScore(m, featurize(input));
  return { raw: Math.round(raw * 1e4) / 1e4, p: Math.round(applyIsotonic(m.isotonic, raw) * 1e4) / 1e4 };
}

// ───────────── metrics ─────────────

export function brier(ps: number[], ys: number[]) {
  return Math.round((ps.reduce((a, p, i) => a + (p - ys[i]!) ** 2, 0) / Math.max(1, ps.length)) * 1e4) / 1e4;
}

export function reliability(ps: number[], ys: number[], bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ bin: `${(i / bins).toFixed(1)}–${((i + 1) / bins).toFixed(1)}`, n: 0, meanPredicted: 0, observed: 0 }));
  ps.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.floor(p * bins));
    out[b]!.n++;
    out[b]!.meanPredicted += p;
    out[b]!.observed += ys[i]!;
  });
  let ece = 0;
  for (const b of out) {
    if (b.n) {
      ece += (b.n / ps.length) * Math.abs(b.meanPredicted / b.n - b.observed / b.n);
      b.meanPredicted = Math.round((b.meanPredicted / b.n) * 1000) / 1000;
      b.observed = Math.round((b.observed / b.n) * 1000) / 1000;
    }
  }
  return { bins: out, ece: Math.round(ece * 1e4) / 1e4 };
}

export function auc(ps: number[], ys: number[]) {
  const pos = ps.filter((_, i) => ys[i] === 1);
  const neg = ps.filter((_, i) => ys[i] === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return Math.round((wins / (pos.length * neg.length)) * 1e4) / 1e4;
}
