/**
 * The decision engine (Challenges 01, 02, 05). Pure function: same inputs → same output.
 *
 * Lanes, from least to most cautious:
 *   auto       → PROVISIONALLY approved by the system alone. Money is only RESERVED; cooling-off
 *                window; citizen told; citizen/officer can cancel; release still needs a human.
 *   fast       → pre-verified; an officer approves with one tap.
 *   ask_proof  → a gap the citizen can close; specific spoken request; escalates after the deadline.
 *   human      → "I am not sure": stop and hand to an officer with notes.
 *
 * Two layers:
 *   1. POLICY (deterministic): rules, identity, documents, hard stops S1–S12, evidence score
 *      S = 0.40·I + 0.35·D + 0.25·E, and the calibrated scorer p (logistic + isotonic).
 *   2. ADVISORY models (Jev, LLM extractions, text classifiers) — ESCALATE-ONLY: they may move a
 *      case to a more cautious lane, never to a less cautious one. Enforced by an invariant below.
 */
import type { IdentityMatch } from "./names";
import { evaluateRules, benefitAmount, autoApproveThreshold, type Facts, type RuleSetDefinition } from "./rules";
import { HARD_STOPS, type HardStopId } from "./hardstops";
import { t, joinList, type Bilingual, type MessageKey } from "../lib/i18n";
import type { Lane } from "../db/schema";

export type DocumentEvidence = {
  kind: "cnic" | "income_proof" | "other";
  readable: boolean;
  blurry: boolean;
  qrValid: boolean | null;
  tamperScore: number;
  fieldsMatchClaim: boolean | null;
};

export type ClassifierSignal = { question: string; probability: number; source: "jev" | "heuristic" | "claude" };

export type DecisionInput = {
  ruleSet: { id: string; version: number; definition: RuleSetDefinition };
  facts: Facts;
  factSources: Record<string, string>;
  identity: IdentityMatch;
  documents: DocumentEvidence[];
  duplicates: { id: string; reason: string }[];
  consent: { ok: boolean; missingScopes: string[] };
  /** Advisory model signals (Jev / heuristic / Claude). Escalate-only. */
  signals: ClassifierSignal[];
  amountRequested?: number | null;
  // Round-3 evidence (all optional so older stored traces still replay).
  identityAmbiguous?: boolean;
  reusedImage?: boolean;
  injection?: { found: boolean; matches: { pattern: string; excerpt: string }[] };
  payoutAccount?: { changedRecently: boolean; sharedWith: string[] };
  registryUnavailable?: string[];
  calibrated?: { p: number; raw: number; modelVersion: number } | null;
};

export type ModelAdjustment = { source: string; from: Lane; to: Lane; reason: string };

export type DecisionOutput = {
  lane: Lane;
  policyLane: Lane;
  eligible: boolean | null;
  score: number;
  components: { identity: number; documents: number; eligibilityEvidence: number };
  calibratedP: number | null;
  hardStops: string[];
  hardStopIds: HardStopId[];
  reasonCodes: string[];
  modelAdjustments: ModelAdjustment[];
  proofItems: string[];
  benefitAmount: number;
  autoApprove: { eligible: boolean; threshold: number; derivedFrom: string; blockers: string[]; coolingOffHours: number; maxAmountPKR: number };
  userReason: Bilingual & { audioKey: string };
  counterfactuals: Bilingual[];
  ruleResults: ReturnType<typeof evaluateRules>["results"];
};

export const WEIGHTS = { identity: 0.4, documents: 0.35, eligibilityEvidence: 0.25 } as const;
export const CAUTION: Record<Lane, number> = { auto: 0, fast: 1, ask_proof: 2, human: 3 };

