/**
 * The Asli API (Hono + OpenAPI). Mounted by Next.js at /api/*.
 *   /api/v1/...          REST API (JWT or X-API-Key)
 *   /api/openapi.json    OpenAPI 3.1 document
 *   /api/docs            Swagger UI
 *   /api/health          health + configuration (no secrets)
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
import type { AppEnv } from "./http/context";
import { base, authenticate } from "./http/middleware";
import { AppError } from "./lib/errors";
import { authRoutes } from "./routes/auth";
import { caseRoutes } from "./routes/cases";
import { trustRoutes } from "./routes/trust";
import { voiceRoutes } from "./routes/voice";
import { adminRoutes } from "./routes/admin";
import { insightRoutes } from "./routes/insights";
import { runDueJobs } from "./services/events";
import { env } from "./env";
import { claudeAvailable } from "./ai/claude";
import { jevAvailable } from "./ai/jev";
import { speechAvailable } from "./ai/speech";
import { safeEqual } from "./lib/crypto";
import { getDb } from "./db/client";

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: { code: "VALIDATION_ERROR", message: "Request is invalid", details: result.error.issues }, requestId: c.get("requestId") }, 400);
      }
    },
  }).basePath("/api");

  app.use("*", cors({ origin: (o) => o ?? "*", allowHeaders: ["authorization", "content-type", "x-api-key", "idempotency-key", "x-request-id"], exposeHeaders: ["x-request-id", "x-ratelimit-remaining", "retry-after"] }));
  app.use("*", base);
  app.use("/v1/*", authenticate);

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message, details: err.details }, requestId }, err.status);
    console.error(`[asli] ${requestId}`, err);
    return c.json({ error: { code: "INTERNAL", message: "Something went wrong. Your data is safe; please try again." }, requestId }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: `No route ${c.req.method} ${c.req.path}` } }, 404));

  // Best-effort background work after each request (webhooks, mock SMS, deadlines). Cron covers the rest.
  app.use("/v1/*", async (c, next) => {
    await next();
    if (c.req.method !== "GET") void runDueJobs(c.get("db"), 10).catch((e) => console.warn("[jobs]", e));
  });

  for (const r of [authRoutes, caseRoutes, trustRoutes, voiceRoutes, adminRoutes, insightRoutes]) app.route("/v1", r);

  app.get("/health", async (c) => {
    const db = await getDb();
    const started = Date.now();
    await db.execute(sql`select 1`);
    const e = env();
    return c.json({
      status: "ok",
      prototype: "PROTOTYPE ONLY — not an official government service. All identity, payment and personal data is simulated.",
      db: { driver: e.DATABASE_URL ? "postgres" : `pglite (${e.ASLI_DB})`, latencyMs: Date.now() - started },
      ai: { mode: e.ASLI_AI_MODE, claude: claudeAvailable(), jev: jevAvailable(), speech: speechAvailable(), model: e.ANTHROPIC_MODEL },
      time: new Date().toISOString(),
    });
  });

  // Cron (e.g. Vercel Cron sends "Authorization: Bearer $CRON_SECRET"). Outside /v1 so it is not parsed as a JWT.
  app.post("/cron/jobs", async (c) => {
    const secret = env().CRON_SECRET;
    const given = c.req.header("authorization")?.replace(/^Bearer /, "") ?? c.req.header("x-cron-secret") ?? "";
    if (!(secret && given && safeEqual(given, secret))) throw new AppError(401, "UNAUTHENTICATED", "Cron secret required");
    return c.json(await runDueJobs(c.get("db"), 100));
  });
  app.get("/cron/jobs", async (c) => {
    const secret = env().CRON_SECRET;
    const given = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!(secret && given && safeEqual(given, secret))) throw new AppError(401, "UNAUTHENTICATED", "Cron secret required");
    return c.json(await runDueJobs(c.get("db"), 100));
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Asli API — trust infrastructure for relief payments (PROTOTYPE)",
      version: "1.0.0",
      description:
        "Coder's Cup 2026 prototype. Mock NADRA / Raast / registries only — no real personal data. AI never moves money: lanes are fast (pre-verified for a one-tap officer approval), ask_proof, or human ('I am not sure'). Auth: Bearer JWT from /v1/auth/login, or X-API-Key for the public REST API. Send Idempotency-Key on retries.",
    },
    servers: [{ url: env().PUBLIC_BASE_URL }],
    tags: [
      { name: "Auth" },
      { name: "Helper mode", description: "One shared phone, many families: PIN switch + per-family consent, checked live" },
      { name: "Cases" },
      { name: "Officer" },
      { name: "Signed Truth", description: "Signed notices, spoken codes, ledger-first verification" },
      { name: "Consent" },
      { name: "Prove, don't share" },
      { name: "Voice" },
      { name: "Feature-phone line" },
      { name: "Policy (RAG)" },
      { name: "Rules", description: "Versioned rules + Digital Twin + kill switch" },
      { name: "Evaluation" },
      { name: "Scam Map" },
      { name: "Analytics" },
      { name: "AI" },
      { name: "Audit" },
      { name: "Admin" },
      { name: "Try to fool Asli" },
      { name: "Offline sync" },
      { name: "Mock DPI", description: "SIMULATED government services" },
    ],
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" });
  app.openAPIRegistry.registerComponent("securitySchemes", "apiKey", { type: "apiKey", in: "header", name: "X-API-Key" });
  app.get("/docs", swaggerUI({ url: "/api/openapi.json" }));
  return app;
}

let appSingleton: ReturnType<typeof createApp> | undefined;
export function getApp() {
  appSingleton ??= createApp();
  return appSingleton;
}
