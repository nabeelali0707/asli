/**
 * Every AI judgement gets TWO views and can be REPLAYED (Challenge 05):
 *   citizen view  → plain words (en/ur + audio key), no internals.
 *   auditor view  → input, model/rule version, confidence, result, full trace.
 * Kinds: case_decision · scam_verdict · message_classification · routing · case_signals ·
 *        policy_answer · extraction · document_read.
 * After a citizen withdraws the department's consent, the auditor view keeps the decision
 * structure but personal fields are replaced with "[removed: consent withdrawn]".
 */
import { and, desc, eq } from "drizzle-orm";
import type { DbOrTx, DB } from "../db/client";
import { aiDecisions, consents, ruleSets } from "../db/schema";
import { newId } from "../lib/ids";
import { canonicalJson, sha256Hex } from "../lib/crypto";
import { notFound, badRequest } from "../lib/errors";
import { classifyMessage, urgencyAndKind, caseSignals, type CaseSignalSummary } from "../ai/signals";
import { askPolicy } from "./rag";
import { extractClaim } from "../ai/claude";
import { decide, type DecisionInput } from "../domain/decision";
import { ruleSetDefinitionSchema } from "../domain/rules";
import { activeRuleSet } from "./rules";

export type AiKind = "case_decision" | "scam_verdict" | "message_classification" | "routing" | "case_signals" | "policy_answer" | "extraction" | "document_read";

export async function recordAiDecision(
  db: DbOrTx,
  r: {
    tenantId: string | null;
    kind: AiKind;
    subjectType?: string;
    subjectId?: string;
    citizenId?: string | null;
    input: unknown;
    output: unknown;
    citizenView: unknown;
    auditorView?: unknown;
    model: unknown;
    replayOf?: string;
  },
) {
  const id = newId("aid");
  await db.insert(aiDecisions).values({
    id,
    tenantId: r.tenantId,
    kind: r.kind,
    subjectType: r.subjectType ?? null,
    subjectId: r.subjectId ?? null,
    citizenId: r.citizenId ?? null,
    input: r.input as object,
    output: r.output as object,
    citizenView: r.citizenView as object,
    auditorView: (r.auditorView ?? { input: r.input, output: r.output, model: r.model }) as object,
    model: r.model as object,
    inputHash: sha256Hex(canonicalJson(r.input ?? null)),
    replayOf: r.replayOf ?? null,
  });
  return id;
}

const PII_KEYS = new Set(["fullName", "fatherName", "cnic", "dob", "phone", "payoutAlias", "alias", "nameVariants", "dobValues", "statement", "transcript", "text", "excerpt", "name", "registryName"]);
const REMOVED = "[removed: consent withdrawn]";

export function stripPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPii);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = PII_KEYS.has(k) && v !== null && v !== undefined ? REMOVED : stripPii(v);
    return out;
  }
  return value;
}

/** True when the citizen has withdrawn the department's consent and none is active. */
export async function consentWithdrawnForDepartment(db: DbOrTx, citizenId: string | null | undefined): Promise<boolean> {
  if (!citizenId) return false;
  const rows = await db.select({ status: consents.status, granteeType: consents.granteeType }).from(consents).where(eq(consents.citizenId, citizenId));
  const dept = rows.filter((r) => r.granteeType === "department");
  return dept.length > 0 && !dept.some((r) => r.status === "active") && dept.some((r) => r.status === "withdrawn");
}

export async function getAiDecision(db: DbOrTx, id: string, view: "citizen" | "auditor") {
  const [row] = await db.select().from(aiDecisions).where(eq(aiDecisions.id, id));
  if (!row) throw notFound("AI decision");
  const base = { id: row.id, kind: row.kind, subjectType: row.subjectType, subjectId: row.subjectId, createdAt: row.createdAt, replayOf: row.replayOf };
  if (view === "citizen") return { ...base, view, explanation: row.citizenView };
  const withdrawn = await consentWithdrawnForDepartment(db, row.citizenId);
  return {
    ...base,
    view,
    tenantId: row.tenantId,
    inputHash: row.inputHash,
    model: row.model,
    trace: withdrawn ? stripPii(row.auditorView) : row.auditorView,
    piiRemoved: withdrawn,
  };
}

export async function listAiDecisions(db: DbOrTx, f: { tenantId: string; subjectId?: string; kind?: string; citizenId?: string; limit?: number }) {
  const where = [eq(aiDecisions.tenantId, f.tenantId)];
  if (f.subjectId) where.push(eq(aiDecisions.subjectId, f.subjectId));
  if (f.kind) where.push(eq(aiDecisions.kind, f.kind));
  if (f.citizenId) where.push(eq(aiDecisions.citizenId, f.citizenId));
  const rows = await db
    .select({ id: aiDecisions.id, kind: aiDecisions.kind, subjectType: aiDecisions.subjectType, subjectId: aiDecisions.subjectId, citizenId: aiDecisions.citizenId, citizenView: aiDecisions.citizenView, createdAt: aiDecisions.createdAt, replayOf: aiDecisions.replayOf })
    .from(aiDecisions)
    .where(and(...where))
    .orderBy(desc(aiDecisions.createdAt))
    .limit(Math.min(f.limit ?? 100, 500));
  return rows;
}

