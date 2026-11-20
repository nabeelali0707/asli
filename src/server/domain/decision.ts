/**
 * The decision engine (Challenges 01, 02, 05). Pure function: same inputs → same output.
 *
 * Three lanes, never a payout:
 *   fast       → pre-verified, goes to an officer as a one-tap approval (AI NEVER pays).
 *   ask_proof  → a gap the citizen can close; specific spoken request; escalates after the deadline.
 *   human      → "I am not sure": stop and hand to an officer with notes.
 *
 * Evidence score (transparent, not a probability):  S = 0.40·I + 0.35·D + 0.25·E
 *   I = identity match strength, D = document quality, E = share of eligibility facts known.
 * Cutoffs live in the versioned rule set and are fitted on labelled cases by the eval module.
 * Hard stops override any score.
 */
import type { IdentityMatch } from "./names";
import { evaluateRules, benefitAmount, type Facts, type RuleSetDefinition } from "./rules";
import { t, joinList, type Bilingual, type MessageKey } from "../lib/i18n";
import type { Lane } from "../db/schema";

export type DocumentEvidence = {
  kind: "cnic" | "income_proof" | "other";
  readable: boolean;
  blurry: boolean;
  qrValid: boolean | null; // null = no QR present / not checkable
  tamperScore: number; // 0..1 (forensics)
  fieldsMatchClaim: boolean | null;
};

export type ClassifierSignal = {
  question: string;
  probability: number; // probability the statement is TRUE
  source: "jev" | "heuristic" | "claude";
};

export type DecisionInput = {
  ruleSet: { id: string; version: number; definition: RuleSetDefinition };
  facts: Facts;
  factSources: Record<string, string>;
  identity: IdentityMatch;
  documents: DocumentEvidence[];
  duplicates: { id: string; reason: string }[];
  consent: { ok: boolean; missingScopes: string[] };
  signals: ClassifierSignal[];
  amountRequested?: number | null;
};

export type DecisionOutput = {
  lane: Lane;
  eligible: boolean | null;
  score: number;
  components: { identity: number; documents: number; eligibilityEvidence: number };
  hardStops: string[];
  reasonCodes: string[];
  proofItems: string[];
  benefitAmount: number;
  userReason: Bilingual & { audioKey: string };
  counterfactuals: Bilingual[];
  ruleResults: ReturnType<typeof evaluateRules>["results"];
};

export const WEIGHTS = { identity: 0.4, documents: 0.35, eligibilityEvidence: 0.25 } as const;

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

