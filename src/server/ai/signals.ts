/**
 * Classification & routing signals. Each function asks Jev small, atomic questions when it is
 * configured, and otherwise uses a deterministic heuristic with the same output shape.
 * Every result says which source produced it, so the auditor trace is honest.
 */
import { jevDecide, type JevQuestion } from "./jev";
import { extractScamFeatures, heuristicScamClassify, SCAM_CATEGORIES, type ScamCategory, type ScamFeatures } from "../domain/scam";
import type { ClassifierSignal } from "../domain/decision";

export type SignalMeta = { source: "jev" | "heuristic"; model: string; latencyMs: number; confidence?: Record<string, number | undefined> };

// ───────────── scam / message classification ─────────────

export type MessageClassification = {
  category: ScamCategory;
  probabilities: Record<ScamCategory, number>;
  asksForFeeOrCode: number; // probability
  impersonatesGovernment: number; // probability
  confidence: number | null;
  features: ScamFeatures;
  meta: SignalMeta;
};

const MESSAGE_QUESTIONS: Record<string, JevQuestion> = {
  category: {
    type: "choice",
    instructions: "What kind of message is this, received by a person in Pakistan who may be waiting for government relief money?",
    criteria: {
      genuine_notice: "A plain official notice about a relief case or payment that asks the person for nothing",
      relief_scam: "Pretends to be a relief or government payment to trick the person",
      fee_request: "Asks the person to pay a fee or charge, or to share an OTP, PIN or code, to receive money",
      phishing_link: "Mainly pushes the person to open a link or install something",
      unrelated: "Not about relief money or government payments",
    },
  },
  asks_fee_or_code: {
    type: "boolean",
    instructions: "Does the message ask the reader to pay any money, fee or charge, or to share an OTP, PIN, password or verification code?",
  },
  impersonates_government: {
    type: "boolean",
    instructions: "Does the message claim to come from a government body or relief programme (such as BISP, Benazir, Ehsaas, or 'the government')?",
  },
};

export async function classifyMessage(text: string, sender?: string | null): Promise<MessageClassification> {
  const features = extractScamFeatures(text, sender);
  const state = `Sender: ${sender ?? "unknown"}\nMessage:\n${text}`;
  const jev = await jevDecide(state, MESSAGE_QUESTIONS);
  if (jev) {
    const cat = jev.answers.category;
    const fee = jev.answers.asks_fee_or_code;
    const gov = jev.answers.impersonates_government;
    if (cat?.type === "choice" && fee?.type === "boolean" && gov?.type === "boolean") {
      const probabilities = Object.fromEntries(
        SCAM_CATEGORIES.map((c) => [c, cat.probabilities?.[c] ?? (c === cat.choice ? 1 : 0)]),
      ) as Record<ScamCategory, number>;
      return {
        category: cat.choice as ScamCategory,
        probabilities,
        asksForFeeOrCode: fee.probability,
        impersonatesGovernment: gov.probability,
        confidence: jev.confidence.category ?? null,
        features,
        meta: { source: "jev", model: jev.model, latencyMs: jev.latencyMs, confidence: jev.confidence },
      };
    }
  }
  const started = Date.now();
  const h = heuristicScamClassify(features);
  return {
    category: h.category,
    probabilities: h.probabilities,
    asksForFeeOrCode: features.asksForFee || features.asksForOtpOrPin ? 0.95 : 0.05,
    impersonatesGovernment: features.claimsGovernment ? 0.8 : 0.1,
    confidence: h.confidence,
    features,
    meta: { source: "heuristic", model: "asli-scam-heuristic@1", latencyMs: Date.now() - started },
  };
}

// ───────────── case evidence signals ─────────────

const CASE_QUESTIONS: Record<string, JevQuestion> = {
  documents_present: {
    type: "boolean",
    instructions: "Has the applicant supplied both an identity card (CNIC) and a proof of income that can be read?",
  },
  income_matches_claim: {
    type: "boolean",
    instructions: "Is the income stated by the applicant consistent with the income shown on their documents and records?",
  },
  conflicting_fields: {
    type: "boolean",
    instructions: "Do any two sources in this case disagree about the same fact (name, CNIC, date of birth, income, household size)?",
  },
  evidence_completeness: {
    type: "score",
    instructions: "How complete is the evidence for deciding this relief claim?",
    criteria: ["Almost nothing provided", "Some key facts missing", "Mostly complete with small gaps", "Complete and consistent"],
  },
};

export type CaseSignalSummary = {
  documentsPresent: boolean;
  incomeStated: number | null;
  incomeOnRecord: number | null;
  incomeOnDocument: number | null;
  nameVariants: string[];
  dobValues: string[];
  householdSizes: number[];
};

