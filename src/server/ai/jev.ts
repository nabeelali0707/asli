/**
 * Jev (TypeSafe AI) — the classification & routing model named in the hackathon brief.
 * Jev answers typed questions (choice / score / boolean) with probabilities and writes no prose.
 *
 * Transport, in order of preference:
 *   1. Vercel AI Gateway via the AI SDK `experimental_decide` (AI_GATEWAY_API_KEY), model `typesafe-ai/jev`
 *   2. OpenRouter decisions API (OPENROUTER_API_KEY), model `typesafe/jev-1.14`
 *   3. none → caller uses its deterministic heuristic and records source "heuristic"
 *
 * Rule: Jev classifies; it never authorises. We never log the raw `state` (citizen text).
 */
import { experimental_decide as decide } from "ai";
import { env, aiLive } from "../env";

export type JevQuestion =
  | { type: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; probabilities?: Record<string, number> }
  | { type: "score"; score: number; probabilities?: Record<string, number> };

export type JevResult = {
  answers: Record<string, JevAnswer>;
  confidence: Record<string, number | undefined>;
  provider: "ai-gateway" | "openrouter";
  model: string;
  latencyMs: number;
};

export function jevAvailable(): boolean {
  const e = env();
  return aiLive() && !!(e.AI_GATEWAY_API_KEY || e.OPENROUTER_API_KEY);
}

export async function jevDecide(state: string, questions: Record<string, JevQuestion>): Promise<JevResult | null> {
  if (!jevAvailable()) return null;
  const e = env();
  const started = Date.now();
  try {
    if (e.AI_GATEWAY_API_KEY) {
      const result = await decide({
        model: e.JEV_MODEL,
        state,
        questions: questions as never,
        maxRetries: 1,
        providerOptions: { gateway: { zeroDataRetention: true } },
      });
      const meta = (result.providerMetadata as Record<string, Record<string, unknown>> | undefined)?.typesafe;
      const confidence = (meta?.confidence ?? {}) as Record<string, number | undefined>;
      return {
        answers: result.answers as unknown as Record<string, JevAnswer>,
        confidence,
        provider: "ai-gateway",
        model: e.JEV_MODEL,
        latencyMs: Date.now() - started,
      };
    }
    // OpenRouter: boolean questions are called "noul" there.
    const orQuestions = Object.fromEntries(
      Object.entries(questions).map(([id, q]) => [id, q.type === "boolean" ? { ...q, type: "noul" } : q]),
    );
    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "typesafe/jev-1.14", state, questions: orQuestions }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`OpenRouter decisions ${res.status}`);
    const json = (await res.json()) as { answers: Record<string, Record<string, unknown>> };
    const answers: Record<string, JevAnswer> = {};
    const confidence: Record<string, number | undefined> = {};
    for (const [id, a] of Object.entries(json.answers)) {
      if (a.type === "noul" || a.type === "boolean") answers[id] = { type: "boolean", probability: Number(a.noul ?? a.probability) };
      else if (a.type === "choice") answers[id] = { type: "choice", choice: String(a.choice), probabilities: a.probabilities as Record<string, number> };
      else if (a.type === "score") answers[id] = { type: "score", score: Number(a.score), probabilities: a.probabilities as Record<string, number> };
      confidence[id] = typeof a.confidence === "number" ? a.confidence : undefined;
    }
    return { answers, confidence, provider: "openrouter", model: "typesafe/jev-1.14", latencyMs: Date.now() - started };
  } catch (err) {
    // Fail safe: the caller falls back to the heuristic and the decision records it.
    console.warn("[jev] call failed, falling back to heuristic:", (err as Error).message);
    return null;
  }
}
