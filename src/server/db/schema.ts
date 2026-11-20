/**
 * Asli database schema (Postgres / Supabase; PGlite locally and in tests).
 *
 * Conventions:
 * - Text primary keys with a readable prefix (case_…, usr_…) generated in code.
 * - Every tenant-owned row carries tenant_id (department workspace).
 * - audit_log is append-only and hash-chained (see lib/audit.ts).
 */
import {
  pgTable,
  text,
  integer,
  bigserial,
  boolean,
  jsonb,
  real,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const ROLES = ["citizen", "helper", "officer", "admin", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export const CASE_STATUSES = [
  "draft",
  "submitted",
  "needs_proof",
  "in_review",
  "approved",
  "rejected",
  "paid",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const LANES = ["auto", "fast", "ask_proof", "human"] as const;
export type Lane = (typeof LANES)[number];

// ───────────────────────── tenancy & users ─────────────────────────

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("standard"), // free | standard | enterprise
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<Role>().notNull(),
    displayName: text("display_name").notNull(),
    citizenId: text("citizen_id"), // for role=citizen: their beneficiary profile
    canSecondApprove: boolean("can_second_approve").notNull().default(false),
    active: boolean("active").notNull().default(true),
    tokenVersion: integer("token_version").notNull().default(0), // bump to revoke all JWTs
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

// ───────────────────────── beneficiaries ─────────────────────────

export const households = pgTable("households", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  label: text("label").notNull(),
  district: text("district"),
  createdAt: createdAt(),
});

export const citizens = pgTable(
  "citizens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    householdId: text("household_id").references(() => households.id),
    fullName: text("full_name").notNull(),
    nameKey: text("name_key").notNull(), // normalised for matching
    fatherName: text("father_name"),
    cnic: text("cnic"), // 13 digits, no dashes; nullable = missing data
    dob: text("dob"), // YYYY-MM-DD
    gender: text("gender"),
    district: text("district"),
    phone: text("phone"),
    language: text("language").notNull().default("ur"),
    payoutAlias: text("payout_alias"), // mock Raast alias (phone/IBAN-like)
    pinHash: text("pin_hash"), // 4-6 digit family PIN for helper-mode switching on a shared phone
    mergedInto: text("merged_into"), // set when an officer confirms a duplicate
    createdAt: createdAt(),
  },
  (t) => [index("citizens_cnic_idx").on(t.cnic), index("citizens_name_key_idx").on(t.nameKey)],
);

// ───────────────────────── consent ─────────────────────────

export const consents = pgTable(
  "consents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    citizenId: text("citizen_id").notNull().references(() => citizens.id),
    granteeType: text("grantee_type").$type<"user" | "department">().notNull(),
    granteeId: text("grantee_id").notNull(), // user id or tenant id
    purpose: text("purpose").notNull(), // e.g. relief_case
    scopes: jsonb("scopes").$type<string[]>().notNull(), // identity.read, income.read, case.write, documents.read
    status: text("status").$type<"active" | "withdrawn" | "expired">().notNull().default("active"),
    grantedVia: text("granted_via").notNull().default("web"), // web | voice | pin | ivr
    receiptHash: text("receipt_hash").notNull(),
    receiptText: jsonb("receipt_text").$type<{ en: string; ur: string }>().notNull(),
    expiresAt: ts("expires_at"),
    withdrawnAt: ts("withdrawn_at"),
    withdrawnReason: text("withdrawn_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("consents_citizen_idx").on(t.citizenId)],
);

export const correctionRequests = pgTable("correction_requests", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  citizenId: text("citizen_id").notNull().references(() => citizens.id),
  field: text("field").notNull(),
  currentValue: text("current_value"),
  requestedValue: text("requested_value").notNull(),
  reason: text("reason"),
  status: text("status").$type<"open" | "applied" | "rejected">().notNull().default("open"),
  reviewedBy: text("reviewed_by"),
  createdAt: createdAt(),
});

// ───────────────────────── rules ─────────────────────────

export const ruleSets = pgTable(
  "rule_sets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    version: integer("version").notNull(),
    status: text("status").$type<"draft" | "published" | "archived">().notNull(),
    definition: jsonb("definition").notNull(), // RuleSetDefinition (domain/rules.ts)
    note: text("note"),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("rule_sets_tenant_version_uq").on(t.tenantId, t.version)],
);