export function caseSummaryText(s: CaseSignalSummary): string {
  return [
    `Documents present and readable: ${s.documentsPresent ? "CNIC and income proof" : "incomplete"}`,
    `Income stated by applicant: ${s.incomeStated ?? "not stated"}`,
    `Income in registry: ${s.incomeOnRecord ?? "unknown"}`,
    `Income on uploaded document: ${s.incomeOnDocument ?? "unknown"}`,
    `Names seen across sources: ${s.nameVariants.join(" | ") || "none"}`,
    `Dates of birth seen: ${s.dobValues.join(" | ") || "none"}`,
    `Household sizes seen: ${s.householdSizes.join(" | ") || "none"}`,
  ].join("\n");
}

export async function caseSignals(summary: CaseSignalSummary): Promise<{ signals: ClassifierSignal[]; completeness: number | null; meta: SignalMeta }> {
  const jev = await jevDecide(caseSummaryText(summary), CASE_QUESTIONS);
  if (jev) {
    const signals: ClassifierSignal[] = [];
    for (const id of ["documents_present", "income_matches_claim", "conflicting_fields"] as const) {
      const a = jev.answers[id];
      if (a?.type === "boolean") signals.push({ question: id, probability: a.probability, source: "jev" });
    }
    const c = jev.answers.evidence_completeness;
    return {
      signals,
      completeness: c?.type === "score" ? c.score / 3 : null,
      meta: { source: "jev", model: jev.model, latencyMs: jev.latencyMs, confidence: jev.confidence },
    };
  }
  // Heuristic: compare the numbers directly.
  const incomes = [summary.incomeStated, summary.incomeOnRecord, summary.incomeOnDocument].filter((x): x is number => x !== null);
  const incomeSpread = incomes.length >= 2 ? (Math.max(...incomes) - Math.min(...incomes)) / Math.max(1, Math.max(...incomes)) : null;
  const dobConflict = new Set(summary.dobValues).size > 1;
  const hhConflict = new Set(summary.householdSizes).size > 1;
  const signals: ClassifierSignal[] = [
    { question: "documents_present", probability: summary.documentsPresent ? 0.95 : 0.05, source: "heuristic" },
    { question: "income_matches_claim", probability: incomeSpread === null ? 0.5 : incomeSpread <= 0.15 ? 0.9 : 0.1, source: "heuristic" },
    { question: "conflicting_fields", probability: dobConflict || (incomeSpread !== null && incomeSpread > 0.3) || hhConflict ? 0.85 : 0.08, source: "heuristic" },
  ];
  // "Income matches" with only one source is genuinely unknown — leave it out rather than inject 0.5 noise.
  return {
    signals: signals.filter((s) => !(s.question === "income_matches_claim" && incomeSpread === null)),
    completeness: null,
    meta: { source: "heuristic", model: "asli-case-heuristic@1", latencyMs: 0 },
  };
}

// ───────────── urgency & routing ─────────────

const URGENCY_QUESTIONS: Record<string, JevQuestion> = {
  urgency: {
    type: "score",
    instructions: "How urgent is this case for the person's safety and savings?",
    criteria: ["Informational", "Needs attention this week", "Hardship: household cannot meet basic needs", "Savings at risk now (fraud in progress, money being demanded)"],
  },
  kind: {
    type: "choice",
    instructions: "What is the person asking for?",
    criteria: { claim: "Applying for or following up on relief money", complaint: "Complaining about service, deductions or treatment", scam_report: "Reporting a suspicious message or caller" },
  },
};

export async function urgencyAndKind(text: string): Promise<{ urgency: number; kind: "claim" | "complaint" | "scam_report"; meta: SignalMeta }> {
  const jev = await jevDecide(text, URGENCY_QUESTIONS);
  if (jev && jev.answers.urgency?.type === "score" && jev.answers.kind?.type === "choice") {
    return {
      urgency: jev.answers.urgency.score / 3,
      kind: jev.answers.kind.choice as "claim" | "complaint" | "scam_report",
      meta: { source: "jev", model: jev.model, latencyMs: jev.latencyMs, confidence: jev.confidence },
    };
  }
  const f = extractScamFeatures(text);
  const scam = f.asksForFee || f.asksForOtpOrPin || /scam|fraud|dhoka|دھوکہ|جعلی|fake/i.test(text);
  const complaint = /complain|shikayat|شکایت|deduct|kaat|کاٹ|rude|bad behaviou?r/i.test(text);
  const hardship = /widow|bewa|بیوہ|no food|khana nahi|کھانا نہیں|sick|beemar|بیمار|rent|kiraya/i.test(text);
  return {
    urgency: scam ? 1 : hardship ? 0.67 : complaint ? 0.33 : 0.2,
    kind: scam ? "scam_report" : complaint ? "complaint" : "claim",
    meta: { source: "heuristic", model: "asli-urgency-heuristic@1", latencyMs: 0 },
  };
}
