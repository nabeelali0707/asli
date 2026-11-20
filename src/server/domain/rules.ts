/**
 * Versioned, data-driven eligibility rules (Challenge 04).
 * Admins edit a JSON definition; it is validated by this schema, stored as a new version,
 * and takes effect on the next decision with no code change or redeploy.
 * Every decision stores the rule set id + version it was made under.
 */
import { z } from "zod";

export const FACTS = [
  "monthly_income",
  "household_size",
  "age",
  "marital_status",
  "gender",
  "district",
  "alive",
  "has_valid_cnic",
  "recent_payment_days", // days since last relief payment; null = never
  "dependents",
] as const;
export type FactName = (typeof FACTS)[number];

const bilingual = z.object({ en: z.string().min(1), ur: z.string().min(1) });

export const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: bilingual,
  fact: z.enum(FACTS),
  op: z.enum(["lt", "lte", "gt", "gte", "eq", "neq", "in", "not_in", "exists"]),
  value: z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  /** Shown to the citizen when this rule fails. {value} and {actual} are filled in. */
  failMessage: bilingual,
  /** What would change the outcome. {value} is filled in. */
  counterfactual: bilingual,
});
export type Rule = z.infer<typeof ruleSchema>;

export const ruleSetDefinitionSchema = z.object({
  program: z.object({
    code: z.string(),
    name: bilingual,
    benefit: z.object({
      base: z.number().int().positive(),
      extras: z
        .array(z.object({ fact: z.enum(FACTS), op: z.enum(["gte", "gt", "eq", "lte", "lt"]), value: z.union([z.number(), z.string()]), add: z.number().int() }))
        .default([]),
      max: z.number().int().positive(),
    }),
  }),
  eligibility: z.array(ruleSchema).min(1),
  requiredDocuments: z.array(z.enum(["cnic", "income_proof"])).default(["cnic", "income_proof"]),
  thresholds: z.object({
    /** Evidence score at/above which a clean case goes to the officer fast lane (pre-verified). */
    fastLaneMinScore: z.number().min(0).max(1),
    /** Below this, the system says "I am not sure" and hands to a human. Between: ask for proof. */
    askProofMinScore: z.number().min(0).max(1),
    secondApproverAbovePKR: z.number().int().nonnegative(),
    proofDeadlineHours: z.number().int().positive(),
    /** Jev / classifier probability bands treated as "not sure". */
    uncertainBand: z.tuple([z.number(), z.number()]).default([0.35, 0.65]),
  }),
  hardStops: z
    .object({
      identityConflict: z.boolean().default(true), // S1 + S2
      identityAmbiguous: z.boolean().default(true), // S3
      duplicateSuspected: z.boolean().default(true), // S4
      deceasedInRegistry: z.boolean().default(true), // S5
      consentMissing: z.boolean().default(true), // S6
      forgerySignal: z.boolean().default(true), // S7
      documentReused: z.boolean().default(true), // S8
      promptInjection: z.boolean().default(true), // S9
      payoutAccountChanged: z.boolean().default(true), // S10
      payoutAccountShared: z.boolean().default(true), // S11
      registryUnavailable: z.boolean().default(true), // S12
    })
    .default({
      identityConflict: true,
      identityAmbiguous: true,
      duplicateSuspected: true,
      deceasedInRegistry: true,
      consentMissing: true,
      forgerySignal: true,
      documentReused: true,
      promptInjection: true,
      payoutAccountChanged: true,
      payoutAccountShared: true,
      registryUnavailable: true,
    }),
  /** Prototype cost assumptions used to DERIVE the auto-approve threshold (labelled as assumptions). */
  costs: z
    .object({
      wrongApprovalPKR: z.number().positive(),
      officerReviewPKR: z.number().nonnegative(),
      delayPKR: z.number().nonnegative(),
      /** Share of wrong PROVISIONAL approvals NOT caught during cooling-off + human release (assumption). */
      provisionalMissRate: z.number().min(0).max(1).default(0.25),
    })
    .default({ wrongApprovalPKR: 50_000, officerReviewPKR: 500, delayPKR: 2_000, provisionalMissRate: 0.25 }),
  /**
   * Provisional auto-approval: the AI may APPROVE a claim alone, but money is only RESERVED.
   * During the cooling-off window the citizen is told, and the citizen or an officer can cancel.
   * Release still needs a human. Threshold = max(floor, (W − R) / (W + D)) on the CALIBRATED score.
   */
  autoApprove: z
    .object({
      enabled: z.boolean().default(true),
      floor: z.number().min(0.5).max(1).default(0.9),
      minCalibratedP: z.number().min(0).max(1).optional().describe("Override; otherwise derived from costs"),
      maxAmountPKR: z.number().int().positive().default(15_000),
      coolingOffHours: z.number().int().min(1).max(168).default(24),
    })
    .default({ enabled: true, floor: 0.9, maxAmountPKR: 15_000, coolingOffHours: 24 }),
  /** Calibrated score below which even a high evidence score cannot enter the fast lane. */
  fastLaneMinCalibratedP: z.number().min(0).max(1).default(0.8),
  /** Kill switch: when false every case goes to a human (also flipped automatically by the drift guard). */
  fastLaneEnabled: z.boolean().default(true),
});
export type RuleSetDefinition = z.infer<typeof ruleSetDefinitionSchema>;

