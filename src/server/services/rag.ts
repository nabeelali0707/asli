/**
 * Policy RAG: BM25 retrieval over the (mock) official policy passages, then Claude answers using
 * ONLY those passages and cites them. Without Claude, the best passage is returned verbatim in both
 * languages. If retrieval is weak, the answer is "I am not sure — a person will help" (no guessing).
 */
import { POLICY_PASSAGES, type PolicyPassage } from "../policy/documents";
import { answerFromPassages } from "../ai/claude";
import { t } from "../lib/i18n";

const STOP = new Set("a an the is are am to of for and or in on at by with my me i you your do does can how what when who which it be this that will from as if not no".split(" "));
const SYNONYMS: Record<string, string[]> = {
  fee: ["fee", "fees", "charge", "charges", "otp", "pin", "code", "فیس"],
  apply: ["apply", "application", "register", "eligible", "eligibility", "qualify", "درخواست", "اہل"],
  amount: ["amount", "much", "rupees", "rs", "payment", "رقم"],
  document: ["document", "documents", "papers", "cnic", "card", "photo", "proof", "کاغذات", "کارڈ"],
  appeal: ["appeal", "disagree", "complain", "wrong", "اپیل"],
  consent: ["data", "permission", "consent", "privacy", "share", "اجازت", "معلومات"],
  helper: ["helper", "volunteer", "family", "مددگار"],
  time: ["long", "days", "time", "wait", "when", "وقت", "دن"],
  scam: ["scam", "fake", "fraud", "message", "sms", "real", "جعلی", "اصلی", "پیغام"],
};

function tokens(text: string): string[] {
  const raw = text.toLowerCase().normalize("NFKC").split(/[^a-z0-9؀-ۿ]+/).filter((w) => w && !STOP.has(w));
  const out = [...raw];
  for (const w of raw) for (const [canon, syns] of Object.entries(SYNONYMS)) if (syns.includes(w)) out.push(`#${canon}`);
  return out;
}

type Indexed = { p: PolicyPassage; tf: Map<string, number>; len: number };
const index: Indexed[] = POLICY_PASSAGES.map((p) => {
  const toks = tokens(`${p.title} ${p.title} ${p.title} ${p.en} ${p.ur}`); // titles weigh 3x
  const tf = new Map<string, number>();
  for (const tk of toks) tf.set(tk, (tf.get(tk) ?? 0) + 1);
  return { p, tf, len: toks.length };
});
const avgLen = index.reduce((a, d) => a + d.len, 0) / index.length;
const df = new Map<string, number>();
for (const d of index) for (const tk of d.tf.keys()) df.set(tk, (df.get(tk) ?? 0) + 1);

export function retrieve(question: string, k = 3) {
  const q = tokens(question);
  const N = index.length;
  const scored = index.map((d) => {
    let s = 0;
    for (const tk of q) {
      const f = d.tf.get(tk);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(tk) ?? 0) + 0.5) / ((df.get(tk) ?? 0) + 0.5));
      s += idf * ((f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * d.len) / avgLen)));
    }
    return { passage: d.p, score: Math.round(s * 1000) / 1000 };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

export const MIN_RETRIEVAL_SCORE = 1.5;

export async function askPolicy(question: string) {
  const hits = retrieve(question);
  const sources = hits.map((h) => ({ id: h.passage.id, doc: h.passage.doc, title: h.passage.title, score: h.score }));
  if (!hits.length || hits[0]!.score < MIN_RETRIEVAL_SCORE) {
    const unsure = t("verify.suspicious");
    return {
      answerable: false,
      answer: { en: "I am not sure about this. A person will help you — press 3 on the call menu or ask your helper.", ur: "مجھے اس کے بارے میں یقین نہیں۔ ایک انسان آپ کی مدد کرے گا — کال مینو میں 3 دبائیں یا اپنے مددگار سے پوچھیں۔", audioKey: unsure.audioKey },
      sources,
      mode: "retrieval-too-weak",
    };
  }
  const top = hits.filter((h) => h.score >= MIN_RETRIEVAL_SCORE);
  const ai = await answerFromPassages(question, top.map((h) => ({ id: h.passage.id, title: h.passage.title, text: h.passage.en })));
  if (ai) {
    const valid = ai.data.citedPassageIds.filter((id) => top.some((h) => h.passage.id === id));
    return {
      answerable: ai.data.answerable && valid.length > 0,
      answer: { en: ai.data.answer_en, ur: ai.data.answer_ur, audioKey: null },
      sources: sources.filter((s) => valid.includes(s.id)),
      mode: "claude-grounded",
      meta: ai.meta,
    };
  }
  // Offline: quote the best passage, plus the runner-up when it is nearly as relevant.
  const picked = top.filter((h, i) => i === 0 || (i === 1 && h.score >= 0.6 * top[0]!.score)).map((h) => h.passage);
  return {
    answerable: true,
    answer: { en: picked.map((p) => p.en).join(" "), ur: picked.map((p) => p.ur).join(" "), audioKey: picked.length === 1 ? `policy.${picked[0]!.id}` : null },
    sources: sources.filter((s) => picked.some((p) => p.id === s.id)),
    mode: "extractive",
  };
}
