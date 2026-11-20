/**
 * Evaluation (Challenge 01: "show the numbers behind your choice") + eval dashboard data.
 *
 * 1. Generate ~200 labelled SYNTHETIC cases across the hard categories (clean eligible, clean
 *    ineligible, missing documents, name-variant duplicates, forged documents, conflicting fields,
 *    unknown-spelling variants). Deterministic seed → reproducible.
 * 2. Split 80/20 (fit / held-out). For every (fastLaneMinScore, askProofMinScore) pair, run the
 *    real decision engine and price each outcome with a cost matrix. Pick the cheapest pair on the
 *    fit split; report it on the held-out split.
 * 3. Report confusion matrix (lane × truth), wrong approvals, false alarms (real claimants slowed),
 *    automation rate, and the cost-vs-automation curve.
 * Costs are prototype ASSUMPTIONS, labelled as such. Synthetic accuracy is not real-world accuracy.
 */
import type { DB } from "../db/client";
import { evalRuns } from "../db/schema";
import { decide, type DecisionInput, type DocumentEvidence } from "../domain/decision";
import { matchIdentity } from "../domain/names";
import type { RuleSetDefinition } from "../domain/rules";
import { newId } from "../lib/ids";
import { audit } from "../lib/audit";
import type { Actor } from "../lib/actor";
import { activeRuleSet, createDraft } from "./rules";

export type Truth = "should_pay" | "should_not_pay" | "needs_info";
export type Category = "clean_eligible" | "clean_ineligible" | "missing_docs" | "duplicate" | "forged" | "conflicting" | "spelling_variant";

export type EvalCostAssumptions = {
  wrongApprovalPKR: number; // money lost if a not-entitled case is paid
  fastLaneMissRate: number; // chance a one-tap officer approval misses a bad fast-lane case
  officerReviewPKR: number; // cost of a full human review
  delayPerRealClaimantPKR: number; // harm of slowing a person who IS entitled
  wastedProofRequestPKR: number; // asking an ineligible/fraud case for more proof
};

export const DEFAULT_COSTS: EvalCostAssumptions = {
  wrongApprovalPKR: 50_000,
  fastLaneMissRate: 0.5,
  officerReviewPKR: 500,
  delayPerRealClaimantPKR: 2_000,
  wastedProofRequestPKR: 300,
};

type SynthCase = { id: string; category: Category; truth: Truth; input: Omit<DecisionInput, "ruleSet"> };

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Fatima Bibi", "Muhammad Aslam", "Zainab Begum", "Ayesha Khan", "Ghulam Rasool", "Shahida Parveen", "Nasreen Akhtar", "Abdul Rahman", "Khadija Bibi", "Yusuf Ali"];
const VARIANT: Record<string, string> = {
  "Muhammad Aslam": "Mohammad Aslam",
  "Fatima Bibi": "Fatimah Bibi",
  "Ayesha Khan": "Aisha Khan",
  "Abdul Rahman": "Abdul Rehman",
  "Yusuf Ali": "Yousaf Ali",
  "Khadija Bibi": "Khadeeja Bibi",
};

