import { router, route, z, body, param, actx, need, IdParam } from "../http/route";
import { getActor, ipKey } from "../http/middleware";
import { verifyMessage } from "../services/verify";
import { publicKeyInfo } from "../lib/signing";
import { grantConsent, withdrawConsent, consentDashboard, requestCorrection, reviewCorrection, openCorrections } from "../services/consent";
import { issueAttestation, verifyAttestation, breakGlass, ATTESTATION_CLAIMS } from "../services/insights";
import { assertCitizenAccess, getCitizenOr404, presentCitizen, SCOPES } from "../services/access";
import { SYSTEM_ACTOR } from "../lib/actor";
import { rateLimit } from "../http/ratelimit";
import { AppError, badRequest } from "../lib/errors";
import { nadraLookup, incomeLookup } from "../services/mockdpi";

export const trustRoutes = router();

// ───────── Signed Truth ─────────

const Verify = z
  .object({
    text: z.string().max(4000).optional().openapi({ description: "The message as received (SMS/WhatsApp text, may include a verify link)" }),
    token: z.string().optional().openapi({ description: "A signed ASLI1.… token, if known" }),
    sender: z.string().optional().openapi({ example: "03451234567" }),
    citizenId: z.string().optional().openapi({ description: "Whose case to check against. Citizens/helpers: defaults to themselves / the active family." }),
    district: z.string().optional(),
  })
  .openapi("VerifyMessage");
trustRoutes.openapi(
  route({
    method: "post",
    path: "/verify",
    tags: ["Signed Truth"],
    summary: "Is this message real? Signature + case ledger + mock Raast first, classifier second",
    description:
      "Verdicts: genuine, tampered, scam, not_linked, code_mismatch, expired, suspicious ('I am not sure'), unrelated. Returns a spoken answer (en/ur + audio key), every check performed, and opens a scam report for bad ones. Works signed-in or anonymously (rate-limited).",
    body: Verify,
    auth: false,
  }),
  async (c) => {
    const b = body(c, Verify);
    if (!b.text && !b.token) throw badRequest("NOTHING_TO_CHECK", "Send the message text or a token");
    const actor = c.get("actor") ?? SYSTEM_ACTOR;
    if (!c.get("actor")) {
      const rl = rateLimit(`verify:${ipKey(c)}`, 30, 60_000);
      if (!rl.ok) throw new AppError(429, "RATE_LIMITED", "Too many checks; try again in a minute.");
    }
    let citizenId = b.citizenId ?? null;
    if (actor.type === "user" && actor.role === "citizen") citizenId = actor.citizenId;
    else if (actor.type === "user" && actor.role === "helper") citizenId = c.get("actFor")?.citizenId ?? null;
    else if (citizenId && actor.type === "user") await assertCitizenAccess(c.get("db"), actx(c), citizenId, "case.read");
    else if (!c.get("actor")) citizenId = null; // anonymous callers can only verify tokens / text, not probe someone's case
    const out = await verifyMessage(c.get("db"), actor, { ...b, citizenId }, c.get("requestId"));
    return c.json(out, 200);
  },
);

trustRoutes.openapi(route({ method: "get", path: "/verify/{id}", tags: ["Signed Truth"], summary: "Verify a token from a verify link (/v/{token})", params: z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) }), auth: false }), async (c) => {
  const rl = rateLimit(`verify:${ipKey(c)}`, 30, 60_000);
  if (!rl.ok) throw new AppError(429, "RATE_LIMITED", "Too many checks; try again in a minute.");
  return c.json(await verifyMessage(c.get("db"), c.get("actor") ?? SYSTEM_ACTOR, { token: param(c) }, c.get("requestId")), 200);
});

trustRoutes.openapi(route({ method: "get", path: "/signing-key", tags: ["Signed Truth"], summary: "Public key used to sign notices and attestations (verify offline)", auth: false }), async (c) => c.json(await publicKeyInfo(c.get("db")), 200));

// ───────── consent ─────────

function citizenFromCaller(c: Parameters<typeof actx>[0], requested?: string): string {
  const a = getActor(c);
  if (a.type === "user" && a.role === "citizen" && a.citizenId) return a.citizenId;
  if (a.type === "user" && a.role === "helper" && c.get("actFor")) return c.get("actFor")!.citizenId;
  if (!requested) throw badRequest("CITIZEN_REQUIRED", "citizenId is required");
  return requested;
}

trustRoutes.openapi(
  route({ method: "get", path: "/consent", tags: ["Consent"], summary: "Who has my data, what they can see, and who actually used it", query: z.object({ citizenId: z.string().optional() }) }),
  async (c) => {
    const citizenId = citizenFromCaller(c, c.req.query("citizenId"));
    await assertCitizenAccess(c.get("db"), actx(c), citizenId, "case.read");
    return c.json(await consentDashboard(c.get("db"), citizenId), 200);
  },
);

const Grant = z
  .object({
    granteeType: z.enum(["user", "department"]),
    granteeId: z.string(),
    scopes: z.array(z.enum(SCOPES)).min(1),
    purpose: z.string().min(3).default("relief_case"),
    expiresInDays: z.number().int().min(1).max(730).optional(),
    grantedVia: z.enum(["web", "voice", "pin", "ivr"]).default("web"),
  })
  .openapi("GrantConsent");