export function decide(input: DecisionInput): DecisionOutput {
  const def = input.ruleSet.definition;
  const th = def.thresholds;
  const rules = evaluateRules(def, input.facts);

  const I = input.identity.score;
  const D = documentScore(def, input.documents);
  const known = rules.results.filter((r) => r.result !== "unknown").length;
  const E = rules.results.length ? known / rules.results.length : 1;
  const score = round(WEIGHTS.identity * I + WEIGHTS.documents * D + WEIGHTS.eligibilityEvidence * E);

  const reasonCodes: string[] = [];
  const hardStops: string[] = [];
  const hs = def.hardStops;

  if (hs.identityConflict && input.identity.verdict === "conflict") hardStops.push("IDENTITY_CONFLICT");
  if (hs.identityConflict && input.identity.verdict === "no_record") hardStops.push("IDENTITY_NOT_IN_REGISTRY");
  if (hs.forgerySignal && input.documents.some((d) => d.qrValid === false || d.tamperScore >= 0.6)) hardStops.push("FORGERY_SIGNAL");
  if (hs.duplicateSuspected && input.duplicates.length) hardStops.push("DUPLICATE_SUSPECTED");
  if (hs.deceasedInRegistry && input.facts.alive === false) hardStops.push("DECEASED_IN_REGISTRY");
  if (hs.consentMissing && !input.consent.ok) hardStops.push("CONSENT_MISSING");

  // Proof the citizen can supply to close the gap.
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

  // Classifier signals inside the uncertainty band count as "not sure".
  const [lo, hi] = th.uncertainBand;
  const uncertain = input.signals.filter((s) => s.probability > lo && s.probability < hi);
  if (uncertain.length) reasonCodes.push("CLASSIFIER_UNCERTAIN");
  const contradicting = input.signals.filter((s) => s.question === "conflicting_fields" && s.probability >= hi);
  if (contradicting.length) reasonCodes.push("CONFLICTING_FIELDS");

  let lane: Lane;
  let messageKey: MessageKey;
  const counterfactuals: Bilingual[] = [...rules.counterfactuals];

  if (hardStops.length) {
    lane = "human";
    messageKey = "lane.human";
    reasonCodes.push("HARD_STOP");
  } else if (rules.eligible === false) {
    lane = "human"; // never auto-reject: blocking a real person is also a cost
    messageKey = "lane.ineligible";
    reasonCodes.push("RULE_FAILED");
  } else if (proofItems.size && score >= th.askProofMinScore) {
    lane = "ask_proof";
    messageKey = "lane.ask_proof";
    reasonCodes.push("PROOF_NEEDED");
  } else if (
    score >= th.fastLaneMinScore &&
    rules.eligible === true &&
    !proofItems.size &&
    !uncertain.length &&
    !contradicting.length
  ) {
    if (def.fastLaneEnabled) {
      lane = "fast";
      messageKey = "lane.fast";
      reasonCodes.push("PRE_VERIFIED");
    } else {
      lane = "human";
      messageKey = "lane.human";
      reasonCodes.push("FAST_LANE_DISABLED");
    }
  } else {
    lane = "human";
    messageKey = "lane.human";
    reasonCodes.push(score < th.askProofMinScore ? "LOW_EVIDENCE" : "NOT_SURE");
  }

  const proofList = [...proofItems];
  const vars: Record<string, string | number> = { hours: th.proofDeadlineHours };
  if (messageKey === "lane.ask_proof") {
    const items = joinList(proofList.map((p) => t(`proof.${p}` as MessageKey)));
    const en = t(messageKey, { ...vars, items: items.en });
    const ur = t(messageKey, { ...vars, items: items.ur });
    return finish({ en: en.en, ur: ur.ur, audioKey: messageKey });
  }
  if (messageKey === "lane.ineligible") {
    const reason = joinList(rules.failMessages);
    const en = t(messageKey, { reason: reason.en });
    const ur = t(messageKey, { reason: reason.ur });
    return finish({ en: en.en, ur: ur.ur, audioKey: messageKey });
  }
  return finish(t(messageKey, vars));

  function finish(userReason: Bilingual & { audioKey: string }): DecisionOutput {
    if (lane === "ask_proof" && proofItems.has("income_proof")) {
      counterfactuals.push({
        en: "Once your income proof is checked, your case can move to an officer for approval.",
        ur: "آپ کی آمدنی کے ثبوت کی جانچ کے بعد آپ کا کیس منظوری کے لیے افسر کے پاس جا سکتا ہے۔",
      });
    }
    if (hardStops.includes("IDENTITY_CONFLICT")) {
      counterfactuals.push({
        en: "If the name on your ID card matches the government record, the case can continue. An officer will check it with you.",
        ur: "اگر آپ کے شناختی کارڈ کا نام سرکاری ریکارڈ سے مل جائے تو کیس آگے بڑھ سکتا ہے۔ ایک افسر آپ کے ساتھ اس کی جانچ کرے گا۔",
      });
    }
    return {
      lane,
      eligible: rules.eligible,
      score,
      components: { identity: round(I), documents: round(D), eligibilityEvidence: round(E) },
      hardStops,
      reasonCodes,
      proofItems: proofList,
      benefitAmount: benefitAmount(def, input.facts),
      userReason,
      counterfactuals,
      ruleResults: rules.results,
    };
  }
}
