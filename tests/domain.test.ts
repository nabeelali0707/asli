import { describe, it, expect } from "vitest";
import { normalizeName, nameSimilarity, matchIdentity, findDuplicateCandidates } from "@/server/domain/names";
import { DEFAULT_RULESET, evaluateRules, ruleSetDefinitionSchema, benefitAmount } from "@/server/domain/rules";
import { decide, type DecisionInput } from "@/server/domain/decision";
import { extractScamFeatures, heuristicScamClassify } from "@/server/domain/scam";
import { generateSyntheticCases, ruleOfThree } from "@/server/services/eval";
import { heuristicExtract } from "@/server/ai/claude";

describe("names: bad data without wrong matches", () => {
  it("normalises Muhammad / Mohammad / Muhammed / Mohd to one form", () => {
    const forms = ["Muhammad Ali", "Mohammad Ali", "Muhammed Ali", "Mohd. Ali", "محمد علی"];
    expect(new Set(forms.map(normalizeName)).size).toBe(1);
  });
  it("verifies a spelling variant only when CNIC + a supporting fact match", () => {
    const registry = { fullName: "Fatima Bibi", fatherName: "Allah Ditta", cnic: "3520112345671", dob: "1968-04-12" };
    expect(matchIdentity({ fullName: "Fatimah Bibi", cnic: "35201-1234567-1", dob: "1968-04-12" }, registry).verdict).toBe("verified");
    expect(matchIdentity({ fullName: "Fatimah Bibi", cnic: "3520112345671" }, registry).verdict).toBe("probable");
  });
  it("flags a CNIC whose name belongs to someone else as a conflict", () => {
    const registry = { fullName: "Fatima Bibi", fatherName: "Allah Ditta", cnic: "3520112345671", dob: "1968-04-12" };
    expect(matchIdentity({ fullName: "Ghulam Rasool", cnic: "3520112345671" }, registry).verdict).toBe("conflict");
  });
  it("missing CNIC is 'insufficient', never a guess", () => {
    expect(matchIdentity({ fullName: "Fatima Bibi" }, null).verdict).toBe("insufficient");
  });
  it("finds duplicate candidates but needs more than a name", () => {
    const target = { id: "a", fullName: "Mohammad Aslam", fatherName: "Ghulam Nabi", dob: "1975-03-14", cnic: "1111111111111" };
    expect(findDuplicateCandidates(target, [{ id: "b", fullName: "Muhammad Aslam", fatherName: "Ghulam Nabi", dob: "1975-03-14", cnic: "2222222222222" }])).toHaveLength(1);
    expect(findDuplicateCandidates(target, [{ id: "c", fullName: "Muhammad Aslam", fatherName: "Rafiq Ahmad", dob: "1990-01-01", cnic: "3333333333333" }])).toHaveLength(0);
    expect(nameSimilarity("Muhammad Aslam", "Mohammad Aslam")).toBe(1);
  });
});

describe("rules: data-driven and validated", () => {
  it("evaluates pass / fail / unknown and builds counterfactuals", () => {
    const r = evaluateRules(DEFAULT_RULESET, { monthly_income: 52000, age: 40, alive: true, recent_payment_days: 99999 });
    expect(r.eligible).toBe(false);
    expect(r.counterfactuals[0]!.en).toContain("40000");
    expect(evaluateRules(DEFAULT_RULESET, { age: 40, alive: true, recent_payment_days: 99999 }).eligible).toBeNull();
  });
  it("rejects invalid definitions", () => {
    expect(ruleSetDefinitionSchema.safeParse({ ...DEFAULT_RULESET, eligibility: [] }).success).toBe(false);
  });
  it("computes benefit with extras and cap", () => {
    expect(benefitAmount(DEFAULT_RULESET, { household_size: 2 })).toBe(8000);
    expect(benefitAmount(DEFAULT_RULESET, { household_size: 6 })).toBe(12000);
  });
});

function baseInput(over: Partial<Omit<DecisionInput, "ruleSet">> = {}): DecisionInput {
  return {
    ruleSet: { id: "t", version: 1, definition: DEFAULT_RULESET },
    facts: { monthly_income: 15000, household_size: 3, age: 50, alive: true, recent_payment_days: 99999, has_valid_cnic: true },
    factSources: {},
    identity: matchIdentity({ fullName: "Fatima Bibi", cnic: "3520112345671", dob: "1968-04-12" }, { fullName: "Fatima Bibi", fatherName: "Allah Ditta", cnic: "3520112345671", dob: "1968-04-12" }),
    documents: [
      { kind: "cnic", readable: true, blurry: false, qrValid: true, tamperScore: 0, fieldsMatchClaim: null },
      { kind: "income_proof", readable: true, blurry: false, qrValid: null, tamperScore: 0, fieldsMatchClaim: null },
    ],
    duplicates: [],
    consent: { ok: true, missingScopes: [] },
    signals: [],
    ...over,
  };
}

