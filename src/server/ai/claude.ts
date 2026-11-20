/**
 * Claude — used only for jobs that need language: turning a spoken Urdu answer into structured
 * claim fields, reading a photographed (mock) CNIC, and grounded policy answers (RAG).
 * Claude never decides eligibility, identity or payment; outputs are validated with Zod and
 * every call records model + prompt version for the auditor trace.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env, aiLive } from "../env";

let client: Anthropic | undefined;
export function claudeAvailable(): boolean {
  return aiLive() && !!env().ANTHROPIC_API_KEY;
}
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  return client;
}

export type AiMeta = { provider: "anthropic" | "heuristic"; model: string; promptVersion: string; latencyMs: number; note?: string };

// ───────────── structured claim extraction from a transcript ─────────────

export const ClaimExtraction = z.object({
  fullName: z.string().nullable().describe("Applicant's own full name as spoken, or null"),
  fatherName: z.string().nullable().describe("Father's (or husband's) name, or null"),
  cnic: z.string().nullable().describe("13-digit CNIC if spoken, digits only, or null"),
  dob: z.string().nullable().describe("Date of birth as YYYY-MM-DD, or null"),
  maritalStatus: z.enum(["married", "widowed", "single", "divorced"]).nullable(),
  householdSize: z.number().int().nullable(),
  monthlyIncome: z.number().int().nullable().describe("Monthly household income in PKR, or null"),
  district: z.string().nullable(),
  phone: z.string().nullable(),
  requestType: z.enum(["relief_claim", "complaint", "status_check", "scam_check", "other"]),
  unclearFields: z.array(z.string()).describe("Fields the speaker mentioned but that were unclear"),
});
export type ClaimExtraction = z.infer<typeof ClaimExtraction>;

const EXTRACT_PROMPT_VERSION = "extract-claim@1";
const EXTRACT_SYSTEM = `You convert a short spoken application for government relief (Urdu, Roman Urdu or English, often transcribed imperfectly) into structured fields.
Only fill a field when the speaker clearly said it. If something is missing or unclear, use null and list it in unclearFields — never guess.
Numbers may be spoken as words in Urdu (e.g. "pachees hazaar" = 25000). CNIC is 13 digits.`;

export async function extractClaim(transcript: string): Promise<{ data: ClaimExtraction; meta: AiMeta }> {
  const started = Date.now();
  if (!claudeAvailable()) {
    return { data: heuristicExtract(transcript), meta: { provider: "heuristic", model: "regex-extractor", promptVersion: "heuristic@1", latencyMs: Date.now() - started } };
  }
  const response = await getClient().beta.messages.parse({
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // server-side refusal fallback (routes by refusal category)
    model: env().ANTHROPIC_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: betaZodOutputFormat(ClaimExtraction) },
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: `Transcript:\n"""${transcript}"""` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return {
      data: heuristicExtract(transcript),
      meta: { provider: "heuristic", model: "regex-extractor", promptVersion: "heuristic@1", latencyMs: Date.now() - started, note: `claude:${response.stop_reason}` },
    };
  }
  return { data: response.parsed_output, meta: { provider: "anthropic", model: env().ANTHROPIC_MODEL, promptVersion: EXTRACT_PROMPT_VERSION, latencyMs: Date.now() - started } };
}

/** Offline fallback: pulls obvious digits and keywords. Conservative — leaves everything else null. */
export function heuristicExtract(text: string): ClaimExtraction {
  const digits = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const cnic = digits.match(/\b\d{5}-?\d{7}-?\d\b/)?.[0]?.replace(/-/g, "") ?? null;
  const income = digits.match(/(?:income|aamdani|amdani|آمدنی|kamai|کمائی)\D{0,20}(\d{1,3}(?:,\d{3})+|\d{3,6})/i)?.[1];
  const household = digits.match(/(\d{1,2})\s*(?:log|afraad|members|افراد|بچے|children|kids)/i)?.[1];
  const dob = digits.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null;
  const name = text.match(/(?:mera naam|my name is|میرا نام)\s+([A-Za-z؀-ۿ ]{3,40}?)(?:\s+(?:hai|ہے|is)\b|[,.]|$)/i)?.[1]?.trim() ?? null;
  const father = text.match(/(?:walid ka naam|father'?s name is|husband'?s name is|والد کا نام|شوہر کا نام)\s+([A-Za-z؀-ۿ ]{3,40}?)(?:\s+(?:hai|ہے|is)\b|[,.]|$)/i)?.[1]?.trim() ?? null;
  const widowed = /\b(widow|bewa|bewah)\b|بیوہ/i.test(text);
  const scamCheck = /\b(sms|message|paigham)\b|پیغام/i.test(text) && /\b(fake|asli|real|check)\b|جعلی|اصلی/i.test(text);
  const unclear: string[] = [];
  if (!name) unclear.push("fullName");
  if (!cnic) unclear.push("cnic");
  if (!income) unclear.push("monthlyIncome");
  return {
    fullName: name,
    fatherName: father,
    cnic,
    dob,
    maritalStatus: widowed ? "widowed" : null,
    householdSize: household ? Number(household) : null,
    monthlyIncome: income ? Number(income.replace(/,/g, "")) : null,
    district: null,
    phone: digits.match(/(?:\+92|0)3\d{2}[\s-]?\d{7}/)?.[0] ?? null,
    requestType: scamCheck ? "scam_check" : "relief_claim",
    unclearFields: unclear,
  };
}

