/**
 * Scam-message feature extraction + heuristic classifier (English, Urdu, Roman Urdu).
 * This is the offline fallback and the explainable second signal; Jev is used when configured.
 * The verifier (Signed Truth) always runs first: ledger truth beats text classification.
 */

export type ScamFeatures = {
  amounts: number[];
  codes: string[]; // 4-digit numbers that could be a spoken code
  caseRefs: string[];
  links: string[];
  phoneNumbers: string[];
  asksForFee: boolean;
  asksForOtpOrPin: boolean;
  asksToCallOrWhatsapp: boolean;
  urgency: boolean;
  claimsGovernment: boolean;
  claimsPayment: boolean;
  shortLink: boolean;
  officialSender: boolean | null; // sender is 8171 (BISP's official short code) — spoofable, never proof
  matchedPatterns: string[];
};

// A fee REQUEST (pay / send / deposit money) — not merely the word "fee" (a school-fee reminder is benign).
const FEE = [
  /processing\s*fee/i, /registration\s*fee/i, /activation\s*fee/i, /service\s*charges?/i, /sms\s*charges/i,
  /(pay|send|deposit|transfer)\b[^.]{0,30}\b(fee|charges?)\b/i, /\b(fee|charges?)\b[^.]{0,30}\b(bhej|jama|transfer)/i,
  /jama\s*kar/i, /(fee|fees|charges?|rupay)[^.]{0,20}bhej(ein|en|o|do|dein)/i,
  /فیس[^۔]{0,30}(کریں|بھیج|جمع|دیں)/, /جمع\s*کر/, /رقم\s*بھیج/, /چارجز/,
];
// Asking someone to SHARE a secret — not an OTP delivered with "do not share it".
const OTP = [
  /(share|send|tell|give|confirm|provide)\b[^.]{0,40}\b(otp|pin|password|verification\s*code|code)\b/i,
  /\b(otp|pin|code)\b[^.]{0,20}\b(bata|batayen|bhej|share|dein|den)\b/i,
  /کوڈ\s*بتا/, /پن\s*کوڈ/, /او\s*ٹی\s*پی/,
];
const NEGATED_SECRET = /(do\s*not|don'?t|never)\s+share/i;
const CALL = [/whatsapp/i, /call\s+(us|now|this)/i, /contact\s+(us|on)/i, /rabta/i, /رابطہ/, /واٹس\s*ایپ/];
const URGENT = [/today\s+only/i, /within\s+\d+\s*(hours?|hrs?)/i, /urgent/i, /last\s+chance/i, /foran/i, /jaldi/i, /فوری/, /آج\s*ہی/, /expire/i, /band\s+ho\s+jaye/i];
const GOV = [/\bbisp\b/i, /benazir/i, /ehsaas/i, /government/i, /hukumat/i, /\bgovt\b/i, /pm\s+relief/i, /relief/i, /rahat/i, /بینظیر/, /احساس/, /حکومت/, /امداد/, /راحت/];
const PAYMENT = [/payment/i, /\brs\.?\s*\d/i, /rupees?/i, /\bpkr\b/i, /amount/i, /raqam/i, /approved/i, /congratulations/i, /mubarak/i, /رقم/, /روپے/, /مبارک/, /ادائیگی/];
const SHORT = /(bit\.ly|tinyurl|t\.co|is\.gd|cutt\.ly|rb\.gy|shorturl|goo\.gl)/i;

const test = (patterns: RegExp[], text: string, name: string, hits: string[]) => {
  const hit = patterns.find((p) => p.test(text));
  if (hit) hits.push(`${name}:${hit.source}`);
  return !!hit;
};

export function extractScamFeatures(text: string, sender?: string | null): ScamFeatures {
  const hits: string[] = [];
  // Urdu/Arabic-Indic digits → ASCII so amounts and codes are recognised in any script.
  const normalized = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const amounts = [...normalized.matchAll(/(?:rs\.?|pkr|rupees?|روپے)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})\s*(?:rs\.?|pkr|rupees?|روپے)?/gi)]
    .filter((m) => /rs|pkr|rupee|روپے/i.test(m[0]))
    .map((m) => Number(m[1]!.replace(/,/g, "")))
    .filter((n) => n > 0);
  const codes = [...normalized.matchAll(/(?:code|کوڈ|ref)\D{0,12}(\d(?:\s?\d){3})\b/gi)].map((m) => m[1]!.replace(/\s/g, ""));
  const caseRefs = [...normalized.matchAll(/\bcase[_\s#:-]*([a-z0-9]{6,20})\b/gi)].map((m) => m[1]!.toLowerCase());
  const links = [...normalized.matchAll(/https?:\/\/\S+|www\.\S+|\b\S+\.(?:com|pk|net|org|info|xyz|top|site)\S*/gi)].map((m) => m[0]);
  const phoneNumbers = [...normalized.matchAll(/(?:\+92|0)3\d{2}[\s-]?\d{7}/g)].map((m) => m[0]);
  const s = (sender ?? "").replace(/\s/g, "");
  return {
    amounts,
    codes,
    caseRefs,
    links,
    phoneNumbers,
    asksForFee: test(FEE, normalized, "fee", hits),
    asksForOtpOrPin: test(OTP, normalized, "otp", hits) && !NEGATED_SECRET.test(normalized),
    asksToCallOrWhatsapp: test(CALL, normalized, "call", hits) || phoneNumbers.length > 0,
    urgency: test(URGENT, normalized, "urgency", hits),
    claimsGovernment: test(GOV, normalized, "gov", hits),
    claimsPayment: test(PAYMENT, normalized, "payment", hits) || amounts.length > 0,
    shortLink: SHORT.test(normalized),
    officialSender: s ? s === "8171" : null,
    matchedPatterns: hits,
  };
}

export const SCAM_CATEGORIES = ["genuine_notice", "relief_scam", "fee_request", "phishing_link", "unrelated"] as const;
export type ScamCategory = (typeof SCAM_CATEGORIES)[number];

/**
 * Heuristic class probabilities (offline fallback for Jev). Deliberately conservative:
 * a fee / OTP / PIN request is near-certain fraud; a payment claim without one is only "suspicious".
 */
export function heuristicScamClassify(f: ScamFeatures): { probabilities: Record<ScamCategory, number>; category: ScamCategory; confidence: number } {
  const score: Record<ScamCategory, number> = {
    genuine_notice: 0.05,
    relief_scam: 0.05,
    fee_request: 0.02,
    phishing_link: 0.02,
    unrelated: 0.2,
  };
  if (f.claimsGovernment) {
    // Only a message that invokes a government / relief programme can be a RELIEF scam.
    score.relief_scam += 0.35;
    score.genuine_notice += 0.25;
    score.unrelated = 0.05;
  } else if (f.claimsPayment) {
    // Bills, fees, family transfers: mentions money, but no relief context → mostly unrelated.
    score.unrelated += 0.2;
    score.relief_scam += 0.05;
  }
  // A fee/OTP request is near-certain fraud only in a relief / government / payment-claim context.
  const reliefContext = f.claimsGovernment || f.amounts.some((a) => a >= 5000) || f.matchedPatterns.some((m) => m.startsWith("gov"));
  if (f.asksForFee) score.fee_request += reliefContext ? 1.2 : 0.15;
  if (f.asksForOtpOrPin) score.fee_request += reliefContext ? 0.9 : 0.3;
  if (f.shortLink || (f.links.length && !f.links.every((l) => /asli/i.test(l)))) score.phishing_link += 0.6;
  if (f.asksToCallOrWhatsapp) score.relief_scam += 0.3;
  if (f.urgency) score.relief_scam += 0.25;
  if (f.officialSender === false && f.claimsGovernment) score.relief_scam += 0.3;
  if (f.officialSender === true) score.genuine_notice += 0.1; // spoofable: small weight only
  const total = Object.values(score).reduce((a, b) => a + b, 0);
  const probabilities = Object.fromEntries(
    Object.entries(score).map(([k, v]) => [k, Math.round((v / total) * 100) / 100]),
  ) as Record<ScamCategory, number>;
  const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const [category, top] = sorted[0] as [ScamCategory, number];
  const second = sorted[1]![1];
  return { probabilities, category, confidence: Math.round((top - second) * 100) / 100 };
}