trustRoutes.openapi(route({ method: "post", path: "/consent", tags: ["Consent"], summary: "Give permission (returns a receipt to read aloud)", body: Grant, status: 201 }), async (c) => {
  const b = body(c, Grant);
  const citizenId = citizenFromCaller(c);
  return c.json(await grantConsent(c.get("db"), getActor(c), { ...b, citizenId, actFor: c.get("actFor") ? { citizenId: c.get("actFor")!.citizenId } : undefined }), 201);
});

const Withdraw = z.object({ reason: z.string().optional() }).openapi("WithdrawConsent");
trustRoutes.openapi(route({ method: "post", path: "/consent/{id}/withdraw", tags: ["Consent"], summary: "Take permission back — access stops on the very next request", params: IdParam, body: Withdraw }), async (c) => {
  return c.json(await withdrawConsent(c.get("db"), getActor(c), param(c), body(c, Withdraw).reason), 200);
});

const Correction = z.object({ field: z.enum(["fullName", "fatherName", "dob", "district", "phone", "payoutAlias"]), requestedValue: z.string().min(1), reason: z.string().optional() }).openapi("CorrectionRequest");
trustRoutes.openapi(route({ method: "post", path: "/consent/corrections", tags: ["Consent"], summary: "Ask to correct my data", body: Correction, status: 201 }), async (c) => {
  const b = body(c, Correction);
  const citizenId = citizenFromCaller(c);
  await assertCitizenAccess(c.get("db"), actx(c), citizenId, "case.write", { write: true });
  return c.json(await requestCorrection(c.get("db"), getActor(c), citizenId, b.field, b.requestedValue, b.reason), 201);
});

trustRoutes.openapi(route({ method: "get", path: "/consent/corrections/open", tags: ["Consent"], summary: "Open correction requests (officer)" }), async (c) => {
  const a = await need(c, ["officer", "admin"]);
  return c.json({ corrections: await openCorrections(c.get("db"), a.tenantId!) }, 200);
});

const Review = z.object({ approve: z.boolean() }).openapi("ReviewCorrection");
trustRoutes.openapi(route({ method: "post", path: "/consent/corrections/{id}/review", tags: ["Consent"], summary: "Apply or reject a correction (officer)", params: IdParam, body: Review }), async (c) => {
  const a = await need(c, ["officer", "admin"]);
  return c.json(await reviewCorrection(c.get("db"), a, param(c), body(c, Review).approve), 200);
});

// ───────── citizens, prove-don't-share, break-glass ─────────

trustRoutes.openapi(route({ method: "get", path: "/citizens/{id}", tags: ["Citizens"], summary: "Citizen profile (masked for staff; full for the person and consented helpers)", params: IdParam }), async (c) => {
  const db = c.get("db");
  const access = await assertCitizenAccess(db, actx(c), param(c), "case.read");
  return c.json({ citizen: presentCitizen(await getCitizenOr404(db, param(c)), access.view) }, 200);
});

const BreakGlass = z.object({ reason: z.string().min(10) }).openapi("BreakGlass");
trustRoutes.openapi(route({ method: "post", path: "/citizens/{id}/break-glass", tags: ["Citizens"], summary: "Officer full-detail view with a reason — logged and shown to the citizen", params: IdParam, body: BreakGlass }), async (c) => {
  const a = await need(c, ["officer", "admin"]);
  return c.json(await breakGlass(c.get("db"), a, param(c), body(c, BreakGlass).reason), 200);
});

trustRoutes.openapi(route({ method: "get", path: "/citizens/{id}/registry", tags: ["Mock DPI"], summary: "Mock NADRA + income registry lookup (consent-gated; 403 when withdrawn)", params: IdParam }), async (c) => {
  const db = c.get("db");
  const ctx = actx(c);
  const identity = await nadraLookup(db, ctx, param(c));
  const income = await incomeLookup(db, ctx, param(c)).catch((e) => ({ error: (e as AppError).code }));
  return c.json({ simulated: true, identity, income }, 200);
});

const Attest = z.object({ claim: z.enum(ATTESTATION_CLAIMS), audience: z.string().min(2).openapi({ example: "provincial-health-dept" }) }).openapi("AttestationRequest");
trustRoutes.openapi(
  route({
    method: "post",
    path: "/citizens/{id}/attestations",
    tags: ["Prove, don't share"],
    summary: "Issue a signed yes/no attestation instead of sharing data",
    description: "Another department learns only 'eligible: yes' (signed, expiring), never the person's income, CNIC or documents.",
    params: IdParam,
    body: Attest,
    status: 201,
  }),
  async (c) => {
    const b = body(c, Attest);
    return c.json(await issueAttestation(c.get("db"), getActor(c), param(c), b.claim, b.audience), 201);
  },
);

const AttVerify = z.object({ token: z.string() }).openapi("VerifyAttestation");
trustRoutes.openapi(route({ method: "post", path: "/attestations/verify", tags: ["Prove, don't share"], summary: "Verify an attestation token", body: AttVerify, auth: false }), async (c) => {
  return c.json(await verifyAttestation(c.get("db"), body(c, AttVerify).token), 200);
});