// ───────────── CNIC / document reading (vision) ─────────────

export const DocumentReading = z.object({
  documentType: z.enum(["cnic", "income_proof", "other", "unreadable"]),
  fullName: z.string().nullable(),
  fatherName: z.string().nullable(),
  cnic: z.string().nullable(),
  dob: z.string().nullable().describe("YYYY-MM-DD"),
  monthlyIncome: z.number().int().nullable(),
  readable: z.boolean().describe("false if blurry, cut off, too dark, or not a document"),
  editSigns: z.array(z.string()).describe("Visible signs of editing: mismatched fonts, pasted text, smudged digits. Empty if none."),
});
export type DocumentReading = z.infer<typeof DocumentReading>;

const READ_PROMPT_VERSION = "read-document@1";

export async function readDocumentImage(base64: string, mime: string): Promise<{ data: DocumentReading | null; meta: AiMeta }> {
  const started = Date.now();
  if (!claudeAvailable() || !/^image\/(png|jpeg|gif|webp)$/.test(mime)) {
    return { data: null, meta: { provider: "heuristic", model: "none", promptVersion: "none", latencyMs: 0, note: "vision unavailable; QR + image checks only" } };
  }
  const response = await getClient().beta.messages.parse({
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // server-side refusal fallback (routes by refusal category)
    model: env().ANTHROPIC_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: betaZodOutputFormat(DocumentReading) },
    system:
      "You read photos of Pakistani identity cards (CNIC) and income documents for a PROTOTYPE that only uses mock documents. Extract only what is clearly legible; use null otherwise. Report visible signs of editing honestly but do not speculate.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/png", data: base64 } },
          { type: "text", text: "Read this document." },
        ],
      },
    ],
  });
  return {
    data: response.parsed_output ?? null,
    meta: { provider: "anthropic", model: env().ANTHROPIC_MODEL, promptVersion: READ_PROMPT_VERSION, latencyMs: Date.now() - started, note: response.stop_reason ?? undefined },
  };
}

// ───────────── grounded policy answers (RAG) ─────────────

export const PolicyAnswer = z.object({
  answerable: z.boolean().describe("false if the passages do not support an answer"),
  answer_en: z.string(),
  answer_ur: z.string(),
  citedPassageIds: z.array(z.string()),
});
export type PolicyAnswer = z.infer<typeof PolicyAnswer>;

export async function answerFromPassages(
  question: string,
  passages: { id: string; title: string; text: string }[],
): Promise<{ data: PolicyAnswer; meta: AiMeta } | null> {
  if (!claudeAvailable()) return null;
  const started = Date.now();
  const context = passages.map((p) => `<passage id="${p.id}" title="${p.title}">\n${p.text}\n</passage>`).join("\n");
  const response = await getClient().beta.messages.parse({
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // server-side refusal fallback (routes by refusal category)
    model: env().ANTHROPIC_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: betaZodOutputFormat(PolicyAnswer) },
    system: `You answer questions about a relief programme for people who may not read well. Use ONLY the passages provided.
If the passages do not clearly answer, set answerable=false and say in both languages that you are not sure and a person will help.
Answer in 1-3 short, plain sentences in English and in simple Urdu. Cite the passage ids you used.`,
    messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
  });
  if (!response.parsed_output) return null;
  return { data: response.parsed_output, meta: { provider: "anthropic", model: env().ANTHROPIC_MODEL, promptVersion: "policy-rag@1", latencyMs: Date.now() - started } };
}

export { getClient as getClaudeClient };
