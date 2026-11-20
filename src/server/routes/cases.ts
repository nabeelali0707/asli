import { router, route, z, body, query, param, actx, need, IdParam } from "../http/route";
import { idempotent } from "../http/idempotency";
import { getActor } from "../http/middleware";
import {
  createCase,
  updateClaim,
  addDocument,
  submitCase,
  getCaseView,
  myCases,
  officerQueue,
  assignCase,
  escalateCase,
  requestProof,
  approveCase,
  addPayoutApproval,
  releasePayout,
  rejectCase,
  closeCase,
  addNote,
  appealCase,
  runDecision,
} from "../services/cases";
import { runCaseAgent } from "../services/agent";
import { applySync } from "../services/sync";
import { CASE_STATUSES } from "../db/schema";

export const caseRoutes = router();

const Claim = z
  .object({
    fullName: z.string().optional(),
    fatherName: z.string().optional(),
    cnic: z.string().optional().openapi({ example: "35201-1234567-1" }),
    dob: z.string().optional().openapi({ example: "1975-03-14" }),
    maritalStatus: z.enum(["married", "widowed", "single", "divorced"]).optional(),
    householdSize: z.number().int().min(1).max(30).optional(),
    monthlyIncome: z.number().int().min(0).optional(),
    district: z.string().optional(),
    phone: z.string().optional(),
    payoutAlias: z.string().optional(),
    statement: z.string().max(4000).optional().openapi({ description: "What the person said (transcript), kept for context" }),
  })
  .openapi("Claim");

const CreateCase = z
  .object({
    citizenId: z.string().optional().openapi({ description: "Required for officers (walk-in). Citizens/helpers act on themselves / the active family." }),
    type: z.enum(["relief_claim", "complaint"]).default("relief_claim"),
    claim: Claim.optional(),
    amountRequested: z.number().int().positive().optional(),
    clientRef: z.string().max(80).optional().openapi({ description: "Client-generated id for offline creation; same clientRef never creates two cases" }),
    createdVia: z.enum(["web", "voice", "helper", "ivr", "api", "sync"]).optional(),
  })
  .openapi("CreateCase");

caseRoutes.openapi(route({ method: "post", path: "/cases", tags: ["Cases"], summary: "Create a case (idempotent via clientRef or Idempotency-Key)", body: CreateCase, status: 201 }), async (c) => {
  const b = body(c, CreateCase);
  const r = await idempotent(c, b, async () => {
    const { case: row, replayed } = await createCase(c.get("db"), actx(c), b);
    return { status: replayed ? 200 : 201, body: { case: row, deduplicated: replayed } };
  });
  return c.json(r.body, r.status as 201);
});

caseRoutes.openapi(route({ method: "get", path: "/cases/mine", tags: ["Cases"], summary: "My cases (citizen) or the active family's cases (helper), with spoken reasons" }), async (c) => {
  return c.json({ cases: await myCases(c.get("db"), actx(c)) }, 200);
});

caseRoutes.openapi(route({ method: "get", path: "/cases/{id}", tags: ["Cases"], summary: "Case detail: decisions (user reason + full trace for staff), documents, notes, payout, notices", params: IdParam }), async (c) => {
  return c.json(await getCaseView(c.get("db"), actx(c), param(c)), 200);
});

caseRoutes.openapi(route({ method: "patch", path: "/cases/{id}/claim", tags: ["Cases"], summary: "Update claim fields (draft / needs_proof only)", params: IdParam, body: Claim }), async (c) => {
  return c.json({ case: await updateClaim(c.get("db"), actx(c), param(c), body(c, Claim)) }, 200);
});

const Doc = z
  .object({
    kind: z.enum(["cnic", "income_proof", "other"]),
    mime: z.string().regex(/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/),
    contentBase64: z.string().min(16).openapi({ description: "Base64 file content, max 6 MB" }),
  })
  .openapi("DocumentUpload");