// ───────────────────────── cases ─────────────────────────

export const cases = pgTable(
  "cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    citizenId: text("citizen_id").notNull().references(() => citizens.id),
    type: text("type").$type<"relief_claim" | "complaint" | "appeal">().notNull(),
    status: text("status").$type<CaseStatus>().notNull().default("draft"),
    lane: text("lane").$type<Lane>(),
    priority: integer("priority").notNull().default(0), // 0-100, higher first
    confidence: real("confidence"),
    amountRequested: integer("amount_requested"),
    claim: jsonb("claim").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdVia: text("created_via").notNull().default("web"), // web | voice | helper | ivr | api | sync
    assignedTo: text("assigned_to"),
    parentCaseId: text("parent_case_id"),
    proofRequested: jsonb("proof_requested").$type<string[]>(),
    proofDeadline: ts("proof_deadline"),
    clientRef: text("client_ref"), // offline-created id; unique per creator
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    index("cases_tenant_status_idx").on(t.tenantId, t.status),
    index("cases_citizen_idx").on(t.citizenId),
    uniqueIndex("cases_client_ref_uq").on(t.createdBy, t.clientRef),
  ],
);

export const caseNotes = pgTable("case_notes", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  authorType: text("author_type").$type<"user" | "ai" | "agent" | "system">().notNull(),
  authorId: text("author_id"),
  kind: text("kind").notNull().default("note"), // note | handoff | proof_request | agent_step
  body: text("body").notNull(),
  data: jsonb("data"),
  createdAt: createdAt(),
});

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id").references(() => cases.id),
    citizenId: text("citizen_id").notNull().references(() => citizens.id),
    kind: text("kind").$type<"cnic" | "income_proof" | "other">().notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    dhash: text("dhash"), // 64-bit perceptual difference hash (hex) for near-duplicate image detection
    contentBase64: text("content_base64").notNull(),
    extracted: jsonb("extracted").$type<Record<string, unknown>>(),
    checks: jsonb("checks").$type<Record<string, unknown>>(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("documents_case_idx").on(t.caseId)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull().references(() => cases.id),
    tenantId: text("tenant_id").notNull(),
    ruleSetId: text("rule_set_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    lane: text("lane").$type<Lane>().notNull(),
    eligible: boolean("eligible"),
    score: real("score").notNull(),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull(),
    hardStops: jsonb("hard_stops").$type<string[]>().notNull(),
    userReason: jsonb("user_reason").$type<{ en: string; ur: string }>().notNull(),
    counterfactuals: jsonb("counterfactuals").$type<{ en: string; ur: string }[]>().notNull(),
    trace: jsonb("trace").notNull(), // full auditor trace
    modelInfo: jsonb("model_info").notNull(), // model + prompt versions per AI call
    inputHash: text("input_hash").notNull(),
    actorType: text("actor_type").notNull().default("ai"),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_case_idx").on(t.caseId)],
);

// ───────────────────────── money ─────────────────────────

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id").notNull().references(() => cases.id),
    citizenId: text("citizen_id").notNull(),
    amount: integer("amount").notNull(),
    alias: text("alias").notNull(),
    status: text("status")
      .$type<"reserved" | "pending_approval" | "approved" | "released" | "failed" | "rejected" | "cancelled">()
      .notNull()
      .default("pending_approval"),
    requiredApprovals: integer("required_approvals").notNull(),
    approvals: jsonb("approvals").$type<{ userId: string; at: string }[]>().notNull().default([]),
    raastRef: text("raast_ref"),
    /** Provisional auto-approval: money is only reserved until this time; citizen/officer can cancel. */
    provisional: boolean("provisional").notNull().default(false),
    coolingOffUntil: timestamp("cooling_off_until", { withTimezone: true, mode: "date" }),
    cancelledReason: text("cancelled_reason"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    releasedAt: ts("released_at"),
  },
  (t) => [uniqueIndex("payouts_case_uq").on(t.caseId)],
);

