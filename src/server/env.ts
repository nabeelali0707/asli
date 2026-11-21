/**
 * Central, validated configuration. Every external dependency is optional:
 * without keys Asli runs in "offline" AI mode using deterministic fallbacks,
 * and every decision records which mode produced it.
 */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().optional(),
  /** memory | file — only used when DATABASE_URL is unset (PGlite). */
  ASLI_DB: z.enum(["memory", "file"]).default("file"),
  ASLI_DB_DIR: z.string().default(".data/pglite"),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-please"),
  JWT_TTL_SECONDS: z.coerce.number().default(60 * 60 * 8),
  /** live = call external AI APIs when keys exist; offline = deterministic fallbacks only. */
  ASLI_AI_MODE: z.enum(["live", "offline"]).default("live"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  AI_GATEWAY_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  JEV_MODEL: z.string().default("typesafe-ai/jev"),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  /** PEM (or base64 of PEM) Ed25519 keys for Signed Truth; generated + stored in DB if absent. */
  SIGNING_PRIVATE_KEY: z.string().optional(),
  SIGNING_PUBLIC_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** For tests that change process.env between cases. */
export function resetEnvCache() {
  cached = undefined;
}

export function aiLive(): boolean {
  return env().ASLI_AI_MODE === "live";
}
