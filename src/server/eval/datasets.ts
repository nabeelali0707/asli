/**
 * Six FROZEN synthetic datasets (spec: datasets/SPEC.md). Generated deterministically from fixed
 * seeds and committed as JSON with sha256 hashes in datasets/manifest.json, so every number we
 * publish has a fixed denominator and can be reproduced.
 *
 *   D1 decision-cases     500 labelled cases; split BY SCENARIO POOL: 300 train / 100 calibration / 100 test
 *   D2 identity-pairs     300 labelled record pairs (same person / different person), name variants
 *   D3 scam-messages      scam / genuine / benign messages incl. LEGITIMATE CONTROLS (Urdu, Roman Urdu, English)
 *   D4 document-specs     document scenarios rendered and checked live (clean, blurry, edited QR, third-party QR, injection)
 *   D5 policy-questions   answerable (with gold passage) vs unanswerable questions
 *   D6 attacks            18 scripted attacks + 8 legitimate controls (Break It)
 *
 * Realism knobs (so calibration is not trivially perfect): ~8% of clean-looking cases are HIDDEN
 * fraud (should not pay, invisible to features); some real claimants have messy evidence.
 */
import { matchIdentity } from "../domain/names";
import type { DocumentEvidence, DecisionInput } from "../domain/decision";

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────── D1 decision cases ─────────────

export type Truth = "should_pay" | "should_not_pay" | "needs_info";
export type Category = "clean_eligible" | "clean_ineligible" | "missing_docs" | "duplicate" | "forged" | "conflicting" | "spelling_variant" | "messy_but_real" | "hidden_fraud";
export type DecisionCase = { id: string; split: "train" | "calibration" | "test"; pool: string; category: Category; truth: Truth; input: Omit<DecisionInput, "ruleSet"> };

const POOLS = {
  A: { first: ["Fatima Bibi", "Muhammad Aslam", "Zainab Begum", "Ayesha Khan", "Ghulam Rasool"], fathers: ["Allah Ditta", "Ghulam Nabi", "Muhammad Iqbal"], districts: ["Lahore", "Kasur"] },
  B: { first: ["Shahida Parveen", "Nasreen Akhtar", "Abdul Rahman", "Khadija Bibi"], fathers: ["Abdul Ghani", "Noor Muhammad", "Rasheed Ahmad"], districts: ["Multan", "Bahawalpur"] },
  C: { first: ["Yusuf Ali", "Rubina Kausar", "Muhammad Saleem", "Naseem Akhtar"], fathers: ["Abdul Karim", "Muhammad Rafiq", "Sher Muhammad"], districts: ["Karachi", "Hyderabad"] },
} as const;
const VARIANT: Record<string, string> = {
  "Muhammad Aslam": "Mohammad Aslam",
  "Fatima Bibi": "Fatimah Bibi",
  "Ayesha Khan": "Aisha Khan",
  "Abdul Rahman": "Abdul Rehman",
  "Yusuf Ali": "Yousaf Ali",
  "Khadija Bibi": "Khadeeja Bibi",
  "Muhammad Saleem": "Muhammed Saleem",
  "Shahida Parveen": "Shahida Perveen",
  "Nasreen Akhtar": "Nasrin Akhtar",
  "Zainab Begum": "Zainab Begam",
  "Ghulam Rasool": "Gulam Rasool",
  "Rubina Kausar": "Rubina Kauser",
  "Naseem Akhtar": "Nasim Akhtar",
};

const PLAN: Record<Category, number> = {
  clean_eligible: 26,
  hidden_fraud: 6,
  messy_but_real: 10,
  clean_ineligible: 12,
  missing_docs: 12,
  duplicate: 10,
  forged: 10,
  conflicting: 8,
  spelling_variant: 6,
}; // = 100 per block