export function generateSyntheticCases(seed = 2026, counts: Partial<Record<Category, number>> = {}): SynthCase[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const plan: Record<Category, number> = {
    clean_eligible: 50,
    clean_ineligible: 30,
    missing_docs: 30,
    duplicate: 25,
    forged: 25,
    conflicting: 20,
    spelling_variant: 20,
    ...counts,
  };
  const out: SynthCase[] = [];
  let n = 0;
  const goodDoc = (kind: DocumentEvidence["kind"], noise = 0): DocumentEvidence => ({
    kind,
    readable: rnd() > noise * 0.5,
    blurry: rnd() < noise * 0.3,
    qrValid: kind === "cnic" ? true : null,
    tamperScore: Math.round(rnd() * 0.15 * 100) / 100,
    fieldsMatchClaim: null,
  });
  for (const [category, k] of Object.entries(plan) as [Category, number][]) {
    for (let i = 0; i < k; i++) {
      const name = pick(FIRST);
      const record = { fullName: name, fatherName: pick(["Allah Ditta", "Ghulam Nabi", "Muhammad Iqbal", "Abdul Ghani"]), cnic: String(3520100000000 + Math.floor(rnd() * 99999999)), dob: `19${60 + Math.floor(rnd() * 35)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}` };
      const income = category === "clean_ineligible" ? 45_000 + Math.floor(rnd() * 40_000) : 8_000 + Math.floor(rnd() * 30_000);
      let claim = { ...record };
      let docs: DocumentEvidence[] = [goodDoc("cnic", 0.1), goodDoc("income_proof", 0.1)];
      let duplicates: { id: string; reason: string }[] = [];
      let signals = [{ question: "documents_present", probability: 0.95, source: "heuristic" as const }, { question: "conflicting_fields", probability: 0.06 + rnd() * 0.08, source: "heuristic" as const }];
      let truth: Truth = "should_pay";
      let incomeFact: number | null = income;
      switch (category) {
        case "clean_ineligible":
          truth = "should_not_pay";
          break;
        case "missing_docs":
          docs = rnd() < 0.5 ? [goodDoc("cnic")] : [goodDoc("cnic"), { ...goodDoc("income_proof"), blurry: true, readable: false }];
          if (rnd() < 0.5) incomeFact = null;
          truth = "needs_info";
          break;
        case "duplicate":
          duplicates = [{ id: `ctz_dup${i}`, reason: "same name with matching father's name, different CNIC" }];
          truth = "should_not_pay";
          break;
        case "forged":
          docs = [{ ...goodDoc("cnic"), qrValid: rnd() < 0.6 ? false : true, tamperScore: 0.55 + rnd() * 0.4 }, goodDoc("income_proof")];
          truth = "should_not_pay";
          break;
        case "conflicting":
          claim = { ...record, dob: rnd() < 0.5 ? "1999-01-01" : record.dob, fullName: rnd() < 0.5 ? pick(FIRST) : record.fullName };
          signals = [signals[0]!, { question: "conflicting_fields", probability: 0.75 + rnd() * 0.2, source: "heuristic" as const }];
          truth = "should_not_pay";
          break;
        case "spelling_variant":
          claim = { ...record, fullName: VARIANT[name] ?? name.replace("a", "aa"), fatherName: rnd() < 0.5 ? record.fatherName : "" };
          truth = "should_pay";
          break;
      }
      const identity = matchIdentity(claim, record);
      out.push({
        id: `syn_${String(++n).padStart(3, "0")}`,
        category,
        truth,
        input: {
          facts: {
            monthly_income: incomeFact,
            household_size: 2 + Math.floor(rnd() * 6),
            age: 25 + Math.floor(rnd() * 45),
            marital_status: pick(["widowed", "married", "widowed"]),
            alive: true,
            has_valid_cnic: true,
            recent_payment_days: 99999,
          },
          factSources: { monthly_income: incomeFact === null ? "missing" : "synthetic" },
          identity,
          documents: docs,
          duplicates,
          consent: { ok: true, missingScopes: [] },
          signals,
          amountRequested: null,
        },
      });
    }
  }
  // Deterministic shuffle so the split mixes categories.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function laneCost(lane: string, truth: Truth, c: EvalCostAssumptions): number {
  if (lane === "fast") return truth === "should_pay" ? 0 : c.wrongApprovalPKR * c.fastLaneMissRate;
  if (lane === "ask_proof") return truth === "should_pay" ? c.delayPerRealClaimantPKR : truth === "needs_info" ? 0 : c.wastedProofRequestPKR;
  return c.officerReviewPKR + (truth === "should_pay" ? c.delayPerRealClaimantPKR : 0);
}

function score(cases: SynthCase[], def: RuleSetDefinition, costs: EvalCostAssumptions) {
  const confusion: Record<string, Record<Truth, number>> = { fast: { should_pay: 0, should_not_pay: 0, needs_info: 0 }, ask_proof: { should_pay: 0, should_not_pay: 0, needs_info: 0 }, human: { should_pay: 0, should_not_pay: 0, needs_info: 0 } };
  let total = 0;
  const byCategory: Record<string, Record<string, number>> = {};
  for (const sc of cases) {
    const out = decide({ ...sc.input, ruleSet: { id: "eval", version: 0, definition: def } });
    confusion[out.lane]![sc.truth]++;
    total += laneCost(out.lane, sc.truth, costs);
    byCategory[sc.category] ??= { fast: 0, ask_proof: 0, human: 0 };
    byCategory[sc.category]![out.lane]!++;
  }
  const n = cases.length || 1;
  const wrongApprovals = confusion.fast!.should_not_pay + confusion.fast!.needs_info;
  const realClaimants = cases.filter((c) => c.truth === "should_pay").length;
  const slowedRealClaimants = confusion.ask_proof!.should_pay + confusion.human!.should_pay;
  return {
    expectedCostPerCasePKR: Math.round(total / n),
    automationRate: Math.round((confusion.fast!.should_pay + confusion.fast!.should_not_pay + confusion.fast!.needs_info) / n * 1000) / 1000,
    wrongFastLane: wrongApprovals,
    wrongFastLaneRate: Math.round((wrongApprovals / n) * 1000) / 1000,
    falseAlarms: slowedRealClaimants,
    falseAlarmRate: realClaimants ? Math.round((slowedRealClaimants / realClaimants) * 1000) / 1000 : 0,
    humanReviewShare: Math.round(((confusion.human!.should_pay + confusion.human!.should_not_pay + confusion.human!.needs_info) / n) * 1000) / 1000,
    confusion,
    byCategory,
  };
}

/** Upper 95% bound on an error rate when 0 errors were seen in n trials ("rule of three"). */
export const ruleOfThree = (n: number) => (n > 0 ? Math.round((3 / n) * 1000) / 1000 : 1);

