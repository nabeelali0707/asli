/**
 * The 12 named hard stops (S1–S12). Any one of them sends a case to a human, whatever the score,
 * and blocks provisional auto-approval. Each has a golden test in tests/hardstops.test.ts.
 * They are evaluated by deterministic code only — no model output can clear a hard stop.
 */
import type { Bilingual } from "../lib/i18n";

export const HARD_STOPS = {
  S1: { code: "IDENTITY_CONFLICT", title: { en: "The ID number belongs to someone else", ur: "شناختی نمبر کسی اور کا ہے" }, why: "CNIC found, but the name or date of birth does not match the registry." },
  S2: { code: "IDENTITY_NOT_IN_REGISTRY", title: { en: "ID number not found", ur: "شناختی نمبر ریکارڈ میں نہیں ملا" }, why: "The CNIC is not in the (mock) identity registry." },
  S3: { code: "IDENTITY_AMBIGUOUS", title: { en: "More than one person could match", ur: "ایک سے زیادہ افراد مل سکتے ہیں" }, why: "Two registry candidates score within 2 bits of each other (Fellegi–Sunter)." },
  S4: { code: "DUPLICATE_SUSPECTED", title: { en: "Possible duplicate person", ur: "ممکنہ دوہرا ریکارڈ" }, why: "Another beneficiary has the same CNIC, or the same name + father/DOB." },
  S5: { code: "DECEASED_IN_REGISTRY", title: { en: "Registry shows the person as deceased", ur: "ریکارڈ میں شخص فوت شدہ درج ہے" }, why: "Payments to a deceased person are a common fraud pattern." },
  S6: { code: "CONSENT_MISSING", title: { en: "Permission missing or withdrawn", ur: "اجازت موجود نہیں یا واپس لے لی گئی" }, why: "The department has no active consent for a required data scope." },
  S7: { code: "FORGERY_SIGNAL", title: { en: "Document may be edited or forged", ur: "کاغذ میں ردوبدل یا جعل سازی کا امکان" }, why: "Signed QR failed verification, or the tamper score is 0.6 or more." },
  S8: { code: "DOCUMENT_REUSED", title: { en: "Same photo used by another applicant", ur: "یہی تصویر کسی اور درخواست میں استعمال ہوئی" }, why: "Exact or near-identical image (difference hash ≤ 6 bits) uploaded for another person." },
  S9: { code: "PROMPT_INJECTION", title: { en: "Document contains instructions to the system", ur: "کاغذ میں نظام کے لیے ہدایات موجود ہیں" }, why: "Text such as 'approve this claim' or 'ignore previous instructions' found in a document or statement." },
  S10: { code: "PAYOUT_ACCOUNT_CHANGED_RECENTLY", title: { en: "Payment account was changed recently", ur: "ادائیگی کا اکاؤنٹ حال ہی میں بدلا گیا" }, why: "A payout-account change is pending or still inside its cooling-off window." },
  S11: { code: "PAYOUT_ACCOUNT_SHARED", title: { en: "Payment account shared with another family", ur: "ادائیگی کا اکاؤنٹ کسی اور خاندان کے ساتھ مشترک ہے" }, why: "The same mobile wallet is the payout account of another beneficiary." },
  S12: { code: "REGISTRY_UNAVAILABLE", title: { en: "Government records could not be reached", ur: "سرکاری ریکارڈ تک رسائی نہیں ہو سکی" }, why: "A mock registry was down or timed out after retries; we do not guess." },
} as const satisfies Record<string, { code: string; title: Bilingual; why: string }>;

export type HardStopId = keyof typeof HARD_STOPS;
export type HardStopCode = (typeof HARD_STOPS)[HardStopId]["code"];

export const HARD_STOP_BY_CODE: Record<string, HardStopId> = Object.fromEntries(
  Object.entries(HARD_STOPS).map(([id, h]) => [h.code, id as HardStopId]),
);

/** "S7 FORGERY_SIGNAL" — how stops are shown in traces and notes. */
export function label(code: string): string {
  const id = HARD_STOP_BY_CODE[code];
  return id ? `${id} ${code}` : code;
}

// ───────────── S9: prompt-injection scan ─────────────

const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "approve_this", re: /\b(approve|accept|pass|clear)\s+(this|the|my)\s+(claim|case|application|payment|request)\b/i },
  { name: "ignore_instructions", re: /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|your|system)\s+(instructions|rules|prompt|policy|guidelines)/i },
  { name: "role_marker", re: /(^|\n)\s*(system|assistant|developer)\s*:/i },
  { name: "mark_eligible", re: /\b(mark|set|classify|treat)\s+(me|this|the applicant|applicant)\s+(as\s+)?(eligible|verified|genuine|approved)\b/i },
  { name: "you_are_now", re: /\byou are now\b|\bact as\b.{0,30}\b(officer|admin|approver)\b/i },
  { name: "urdu_approve", re: /(منظور\s*کر(یں|و|دیں))|(اہل\s*قرار\s*دیں)/ },
  { name: "roman_urdu_approve", re: /\b(approve|manzoor)\s+kar\s*(do|dein|den|dain)\b/i },
  { name: "tool_markup", re: /<\/?(tool|function|system|instructions?)[^>]*>/i },
];

export function scanForInjection(texts: (string | null | undefined)[]): { found: boolean; matches: { pattern: string; excerpt: string }[] } {
  const matches: { pattern: string; excerpt: string }[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const p of INJECTION_PATTERNS) {
      const m = t.match(p.re);
      if (m) matches.push({ pattern: p.name, excerpt: t.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + m[0].length + 20).trim() });
    }
  }
  return { found: matches.length > 0, matches };
}