// ───────────────────────── signed truth ─────────────────────────

export const notices = pgTable(
  "notices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id").notNull(),
    citizenId: text("citizen_id").notNull(),
    type: text("type").notNull(), // payment_released | proof_requested | decision | case_received
    amount: integer("amount"),
    payload: jsonb("payload").notNull(), // the exact signed object
    token: text("token").notNull(), // base64url(payload).base64url(signature)
    code: text("code").notNull(), // 4-digit spoken code
    nonce: text("nonce").notNull().unique(),
    keyId: text("key_id").notNull(),
    issuedAt: ts("issued_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    verifyCount: integer("verify_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("notices_citizen_idx").on(t.citizenId), index("notices_code_idx").on(t.code)],
);

export const attestations = pgTable("attestations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  citizenId: text("citizen_id").notNull(),
  caseId: text("case_id"),
  claim: text("claim").notNull(), // identity_verified | eligible_under_rules | ...
  value: boolean("value").notNull(),
  audience: text("audience").notNull(),
  token: text("token").notNull(),
  issuedBy: text("issued_by").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const scamReports = pgTable(
  "scam_reports",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reporterId: text("reporter_id"),
    citizenId: text("citizen_id"),
    text: text("text").notNull(),
    sender: text("sender"),
    district: text("district"),
    verdict: text("verdict").notNull(),
    category: text("category"),
    classification: jsonb("classification"),
    ledgerCheck: jsonb("ledger_check"),
    status: text("status").$type<"open" | "confirmed_scam" | "false_alarm">().notNull().default("open"),
    reviewedBy: text("reviewed_by"),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
  },
  (t) => [index("scam_reports_created_idx").on(t.createdAt)],
);

// ───────────────────────── audit, keys, jobs ─────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    chainIndex: integer("chain_index").notNull().default(0), // contiguous 1..N, set by the DB trigger
    tenantId: text("tenant_id"),
    at: ts("at").notNull().defaultNow(),
    actorType: text("actor_type").$type<"user" | "ai" | "agent" | "system" | "api_key">().notNull(),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome").notNull().default("ok"), // ok | denied | error
    detail: jsonb("detail"),
    requestId: text("request_id"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_target_idx").on(t.targetType, t.targetId), index("audit_actor_idx").on(t.actorId)],
);

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  createdBy: text("created_by").notNull(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: integer("status").notNull(),
    body: jsonb("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: ts("run_at").notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("jobs_due_idx").on(t.status, t.runAt)],
);

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").$type<"pending" | "delivered" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  responseCode: integer("response_code"),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id"),
    citizenId: text("citizen_id"),
    channel: text("channel").$type<"in_app" | "sms" | "whatsapp" | "ivr">().notNull(),
    title: text("title").notNull(),
    body: jsonb("body").$type<{ en: string; ur: string }>().notNull(),
    audioKey: text("audio_key"),
    noticeId: text("notice_id"),
    status: text("status").$type<"queued" | "sent" | "failed">().notNull().default("queued"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId), index("notifications_citizen_idx").on(t.citizenId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const evalRuns = pgTable("eval_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  caseCount: integer("case_count").notNull(),
  costs: jsonb("costs").notNull(),
  metrics: jsonb("metrics").notNull(),
  curve: jsonb("curve").notNull(),
  confusion: jsonb("confusion").notNull(),
  thresholds: jsonb("thresholds").notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const usageCounters = pgTable(
  "usage_counters",
  {
    tenantId: text("tenant_id").notNull(),
    period: text("period").notNull(), // YYYY-MM
    apiCalls: integer("api_calls").notNull().default(0),
    aiCalls: integer("ai_calls").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.period] })],
);