export async function runEvaluation(db: DB, actor: Actor, tenantId: string, opts: { seed?: number; costs?: Partial<EvalCostAssumptions> } = {}) {
  const costs = { ...DEFAULT_COSTS, ...opts.costs };
  const rs = await activeRuleSet(db, tenantId);
  const all = generateSyntheticCases(opts.seed ?? 2026);
  const cut = Math.floor(all.length * 0.8);
  const fit = all.slice(0, cut);
  const heldOut = all.slice(cut);

  const withTh = (fast: number, ask: number): RuleSetDefinition => ({ ...rs.definition, fastLaneEnabled: true, thresholds: { ...rs.definition.thresholds, fastLaneMinScore: fast, askProofMinScore: ask } });
  const grid: { fast: number; ask: number; cost: number; automation: number }[] = [];
  let best = { fast: rs.definition.thresholds.fastLaneMinScore, ask: rs.definition.thresholds.askProofMinScore, cost: Infinity };
  for (let fast = 0.5; fast <= 1.0001; fast += 0.025) {
    for (let ask = 0.2; ask <= fast + 1e-9; ask += 0.05) {
      const s = score(fit, withTh(round3(fast), round3(ask)), costs);
      grid.push({ fast: round3(fast), ask: round3(ask), cost: s.expectedCostPerCasePKR, automation: s.automationRate });
      // Prefer cheaper; on ties prefer the stricter fast-lane cutoff (wrong approvals cost more than slow ones).
      if (s.expectedCostPerCasePKR < best.cost || (s.expectedCostPerCasePKR === best.cost && round3(fast) > best.fast)) best = { fast: round3(fast), ask: round3(ask), cost: s.expectedCostPerCasePKR };
    }
  }
  // Curve: for each fast cutoff, the best ask cutoff → cost vs automation trade-off.
  const curve = [...new Set(grid.map((g) => g.fast))].map((fast) => {
    const rows = grid.filter((g) => g.fast === fast);
    const b = rows.reduce((a, r) => (r.cost < a.cost ? r : a), rows[0]!);
    return { fastLaneMinScore: fast, bestAskProofMinScore: b.ask, expectedCostPerCasePKR: b.cost, automationRate: b.automation };
  });
  const current = score(heldOut, rs.definition, costs);
  const recommended = score(heldOut, withTh(best.fast, best.ask), costs);
  const fitRecommended = score(fit, withTh(best.fast, best.ask), costs);
  const fastCorrectOnHeldOut = recommended.confusion.fast!.should_pay;
  const metrics = {
    syntheticCases: all.length,
    fitCases: fit.length,
    heldOutCases: heldOut.length,
    current: { thresholds: { fast: rs.definition.thresholds.fastLaneMinScore, ask: rs.definition.thresholds.askProofMinScore }, heldOut: current },
    recommended: { thresholds: { fast: best.fast, ask: best.ask }, fit: fitRecommended, heldOut: recommended },
    honesty: {
      note: "Synthetic data and assumed costs. These numbers show HOW thresholds are chosen; they do not prove real-world accuracy.",
      wrongApprovalUpperBound95: recommended.wrongFastLane === 0 ? `0 wrong fast-lane cases in ${heldOut.length} held-out cases → true rate could still be up to ${(ruleOfThree(heldOut.length) * 100).toFixed(1)}% (rule of three)` : `${recommended.wrongFastLane} wrong fast-lane cases in ${heldOut.length}`,
      breakEvenForActingAlone: `Acting alone beats a human review only if P(correct) > ${(1 - costs.officerReviewPKR / costs.wrongApprovalPKR).toFixed(3)}; so Asli never pays without an officer.`,
      fastLaneCorrectHeldOut: fastCorrectOnHeldOut,
    },
  };
  const id = newId("evl");
  await db.insert(evalRuns).values({
    id,
    tenantId,
    ruleVersion: rs.version,
    caseCount: all.length,
    costs,
    metrics,
    curve,
    confusion: recommended.confusion,
    thresholds: { fastLaneMinScore: best.fast, askProofMinScore: best.ask },
    createdBy: actor.id,
  });
  await audit(db, { actor, action: "eval.run", targetType: "eval_run", targetId: id, detail: { ruleVersion: rs.version, recommended: best, costs }, tenantId });
  return { id, ruleVersion: rs.version, costs, metrics, curve, thresholds: { fastLaneMinScore: best.fast, askProofMinScore: best.ask } };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Turn an eval run's recommended thresholds into a rule DRAFT (an admin still has to publish it). */
export async function draftFromEval(db: DB, actor: Actor, tenantId: string, thresholds: { fastLaneMinScore: number; askProofMinScore: number }, evalId: string) {
  const rs = await activeRuleSet(db, tenantId);
  return createDraft(db, actor, tenantId, { ...rs.definition, thresholds: { ...rs.definition.thresholds, ...thresholds } }, `Thresholds from evaluation ${evalId}`);
}