caseRoutes.openapi(
  route({
    method: "post",
    path: "/cases/{id}/documents",
    tags: ["Cases"],
    summary: "Upload a document → blur check, signed-QR check, vision read, tamper score",
    description: "If the photo is blurry the response carries a spoken 'retake' prompt. Reports what could NOT be checked.",
    params: IdParam,
    body: Doc,
    status: 201,
  }),
  async (c) => {
    const b = body(c, Doc);
    const r = await idempotent(c, { id: param(c), kind: b.kind, len: b.contentBase64.length, head: b.contentBase64.slice(0, 64) }, async () => ({ status: 201, body: { document: await addDocument(c.get("db"), actx(c), param(c), b) } }));
    return c.json(r.body, r.status as 201);
  },
);

caseRoutes.openapi(
  route({
    method: "post",
    path: "/cases/{id}/submit",
    tags: ["Cases"],
    summary: "Submit → department consent receipt + signed 'received' notice + AI decision (fast / ask_proof / human)",
    params: IdParam,
  }),
  async (c) => {
    const r = await idempotent(c, { id: param(c) }, async () => ({ status: 200, body: await submitCase(c.get("db"), actx(c), param(c)) }));
    return c.json(r.body, 200);
  },
);

const Appeal = z.object({ statement: z.string().min(2).max(4000), via: z.enum(["voice", "web", "ivr", "helper"]).default("voice") }).openapi("Appeal");
caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/appeal", tags: ["Cases"], summary: "Appeal a decision (opens a linked case for a DIFFERENT officer)", params: IdParam, body: Appeal, status: 201 }), async (c) => {
  const b = body(c, Appeal);
  return c.json(await appealCase(c.get("db"), actx(c), param(c), b.statement, b.via), 201);
});

const Escalate = z.object({ reason: z.string().min(3) }).openapi("Escalate");
caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/escalate", tags: ["Cases"], summary: "Escalate to a human (citizen 'talk to a person', or officer)", params: IdParam, body: Escalate }), async (c) => {
  return c.json(await escalateCase(c.get("db"), getActor(c), param(c), body(c, Escalate).reason), 200);
});

// ───────── sync ─────────

const SyncOps = z
  .object({
    ops: z
      .array(
        z.union([
          z.object({ opId: z.string(), type: z.literal("create_case"), clientRef: z.string(), payload: z.object({ claim: Claim.optional(), type: z.enum(["relief_claim", "complaint"]).optional() }) }),
          z.object({ opId: z.string(), type: z.literal("update_claim"), caseRef: z.string(), payload: Claim }),
          z.object({ opId: z.string(), type: z.literal("add_document"), caseRef: z.string(), payload: Doc }),
          z.object({ opId: z.string(), type: z.literal("submit_case"), caseRef: z.string() }),
        ]),
      )
      .min(1)
      .max(50),
  })
  .openapi("SyncBatch");
caseRoutes.openapi(
  route({
    method: "post",
    path: "/sync",
    tags: ["Offline sync"],
    summary: "Replay an offline outbox in order (each opId applied at most once)",
    description: "Ops can reference a case created earlier in the batch by clientRef. Replaying the same batch after a dropped connection returns 'replayed' and creates nothing twice.",
    body: SyncOps,
  }),
  async (c) => c.json(await applySync(c.get("db"), actx(c), body(c, SyncOps).ops as never), 200),
);

// ───────── officer ─────────

const Queue = z.object({
  status: z.string().optional().openapi({ description: "Comma-separated statuses", example: "in_review,submitted" }),
  lane: z.enum(["auto", "fast", "ask_proof", "human"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
caseRoutes.openapi(route({ method: "get", path: "/officer/queue", tags: ["Officer"], summary: "Review queue sorted by priority, then lowest confidence, then oldest", query: Queue }), async (c) => {
  const actor = await need(c, ["officer", "admin", "auditor"], "cases:read");
  const q = query(c, Queue);
  const statuses = q.status?.split(",").filter((s): s is (typeof CASE_STATUSES)[number] => (CASE_STATUSES as readonly string[]).includes(s));
  return c.json({ cases: await officerQueue(c.get("db"), actor, { status: statuses, lane: q.lane, assignedToMe: q.mine === "true", limit: q.limit }) }, 200);
});

const Assign = z.object({ officerId: z.string().nullable() }).openapi("Assign");
caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/assign", tags: ["Officer"], summary: "Assign / unassign an officer", params: IdParam, body: Assign }), async (c) => {
  const actor = await need(c, ["officer", "admin"]);
  return c.json(await assignCase(c.get("db"), actor, param(c), body(c, Assign).officerId), 200);
});

const Note = z.object({ body: z.string().min(1).max(4000) }).openapi("Note");
caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/notes", tags: ["Officer"], summary: "Add a case note", params: IdParam, body: Note, status: 201 }), async (c) => {
  const actor = await need(c, ["officer", "admin"]);
  return c.json(await addNote(c.get("db"), actor, param(c), body(c, Note).body), 201);
});

