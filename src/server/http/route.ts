/**
 * Thin helpers over @hono/zod-openapi so every endpoint is validated and documented
 * (OpenAPI 3.1 at /api/openapi.json, Swagger UI at /api/docs).
 */
import { createRoute, z, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "./context";
import type { AccessContext } from "../services/access";
import { getActor } from "./middleware";
import { forbidden } from "../lib/errors";
import { audit } from "../lib/audit";
import type { Role } from "../db/schema";

export { z };

export const JsonAny = z.record(z.string(), z.any()).openapi({ type: "object", description: "See endpoint description" });
const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string(), details: z.any().optional() }), requestId: z.string().optional() })
  .openapi("Error");

type Method = "get" | "post" | "put" | "patch" | "delete";

export function route<
  B extends z.ZodType | undefined = undefined,
  Q extends z.ZodObject | undefined = undefined,
  P extends z.ZodObject | undefined = undefined,
>(cfg: { method: Method; path: string; tags: string[]; summary: string; description?: string; body?: B; query?: Q; params?: P; auth?: boolean; status?: 200 | 201 | 202 }) {
  const request: Record<string, unknown> = {};
  if (cfg.body) request.body = { content: { "application/json": { schema: cfg.body } }, required: true };
  if (cfg.query) request.query = cfg.query;
  if (cfg.params) request.params = cfg.params;
  const ok = cfg.status ?? 200;
  return createRoute({
    method: cfg.method,
    path: cfg.path,
    tags: cfg.tags,
    summary: cfg.summary,
    description: cfg.description,
    security: cfg.auth === false ? [] : [{ bearerAuth: [] }, { apiKey: [] }],
    request: request as never,
    responses: {
      [ok]: { description: "Success", content: { "application/json": { schema: JsonAny } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorBody } } },
      401: { description: "Not signed in", content: { "application/json": { schema: ErrorBody } } },
      403: { description: "Not allowed (role, consent, tenant or guardrail)", content: { "application/json": { schema: ErrorBody } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
      409: { description: "Conflict", content: { "application/json": { schema: ErrorBody } } },
      429: { description: "Rate or plan limit", content: { "application/json": { schema: ErrorBody } } },
    },
  });
}

export function router() {
  return new OpenAPIHono<AppEnv>();
}

export function actx(c: Context<AppEnv>): AccessContext {
  return { actor: getActor(c), actFor: c.get("actFor"), requestId: c.get("requestId") };
}

/** Server-side role gate (with audit on denial). API keys pass only with the scope. */
export async function need(c: Context<AppEnv>, roles: Role[], apiScope?: string) {
  const actor = getActor(c);
  if (actor.type === "user" && roles.includes(actor.role)) return actor;
  if (actor.type === "api_key" && apiScope && (actor.scopes.includes(apiScope) || actor.scopes.includes("*"))) return actor;
  await audit(c.get("db"), { actor, action: "access.denied", targetType: "route", targetId: `${c.req.method} ${c.req.path}`, outcome: "denied", detail: { needed: roles, apiScope }, requestId: c.get("requestId") });
  throw forbidden("FORBIDDEN_ROLE", `This action needs one of: ${roles.join(", ")}${apiScope ? ` (or API scope ${apiScope})` : ""}`);
}

export const IdParam = z.object({ id: z.string().min(3).openapi({ param: { name: "id", in: "path" }, example: "case_7k2m9x4q1h8z3w5r" }) });

/** Typed access to the already-validated request parts (validated by the OpenAPI middleware). */
export function body<T extends z.ZodType>(c: Context<AppEnv>, _schema: T): z.infer<T> {
  return (c.req as unknown as { valid(t: string): unknown }).valid("json") as z.infer<T>;
}
export function query<T extends z.ZodType>(c: Context<AppEnv>, _schema: T): z.infer<T> {
  return (c.req as unknown as { valid(t: string): unknown }).valid("query") as z.infer<T>;
}
export function param(c: Context<AppEnv>): string {
  return (c.req as unknown as { valid(t: string): { id: string } }).valid("param").id;
}