export type Facts = Partial<Record<FactName, string | number | boolean | null>>;

export type RuleResult = {
  ruleId: string;
  label: { en: string; ur: string };
  fact: FactName;
  op: Rule["op"];
  expected: Rule["value"];
  actual: string | number | boolean | null;
  result: "pass" | "fail" | "unknown";
};

function compare(op: Rule["op"], actual: unknown, expected: Rule["value"]): boolean {
  switch (op) {
    case "exists":
      return actual !== null && actual !== undefined && actual !== "";
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual as string | number);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual as string | number);
  }
}

export function evaluateRules(def: RuleSetDefinition, facts: Facts) {
  const results: RuleResult[] = def.eligibility.map((r) => {
    const actual = facts[r.fact];
    const missing = actual === null || actual === undefined;
    return {
      ruleId: r.id,
      label: { en: r.label.en.replace("{value}", String(r.value)), ur: r.label.ur.replace("{value}", String(r.value)) },
      fact: r.fact,
      op: r.op,
      expected: r.value,
      actual: missing ? null : (actual as string | number | boolean),
      result: r.op === "exists" ? (compare("exists", actual, undefined) ? "pass" : "fail") : missing ? "unknown" : compare(r.op, actual, r.value) ? "pass" : "fail",
    };
  });
  const failed = results.filter((r) => r.result === "fail");
  const unknown = results.filter((r) => r.result === "unknown");
  const eligible: boolean | null = failed.length ? false : unknown.length ? null : true;

  const fillMsg = (m: { en: string; ur: string }, rule: Rule, actual: unknown) => ({
    en: m.en.replace("{value}", String(rule.value)).replace("{actual}", String(actual)),
    ur: m.ur.replace("{value}", String(rule.value)).replace("{actual}", String(actual)),
  });
  const ruleById = new Map(def.eligibility.map((r) => [r.id, r]));
  const failMessages = failed.map((f) => fillMsg(ruleById.get(f.ruleId)!.failMessage, ruleById.get(f.ruleId)!, f.actual));
  const counterfactuals = failed.map((f) => fillMsg(ruleById.get(f.ruleId)!.counterfactual, ruleById.get(f.ruleId)!, f.actual));

  return { eligible, results, failMessages, counterfactuals };
}

export function benefitAmount(def: RuleSetDefinition, facts: Facts): number {
  let amount = def.program.benefit.base;
  for (const x of def.program.benefit.extras) {
    const v = facts[x.fact];
    if (v !== null && v !== undefined && compare(x.op, v, x.value)) amount += x.add;
  }
  return Math.min(amount, def.program.benefit.max);
}