export function escalate(current: Lane, proposed: Lane): Lane {
  return CAUTION[proposed] > CAUTION[current] ? proposed : current;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function documentScore(def: RuleSetDefinition, docs: DocumentEvidence[]): number {
  if (!def.requiredDocuments.length) return 1;
  const per = def.requiredDocuments.map((kind) => {
    const candidates = docs.filter((d) => d.kind === kind);
    if (!candidates.length) return 0;
    return Math.max(
      ...candidates.map((d) => {
        let s = d.readable ? 1 : 0.3;
        if (d.blurry) s = Math.min(s, 0.4);
        if (d.qrValid === false) s = 0;
        if (d.fieldsMatchClaim === false) s *= 0.5;
        s *= 1 - Math.min(1, Math.max(0, d.tamperScore));
        return s;
      }),
    );
  });
  return per.reduce((a, b) => a + b, 0) / per.length;
}

/** Which hard stops fire. Deterministic; no model output is consulted. */
export function evaluateHardStops(input: DecisionInput): HardStopId[] {
  const hs = input.ruleSet.definition.hardStops;
  const fired: HardStopId[] = [];
  if (hs.identityConflict && input.identity.verdict === "conflict") fired.push("S1");
  if (hs.identityConflict && input.identity.verdict === "no_record") fired.push("S2");
  if (hs.identityAmbiguous && input.identityAmbiguous) fired.push("S3");
  if (hs.duplicateSuspected && input.duplicates.length) fired.push("S4");
  if (hs.deceasedInRegistry && input.facts.alive === false) fired.push("S5");
  if (hs.consentMissing && !input.consent.ok) fired.push("S6");
  if (hs.forgerySignal && input.documents.some((d) => d.qrValid === false || d.tamperScore >= 0.6)) fired.push("S7");
  if (hs.documentReused && input.reusedImage) fired.push("S8");
  if (hs.promptInjection && input.injection?.found) fired.push("S9");
  if (hs.payoutAccountChanged && input.payoutAccount?.changedRecently) fired.push("S10");
  if (hs.payoutAccountShared && (input.payoutAccount?.sharedWith.length ?? 0) > 0) fired.push("S11");
  if (hs.registryUnavailable && (input.registryUnavailable?.length ?? 0) > 0) fired.push("S12");
  return fired;
}

export function decide(input: DecisionInput): DecisionOutput {
  const def = input.ruleSet.definition;
  const th = def.thresholds;
  const rules = evaluateRules(def, input.facts);

  const I = input.identity.score;
  const D = documentScore(def, input.documents);
  const known = rules.results.filter((r) => r.result !== "unknown").length;
  const E = rules.results.length ? known / rules.results.length : 1;
  const score = round(WEIGHTS.identity * I + WEIGHTS.documents * D + WEIGHTS.eligibilityEvidence * E);
  const benefit = benefitAmount(def, input.facts);
  const p = input.calibrated?.p ?? null;

  const hardStopIds = evaluateHardStops(input);
  const hardStops = hardStopIds.map((id) => HARD_STOPS[id].code);
  const reasonCodes: string[] = [];

  // Proof the citizen can supply to close a gap.
  const proofItems = new Set<string>();
  for (const kind of def.requiredDocuments) {
    const docs = input.documents.filter((d) => d.kind === kind);
    if (!docs.length) proofItems.add(kind);
    else if (docs.every((d) => d.blurry || !d.readable)) proofItems.add("retake_photo");
  }
  if (input.identity.verdict === "insufficient") proofItems.add("cnic");
  if (input.identity.verdict === "candidate" || input.identity.verdict === "probable") {
    const fatherUnknown = input.identity.evidence.find((e) => e.check === "father_name")?.result !== "pass";
    const dobUnknown = input.identity.evidence.find((e) => e.check === "dob")?.result !== "pass";
    if (fatherUnknown) proofItems.add("father_name");
    if (fatherUnknown && dobUnknown) proofItems.add("dob");
  }
  for (const r of rules.results) if (r.result === "unknown" && r.fact === "monthly_income") proofItems.add("income_proof");

  // ── 1. POLICY lane (deterministic + calibrated scorer) ──
  const aa = autoApproveThreshold(def);
  const autoBlockers: string[] = [];
  if (!def.autoApprove.enabled) autoBlockers.push("auto-approve disabled in rules");
  if (!def.fastLaneEnabled) autoBlockers.push("fast lane switched off (kill switch / drift guard)");
  if (p === null) autoBlockers.push("no calibrated score");
  else if (p < aa.threshold) autoBlockers.push(`calibrated p ${p} < threshold ${aa.threshold}`);
  if (benefit > def.autoApprove.maxAmountPKR) autoBlockers.push(`amount Rs ${benefit} > cap Rs ${def.autoApprove.maxAmountPKR}`);
  if (input.identity.verdict !== "verified") autoBlockers.push(`identity is "${input.identity.verdict}", not verified`);

  let policyLane: Lane;
  let messageKey: MessageKey;
  if (hardStops.length) {
    policyLane = "human";
    messageKey = "lane.human";
    reasonCodes.push("HARD_STOP");
  } else if (rules.eligible === false) {
    policyLane = "human"; // never auto-reject: blocking a real person is also a cost
    messageKey = "lane.ineligible";
    reasonCodes.push("RULE_FAILED");
  } else if (proofItems.size && score >= th.askProofMinScore) {
    policyLane = "ask_proof";
    messageKey = "lane.ask_proof";
    reasonCodes.push("PROOF_NEEDED");
  } else if (score >= th.fastLaneMinScore && rules.eligible === true && !proofItems.size) {
    if (!def.fastLaneEnabled) {
      policyLane = "human";
      messageKey = "lane.human";
      reasonCodes.push("FAST_LANE_DISABLED");
    } else if (!autoBlockers.length) {
      policyLane = "auto";
      messageKey = "lane.auto";
      reasonCodes.push("PROVISIONALLY_APPROVED");
    } else if (p !== null && p < def.fastLaneMinCalibratedP) {
      policyLane = "human";
      messageKey = "lane.human";
      reasonCodes.push("CALIBRATED_SCORE_LOW");
    } else {
      policyLane = "fast";
      messageKey = "lane.fast";
      reasonCodes.push("PRE_VERIFIED");
    }
  } else {
    policyLane = "human";
    messageKey = "lane.human";
    reasonCodes.push(score < th.askProofMinScore ? "LOW_EVIDENCE" : "NOT_SURE");
  }
  if (hardStops.length) autoBlockers.push(...hardStops.map((h) => `hard stop ${h}`));

  // ── 2. ADVISORY models: escalate-only ──
  let lane = policyLane;
  const modelAdjustments: ModelAdjustment[] = [];
  const [lo, hi] = th.uncertainBand;
  for (const s of input.signals) {
    let proposed: Lane | null = null;
    let reason = "";
    if (s.probability > lo && s.probability < hi) {
      proposed = "human";
      reason = `${s.question} p=${s.probability} is inside the "not sure" band ${lo}–${hi}`;
    } else if (s.question === "conflicting_fields" && s.probability >= hi) {
      proposed = "human";
      reason = `sources disagree (p=${s.probability})`;
    } else if (s.question === "documents_present" && s.probability <= lo && CAUTION[lane] < CAUTION.ask_proof) {
      proposed = "ask_proof";
      reason = `model thinks documents are incomplete (p=${s.probability})`;
    } else if (s.question === "income_matches_claim" && s.probability <= lo) {
      proposed = "human";
      reason = `stated income does not match records (p=${s.probability})`;
    }
    if (proposed) {
      const next = escalate(lane, proposed);
      if (next !== lane) {
        modelAdjustments.push({ source: `${s.source}:${s.question}`, from: lane, to: next, reason });
        lane = next;
      }
    }
  }
  if (CAUTION[lane] < CAUTION[policyLane]) {
    // Invariant: an advisory model can never remove caution. Unreachable by construction; fail loudly if not.
    throw new Error(`ESCALATE_ONLY_VIOLATION: ${policyLane} → ${lane}`);
  }
  if (lane !== policyLane) {
    reasonCodes.push("ADVISORY_ESCALATION");
    if (lane === "human") messageKey = "lane.human";
    else if (lane === "ask_proof" && messageKey !== "lane.ask_proof") {
      messageKey = "lane.ask_proof";
      if (!proofItems.size) proofItems.add("income_proof");
    }
  }
  if (lane !== "auto" && autoBlockers.length === 0) autoBlockers.push("advisory model escalated the case");

  const counterfactuals: Bilingual[] = [...rules.counterfactuals];
  if (lane === "ask_proof" && proofItems.has("income_proof")) {
    counterfactuals.push({
      en: "Once your income proof is checked, your case can move to an officer for approval.",
      ur: "آپ کی آمدنی کے ثبوت کی جانچ کے بعد آپ کا کیس منظوری کے لیے افسر کے پاس جا سکتا ہے۔",
    });
  }
  if (hardStopIds.includes("S1")) {
    counterfactuals.push({
      en: "If the name on your ID card matches the government record, the case can continue. An officer will check it with you.",
      ur: "اگر آپ کے شناختی کارڈ کا نام سرکاری ریکارڈ سے مل جائے تو کیس آگے بڑھ سکتا ہے۔ ایک افسر آپ کے ساتھ اس کی جانچ کرے گا۔",
    });
  }
  if (hardStopIds.includes("S12")) {
    counterfactuals.push({ en: "We will try the government records again automatically. You do not need to do anything.", ur: "ہم سرکاری ریکارڈ کو خود دوبارہ چیک کریں گے۔ آپ کو کچھ کرنے کی ضرورت نہیں۔" });
  }

  let userReason: Bilingual & { audioKey: string };
  const vars: Record<string, string | number> = { hours: th.proofDeadlineHours, coolHours: def.autoApprove.coolingOffHours, amount: benefit };
  if (messageKey === "lane.ask_proof") {
    const items = joinList([...proofItems].map((pi) => t(`proof.${pi}` as MessageKey)));
    userReason = { en: t(messageKey, { ...vars, items: items.en }).en, ur: t(messageKey, { ...vars, items: items.ur }).ur, audioKey: messageKey };
  } else if (messageKey === "lane.ineligible") {
    const reason = joinList(rules.failMessages);
    userReason = { en: t(messageKey, { reason: reason.en }).en, ur: t(messageKey, { reason: reason.ur }).ur, audioKey: messageKey };
  } else userReason = t(messageKey, vars);

  return {
    lane,
    policyLane,
    eligible: rules.eligible,
    score,
    components: { identity: round(I), documents: round(D), eligibilityEvidence: round(E) },
    calibratedP: p,
    hardStops,
    hardStopIds,
    reasonCodes,
    modelAdjustments,
    proofItems: [...proofItems],
    benefitAmount: benefit,
    autoApprove: { eligible: lane === "auto", threshold: aa.threshold, derivedFrom: aa.formula, blockers: lane === "auto" ? [] : autoBlockers, coolingOffHours: def.autoApprove.coolingOffHours, maxAmountPKR: def.autoApprove.maxAmountPKR },
    userReason,
    counterfactuals,
    ruleResults: rules.results,
  };
}