export const ivrSessions = pgTable("ivr_sessions", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull(),
  citizenId: text("citizen_id"),
  state: text("state").notNull(),
  data: jsonb("data").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ───────────────────────── mock DPI (simulated government systems) ─────────────────────────

export const mockNadra = pgTable("mock_nadra", {
  cnic: text("cnic").primaryKey(),
  fullName: text("full_name").notNull(),
  fatherName: text("father_name").notNull(),
  dob: text("dob").notNull(),
  gender: text("gender").notNull(),
  district: text("district").notNull(),
  maritalStatus: text("marital_status").notNull(), // married | widowed | single
  alive: boolean("alive").notNull().default(true),
});

export const mockIncome = pgTable("mock_income", {
  cnic: text("cnic").primaryKey(),
  monthlyIncome: integer("monthly_income").notNull(),
  householdSize: integer("household_size").notNull(),
  source: text("source").notNull(),
});

export const mockRaastLedger = pgTable(
  "mock_raast_ledger",
  {
    ref: text("ref").primaryKey(),
    alias: text("alias").notNull(),
    amount: integer("amount").notNull(),
    caseId: text("case_id"),
    payoutId: text("payout_id").notNull(),
    status: text("status").$type<"settled" | "reversed">().notNull().default("settled"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mock_raast_payout_uq").on(t.payoutId)],
);

// ───────────────────────── round 3 additions ─────────────────────────

/** Time-boxed officer access to full identity fields, with a reason the citizen can see. */
export const breakGlassGrants = pgTable("break_glass_grants", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  officerId: text("officer_id").notNull(),
  citizenId: text("citizen_id").notNull(),
  reason: text("reason").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

/** Every AI judgement (scam verdicts, routing, triage, policy answers, extraction, case decisions):
 *  stored input + output, a citizen view and an auditor view, so it can be explained and replayed. */
export const aiDecisions = pgTable(
  "ai_decisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    kind: text("kind").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    citizenId: text("citizen_id"),
    input: jsonb("input").notNull(),
    output: jsonb("output").notNull(),
    citizenView: jsonb("citizen_view").notNull(),
    auditorView: jsonb("auditor_view").notNull(),
    model: jsonb("model").notNull(),
    inputHash: text("input_hash").notNull(),
    replayOf: text("replay_of"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_decisions_subject_idx").on(t.subjectType, t.subjectId), index("ai_decisions_kind_idx").on(t.kind)],
);

/** Durable, resumable pipeline runs (decision pipeline): each step persisted with attempts and timing. */
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").$type<"running" | "done" | "failed" | "halted">().notNull(),
    trigger: text("trigger").notNull(),
    steps: jsonb("steps").$type<{ name: string; status: string; attempts: number; ms: number; error?: string; at: string }[]>().notNull().default([]),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("pipeline_runs_case_idx").on(t.caseId), index("pipeline_runs_status_idx").on(t.status)],
);

/** Payout-account (Raast alias) changes: PIN + officer approval + cooling-off + notice to the old number. */
export const payoutAliasChanges = pgTable("payout_alias_changes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  citizenId: text("citizen_id").notNull(),
  oldAlias: text("old_alias"),
  newAlias: text("new_alias").notNull(),
  requestedBy: text("requested_by").notNull(),
  status: text("status").$type<"pending_officer" | "cooling_off" | "applied" | "rejected" | "frozen">().notNull(),
  approvedBy: text("approved_by"),
  effectiveAt: ts("effective_at"),
  frozenAt: ts("frozen_at"),
  frozenVia: text("frozen_via"),
  createdAt: createdAt(),
});

/** Citizen confirms the exact amount that arrived ("received less" opens a complaint). */
export const payoutReceipts = pgTable("payout_receipts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  payoutId: text("payout_id").notNull(),
  citizenId: text("citizen_id").notNull(),
  expectedAmount: integer("expected_amount").notNull(),
  confirmedAmount: integer("confirmed_amount"),
  status: text("status").$type<"received_full" | "received_less" | "not_received">().notNull(),
  via: text("via").notNull(),
  complaintCaseId: text("complaint_case_id"),
  createdAt: createdAt(),
});

/** Versioned calibrated evidence model (logistic regression + isotonic), trained on frozen synthetic data. */
export const scoringModels = pgTable("scoring_models", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  model: jsonb("model").notNull(),
  metrics: jsonb("metrics").notNull(),
  datasetHash: text("dataset_hash").notNull(),
  active: boolean("active").notNull().default(false),
  createdAt: createdAt(),
});