/** The default program shipped with the prototype (a mock widow/low-income relief scheme). */
export const DEFAULT_RULESET: RuleSetDefinition = ruleSetDefinitionSchema.parse({
  program: {
    code: "RAHAT-WIDOW-2026",
    name: { en: "Rahat Relief Support (prototype)", ur: "راحت امدادی پروگرام (نمونہ)" },
    benefit: { base: 8000, extras: [{ fact: "household_size", op: "gte", value: 5, add: 4000 }], max: 15000 },
  },
  eligibility: [
    {
      id: "income_limit",
      label: { en: "Monthly household income at or below Rs {value}", ur: "ماہانہ گھریلو آمدنی {value} روپے یا کم" },
      fact: "monthly_income",
      op: "lte",
      value: 40000,
      failMessage: { en: "your recorded monthly income (Rs {actual}) is above Rs {value}", ur: "آپ کی درج ماہانہ آمدنی ({actual} روپے) {value} روپے سے زیادہ ہے" },
      counterfactual: { en: "If proof shows your monthly income is Rs {value} or less, you would qualify.", ur: "اگر ثبوت سے آپ کی ماہانہ آمدنی {value} روپے یا کم ثابت ہو تو آپ اہل ہوں گی۔" },
    },
    {
      id: "adult",
      label: { en: "Applicant is 18 or older", ur: "درخواست دہندہ کی عمر 18 سال یا زیادہ" },
      fact: "age",
      op: "gte",
      value: 18,
      failMessage: { en: "the applicant must be at least {value} years old", ur: "درخواست دہندہ کی عمر کم از کم {value} سال ہونی چاہیے" },
      counterfactual: { en: "An adult family member (18+) can apply for the household instead.", ur: "گھر کا کوئی بالغ فرد (18+) آپ کی جگہ درخواست دے سکتا ہے۔" },
    },
    {
      id: "alive_in_registry",
      label: { en: "Applicant is alive in the identity registry", ur: "شناختی ریکارڈ میں درخواست دہندہ زندہ ہے" },
      fact: "alive",
      op: "eq",
      value: true,
      failMessage: { en: "the identity registry does not show this person as alive", ur: "شناختی ریکارڈ میں یہ شخص زندہ درج نہیں" },
      counterfactual: { en: "If the registry record is wrong, a correction request can fix it.", ur: "اگر ریکارڈ غلط ہے تو درستگی کی درخواست سے ٹھیک ہو سکتا ہے۔" },
    },
    {
      id: "no_recent_payment",
      label: { en: "No relief payment in the last {value} days", ur: "پچھلے {value} دنوں میں کوئی امدادی رقم نہیں ملی" },
      fact: "recent_payment_days",
      op: "gt",
      value: 90,
      failMessage: { en: "a relief payment was already made {actual} days ago (limit: one per {value} days)", ur: "{actual} دن پہلے امدادی رقم پہلے ہی دی جا چکی ہے (حد: ہر {value} دن میں ایک)" },
      counterfactual: { en: "You can apply again once {value} days have passed since your last payment.", ur: "پچھلی ادائیگی کے {value} دن بعد آپ دوبارہ درخواست دے سکتی ہیں۔" },
    },
  ],
  requiredDocuments: ["cnic", "income_proof"],
  thresholds: { fastLaneMinScore: 0.85, askProofMinScore: 0.55, secondApproverAbovePKR: 10000, proofDeadlineHours: 72, uncertainBand: [0.35, 0.65] },
  fastLaneEnabled: true,
});

/** Threshold for provisional auto-approval derived from the cost assumptions.
 *  A wrong PROVISIONAL approval only becomes a loss if the cooling-off and the human release both miss it:
 *  expected loss = W·m (m = provisionalMissRate). Approve alone when (1 − p)·W·m < R + p·D
 *  ⇔ p > (W·m − R) / (W·m + D); never below the floor. */
export function autoApproveThreshold(def: RuleSetDefinition): { threshold: number; derived: number; floor: number; formula: string } {
  const { wrongApprovalPKR: W, officerReviewPKR: R, delayPKR: D } = def.costs;
  const m = def.costs.provisionalMissRate ?? 0.25;
  const Wm = W * m;
  const derived = Math.max(0, Math.round(((Wm - R) / (Wm + D)) * 1000) / 1000);
  const floor = def.autoApprove.floor;
  const threshold = def.autoApprove.minCalibratedP ?? Math.max(floor, derived);
  return { threshold, derived, floor, formula: `max(floor ${floor}, (W·m − R)/(W·m + D) = (${W}·${m} − ${R})/(${W}·${m} + ${D}) = ${derived})` };
}