function diff(a: unknown, b: unknown, path = ""): string[] {
  if (canonicalJson(a) === canonicalJson(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return [path || "(root)"];
}

/**
 * Replay: run the same stored input again. For case decisions we replay under the ORIGINAL rule
 * version (must reproduce exactly — proves determinism) and under the CURRENT version (shows drift).
 * For model-backed kinds, a changed answer means the model or its fallback changed; that is reported.
 */
export async function replayAiDecision(db: DB, id: string) {
  const [row] = await db.select().from(aiDecisions).where(eq(aiDecisions.id, id));
  if (!row) throw notFound("AI decision");
  const input = row.input as Record<string, unknown>;
  let replayed: unknown;
  let extra: Record<string, unknown> = {};
  switch (row.kind) {
    case "case_decision": {
      const { ruleSetId, ...rest } = input as { ruleSetId: string } & Omit<DecisionInput, "ruleSet">;
      const [rs] = await db.select().from(ruleSets).where(eq(ruleSets.id, ruleSetId));
      if (!rs) throw notFound("Original rule set");
      const original = decide({ ...rest, ruleSet: { id: rs.id, version: rs.version, definition: ruleSetDefinitionSchema.parse(rs.definition) } });
      const cur = await activeRuleSet(db, row.tenantId!);
      const current = decide({ ...rest, ruleSet: { id: cur.id, version: cur.version, definition: cur.definition } });
      replayed = summarizeDecision(original);
      extra = { underCurrentRules: { version: cur.version, ...summarizeDecision(current) }, originalRuleVersion: rs.version };
      break;
    }
    case "scam_verdict":
    case "message_classification": {
      const c = await classifyMessage(String(input.text ?? ""), (input.sender as string | null) ?? null);
      replayed = { category: c.category, asksForFeeOrCode: c.asksForFeeOrCode, source: c.meta.source };
      break;
    }
    case "routing":
      replayed = await urgencyAndKind(String(input.text ?? "")).then((r) => ({ urgency: r.urgency, kind: r.kind, source: r.meta.source }));
      break;
    case "case_signals":
      replayed = await caseSignals(input as unknown as CaseSignalSummary).then((r) => ({ signals: r.signals, source: r.meta.source }));
      break;
    case "policy_answer":
      replayed = await askPolicy(String(input.question ?? "")).then((r) => ({ answerable: r.answerable, sources: r.sources.map((s) => s.id), mode: r.mode }));
      break;
    case "extraction":
      replayed = await extractClaim(String(input.transcript ?? "")).then((r) => ({ fields: r.data, provider: r.meta.provider }));
      break;
    default:
      throw badRequest("NOT_REPLAYABLE", `Kind ${row.kind} cannot be replayed`);
  }
  const originalOutput = row.kind === "case_decision" ? summarizeDecision(row.output as never) : pickComparable(row.kind, row.output);
  const changed = diff(originalOutput, replayed);
  const replayId = await recordAiDecision(db, {
    tenantId: row.tenantId,
    kind: row.kind as AiKind,
    subjectType: row.subjectType ?? undefined,
    subjectId: row.subjectId ?? undefined,
    citizenId: row.citizenId,
    input: row.input,
    output: replayed,
    citizenView: row.citizenView,
    model: { replay: true, of: row.id },
    replayOf: row.id,
  });
  return { replayId, of: row.id, kind: row.kind, reproduced: changed.length === 0, changedFields: changed, original: originalOutput, replayed, ...extra };
}

function summarizeDecision(d: { lane: string; eligible: boolean | null; score: number; hardStops: string[]; reasonCodes: string[]; calibratedP?: number | null; benefitAmount: number }) {
  return { lane: d.lane, eligible: d.eligible, score: d.score, hardStops: d.hardStops, reasonCodes: d.reasonCodes, calibratedP: d.calibratedP ?? null, benefitAmount: d.benefitAmount };
}

function pickComparable(kind: string, out: unknown): unknown {
  const o = out as Record<string, unknown>;
  switch (kind) {
    case "scam_verdict":
    case "message_classification":
      return { category: o.category, asksForFeeOrCode: o.asksForFeeOrCode, source: (o.meta as { source?: string } | undefined)?.source ?? o.source };
    case "routing":
      return { urgency: o.urgency, kind: o.kind, source: (o.meta as { source?: string } | undefined)?.source ?? o.source };
    case "case_signals":
      return { signals: o.signals, source: (o.meta as { source?: string } | undefined)?.source ?? o.source };
    case "policy_answer":
      return { answerable: o.answerable, sources: ((o.sources as { id: string }[]) ?? []).map((s) => s.id), mode: o.mode };
    case "extraction":
      return { fields: o.fields ?? o.data, provider: (o.meta as { provider?: string } | undefined)?.provider ?? o.provider };
  }
  return out;
}