describe("decision engine: three lanes, never a payout", () => {
  it("clean case → fast lane (pre-verified for an officer)", () => {
    const d = decide(baseInput());
    expect(d.lane).toBe("fast");
    expect(d.userReason.en).toContain("Nothing has been paid yet");
  });
  it("blurry income proof → ask for a retake", () => {
    const d = decide(baseInput({ documents: [baseInput().documents[0]!, { kind: "income_proof", readable: false, blurry: true, qrValid: null, tamperScore: 0, fieldsMatchClaim: null }] }));
    expect(d.lane).toBe("ask_proof");
    expect(d.proofItems).toContain("retake_photo");
  });
  it("hard stops override a perfect score", () => {
    expect(decide(baseInput({ duplicates: [{ id: "x", reason: "dup" }] })).hardStops).toContain("DUPLICATE_SUSPECTED");
    expect(decide(baseInput({ consent: { ok: false, missingScopes: ["identity.read"] } })).lane).toBe("human");
    const forged = decide(baseInput({ documents: [{ ...baseInput().documents[0]!, qrValid: false }, baseInput().documents[1]!] }));
    expect(forged.hardStops).toContain("FORGERY_SIGNAL");
  });
  it("failed rule goes to a human, not an automatic rejection", () => {
    const d = decide(baseInput({ facts: { ...baseInput().facts, monthly_income: 90000 } }));
    expect(d.lane).toBe("human");
    expect(d.eligible).toBe(false);
    expect(d.counterfactuals.length).toBeGreaterThan(0);
  });
  it("classifier probability in the uncertainty band blocks the fast lane", () => {
    const d = decide(baseInput({ signals: [{ question: "income_matches_claim", probability: 0.5, source: "jev" }] }));
    expect(d.lane).toBe("human");
    expect(d.policyLane).toBe("fast");
    expect(d.reasonCodes).toContain("ADVISORY_ESCALATION");
    expect(d.modelAdjustments[0]!.to).toBe("human");
  });
  it("kill switch sends would-be fast cases to humans", () => {
    const d = decide({ ...baseInput(), ruleSet: { id: "t", version: 2, definition: { ...DEFAULT_RULESET, fastLaneEnabled: false } } });
    expect(d.lane).toBe("human");
    expect(d.reasonCodes).toContain("FAST_LANE_DISABLED");
  });
});

describe("scam features (English, Urdu, Roman Urdu)", () => {
  it("detects fee / OTP requests and amounts", () => {
    const f = extractScamFeatures("BISP: Mubarak! Rs. 25,000 approve. Rs 500 processing fee jama karwayen 03451234567", "03451234567");
    expect(f.asksForFee).toBe(true);
    expect(f.amounts).toContain(25000);
    expect(heuristicScamClassify(f).category).toBe("fee_request");
    expect(extractScamFeatures("حکومت کی طرف سے 25,000 روپے۔ فیس بھیجیں").asksForFee).toBe(true);
    expect(extractScamFeatures("Share the OTP with our agent").asksForOtpOrPin).toBe(true);
  });
  it("reads Urdu digits", () => {
    expect(extractScamFeatures("رقم ۲۵۰۰۰ روپے").amounts).toContain(25000);
  });
});

describe("offline extraction never guesses", () => {
  it("fills only what was said", () => {
    const x = heuristicExtract("Mera naam Fatima Bibi hai, main bewa hoon. Aamdani 18000 hai. 5 log hain.");
    expect(x.fullName).toBe("Fatima Bibi");
    expect(x.maritalStatus).toBe("widowed");
    expect(x.monthlyIncome).toBe(18000);
    expect(x.cnic).toBeNull();
    expect(x.unclearFields).toContain("cnic");
  });
});

describe("evaluation data", () => {
  it("is deterministic and balanced", () => {
    const a = generateSyntheticCases(7);
    const b = generateSyntheticCases(7);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a).toHaveLength(200);
    expect(new Set(a.map((x) => x.category)).size).toBe(7);
    expect(ruleOfThree(300)).toBe(0.01);
  });
});