export function genDecisionBlock(seed: number, poolName: keyof typeof POOLS, split: DecisionCase["split"], blocks: number): DecisionCase[] {
  const rnd = mulberry32(seed);
  const pool = POOLS[poolName];
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const out: DecisionCase[] = [];
  const doc = (kind: DocumentEvidence["kind"], over: Partial<DocumentEvidence> = {}): DocumentEvidence => ({ kind, readable: true, blurry: false, qrValid: kind === "cnic" ? true : null, tamperScore: Math.round(rnd() * 0.12 * 100) / 100, fieldsMatchClaim: null, ...over });
  let n = 0;
  for (let b = 0; b < blocks; b++) {
    for (const [category, k] of Object.entries(PLAN) as [Category, number][]) {
      for (let i = 0; i < k; i++) {
        const name = pick(pool.first);
        const record = {
          fullName: name,
          fatherName: pick(pool.fathers),
          cnic: String(3520100000000 + Math.floor(rnd() * 899999999)),
          dob: `19${55 + Math.floor(rnd() * 40)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
        };
        let claim: { fullName: string; fatherName: string | null; cnic: string; dob: string | null } = { ...record };
        let income: number | null = category === "clean_ineligible" ? 41_000 + Math.floor(rnd() * 50_000) : 7_000 + Math.floor(rnd() * 32_000);
        let docs = [doc("cnic"), doc("income_proof")];
        let duplicates: { id: string; reason: string }[] = [];
        let conflicting = 0.04 + rnd() * 0.1;
        let truth: Truth = "should_pay";
        switch (category) {
          case "hidden_fraud": // looks clean; fraud is invisible to every feature → honest calibration
            truth = "should_not_pay";
            docs = [doc("cnic", { tamperScore: Math.round((0.1 + rnd() * 0.35) * 100) / 100 }), doc("income_proof")];
            break;
          case "messy_but_real":
            claim = { ...record, fatherName: rnd() < 0.5 ? null : record.fatherName, dob: rnd() < 0.4 ? null : record.dob, fullName: VARIANT[name] ?? name };
            docs = [doc("cnic", { tamperScore: Math.round((0.15 + rnd() * 0.3) * 100) / 100 }), doc("income_proof", { readable: rnd() > 0.3 })];
            conflicting = 0.2 + rnd() * 0.25;
            break;
          case "clean_ineligible":
            truth = "should_not_pay";
            break;
          case "missing_docs":
            docs = rnd() < 0.5 ? [doc("cnic")] : [doc("cnic"), doc("income_proof", { blurry: true, readable: false })];
            if (rnd() < 0.5) income = null;
            truth = "needs_info";
            break;
          case "duplicate":
            duplicates = [{ id: `ctz_dup_${seed}_${n}`, reason: "same name with matching father's name, different CNIC" }];
            truth = "should_not_pay";
            break;
          case "forged":
            docs = [doc("cnic", rnd() < 0.5 ? { qrValid: false, tamperScore: 0.9 } : { tamperScore: Math.round((0.45 + rnd() * 0.5) * 100) / 100 }), doc("income_proof")];
            truth = "should_not_pay";
            break;
          case "conflicting":
            claim = { ...record, dob: rnd() < 0.5 ? "1999-01-01" : record.dob, fullName: rnd() < 0.5 ? pick(pool.first) : record.fullName };
            conflicting = 0.7 + rnd() * 0.25;
            truth = "should_not_pay";
            break;
          case "spelling_variant":
            claim = { ...record, fullName: VARIANT[name] ?? name, fatherName: rnd() < 0.5 ? record.fatherName : null };
            break;
        }
        out.push({
          id: `d1_${split}_${String(++n).padStart(3, "0")}`,
          split,
          pool: poolName,
          category,
          truth,
          input: {
            facts: { monthly_income: income, household_size: 1 + Math.floor(rnd() * 8), age: 22 + Math.floor(rnd() * 50), marital_status: pick(["widowed", "married", "widowed", "divorced"]), alive: true, has_valid_cnic: true, recent_payment_days: 99999 },
            factSources: { monthly_income: income === null ? "missing" : "synthetic" },
            identity: matchIdentity(claim, record),
            documents: docs,
            duplicates,
            consent: { ok: true, missingScopes: [] },
            signals: [
              { question: "documents_present", probability: docs.length === 2 && docs.every((d) => d.readable) ? 0.93 : 0.12, source: "heuristic" },
              { question: "conflicting_fields", probability: Math.round(conflicting * 100) / 100, source: "heuristic" },
            ],
            amountRequested: null,
          },
        });
      }
    }
  }
  return out;
}

export function genD1(): DecisionCase[] {
  return [...genDecisionBlock(101, "A", "train", 3), ...genDecisionBlock(202, "B", "calibration", 1), ...genDecisionBlock(303, "C", "test", 1)];
}

// ───────────── D2 identity pairs ─────────────

export type IdentityPair = { id: string; a: { fullName: string; fatherName: string | null; cnic: string | null; dob: string | null }; b: { fullName: string; fatherName: string; cnic: string; dob: string }; same: boolean; kind: string };

export function genD2(): IdentityPair[] {
  const rnd = mulberry32(404);
  const names = [...POOLS.A.first, ...POOLS.B.first, ...POOLS.C.first];
  const fathers = [...POOLS.A.fathers, ...POOLS.B.fathers, ...POOLS.C.fathers];
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const out: IdentityPair[] = [];
  const mk = () => ({ fullName: pick(names), fatherName: pick(fathers), cnic: String(3520100000000 + Math.floor(rnd() * 899999999)), dob: `19${55 + Math.floor(rnd() * 40)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}` });
  const kinds: [string, number][] = [["exact", 60], ["variant_spelling", 60], ["variant_missing_father", 40], ["same_name_different_person", 60], ["cnic_reused_by_other", 40], ["typo_in_cnic", 40]];
  let n = 0;
  for (const [kind, k] of kinds) {
    for (let i = 0; i < k; i++) {
      const b = mk();
      let a: IdentityPair["a"] = { ...b };
      let same = true;
      if (kind === "variant_spelling") a = { ...b, fullName: VARIANT[b.fullName] ?? b.fullName.replace(/a/, "aa"), fatherName: b.fatherName };
      if (kind === "variant_missing_father") a = { ...b, fullName: VARIANT[b.fullName] ?? b.fullName, fatherName: null };
      if (kind === "same_name_different_person") {
        same = false;
        a = { fullName: b.fullName, fatherName: pick(fathers.filter((f) => f !== b.fatherName)), cnic: b.cnic, dob: "1999-12-31" };
      }
      if (kind === "cnic_reused_by_other") {
        same = false;
        a = { fullName: pick(names.filter((x) => x !== b.fullName)), fatherName: pick(fathers), cnic: b.cnic, dob: null };
      }
      if (kind === "typo_in_cnic") {
        same = true;
        a = { ...b, cnic: b.cnic.slice(0, 12) + String((Number(b.cnic.at(-1)) + 1) % 10) };
      }
      out.push({ id: `d2_${String(++n).padStart(3, "0")}`, a, b, same, kind });
    }
  }
  return out;
}

// ───────────── D3 scam messages ─────────────

export type MessageCase = { id: string; text: string; sender: string | null; label: "scam" | "genuine_like" | "benign"; isControl: boolean; note: string };

export function genD3(): MessageCase[] {
  const scams = [
    ["BISP: Mubarak ho! Aap ki Rs. 25,000 relief payment approve ho gayi hai. Release ke liye Rs 500 processing fee 03451234567 par jama karwayen.", "03451234567"],
    ["Benazir program: your Rs 12,000 is ready. Share the OTP sent to your phone with our agent to receive it.", "03009998887"],
    ["Govt Relief 2026: click bit.ly/relief-pk to claim Rs 30,000 before midnight.", "03112223334"],
    ["Ehsaas: Rs 25000 approved. Call 03211112222 on WhatsApp to confirm your CNIC and PIN.", "03211112222"],
    ["حکومت کی طرف سے آپ کو 25,000 روپے امداد منظور ہوئی ہے۔ فیس 1000 روپے ایزی پیسہ کریں۔", "03331110000"],
    ["BISP: Rs. 25,000 aap ke liye manzoor. Registration fee 300 rupay bhejein.", "03451234567"],
    ["Congratulations! PM relief package Rs 35,000. Send Rs 999 service charges via JazzCash to activate.", "03015556667"],
    ["URGENT: your relief will expire today. Verify your account at relief-gov.xyz with your PIN.", "03004440001"],
    ["آپ کی امدادی رقم روک دی گئی ہے۔ کوڈ بتائیں تاکہ رقم جاری ہو۔", "03216665544"],
    ["Rahat program: Rs 15,000 credited. Pay Rs 200 SMS charges to receive.", "03121231234"],
  ];
  const genuineLike = [
    ["Relief payment update: your application is under review. No action needed.", "8171"],
    ["Asli: we received your application, case K7Q2XM. Your code is 4821.", "ASLI"],
    ["Asli: there is an update on your case P3RT9Z. Your code is 1904.", "ASLI"],
    ["Your BISP payment can be collected from the nearest campsite with your CNIC. No fee is required.", "8171"],
  ];
  const benign = [
    ["Your electricity bill of Rs 3,450 is due on 25 Nov. Pay at any bank.", "LESCO"],
    ["School fee for November is Rs 1,500. Please submit by Friday.", "03001234000"],
    ["Ammi, I sent you Rs 2,000 on Easypaisa for groceries.", "03009876543"],
    ["Your OTP for logging in to your bank app is 482913. Do not share it.", "BANK"],
    ["کل شام کو سب گھر آ جائیں، دعوت ہے۔", "03111222333"],
    ["Pharmacy: your medicine order of Rs 780 is ready for pickup.", "03215550000"],
  ];
  // HELD-OUT: written after the heuristic was tuned on the messages above, and never used for tuning.
  const holdout: [string, string, MessageCase["label"]][] = [
    ["Benazir Kafaalat: Rs 10,500 ki qist jaari. Wasooli ke liye 250 rupay fee is account mein jama karein.", "03007771234", "scam"],
    ["Dear beneficiary, your Ehsaas amount is blocked. Send your CNIC picture and PIN to unblock.", "03458889990", "scam"],
    ["Relief Fund 2026 – Rs 40,000 approved for your family. Pay token money Rs 1,000 first.", "03122229999", "scam"],
    ["احساس پروگرام: آپ کی رقم 12000 روپے منظور۔ تصدیق کے لیے اپنا پن کوڈ بھیجیں۔", "03334445556", "scam"],
    ["Govt grant winner! Visit tinyurl.com/grant-pk now to receive Rs 50,000.", "03009990000", "scam"],
    ["Your mobile balance is low. Recharge Rs 100 to continue calls.", "JAZZ", "benign"],
    ["Bhai, kal 500 rupay wapis kar dena jo udhaar liye the.", "03211234567", "benign"],
    ["Union council: free eye camp on Sunday. No registration fee.", "03001112222", "benign"],
    ["Asli: Rs 8,000 has been sent to your account for case M2TQ7K. Your code is 5512. No fee is ever required.", "ASLI", "genuine_like"],
    ["BISP: Aap ki raqam aap ke qareebi campsite se wasool ki ja sakti hai. Koi fee nahi.", "8171", "genuine_like"],
  ];
  const out: MessageCase[] = [];
  let n = 0;
  for (const [text, sender, lbl] of holdout) out.push({ id: `d3_holdout_${++n}`, text, sender, label: lbl, isControl: lbl !== "scam", note: "HELD-OUT (not used for tuning)" });
  n = 0;
  for (const [text, sender] of scams) out.push({ id: `d3_${++n}`, text: text!, sender: sender!, label: "scam", isControl: false, note: "fee / OTP / PIN / phishing" });
  for (const [text, sender] of genuineLike) out.push({ id: `d3_${++n}`, text: text!, sender: sender!, label: "genuine_like", isControl: true, note: "LEGITIMATE CONTROL: official-sounding, asks for nothing" });
  for (const [text, sender] of benign) out.push({ id: `d3_${++n}`, text: text!, sender: sender!, label: "benign", isControl: true, note: "LEGITIMATE CONTROL: mentions money/fee/OTP but is not a relief scam" });
  return out;
}

// ───────────── D4 document specs ─────────────

export type DocumentSpec = { id: string; scenario: "clean" | "blurry" | "edited_qr" | "third_party_qr" | "injection_qr"; expect: { qrValid: boolean | null; blurry: boolean; injection: boolean } };
export function genD4(): DocumentSpec[] {
  const s: DocumentSpec[] = [];
  const add = (scenario: DocumentSpec["scenario"], k: number, expect: DocumentSpec["expect"]) => {
    for (let i = 0; i < k; i++) s.push({ id: `d4_${scenario}_${i + 1}`, scenario, expect });
  };
  add("clean", 6, { qrValid: true, blurry: false, injection: false });
  add("blurry", 4, { qrValid: null, blurry: true, injection: false });
  add("edited_qr", 4, { qrValid: false, blurry: false, injection: false });
  add("third_party_qr", 3, { qrValid: null, blurry: false, injection: false });
  add("injection_qr", 3, { qrValid: null, blurry: false, injection: true });
  return s;
}

// ───────────── D5 policy questions ─────────────

export type PolicyQuestion = { id: string; question: string; gold: string | null };
export function genD5(): PolicyQuestion[] {
  const qs: [string, string | null][] = [
    ["Do I have to pay any fee to get the money?", "fees-1"],
    ["Someone asked me for my OTP to release the relief, is that ok?", "fees-1"],
    ["how much money will I get", "amount-1"],
    ["What is the payment for a family of six?", "amount-1"],
    ["what documents do I need", "docs-1"],
    ["My photo was blurry, what now?", "docs-1"],
    ["can I appeal", "appeal-1"],
    ["I disagree with the decision", "appeal-1"],
    ["how do I know if a message is real", "fees-2"],
    ["who can see my data", "consent-1"],
    ["can I take back permission", "consent-1"],
    ["how long does it take", "process-2"],
    ["Who decides my case, a computer?", "process-1"],
    ["Can a helper apply for my family?", "helper-1"],
    ["How will I receive the money?", "payment-1"],
    ["Who is eligible to apply?", "elig-1"],
    ["what is the capital of France", null],
    ["What is the weather in Lahore tomorrow?", null],
    ["Can you give me a loan for my shop?", null],
    ["Who won the cricket match yesterday?", null],
  ];
  return qs.map(([question, gold], i) => ({ id: `d5_${i + 1}`, question, gold }));
}

// ───────────── D6 attacks ─────────────
export const D6_NOTE = "D6 is the Break It list in services/breakit.ts (18 attacks + 8 legitimate controls); its ids are frozen in the manifest.";