const ProofReq = z.object({ items: z.array(z.enum(["cnic", "income_proof", "father_name", "dob", "retake_photo"])).min(1), note: z.string().optional() }).openapi("ProofRequest");
caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/request-proof", tags: ["Officer"], summary: "Ask the citizen for specific proof (signed notice + deadline)", params: IdParam, body: ProofReq }), async (c) => {
  const actor = await need(c, ["officer", "admin"]);
  const b = body(c, ProofReq);
  return c.json(await requestProof(c.get("db"), actor, param(c), b.items, b.note), 200);
});

const Approve = z.object({ amount: z.number().int().positive().optional(), note: z.string().optional() }).openapi("Approve");
caseRoutes.openapi(
  route({
    method: "post",
    path: "/cases/{id}/approve",
    tags: ["Officer"],
    summary: "Approve the claim → payout (second approver needed above the limit). Requires Idempotency-Key.",
    description: "Creates the payout with this officer's approval. At or below the rule set's secondApproverAbovePKR it is released at once via mock Raast and a signed payment notice is sent; above it, a different officer must approve.",
    params: IdParam,
    body: Approve,
  }),
  async (c) => {
    const actor = await need(c, ["officer", "admin"]);
    const b = body(c, Approve);
    const r = await idempotent(c, { id: param(c), ...b }, async () => ({ status: 200, body: await approveCase(c.get("db"), actor, param(c), b) }), null, { required: true });
    return c.json(r.body, 200);
  },
);

const Reason = z.object({ reason: z.string().min(3) }).openapi("Reason");
caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/reject", tags: ["Officer"], summary: "Reject (human only; citizen can appeal)", params: IdParam, body: Reason }), async (c) => {
  const actor = await need(c, ["officer", "admin"]);
  return c.json(await rejectCase(c.get("db"), actor, param(c), body(c, Reason).reason), 200);
});

const Close = z.object({ reason: z.string().optional() }).openapi("Close");
caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/close", tags: ["Officer"], summary: "Close a case", params: IdParam, body: Close }), async (c) => {
  const actor = await need(c, ["officer", "admin"]);
  return c.json(await closeCase(c.get("db"), actor, param(c), body(c, Close).reason), 200);
});

caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/redecide", tags: ["Officer"], summary: "Re-run the decision under the CURRENT rule version (old decisions keep theirs)", params: IdParam }), async (c) => {
  await need(c, ["officer", "admin"]);
  return c.json(await runDecision(c.get("db"), param(c), { trigger: "officer_redecide", requestId: c.get("requestId") }), 200);
});

caseRoutes.openapi(route({ method: "post", path: "/cases/{id}/agent", tags: ["AI"], summary: "Run the case agent (tool calls logged; cannot approve or pay)", params: IdParam }), async (c) => {
  const actor = await need(c, ["officer", "admin"]);
  return c.json(await runCaseAgent(c.get("db"), actor, param(c)), 200);
});

caseRoutes.openapi(route({ method: "post", path: "/payouts/{id}/approve", tags: ["Officer"], summary: "Second approval for a large payout (different officer with second-approver right)", params: IdParam }), async (c) => {
  const actor = await need(c, ["officer", "admin"]);
  const r = await idempotent(c, { id: param(c) }, async () => ({ status: 200, body: await addPayoutApproval(c.get("db"), actor, param(c)) }), null, { required: true });
  return c.json(r.body, 200);
});

caseRoutes.openapi(route({ method: "post", path: "/payouts/{id}/release", tags: ["Officer"], summary: "Release an approved payout via mock Raast (humans only; AI gets 403)", params: IdParam }), async (c) => {
  const r = await idempotent(c, { id: param(c) }, async () => ({ status: 200, body: await releasePayout(c.get("db"), getActor(c), param(c)) }), null, { required: true });
  return c.json(r.body, 200);
});
