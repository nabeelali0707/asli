/**
 * Gemini (Google AI Studio, free tier) — a second structured-output provider for the same three
 * language jobs Claude does: spoken-answer extraction, document reading, grounded policy answers.
 * Output is forced to the Zod schema's JSON Schema and re-validated here; any failure throws so the
 * caller falls back to its deterministic heuristic. Gemini never decides eligibility or payment.
 */
import { z } from "zod";
import { env, aiLive } from "../env";

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export function geminiAvailable(): boolean {
  return aiLive() && !!env().GEMINI_API_KEY;
}

export async function geminiStructured<S extends z.ZodType>(schema: S, opts: { system: string; parts: GeminiPart[] }): Promise<z.infer<S>> {
  const e = env();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${e.GEMINI_MODEL}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema) },
  });
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": e.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) throw new Error(`gemini empty (${json.candidates?.[0]?.finishReason ?? "no candidate"})`);
      return schema.parse(JSON.parse(text));
    }
    lastErr = `gemini ${res.status}`;
    if (res.status !== 429 && res.status < 500) break; // bad request / auth: retrying will not help
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(lastErr);
}
